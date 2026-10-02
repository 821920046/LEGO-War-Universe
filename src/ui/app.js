import { createRegistry } from '../domain/registry.js';
import { planFilm } from '../domain/planner.js';
import { compileShot } from '../domain/compiler.js';
import { validateFilmPlan } from '../domain/shot-spec.js';
import { transpileMovieToLego, CINEMA_DATABASE } from '../domain/cinema-homage.js';
import { callAiBrain } from '../domain/ai-brain.js';
import { buildRoster, rosterToJSON, rosterFromJSON } from '../domain/roster.js';
import { extractCharacterLineup, generateLineupPrompt } from '../domain/character-lineup.js';
import { checkContentGovernance } from '../domain/governance.js';
import { ProjectStore } from './project-store.js';
import { renderTimeline, exportToCapCutCSV } from './timeline.js';
import { renderShotEditor } from './shot-editor.js';
import { renderReviewQueue } from './review-queue.js';
import { renderAssetManager } from './asset-manager.js';
import { renderEvolutionPanel } from './evolution-panel.js';
import { loadLedger, saveLedger, createLedger, evolve, applyForgedAssets, enrichShotsWithForged, ledgerStats } from '../domain/evolution.js';
import { renderPlan, renderProjectTabs, renderViolations, continuityRepairWarnings, text, createEl } from './render.js';
import { toast, confirmDialog, promptDialog } from './feedback.js';
import { loadCustomAssets, applyCustomAssets } from './custom-assets.js';

const $ = id => document.getElementById(id);
const fallback = JSON.parse($('lwu-data').textContent);

const storeManager = new ProjectStore();
let currentStore = null;
let currentProject = null;
let activeRegistry = null;
let activeRegistryData = null;
let activeProfile = null;
let evolutionLedger = null;
let transpiling = false;

/**
 * 统一渲染进化面板（含重置交互），避免在 boot / 切换 / 生成后重复实现。
 */
function refreshEvolutionPanel() {
  renderEvolutionPanel($('evolution-panel'), evolutionLedger || createLedger(), {
    registry: activeRegistry,
    onReset: async () => {
      const ok = await confirmDialog({
        title: '重置自我进化记忆',
        message: '将清空全部学习统计、锻造资产与晋升记录，且不可恢复。是否继续？',
        confirmText: '确认重置',
        danger: true
      });
      if (!ok) return;
      evolutionLedger = createLedger();
      saveLedger(evolutionLedger);
      refreshEvolutionPanel();
      toast('进化记忆已重置（刷新页面后锻造资产将被移除）', 'info', 4500);
    }
  });
}

/**
 * 生成后的自我进化闭环：衰减 → 锻造缺口 → 记录 → 晋升 → 让新装备上镜。
 * 返回富化后的镜头数组，并刷新进化面板。
 */
function runEvolution({ theme, engine, era, shots, forgeCount = 6 }) {
  try {
    const result = evolve({
      ledger: evolutionLedger || createLedger(),
      theme,
      engine,
      era,
      shots,
      registryData: activeRegistryData || {},
      forgeCount
    });
    evolutionLedger = result.ledger;
    saveLedger(evolutionLedger);

    const added = applyForgedAssets(activeRegistry, result.forgedAssets);
    if (added.added > 0) {
      const total = activeRegistry.byId.size;
      if ($('asset-manager-btn')) $('asset-manager-btn').textContent = `🧱 乐高资产库 (${total} · 进化 ${evolutionLedger.forged.length})`;
    }

    const enriched = enrichShotsWithForged(shots, result.forgedAssets, activeRegistry);
    refreshEvolutionPanel();

    return { shots: enriched.shots, forged: result.forgedAssets, promotions: result.newlyPromoted, applied: enriched.applied };
  } catch (err) {
    console.warn('自我进化流程跳过:', err);
    return { shots, forged: [], promotions: [], applied: [] };
  }
}

/** 生成后把进化成果反馈到界面状态栏 */
function reportEvolution({ forged, promotions, applied }, intentEl) {
  if (!intentEl) return;
  const bits = [];
  if (forged?.length) bits.push(`⚒️ 锻造 ${forged.length} 件新装备`);
  if (applied?.length) bits.push(`🎬 ${applied.length} 处已用上进化资产`);
  if (promotions?.length) bits.push(`⭐ 晋升 ${promotions.length} 项主力资产`);
  if (bits.length) {
    intentEl.textContent += ` ｜ ${bits.join(' · ')}`;
  }
}

/**
 * 统一的持久化入口。
 * 保存失败必须在界面上明确告知，否则用户会以为改动已经落盘。
 */
async function persist() {
  const result = await storeManager.saveAll(currentStore);
  if (!result.ok) toast(result.error, 'error', 6000);
  return result.ok;
}

/**
 * 统一的名册解析入口（角色代号 = 一部片子的演员身份，只能冻结一次）。
 *
 * 为什么要「继承」而不是「重算」：生成链路是
 *   规划器写台词（内含代号）→ 自我进化往镜头里补资产 → UI 重新聚合名册。
 * 若每次都按当前集合重算，补进来的新资产会把老资产挤出原代号，
 * 结果就是台词写着 GHOST、定妆表却变成 FALCON —— 视频生成直接串戏。
 * 因此这里始终以 currentProject.roster 为基准，只给「全新 ID」分配新代号。
 *
 * @returns {object|null} 名册对象（含 byId Map）
 */
function ensureRoster() {
  if (!currentProject) return null;
  const prior = rosterFromJSON(currentProject.roster);
  const roster = buildRoster(currentProject.shots || [], activeRegistry, { prior });
  currentProject.roster = rosterToJSON(roster);
  return roster;
}

function setProgress(message, visible = true) {
  const progressEl = $('transpile-progress');
  if (!progressEl) return;
  progressEl.style.display = visible ? 'block' : 'none';
  if (message) progressEl.textContent = message;
}

/**
 * 对一段文本执行内容治理，返回是否需要中止后续生成
 * @returns {object|null} 命中阻断时返回 governance 结果，否则 null
 */
function applyGovernance(rawText, { source = '主题' } = {}) {
  const governance = checkContentGovernance(rawText);

  if (governance.status === 'blocked') {
    text($('intent'), `❌ 已被内容安全策略阻断：${governance.reasons.join('；')}`);
    $('intent').className = 'bad';
    $('violations').replaceChildren(
      createEl('div', { class: 'alert alert--danger' },
        createEl('span', { class: 'alert__icon' }, '⛔'),
        createEl('span', {}, `触发阻断规则: ${governance.flags.join(', ')}。请修改${source}以符合微缩军事安全规范。`))
    );
    toast(`已被内容安全策略阻断：${governance.reasons.join('；')}`, 'error', 6000);
    return governance;
  }

  if (governance.status === 'review_required') {
    currentProject.reviewQueue = currentProject.reviewQueue || [];
    currentProject.reviewQueue.unshift({
      id: `rev_${Date.now()}`,
      theme: rawText,
      flags: governance.flags,
      reasons: governance.reasons,
      createdAt: new Date().toISOString()
    });
    text($('intent'), `⚠ 已转入人工审核队列：${governance.reasons.join('；')}`);
    $('intent').className = 'warn';
  }

  return null;
}

async function boot() {
  const [manifest, external, profiles] = await Promise.all([
    fetch('./public/build-manifest.json').then(r => r.json()),
    fetch('./02_Assets/assets.json').then(r => r.json()).catch(() => fallback),
    fetch('./02_Assets/model-profiles.json').then(r => r.json())
  ]);

  activeRegistry = createRegistry(external, profiles, { references: [] });
  activeRegistryData = external;

  // 用户录入的自定义资产并入运行时注册表，使其可被检索、校验与编译
  const customApplied = applyCustomAssets(activeRegistry, loadCustomAssets());

  // 载入自我进化记忆，并把历次锻造出的资产重新并入注册表
  evolutionLedger = loadLedger();
  const forgedApplied = applyForgedAssets(activeRegistry, evolutionLedger.forged);

  text($('manifest'), `构建 ${manifest.projectVersion} · 认证资产 ${manifest.assetCount} · 签名 ${manifest.assetSha256.slice(0, 12)}`);

  // 资产数量必须以实际注册表为准：写死的数字会随资产库扩充或自定义录入而失真
  const totalAssets = activeRegistry.byId.size;
  if ($('asset-count-inline')) text($('asset-count-inline'), totalAssets);
  if ($('asset-manager-btn')) {
    $('asset-manager-btn').textContent =
      `🧱 乐高资产库 (${totalAssets}${customApplied.added ? ` · 自定义 ${customApplied.added}` : ''}${forgedApplied.added ? ` · 进化 ${forgedApplied.added}` : ''})`;
  }
  if ($('ai-brain-status')) {
    $('ai-brain-status').textContent = '🧠 云端 AI 导演大脑：待调用（不可用时将自动回退本地引擎）';
  }

  // 初始化模型 Profile 选项
  $('profile').replaceChildren();
  for (const p of profiles.profiles) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.name}（${p.durations.join('/')} 秒，${p.aspectRatios.join(' / ')}）`;
    $('profile').append(o);
  }
  activeProfile = profiles.profiles[0];

  $('profile').onchange = () => {
    activeProfile = activeRegistry.profileById.get($('profile').value);
    refreshOutputs();
  };

  // 初始化工程存储
  currentStore = await storeManager.loadAll();
  if (currentStore.projects.length === 0) {
    currentStore = storeManager.createProject(currentStore, '默认影片 01');
    await storeManager.saveAll(currentStore);
  }
  currentProject = storeManager.getCurrentProject(currentStore);

  renderTabs();
  bindGlobalEvents();
  bindDrawerEscapeKeys();
  refreshEvolutionPanel();
  renderCurrentProject();
}

function renderTabs() {
  renderProjectTabs($('project-tabs'), currentStore.projects, currentProject?.id, {
    onSelect: (id) => {
      currentStore.currentProjectId = id;
      currentProject = storeManager.getCurrentProject(currentStore);
      storeManager.saveAll(currentStore);
      renderTabs();
      renderCurrentProject();
    },
    onCreate: async () => {
      const name = await promptDialog({
        title: '新建影片工程',
        label: '影片名称',
        defaultValue: `大片企划 ${currentStore.projects.length + 1}`,
        placeholder: '例如：诺曼底登陆 8 镜版'
      });
      if (!name) return;
      currentStore = storeManager.createProject(currentStore, name);
      currentProject = storeManager.getCurrentProject(currentStore);
      await persist();
      renderTabs();
      renderCurrentProject();
      toast(`已创建影片工程「${name}」`, 'success');
    },
    onDelete: async (id) => {
      const project = currentStore.projects.find(p => p.id === id);
      const ok = await confirmDialog({
        title: '删除影片工程',
        message: `确定删除「${project?.name || '未命名影片'}」吗？该工程的全部镜头与审核记录将一并移除，且无法撤销。`,
        confirmText: '删除',
        danger: true
      });
      if (!ok) return;
      currentStore = storeManager.deleteProject(currentStore, id);
      currentProject = storeManager.getCurrentProject(currentStore);
      await persist();
      renderTabs();
      renderCurrentProject();
      toast('影片工程已删除', 'info');
    }
  });
}

/**
 * 渲染好莱坞电影全景视听解构拉片教学看板 (Master Deck)
 */
function renderDirectorNotesPanel(movieName, data) {
  const panel = $('director-notes-panel');
  if (!panel || !data) return;

  panel.replaceChildren();
  panel.style.display = 'block';

  const grammar = data.visualGrammar || {};

  const card = createEl('div', { class: 'card card--accent' },
    // 顶栏：电影头衔与名牌
    createEl('div', { class: 'card__head' },
      createEl('div', {},
        createEl('div', { class: 'card__title', style: { fontSize: '19px' } },
          createEl('span', { style: { fontSize: '22px' } }, '🎬'),
          createEl('span', {}, data.matchedMovie || movieName),
          createEl('span', { class: 'badge badge--info' }, data.genre || '好莱坞大片'),
          createEl('span', { class: 'badge badge--ok' }, data.engine || '智能大脑')
        ),
        createEl('p', { class: 'card__sub' },
          `导演：${data.director || '好莱坞名家'} · 上映年份：${data.year || '经典'} · 乐高适配引擎：已完成认证资产精准重构`)
      ),
      createEl('div', { class: 'card__actions' },
        createEl('button', {
          class: 'btn btn--ghost btn--sm',
          onClick: () => { panel.style.display = 'none'; }
        }, '收起拉片看板')
      )
    ),

    createEl('div', { class: 'card__body' },
      // 核心戏剧冲突条
      createEl('div', { class: 'alert alert--danger', style: { marginBottom: '16px' } },
        createEl('span', { class: 'alert__icon' }, '💥'),
        createEl('span', {},
          createEl('strong', {}, '核心戏剧母题与危机冲突：'),
          document.createTextNode(` ${data.dramaticConflict || '在极限压力下执行关键突破任务。'}`))
      ),

      // 三列网格：运镜、声效、乐高改编
      createEl('div', { class: 'grid grid--3', style: { marginBottom: '16px' } },
        createEl('div', { class: 'panel' },
          createEl('div', { class: 'field__label', style: { color: 'var(--info)', marginBottom: '8px' } }, '🎥 导演视听运镜法则'),
          createEl('div', { style: { color: 'var(--text)', lineHeight: '1.55', fontSize: '12.5px' } }, grammar.cameraMotion || '经典好莱坞景别张力')
        ),
        createEl('div', { class: 'panel' },
          createEl('div', { class: 'field__label', style: { color: 'var(--info)', marginBottom: '8px' } }, '🔊 声音设计与伴随配乐'),
          createEl('div', { style: { color: 'var(--text)', lineHeight: '1.55', fontSize: '12.5px' } }, grammar.soundDesign || '战地环境音与低频脉冲')
        ),
        createEl('div', { class: 'panel' },
          createEl('div', { class: 'field__label', style: { color: 'var(--accent-hi)', marginBottom: '8px' } }, '🧱 乐高微缩定格转译秘诀'),
          createEl('div', { style: { color: 'var(--text)', lineHeight: '1.55', fontSize: '12.5px' } }, data.legoAdaptation || '微距景深与真实注塑颗粒反光')
        )
      ),

      // 创作者干货底栏
      createEl('div', { class: 'alert alert--warn' },
        createEl('span', { class: 'alert__icon' }, '💡'),
        createEl('span', {},
          createEl('strong', {}, '自媒体短视频爆款秘籍 (Creator Insights)：'),
          document.createTextNode(` ${data.creatorTips || '把握前3秒完播率，声画对齐。'}`))
      )
    )
  );

  panel.appendChild(card);
}

/**
 * 渲染单个阵营的角色卡片网格
 * 极致防御性设计：确保 chars 为空或非数组时安全退出，绝不抛错
 * @param {HTMLElement} container 容器元素
 * @param {Array} chars 角色数组
 * @param {'coalition'|'opposing'} faction 阵营类型
 */
function renderFactionCards(container, chars, faction) {
  if (!container || !Array.isArray(chars) || chars.length === 0) return;

  const isCoalition = faction === 'coalition';
  const variant = isCoalition ? 'blue' : 'red';

  for (const c of chars) {
    if (!c) continue;
    // 真实名册会带资产 ID 与系列，标注出来才能证明「角色确实来自资产库」
    const meta = [c.role, c.id, c.series && c.series !== 'shared' ? c.series : '']
      .filter(Boolean).join(' · ');
    const card = createEl('div', { class: `rcard rcard--${variant}` },
      createEl('div', { class: 'rcard__top' },
        createEl('strong', { class: 'rcard__name' }, `${isCoalition ? '🛡️' : '⚔️'} ${c.name || '战术角色'}`),
        createEl('span', { class: `badge ${isCoalition ? 'badge--info' : 'badge--danger'}` }, c.role || '战斗员')
      ),
      createEl('div', { class: 'rcard__outfit' }, `📦 资产：${meta || '—'}`),
      createEl('div', { class: 'rcard__outfit' }, `🧵 装具：${c.outfit || '标准作战配置'}`),
      // 底部代号名牌标签 — 醒目展示，方便视频生成时直接调用对应角色
      createEl('div', { class: `rcard__tag rcard__tag--${variant}` }, `🏷️ [${c.callsign || 'AGENT'}]`)
    );
    container.appendChild(card);
  }
}

/**
 * 渲染原创立意卡（logline / 转折 / 开场钩子 / 致敬说明）。
 * 这一层正是「像智能」与「照着电影抄」的分界线：参考片只贡献视听语言，情节独立生成。
 */
function renderOriginality(project) {
  const box = $('lineup-originality');
  if (!box) return;
  box.replaceChildren();

  const o = project?.originality;
  if (!o || (!o.logline && !o.twist && !o.hook)) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';

  const rows = [
    ['🎯 立意 (Logline)', o.logline],
    ['🌀 转折 (Twist)', o.twist],
    ['⚡ 开场钩子 (Hook)', o.hook],
    ['🎬 致敬说明 (Homage)', o.homageNote]
  ].filter(([, v]) => v);

  box.appendChild(
    createEl('div', { class: 'panel', style: { marginBottom: '16px' } },
      createEl('div', { class: 'field__label', style: { marginBottom: '8px', color: 'var(--accent-hi)' } },
        '🧠 原创立意层（独立于参考片，避免照搬桥段）'),
      ...rows.map(([k, v]) => createEl('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.6', marginBottom: '4px' } },
        createEl('strong', { style: { color: 'var(--text)' } }, `${k}：`),
        document.createTextNode(String(v))
      ))
    )
  );
}

/**
 * 渲染全片全角色定妆表与全家福控制台 (置顶于分镜脚本之前)
 *
 * 名册来源已被修正：早期实现无论生成什么片子，都从写死的 FACTION_TEMPLATES 里
 * 取「幽灵队长 / 猎鹰狙击手」这套虚构角色 —— 与用户真正生成的分镜毫无关系。
 * 现在一律以「本次分镜实际用到的真实资产」为准（roster），模板只在名册为空时作预览。
 *
 * @param {object} project 当前工程
 * @param {object|null} roster ensureRoster() 的产物
 */
function renderCharacterLineupPanel(project, roster = null) {
  const section = $('character-lineup-section');
  if (!section) return;

  if (!project || !project.shots || project.shots.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  try {
    const theme = project.theme || project.name || '好莱坞大片';
    const era = project.intent?.era || project.directorNotes?.era || 'Modern';
    const ar = project.aspectRatio || '9:16';

    const realCoalition = Array.isArray(roster?.coalition) ? roster.coalition : [];
    const realOpposing = Array.isArray(roster?.opposing) ? roster.opposing : [];

    // 载具不能混进「人仔全家福」。
    // generateLineupPrompt 会生成「N distinct LEGO minifigures」的合影 Prompt，
    // 早期把载具也算进去，会要求模型画出一架「人仔大小的直升机」，全家福直接废掉。
    const vehicles = Array.isArray(roster?.all) ? roster.all.filter(e => e.kind === 'vehicle') : [];
    const charCoalition = realCoalition.filter(e => e.kind !== 'vehicle');
    const charOpposing = realOpposing.filter(e => e.kind !== 'vehicle');

    // 有真实名册 → 用真实名册；确实没有（例如全片只有环境/特效镜头）→ 用模板做「预览」并明确标注
    const hasReal = charCoalition.length + charOpposing.length > 0;
    const factions = hasReal
      ? { coalition: charCoalition, opposing: charOpposing, isPreview: false }
      : { ...extractCharacterLineup(project.shots, activeRegistry, era, theme), isPreview: true };

    const lineupData = generateLineupPrompt(factions, theme, era, ar);

    // 原创立意层
    renderOriginality(project);

    // 2. 渲染双阵营角色卡片网格（蓝色前排正方 + 红色后排反方）
    const grid = $('character-roster-grid');
    if (grid) {
      grid.replaceChildren();

      const coalitionList = Array.isArray(factions?.coalition) ? factions.coalition : [];
      const opposingList = Array.isArray(factions?.opposing) ? factions.opposing : [];

      const sourceNote = factions.isPreview
        ? '预览模板（生成分镜后将自动改为从资产库挑选的真实角色）'
        : '来自资产库的真实资产';

      // 🔵 前排站位 · 正方特战小队
      const coalitionHeader = createEl('div', { class: 'roster-head roster-head--blue' },
        `🔵 前排站位 (Front Row) · 正义主角特战小队 (每位角色脚踏专属代号名牌 · ${coalitionList.length} 人 · ${sourceNote})`);
      grid.appendChild(coalitionHeader);
      renderFactionCards(grid, coalitionList, 'coalition');

      // 🔴 后排站位 · 敌对武装反派势力
      const opposingHeader = createEl('div', { class: 'roster-head roster-head--red', style: { marginTop: '8px' } },
        `🔴 后排站位 (Elevated Back Row) · 敌对武装反派势力 (每位角色脚踏专属代号名牌 · ${opposingList.length} 人)`);
      grid.appendChild(opposingHeader);
      if (opposingList.length === 0 && !factions.isPreview) {
        grid.appendChild(createEl('div', { class: 'alert alert--warn' },
          createEl('span', { class: 'alert__icon' }, '💡'),
          createEl('span', {}, '该题材的资产库中暂无对立阵营角色，本片以单向行动叙事呈现（不硬塞会造成时代穿帮的敌人）。')
        ));
      } else {
        renderFactionCards(grid, opposingList, 'opposing');
      }

      // 🚁 载具单独成组：同样有专属代号，但不计入人仔全家福
      if (vehicles.length > 0) {
        grid.appendChild(createEl('div', { class: 'roster-head', style: { marginTop: '8px' } },
          `🚁 本片载具 (${vehicles.length} 台 · 拥有专属代号，不计入人仔全家福，需单独出定妆图)`));
        renderFactionCards(grid, vehicles, 'coalition');
      }
    }

    // 3. 填充提示词（防御性检查）
    if ($('lineup-prompt-en')) $('lineup-prompt-en').value = lineupData?.promptEn || '';
    if ($('lineup-prompt-zh')) text($('lineup-prompt-zh'), lineupData?.promptZh || '');

    // 4. 更新参考图上传预览状态
    const previewWrap = $('lineup-preview-wrap');
    const placeholder = $('lineup-upload-placeholder');
    const imgPreview = $('lineup-image-preview');
    const anchorStatus = $('lineup-anchor-status');

    if (project.lineupImage) {
      if (imgPreview) imgPreview.src = project.lineupImage;
      if (previewWrap) previewWrap.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
      if (anchorStatus) {
        anchorStatus.textContent = '✔ 🔒 全局角色视觉锚点已锁定';
        anchorStatus.className = 'badge badge--ok';
      }
    } else {
      if (previewWrap) previewWrap.style.display = 'none';
      if (placeholder) placeholder.style.display = 'block';
      if (anchorStatus) {
        anchorStatus.textContent = '⏳ 待生成 / 上传全家福';
        anchorStatus.className = 'badge badge--warn';
      }
    }
  } catch (err) {
    console.warn('全角色定妆看板渲染异常（已安全容灾，不影响分镜脚本生成）:', err);
  }
}

/**
 * 执行电影深度转译（无缝调用后台免费大模型与智能兜底）
 */
async function executeMovieTranspile(movieQuery) {
  // 防重复提交：转译是一次昂贵的远端调用，连点会造成并发请求与结果互相覆盖
  if (transpiling) {
    toast('正在转译中，请稍候…', 'warn', 2200);
    return;
  }

  const btn = $('transpile-movie-btn');
  const requestedShots = Number($('shots-cinema')?.value || $('shots')?.value) || 4;
  const selectedAr = $('aspect-ratio-cinema')?.value || $('aspect-ratio')?.value || '9:16';

  // 内容治理必须与自由模式一致地作用于转译输入。
  // 此前该路径把 governance 硬编码为 passed，等于默认模式完全没有安全拦截。
  if (applyGovernance(movieQuery, { source: '影片名' })) return;

  transpiling = true;
  if (btn) {
    btn.disabled = true;
    btn.style.filter = 'grayscale(0.6)';
    btn.style.cursor = 'progress';
  }
  setProgress('🚀 正在唤醒后台免费 AI 导演大脑进行视听拉片与转译…');

  try {
    const result = await callAiBrain({
      query: movieQuery,
      requestedShots,
      // 把运行时注册表（含用户自定义 + 进化锻造资产）交给大脑：
      // 本地兜底路径要靠它才能「从真实资产库里挑角色」并给出代号
      registry: activeRegistry,
      onProgress: (msg) => setProgress(msg)
    });

    // 大模型产出的分镜文本同样必须过治理：输入合规不代表输出合规
    const generatedText = (result.shots || []).map(s => `${s.action || ''} ${s.radioVoice || ''}`).join('\n');
    if (applyGovernance(generatedText, { source: '分镜内容' })) {
      setProgress('', false);
      return;
    }

    setProgress('', false);

    // 真实回显本次实际使用的引擎，而不是无条件宣称"云端大脑就绪"
    if ($('ai-brain-status')) {
      $('ai-brain-status').textContent = `🧠 本次引擎：${result.engine || '未知'}`;
      $('ai-brain-status').className = 'badge badge--ok';
    }

    $('theme').value = result.themeZh;
    currentProject.theme = result.themeZh;

    result.shots.forEach(s => { s.aspectRatio = selectedAr; });

    // 自我进化闭环：记录学习、锻造缺口资产，并让新装备进入分镜
    const evolution = runEvolution({
      theme: movieQuery,
      engine: result.engine,
      era: result.era || 'Modern',
      shots: result.shots
    });
    currentProject.shots = evolution.shots;
    // 名册以本次生成的结果为基准冻结；进化补进来的新资产只会拿到新代号，不会挤走老代号
    currentProject.roster = Array.isArray(result.roster) ? result.roster : null;
    currentProject.originality = result.originality || null;
    currentProject.intent = {
      era: result.era || 'Modern',
      task: 'combat',
      theme: result.themeZh,
      confidence: 1.0,
      safetyTags: [],
      // 治理结论必须由实际检查结果得出，不能写死为 passed
      governance: checkContentGovernance(`${movieQuery}\n${generatedText}`)
    };
    currentProject.aspectRatio = selectedAr;
    currentProject.directorNotes = result;
    currentProject.matchedMovie = result.matchedMovie;
    ensureRoster();
    await persist();

    renderDirectorNotesPanel(result.matchedMovie, result);

    text($('intent'), `🎬 已成功解构并转译《${result.matchedMovie}》！${result.shots.length} 镜好莱坞视听分镜已生成 [${result.engine || 'AI'}]。`);
    $('intent').className = 'ok';
    reportEvolution(evolution, $('intent'));

    refreshOutputs();
    $('character-lineup-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setProgress(`转译异常: ${err.message}`);
    toast(`转译失败：${err.message}`, 'error', 5000);
    setTimeout(() => setProgress('', false), 4000);
  } finally {
    transpiling = false;
    if (btn) {
      btn.disabled = false;
      btn.style.filter = '';
      btn.style.cursor = '';
    }
  }
}

function bindGlobalEvents() {
  // 1. 模式切换 Tab 交互
  const setMode = (mode) => {
    const cinema = mode === 'cinema';
    $('tab-cinema-mode').className = `seg__btn${cinema ? ' is-active' : ''}`;
    $('tab-custom-mode').className = `seg__btn${cinema ? '' : ' is-active'}`;
    $('tab-cinema-mode').setAttribute('aria-selected', String(cinema));
    $('tab-custom-mode').setAttribute('aria-selected', String(!cinema));
    $('section-cinema-mode').style.display = cinema ? 'block' : 'none';
    $('section-custom-mode').style.display = cinema ? 'none' : 'block';
  };
  $('tab-cinema-mode').onclick = () => setMode('cinema');
  $('tab-custom-mode').onclick = () => setMode('custom');

  // 1b. 顶栏「更多」下拉菜单（主次分离：主操作在顶栏，次级操作收进菜单）
  const moreBtn = $('more-btn');
  const moreMenu = $('more-menu');
  if (moreBtn && moreMenu) {
    const closeMenu = () => {
      moreMenu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
    };
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = moreMenu.hidden;
      moreMenu.hidden = !willOpen;
      moreBtn.setAttribute('aria-expanded', String(willOpen));
    };
    // 点击菜单内任意项后自动收起
    moreMenu.addEventListener('click', closeMenu);
    // 点击菜单外部或按 ESC 收起
    document.addEventListener('click', (e) => {
      if (moreMenu.hidden) return;
      if (e.target === moreBtn || moreBtn.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  // 2. 电影快捷选片标签流
  const chipContainer = $('movie-chips');
  if (chipContainer) {
    chipContainer.replaceChildren();
    const films = [
      { name: '壮志凌云：独行侠', tag: '五代机空战' },
      { name: '黑鹰坠落', tag: '城市巷战索降' },
      { name: '地心引力', tag: '空间站碎片危机' },
      { name: '明日边缘', tag: '外骨骼突围' },
      { name: '流浪地球', tag: '行星发动机史诗' },
      { name: '边境杀手', tag: '夜视仪无声渗透' },
      { name: '拯救大兵瑞恩', tag: '诺曼底血战' },
      { name: '敦刻尔克', tag: '非线性时空撤离' }
    ];
    for (const f of films) {
      const btn = createEl('button', {
        class: 'chip',
        onClick: () => {
          $('movie-input').value = f.name;
          executeMovieTranspile(f.name);
        }
      },
        createEl('strong', {}, `🎬 ${f.name}`),
        createEl('span', { style: { color: 'var(--text-3)', fontSize: '10px' } }, `(${f.tag})`)
      );
      chipContainer.appendChild(btn);
    }
  }

  // 3. 电影搜索转译按钮与回车触发
  $('transpile-movie-btn').onclick = () => {
    const query = $('movie-input').value.trim();
    if (!query) {
      toast('请输入要转译的电影名（例如：壮志凌云、地心引力、黑鹰坠落）', 'warn');
      $('movie-input')?.focus();
      return;
    }
    executeMovieTranspile(query);
  };

  $('movie-input').onkeydown = (e) => {
    if (e.key === 'Enter') {
      $('transpile-movie-btn').click();
    }
  };

  // 4. 双向画幅与镜头选择同步
  $('aspect-ratio-cinema').onchange = () => {
    const val = $('aspect-ratio-cinema').value;
    $('aspect-ratio').value = val;
    applyAspectRatioChange(val);
  };

  $('aspect-ratio').onchange = () => {
    const val = $('aspect-ratio').value;
    $('aspect-ratio-cinema').value = val;
    applyAspectRatioChange(val);
  };

  $('shots-cinema').onchange = () => {
    $('shots').value = $('shots-cinema').value;
  };
  $('shots').onchange = () => {
    $('shots-cinema').value = $('shots').value;
  };

  async function applyAspectRatioChange(ar) {
    if (currentProject && currentProject.shots) {
      currentProject.shots.forEach(s => { s.aspectRatio = ar; });
      currentProject.aspectRatio = ar;
      await persist();
      refreshOutputs();
    }
  }

  // 5. 复制全家福生图 Prompt 按钮
  $('copy-lineup-prompt-btn').onclick = async () => {
    const promptText = $('lineup-prompt-en').value;
    if (!promptText) {
      toast('暂无可复制的全家福 Prompt，请先生成分镜', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(promptText);
      toast('已复制全家福生图 Prompt。生成完毕后请把图片上传到右侧，作为全片全局主控参考图。', 'success', 5000);
    } catch {
      toast('浏览器拒绝了剪贴板访问，请手动选中文本框内容后复制。', 'error', 5000);
    }
  };

  // 6. 全家福参考图上传与拖拽事件
  const dropzone = $('lineup-dropzone');
  const fileInput = $('lineup-file-input');

  dropzone.onclick = (e) => {
    if (e.target.id === 'remove-lineup-img-btn') return;
    fileInput.click();
  };

  fileInput.onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleLineupImageFile(file);
  };

  dropzone.ondragover = (e) => {
    e.preventDefault();
    dropzone.classList.add('is-drag');
  };

  dropzone.ondragleave = () => {
    dropzone.classList.remove('is-drag');
  };

  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleLineupImageFile(file);
  };

  $('remove-lineup-img-btn').onclick = async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: '清除全家福参考图',
      message: '确定更换或清除当前全家福参考图吗？清除后全片将失去全局角色视觉锚点。',
      confirmText: '清除',
      danger: true
    });
    if (!ok) return;
    currentProject.lineupImage = null;
    await persist();
    renderCharacterLineupPanel(currentProject, ensureRoster());
    toast('已清除全家福参考图', 'info');
  };

  /**
   * 全家福参考图会被以 base64 dataURL 直接写进 localStorage。
   * 一张 4000px 的手机照片转 base64 后可达数 MB，会瞬间撑爆 5MB 配额，
   * 导致所有工程数据一起写不进去。因此入库前必须先降采样。
   */
  const MAX_ANCHOR_DIM = 1024;
  const MAX_ANCHOR_BYTES = 700 * 1024;

  function downscaleImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_ANCHOR_DIM / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        let out = canvas.toDataURL('image/jpeg', 0.82);
        // 仍然过大则继续压质量，避免单点拖垮整个存储
        if (out.length > MAX_ANCHOR_BYTES) out = canvas.toDataURL('image/jpeg', 0.6);
        resolve(out);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function handleLineupImageFile(file) {
    if (!file.type.startsWith('image/')) {
      toast('请上传图片格式文件 (PNG / JPG / WEBP)', 'warn');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const optimized = await downscaleImage(String(reader.result));
      currentProject.lineupImage = optimized;
      const saved = await persist();
      renderCharacterLineupPanel(currentProject, ensureRoster());
      if (saved) {
        toast('全家福参考图已锁定为全片全局视觉基准', 'success');
      }
    };
    reader.onerror = () => toast('图片读取失败，请重试', 'error');
    reader.readAsDataURL(file);
  }

  // 7. 自由模式生成常规分镜计划
  $('plan').onclick = async () => {
    const themeText = $('theme').value.trim();
    if (!themeText) {
      toast('请输入影片主题描述', 'warn');
      $('theme')?.focus();
      return;
    }

    const requestedShots = Number($('shots').value) || 4;
    const profileId = $('profile').value;

    if (applyGovernance(themeText, { source: '主题' })) return;

    const { intent, plan, warnings } = planFilm({
      theme: themeText,
      requestedShots,
      profileId
    }, activeRegistry);

    if (intent.governance.status !== 'blocked' && intent.governance.status !== 'review_required') {
      text($('intent'), intent.needsConfirmation
        ? `需确认年代：${warnings.join('；')}`
        : `年代：${intent.era || '未指定'} · 任务：${intent.task} · 状态：合规放行`);
      $('intent').className = intent.needsConfirmation ? 'warn' : 'ok';
    }

    const selectedAr = $('aspect-ratio').value || '9:16';
    plan.shots.forEach(s => { s.aspectRatio = selectedAr; });

    // 自由模式同样接入自我进化：现代/未来战争题材会触发缺口锻造
    const evolution = runEvolution({
      theme: themeText,
      engine: 'Local Planner (本地规划器)',
      era: intent.era,
      shots: plan.shots
    });
    reportEvolution(evolution, $('intent'));

    currentProject.shots = evolution.shots;
    currentProject.theme = themeText;
    currentProject.intent = intent;
    // 名册与原创立意随计划一起落库，供定妆表 / 编译 Prompt / CSV 共用同一套代号
    currentProject.roster = Array.isArray(plan.roster) ? plan.roster : null;
    currentProject.originality = plan.originality || null;
    currentProject.aspectRatio = selectedAr;
    currentProject.directorNotes = null;
    currentProject.matchedMovie = null;
    $('director-notes-panel').style.display = 'none';
    ensureRoster();

    await persist();
    renderCurrentProject();
  };

  // 8. 导出工程 JSON
  $('export-btn').onclick = () => {
    if (!currentProject) return;
    const jsonStr = storeManager.export(currentProject);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.name || 'lwu-film'}.json`;
    a.click();
    // 立即 revoke 会在部分浏览器上赶在下载开始前销毁 blob，延后释放
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('工程 JSON 已导出', 'success');
  };

  // 9. 导出剪映分镜表 CSV
  $('export-csv-btn').onclick = () => {
    if (!currentProject || !currentProject.shots || currentProject.shots.length === 0) {
      toast('当前影片暂无镜头，请先选择一部电影或生成分镜计划', 'warn');
      return;
    }
    exportToCapCutCSV(
      currentProject.shots,
      activeRegistry,
      currentProject.theme || currentProject.name,
      ensureRoster()
    );
    toast('剪映分镜表 CSV 已导出', 'success');
  };

  // 10. 打开乐高资产库抽屉
  $('asset-manager-btn').onclick = () => {
    renderAssetManager($('asset-drawer'), activeRegistry);
  };

  // 10b. 切换自我进化面板
  if ($('evolution-btn')) {
    $('evolution-btn').onclick = () => {
      const section = $('evolution-section');
      if (!section) return;
      const showing = section.style.display !== 'none';
      section.style.display = showing ? 'none' : 'block';
      if (!showing) refreshEvolutionPanel();
    };
  }

  // 11. 导入工程
  $('import-btn').onclick = () => $('import-file').click();
  $('import-file').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    const result = await storeManager.import(content);
    if (result.violations) {
      toast(`导入失败：${result.violations.map(v => v.code).join(', ')}`, 'error', 5000);
      return;
    }
    currentStore.projects.push(result.project);
    currentStore.currentProjectId = result.project.id;
    currentProject = result.project;
    const saved = await persist();
    renderTabs();
    renderCurrentProject();
    if (saved) toast('工程导入成功', 'success');
    $('import-file').value = '';
  };
}

function refreshOutputs() {
  if (!currentProject) return;
  const p = activeProfile || activeRegistry.profileById.get($('profile').value);

  // 0. 先解析名册：定妆表、时间线卡片、编译 Prompt、CSV 必须共用同一套代号
  let roster = null;
  try {
    roster = ensureRoster();
  } catch (err) {
    console.warn('角色名册解析失败（已降级为无代号渲染）:', err);
  }

  // 1. 置顶渲染全片全角色定妆表与全家福控制台（独立容灾隔离）
  try {
    renderCharacterLineupPanel(currentProject, roster);
  } catch (err) {
    console.error('渲染全角色定妆表异常:', err);
  }

  // 2. 渲染双轨视听时间线（含首帧与音轨）
  try {
    renderTimeline($('timeline-container'), currentProject.shots || [], activeRegistry, (idx, shot) => {
      openShotEditor(idx, shot);
    }, async (keyframePrompt) => {
      try {
        await navigator.clipboard.writeText(keyframePrompt);
        toast('已复制 35mm 定格首帧参考图 Prompt，可直接粘贴至 FLUX / Midjourney 生成关键帧', 'success');
      } catch {
        toast('浏览器拒绝了剪贴板访问，请手动复制。', 'error');
      }
    }, roster);
  } catch (err) {
    console.error('渲染时间线异常:', err);
  }

  // 3. 渲染已编译输出（分镜脚本）
  try {
    renderPlan($('output'), { shots: currentProject.shots || [] }, compileShot, activeRegistry, p, (idx, shot) => {
      openShotEditor(idx, shot);
    }, roster);
  } catch (err) {
    console.error('渲染编译分镜异常:', err);
  }

  // 4. 校验违规（按严重度分级渲染）
  try {
    const valResult = validateFilmPlan({ shots: currentProject.shots || [], intent: currentProject.intent || {} }, activeRegistry);
    const axisRepairWarnings = continuityRepairWarnings(currentProject.shots || []);
    renderViolations($('violations'), {
      ...valResult,
      warnings: [...(valResult.warnings || []), ...axisRepairWarnings]
    });
  } catch (err) {
    console.warn('分镜规则校验跳过:', err);
  }

  // 5. 渲染审核队列
  try {
    renderReviewQueue($('review-container'), currentProject.reviewQueue || [], {
      onApprove: async (item) => {
        currentProject.reviewQueue = currentProject.reviewQueue.filter(q => q.id !== item.id);
        await persist();
        refreshOutputs();
        toast('已批准放行', 'success');
      },
      onReject: async (item) => {
        currentProject.reviewQueue = currentProject.reviewQueue.filter(q => q.id !== item.id);
        await persist();
        refreshOutputs();
        toast('已驳回该题材', 'info');
      }
    });
  } catch (err) {
    console.warn('审核队列渲染跳过:', err);
  }
}

function renderCurrentProject() {
  if (!currentProject) return;
  if (currentProject.theme) $('theme').value = currentProject.theme;
  if (currentProject.aspectRatio) {
    if ($('aspect-ratio')) $('aspect-ratio').value = currentProject.aspectRatio;
    if ($('aspect-ratio-cinema')) $('aspect-ratio-cinema').value = currentProject.aspectRatio;
  }
  if (currentProject.directorNotes && currentProject.matchedMovie) {
    renderDirectorNotesPanel(currentProject.matchedMovie, currentProject.directorNotes);
  }
  refreshOutputs();
}

function openShotEditor(index, shot) {
  renderShotEditor(
    $('editor-drawer'),
    shot,
    index,
    activeRegistry,
    currentProject.intent || {},
    async (updated) => {
      currentProject.shots[index] = updated;
      await persist();
      refreshOutputs();
      $('editor-drawer').style.display = 'none';
      toast('镜头修改已应用', 'success');
    },
    () => {
      $('editor-drawer').style.display = 'none';
    }
  );
}

/**
 * 抽屉必须能用 ESC 关闭：它们是 position:fixed 浮层，
 * 没有关闭快捷键时，键盘用户会被困在抽屉里。
 */
function bindDrawerEscapeKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const id of ['editor-drawer', 'asset-drawer']) {
      const drawer = $(id);
      if (drawer && drawer.style.display !== 'none') drawer.style.display = 'none';
    }
  });
}

boot().catch(err => {
  text($('manifest'), '资产或工作台初始化失败');
  $('manifest').className = 'bad';
  console.error(err);
});
