import { createRegistry } from '../domain/registry.js';
import { planFilm } from '../domain/planner.js';
import { compileShot } from '../domain/compiler.js';
import { validateFilmPlan } from '../domain/shot-spec.js';
import { ProjectStore } from './project-store.js';
import { renderTimeline } from './timeline.js';
import { renderShotEditor } from './shot-editor.js';
import { renderReviewQueue } from './review-queue.js';
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

function bindGlobalEvents() {
  // 生成分镜计划按钮
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

    // 更新当前项目并保存
    currentProject.shots = plan.shots;
    currentProject.theme = themeText;
    currentProject.intent = intent;
    storeManager.saveAll(currentStore);

    renderCurrentProject();
  };

  // 导出工程
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

  // 1. 渲染时间线
  renderTimeline($('timeline-container'), currentProject.shots || [], activeRegistry, (idx, shot) => {
    openShotEditor(idx, shot);
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
