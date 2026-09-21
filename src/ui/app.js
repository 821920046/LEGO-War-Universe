import { createRegistry } from '../domain/registry.js';
import { planFilm } from '../domain/planner.js';
import { compileShot } from '../domain/compiler.js';
import { validateFilmPlan } from '../domain/shot-spec.js';
import { transpileMovieToLego, CINEMA_DATABASE } from '../domain/cinema-homage.js';
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
  text($('manifest'), `构建 ${manifest.projectVersion} · 资产 ${manifest.assetCount} · ${manifest.assetSha256.slice(0, 12)}`);

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
      const name = prompt('请输入新影片名称：', `影片 ${currentStore.projects.length + 1}`);
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

function renderDirectorNotesPanel(movieName, notes) {
  const panel = $('director-notes-panel');
  if (!panel || !notes) return;

  panel.replaceChildren();
  panel.style.display = 'block';

  const card = createEl('div', {
    style: {
      background: 'linear-gradient(135deg, #091a2f 0%, #050d18 100%)',
      border: '1px solid #1e3a5f',
      borderRadius: '8px',
      padding: '16px 20px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      fontSize: '13px'
    }
  },
    // 标题栏
    createEl('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } },
      createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        createEl('span', { style: { fontSize: '18px' } }, '🎬'),
        createEl('strong', { style: { color: '#ffd07a', fontSize: '15px' } }, `《${movieName}》好莱坞经典视听解构与导演拉片笔记`),
        createEl('span', { style: { color: '#64748b', fontSize: '12px' } }, `导演：${notes.director || '大师名家'}`)
      ),
      createEl('button', {
        style: { background: 'transparent', border: '1px solid #475569', color: '#94a3b8', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' },
        onClick: () => { panel.style.display = 'none'; }
      }, '收起笔记')
    ),
    // 核心视听与光影
    createEl('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' } },
      createEl('div', { style: { background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '6px' } },
        createEl('div', { style: { color: '#38bdf8', fontWeight: '700', marginBottom: '4px' } }, '🎥 运镜视效特征 (Visual Style)'),
        createEl('div', { style: { color: '#cbd5e1', lineHeight: '1.4' } }, notes.visualStyle || '')
      ),
      createEl('div', { style: { background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '6px' } },
        createEl('div', { style: { color: '#38bdf8', fontWeight: '700', marginBottom: '4px' } }, '🔊 声音设计灵魂 (Audio / SFX)'),
        createEl('div', { style: { color: '#cbd5e1', lineHeight: '1.4' } }, notes.audioScore || '')
      )
    ),
    // 拉片教学核心干货
    createEl('div', {
      style: {
        background: 'rgba(255, 208, 122, 0.08)',
        borderLeft: '4px solid #ffd07a',
        padding: '10px 14px',
        borderRadius: '4px',
        color: '#fef08a',
        lineHeight: '1.5'
      }
    },
      createEl('strong', { style: { color: '#ffd07a' } }, '💡 创作者提升 · 为什么这么拍：'),
      document.createTextNode(` ${notes.pedagogyLesson || ''}`)
    )
  );

  panel.appendChild(card);
}

function executeMovieTranspile(movieQuery) {
  const requestedShots = Number($('shots').value) || 4;
  const selectedAr = $('aspect-ratio').value || '16:9';
  const result = transpileMovieToLego(movieQuery, requestedShots);

  // 填充主题文本
  $('theme').value = result.themeZh;
  currentProject.theme = result.themeZh;

  // 注入画面比例并更新镜头
  result.shots.forEach(s => { s.aspectRatio = selectedAr; });
  currentProject.shots = result.shots;
  currentProject.intent = {
    era: result.era,
    task: 'combat',
    theme: result.themeZh,
    confidence: 1.0,
    safetyTags: [],
    governance: { status: 'passed', flags: [], reasons: [] }
  };
  currentProject.aspectRatio = selectedAr;
  currentProject.directorNotes = result.directorNotes;
  currentProject.matchedMovie = result.matchedMovie;
  storeManager.saveAll(currentStore);

  // 渲染好莱坞导演拉片笔记面板
  renderDirectorNotesPanel(result.matchedMovie, result.directorNotes);

  text($('intent'), `🎬 已成功转译《${result.matchedMovie}》视听母题 · 时代：${result.era} · 好莱坞视听拉片已就绪`);
  $('intent').className = 'ok';

  refreshOutputs();
}

function bindGlobalEvents() {
  // 渲染电影快捷标签
  const chipContainer = $('movie-chips');
  if (chipContainer) {
    chipContainer.replaceChildren();
    const chipMovies = ['壮志凌云', '黑鹰坠落', '地心引力', '明日边缘', '边境杀手', '流浪地球', '拯救大兵瑞恩', '敦刻尔克'];
    for (const name of chipMovies) {
      const btn = createEl('button', {
        style: {
          background: '#1e293b',
          border: '1px solid #334155',
          color: '#94a3b8',
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '11px',
          cursor: 'pointer'
        },
        onClick: () => {
          $('movie-input').value = name;
          executeMovieTranspile(name);
        }
      }, `🎬 ${name}`);
      chipContainer.appendChild(btn);
    }
  }

  // 电影智能转译按钮
  $('transpile-movie-btn').onclick = () => {
    const query = $('movie-input').value.trim();
    if (!query) {
      alert('请输入电影名称（如：壮志凌云、地心引力、黑鹰坠落）！');
      return;
    }
    executeMovieTranspile(query);
  };

  // 生成常规分镜计划按钮
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

    // 内容治理前置分流与处理
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
      // 加入人工审核队列
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

    // 注入当前选择的画面比例
    const selectedAr = $('aspect-ratio').value || '16:9';
    plan.shots.forEach(s => { s.aspectRatio = selectedAr; });

    // 更新当前项目并保存
    currentProject.shots = plan.shots;
    currentProject.theme = themeText;
    currentProject.intent = intent;
    currentProject.aspectRatio = selectedAr;
    storeManager.saveAll(currentStore);

    renderCurrentProject();
  };

  // 监听画面比例切换
  $('aspect-ratio').onchange = () => {
    const ar = $('aspect-ratio').value;
    if (currentProject && currentProject.shots) {
      currentProject.shots.forEach(s => { s.aspectRatio = ar; });
      currentProject.aspectRatio = ar;
      storeManager.saveAll(currentStore);
      refreshOutputs();
    }
  };

  // 导出工程 JSON
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

  // 导出剪映分镜表 CSV
  $('export-csv-btn').onclick = () => {
    if (!currentProject || !currentProject.shots || currentProject.shots.length === 0) {
      alert('当前影片暂无镜头，请先生成分镜计划！');
      return;
    }
    exportToCapCutCSV(currentProject.shots, activeRegistry, currentProject.theme || currentProject.name);
  };

  // 打开乐高资产库抽屉
  $('asset-manager-btn').onclick = () => {
    renderAssetManager($('asset-drawer'), activeRegistry);
  };

  // 导入工程
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
  if (currentProject.aspectRatio) $('aspect-ratio').value = currentProject.aspectRatio;
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
