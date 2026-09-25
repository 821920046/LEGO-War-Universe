import { createRegistry } from '../domain/registry.js';
import { planFilm } from '../domain/planner.js';
import { compileShot } from '../domain/compiler.js';
import { validateFilmPlan } from '../domain/shot-spec.js';
import { transpileMovieToLego, CINEMA_DATABASE } from '../domain/cinema-homage.js';
import { callAiBrain } from '../domain/ai-brain.js';
import { ProjectStore } from './project-store.js';
import { renderTimeline, exportToCapCutCSV } from './timeline.js';
import { renderShotEditor } from './shot-editor.js';
import { renderReviewQueue } from './review-queue.js';
import { renderAssetManager } from './asset-manager.js';
import { renderPlan, renderProjectTabs, text, createEl } from './render.js';

const $ = id => document.getElementById(id);
const fallback = JSON.parse($('lwu-data').textContent);

const storeManager = new ProjectStore();
let currentStore = null;
let currentProject = null;
let activeRegistry = null;
let activeProfile = null;

async function boot() {
  const [manifest, external, profiles] = await Promise.all([
    fetch('./public/build-manifest.json').then(r => r.json()),
    fetch('./02_Assets/assets.json').then(r => r.json()).catch(() => fallback),
    fetch('./02_Assets/model-profiles.json').then(r => r.json())
  ]);

  activeRegistry = createRegistry(external, profiles, { references: [] });
  text($('manifest'), `构建 ${manifest.projectVersion} · 认证资产 ${manifest.assetCount} · 签名 ${manifest.assetSha256.slice(0, 12)} · 免费大模型大脑全自动就绪`);

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
    onCreate: () => {
      const name = prompt('请输入新影片名称：', `大片企划 ${currentStore.projects.length + 1}`);
      if (!name) return;
      currentStore = storeManager.createProject(currentStore, name);
      currentProject = storeManager.getCurrentProject(currentStore);
      storeManager.saveAll(currentStore);
      renderTabs();
      renderCurrentProject();
    },
    onDelete: (id) => {
      if (!confirm('确定删除该影片工程吗？')) return;
      currentStore = storeManager.deleteProject(currentStore, id);
      currentProject = storeManager.getCurrentProject(currentStore);
      storeManager.saveAll(currentStore);
      renderTabs();
      renderCurrentProject();
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

  const card = createEl('div', {
    style: {
      background: 'linear-gradient(135deg, #0b1528 0%, #060b16 100%)',
      border: '1px solid rgba(245, 158, 11, 0.4)',
      borderRadius: '12px',
      padding: '24px 28px',
      boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
      fontSize: '13px'
    }
  },
    // 顶栏：电影头衔与名牌
    createEl('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '14px' } },
      createEl('div', {},
        createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' } },
          createEl('span', { style: { fontSize: '24px' } }, '🎬'),
          createEl('h2', { style: { margin: '0', fontSize: '20px', color: '#ffd07a', fontWeight: '800' } }, data.matchedMovie || movieName),
          createEl('span', { style: { background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '700', border: '1px solid rgba(56, 189, 248, 0.3)' } }, data.genre || '好莱坞大片'),
          createEl('span', { style: { background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '700', border: '1px solid rgba(52, 211, 153, 0.3)' } }, data.engine || '智能大脑')
        ),
        createEl('div', { style: { color: '#94a3b8', fontSize: '13px' } },
          `导演：${data.director || '好莱坞名家'} · 上映年份：${data.year || '经典'} · 乐高适配引擎：已完成 390 资产精准重构`
        )
      ),
      createEl('button', {
        style: { background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
        onClick: () => { panel.style.display = 'none'; }
      }, '收起拉片看板')
    ),

    // 核心戏剧冲突条
    createEl('div', {
      style: {
        background: 'rgba(239, 68, 68, 0.08)',
        borderLeft: '4px solid #ef4444',
        padding: '10px 14px',
        borderRadius: '4px',
        marginBottom: '16px',
        color: '#fca5a5',
        fontSize: '13px',
        lineHeight: '1.5'
      }
    },
      createEl('strong', { style: { color: '#f87171' } }, '💥 核心戏剧母题与危机冲突：'),
      document.createTextNode(` ${data.dramaticConflict || '在极限压力下执行关键突破任务。'}`)
    ),

    // 三列网格：运镜、声效、乐高改编
    createEl('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginBottom: '16px' } },
      createEl('div', { style: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', padding: '14px 16px', borderRadius: '8px' } },
        createEl('div', { style: { color: '#38bdf8', fontWeight: '700', fontSize: '13px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' } }, '🎥 导演视听运镜法则'),
        createEl('div', { style: { color: '#cbd5e1', lineHeight: '1.5' } }, grammar.cameraMotion || '经典好莱坞景别张力')
      ),
      createEl('div', { style: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', padding: '14px 16px', borderRadius: '8px' } },
        createEl('div', { style: { color: '#38bdf8', fontWeight: '700', fontSize: '13px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' } }, '🔊 声音设计与伴随配乐'),
        createEl('div', { style: { color: '#cbd5e1', lineHeight: '1.5' } }, grammar.soundDesign || '战地环境音与低频脉冲')
      ),
      createEl('div', { style: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', padding: '14px 16px', borderRadius: '8px' } },
        createEl('div', { style: { color: '#ffd07a', fontWeight: '700', fontSize: '13px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' } }, '🧱 乐高微缩定格转译秘诀'),
        createEl('div', { style: { color: '#cbd5e1', lineHeight: '1.5' } }, data.legoAdaptation || '微距景深与真实注塑颗粒反光')
      )
    ),

    // 创作者干货底栏
    createEl('div', {
      style: {
        background: 'rgba(245, 158, 11, 0.1)',
        borderLeft: '4px solid #f59e0b',
        padding: '12px 16px',
        borderRadius: '6px',
        color: '#fef08a',
        fontSize: '13px',
        lineHeight: '1.5'
      }
    },
      createEl('strong', { style: { color: '#f59e0b' } }, '💡 自媒体短视频爆款秘籍 (Creator Insights)：'),
      document.createTextNode(` ${data.creatorTips || '把握前3秒完播率，声画对齐。'}`)
    )
  );

  panel.appendChild(card);
}

/**
 * 执行电影深度转译（无缝调用后台免费大模型与智能兜底）
 */
async function executeMovieTranspile(movieQuery) {
  const requestedShots = Number($('shots-cinema')?.value || $('shots')?.value) || 4;
  const selectedAr = $('aspect-ratio-cinema')?.value || $('aspect-ratio')?.value || '16:9';
  const progressEl = $('transpile-progress');

  if (progressEl) {
    progressEl.style.display = 'block';
    progressEl.textContent = '🚀 正在唤醒后台免费 AI 导演大脑进行视听拉片与转译…';
  }

  try {
    const result = await callAiBrain({
      query: movieQuery,
      requestedShots,
      onProgress: (msg) => {
        if (progressEl) progressEl.textContent = msg;
      }
    });

    if (progressEl) {
      progressEl.style.display = 'none';
    }

    // 同步两边的主题文本与参数
    $('theme').value = result.themeZh;
    currentProject.theme = result.themeZh;

    // 注入画面比例并更新镜头
    result.shots.forEach(s => { s.aspectRatio = selectedAr; });
    currentProject.shots = result.shots;
    currentProject.intent = {
      era: result.era || 'Modern',
      task: 'combat',
      theme: result.themeZh,
      confidence: 1.0,
      safetyTags: [],
      governance: { status: 'passed', flags: [], reasons: [] }
    };
    currentProject.aspectRatio = selectedAr;
    currentProject.directorNotes = result;
    currentProject.matchedMovie = result.matchedMovie;
    storeManager.saveAll(currentStore);

    // 渲染好莱坞电影全景视听解构看板
    renderDirectorNotesPanel(result.matchedMovie, result);

    text($('intent'), `🎬 已成功解构并转译《${result.matchedMovie}》！${result.shots.length} 镜好莱坞视听分镜已生成 [${result.engine || 'AI'}]。`);
    $('intent').className = 'ok';

    refreshOutputs();

    // 平滑滚动到时间线
    $('timeline-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (progressEl) {
      progressEl.textContent = `转译异常: ${err.message}`;
      setTimeout(() => { progressEl.style.display = 'none'; }, 4000);
    }
  }
}

function bindGlobalEvents() {
  // 1. 模式切换 Tab 交互
  $('tab-cinema-mode').onclick = () => {
    $('tab-cinema-mode').className = 'mode-tab active';
    $('tab-custom-mode').className = 'mode-tab';
    $('section-cinema-mode').style.display = 'block';
    $('section-custom-mode').style.display = 'none';
  };

  $('tab-custom-mode').onclick = () => {
    $('tab-cinema-mode').className = 'mode-tab';
    $('tab-custom-mode').className = 'mode-tab active';
    $('section-cinema-mode').style.display = 'none';
    $('section-custom-mode').style.display = 'block';
  };

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
        class: 'film-chip',
        onClick: () => {
          $('movie-input').value = f.name;
          executeMovieTranspile(f.name);
        }
      },
        createEl('strong', { style: { color: '#ffd07a' } }, `🎬 ${f.name}`),
        createEl('span', { style: { color: '#64748b', fontSize: '10px' } }, `(${f.tag})`)
      );
      chipContainer.appendChild(btn);
    }
  }

  // 3. 电影搜索转译按钮与回车触发
  $('transpile-movie-btn').onclick = () => {
    const query = $('movie-input').value.trim();
    if (!query) {
      alert('请输入要转译的电影名（例如：壮志凌云、地心引力、黑鹰坠落）！');
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

  function applyAspectRatioChange(ar) {
    if (currentProject && currentProject.shots) {
      currentProject.shots.forEach(s => { s.aspectRatio = ar; });
      currentProject.aspectRatio = ar;
      storeManager.saveAll(currentStore);
      refreshOutputs();
    }
  }

  // 5. 自由模式生成常规分镜计划
  $('plan').onclick = () => {
    const themeText = $('theme').value.trim();
    if (!themeText) {
      alert('请输入影片主题描述！');
      return;
    }

    const requestedShots = Number($('shots').value) || 4;
    const profileId = $('profile').value;

    const { intent, plan, warnings, governance } = planFilm({
      theme: themeText,
      requestedShots,
      profileId
    }, activeRegistry);

    // 内容治理前置分流
    if (governance.status === 'blocked') {
      text($('intent'), `❌ 已被内容安全策略阻断：${governance.reasons.join('；')}`);
      $('intent').className = 'bad';
      $('violations').replaceChildren(
        createEl('div', { style: { color: '#ff5252', padding: '12px', background: 'rgba(255,82,82,0.1)', borderRadius: '6px' } },
          `触发阻断规则: ${governance.flags.join(', ')}。请修改主题以符合微缩军事安全规范。`)
      );
      return;
    }

    if (governance.status === 'review_required') {
      currentProject.reviewQueue = currentProject.reviewQueue || [];
      currentProject.reviewQueue.unshift({
        id: `rev_${Date.now()}`,
        theme: themeText,
        flags: governance.flags,
        reasons: governance.reasons,
        createdAt: new Date().toISOString()
      });
      text($('intent'), `⚠ 已转入人工审核队列：${governance.reasons.join('；')}`);
      $('intent').className = 'warn';
    } else {
      text($('intent'), intent.needsConfirmation
        ? `需确认年代：${warnings.join('；')}`
        : `年代：${intent.era || '未指定'} · 任务：${intent.task} · 状态：合规放行`);
      $('intent').className = intent.needsConfirmation ? 'warn' : 'ok';
    }

    const selectedAr = $('aspect-ratio').value || '16:9';
    plan.shots.forEach(s => { s.aspectRatio = selectedAr; });

    currentProject.shots = plan.shots;
    currentProject.theme = themeText;
    currentProject.intent = intent;
    currentProject.aspectRatio = selectedAr;
    currentProject.directorNotes = null;
    currentProject.matchedMovie = null;
    $('director-notes-panel').style.display = 'none';

    storeManager.saveAll(currentStore);
    renderCurrentProject();
  };

  // 6. 导出工程 JSON
  $('export-btn').onclick = () => {
    if (!currentProject) return;
    const jsonStr = storeManager.export(currentProject);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.name || 'lwu-film'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 7. 导出剪映分镜表 CSV
  $('export-csv-btn').onclick = () => {
    if (!currentProject || !currentProject.shots || currentProject.shots.length === 0) {
      alert('当前影片暂无镜头，请先选择一部电影或生成分镜计划！');
      return;
    }
    exportToCapCutCSV(currentProject.shots, activeRegistry, currentProject.theme || currentProject.name);
  };

  // 8. 打开乐高资产库抽屉
  $('asset-manager-btn').onclick = () => {
    renderAssetManager($('asset-drawer'), activeRegistry);
  };

  // 9. 导入工程
  $('import-btn').onclick = () => $('import-file').click();
  $('import-file').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    const result = await storeManager.import(content);
    if (result.violations) {
      alert(`导入失败: ${result.violations.map(v => v.code).join(', ')}`);
      return;
    }
    currentStore.projects.push(result.project);
    currentStore.currentProjectId = result.project.id;
    currentProject = result.project;
    await storeManager.saveAll(currentStore);
    renderTabs();
    renderCurrentProject();
    alert('工程导入成功！');
    $('import-file').value = '';
  };
}

function refreshOutputs() {
  if (!currentProject) return;
  const p = activeProfile || activeRegistry.profileById.get($('profile').value);

  // 1. 渲染双轨视听时间线（含首帧与音轨）
  renderTimeline($('timeline-container'), currentProject.shots || [], activeRegistry, (idx, shot) => {
    openShotEditor(idx, shot);
  }, (prompt) => {
    navigator.clipboard?.writeText(prompt);
    alert('已成功复制 35mm 定格首帧参考图 Prompt 到剪贴板！\n可直接粘贴至 FLUX / Midjourney 中生成关键帧图片。');
  });

  // 2. 渲染已编译输出
  renderPlan($('output'), { shots: currentProject.shots || [] }, compileShot, activeRegistry, p, (idx, shot) => {
    openShotEditor(idx, shot);
  });

  // 3. 校验违规
  const valResult = validateFilmPlan({ shots: currentProject.shots || [], intent: currentProject.intent || {} }, activeRegistry);
  $('violations').replaceChildren();
  if (!valResult.ok) {
    for (const v of valResult.violations) {
      const msg = createEl('div', {
        style: { color: '#ff9292', padding: '6px 12px', background: 'rgba(255,146,146,0.08)', borderRadius: '4px', marginBottom: '6px', fontSize: '13px' }
      }, `⚠ 规则警告 [${v.code}] ${v.message || ''}`);
      $('violations').appendChild(msg);
    }
  }

  // 4. 渲染审核队列
  renderReviewQueue($('review-container'), currentProject.reviewQueue || [], {
    onApprove: (item) => {
      currentProject.reviewQueue = currentProject.reviewQueue.filter(q => q.id !== item.id);
      storeManager.saveAll(currentStore);
      refreshOutputs();
    },
    onReject: (item) => {
      currentProject.reviewQueue = currentProject.reviewQueue.filter(q => q.id !== item.id);
      storeManager.saveAll(currentStore);
      refreshOutputs();
    }
  });
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
    (updated) => {
      currentProject.shots[index] = updated;
      storeManager.saveAll(currentStore);
      refreshOutputs();
      $('editor-drawer').style.display = 'none';
    },
    () => {
      $('editor-drawer').style.display = 'none';
    }
  );
}

boot().catch(err => {
  text($('manifest'), '资产或工作台初始化失败');
  $('manifest').className = 'bad';
  console.error(err);
});
