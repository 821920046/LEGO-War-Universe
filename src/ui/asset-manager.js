/**
 * LEGO War Universe - 可视化乐高资产管理器 (Asset Library & Manager)
 * 支持 381 基础资产多维检索（按类别、时代、关键词）
 * 支持可视化录入新乐高人仔/装备，自动验证 ID 命名规范并导出 JSON
 */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else if (c) node.appendChild(c);
  }
  return node;
}

const CATEGORY_NAMES = {
  characters: '人仔 (Characters)',
  vehicles: '载具 (Vehicles)',
  weapons: '武器 (Weapons)',
  environments: '环境战场 (Environments)',
  lighting: '灯光布光 (Lighting)',
  colorGrades: '色彩分级 (Color Grades)'
};

import { openAddAssetDialog, openManageCustomAssets, loadCustomAssets } from './custom-assets.js';

/**
 * 渲染资产库抽屉面板
 * @param {HTMLElement} container 抽屉容器
 * @param {object} registry 资产注册表
 * @param {Function} onClose 关闭回调
 */
export function renderAssetManager(container, registry, onClose = null) {
  container.replaceChildren();
  container.style.display = 'flex';

  let currentCategory = 'characters';
  let searchQuery = '';

  const listContainer = el('div', { class: 'grid grid--cards' });

  function refreshList() {
    listContainer.replaceChildren();
    const items = registry?.byKind?.get(currentCategory.replace(/s$/, '')) || [];
    const q = searchQuery.toLowerCase().trim();

    const filtered = items.filter(item => {
      if (!q) return true;
      const text = `${item.id} ${item.name || ''} ${item.nameZh || ''} ${item.series || ''} ${item.faction || ''}`.toLowerCase();
      return text.includes(q);
    });

    if (filtered.length === 0) {
      listContainer.appendChild(
        el('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, '未找到匹配的乐高资产')
      );
      return;
    }

    for (const item of filtered) {
      const card = el('div', { class: 'rcard' },
        el('div', { class: 'rcard__top' },
          el('strong', { class: 'badge badge--mono badge--info' }, item.id),
          el('span', { style: { color: 'var(--text-3)', fontSize: '11px' } }, item.series || '通用')
        ),
        el('div', { class: 'rcard__name' }, item.nameZh || item.name),
        el('div', { class: 'rcard__outfit' }, item.lines ? item.lines[0] : '')
      );
      listContainer.appendChild(card);
    }
  }

  // 头部
  const totalCount = registry?.byId?.size ?? 0;
  const customCount = loadCustomAssets().length;

  const header = el('div', { class: 'drawer__head' },
    el('h3', { class: 'drawer__title' },
      `乐高微缩资产库 · ${totalCount} 项${customCount ? `（含自定义 ${customCount} 项）` : ''}`),
    el('button', {
      class: 'btn btn--ghost btn--sm',
      onClick: () => { container.style.display = 'none'; onClose?.(); }
    }, '关闭')
  );

  // 搜索栏与分类过滤
  const searchInput = el('input', {
    type: 'text',
    class: 'input',
    placeholder: '按名称、ID、时代或阵营搜索（如 Abrams、特种部队）…',
    style: { marginBottom: '12px' },
    onInput: (e) => { searchQuery = e.target.value; refreshList(); }
  });

  const catTabs = el('div', { class: 'tabs', style: { marginBottom: '14px' } });
  for (const [key, label] of Object.entries(CATEGORY_NAMES)) {
    const btn = el('button', {
      class: `tab${key === currentCategory ? ' is-active' : ''}`,
      onClick: () => {
        currentCategory = key;
        for (const child of catTabs.children) child.classList.remove('is-active');
        btn.classList.add('is-active');
        refreshList();
      }
    }, label);
    catTabs.appendChild(btn);
  }

  // 新增资产入口：录入后立即注入注册表并持久化，而非仅仅下载一个 JSON 文件
  const addAssetBtn = el('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } },
    el('button', {
      class: 'btn btn--subtle',
      style: { flex: '1', borderStyle: 'dashed' },
      onClick: () => openAddAssetDialog(() => {
        refreshList();
        const nextCustom = loadCustomAssets().length;
        header.querySelector('.drawer__title').textContent = `乐高微缩资产库 · ${registry?.byId?.size ?? 0} 项（含自定义 ${nextCustom} 项）`;
      })
    }, '+ 录入新的自定义乐高人仔 / 载具装备'),
    el('button', {
      class: 'btn btn--ghost',
      title: '管理/清除已录入的自定义资产',
      onClick: () => openManageCustomAssets(registry, () => refreshList())
    }, '管理自定义')
  );

  const body = el('div', { class: 'drawer__body' },
    searchInput, catTabs, listContainer, addAssetBtn);

  container.appendChild(header);
  container.appendChild(body);
  refreshList();
}
