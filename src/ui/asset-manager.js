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
  container.style.display = 'block';

  let currentCategory = 'characters';
  let searchQuery = '';

  const listContainer = el('div', {
    style: {
      maxHeight: '400px',
      overflowY: 'auto',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      gap: '10px',
      padding: '4px'
    }
  });

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
        el('div', { style: { gridColumn: '1 / -1', color: '#64748b', textAlign: 'center', padding: '24px' } }, '未找到匹配的乐高资产')
      );
      return;
    }

    for (const item of filtered) {
      const card = el('div', {
        style: {
          background: '#071019',
          border: '1px solid #1e293b',
          borderRadius: '6px',
          padding: '10px 12px',
          fontSize: '12px'
        }
      },
        el('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } },
          el('strong', { style: { color: '#38bdf8' } }, item.id),
          el('span', { style: { color: '#94a3b8', fontSize: '11px' } }, item.series || '通用')
        ),
        el('div', { style: { color: '#f1f5f9', fontWeight: '600', marginBottom: '4px' } }, item.nameZh || item.name),
        el('div', { style: { color: '#64748b', fontSize: '11px', lineHeight: '1.4', maxHeight: '36px', overflow: 'hidden' } },
          item.lines ? item.lines[0] : ''
        )
      );
      listContainer.appendChild(card);
    }
  }

  // 头部
  const totalCount = registry?.byId?.size ?? 0;
  const customCount = loadCustomAssets().length;

  const header = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' } },
    el('h3', { style: { color: '#e7edf7', margin: '0', fontSize: '16px' } },
      `乐高微缩资产库 (${totalCount} 项${customCount ? `，含自定义 ${customCount} 项` : ''})`),
    el('button', {
      style: { background: 'transparent', border: '1px solid #475569', color: '#94a3b8', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
      onClick: () => { container.style.display = 'none'; onClose?.(); }
    }, '关闭')
  );

  // 搜索栏与分类过滤
  const searchInput = el('input', {
    type: 'text',
    placeholder: '按名称、ID、时代或阵营搜索（如 Abrams、特种部队）…',
    style: { width: '100%', boxSizing: 'border-box', padding: '8px 12px', background: '#020617', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', marginBottom: '12px' },
    onInput: (e) => { searchQuery = e.target.value; refreshList(); }
  });

  const catTabs = el('div', { style: { display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '12px' } });
  for (const [key, label] of Object.entries(CATEGORY_NAMES)) {
    const btn = el('button', {
      style: {
        background: key === currentCategory ? '#38bdf8' : '#1e293b',
        color: key === currentCategory ? '#0f172a' : '#94a3b8',
        border: '0',
        borderRadius: '4px',
        padding: '4px 10px',
        fontSize: '11px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontWeight: '600'
      },
      onClick: () => {
        currentCategory = key;
        for (const child of catTabs.children) {
          child.style.background = '#1e293b';
          child.style.color = '#94a3b8';
        }
        btn.style.background = '#38bdf8';
        btn.style.color = '#0f172a';
        refreshList();
      }
    }, label);
    catTabs.appendChild(btn);
  }

  // 新增资产入口：录入后立即注入注册表并持久化，而非仅仅下载一个 JSON 文件
  const addAssetBtn = el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
    el('button', {
      style: {
        flex: '1',
        background: 'transparent',
        border: '1px dashed #38bdf8',
        color: '#38bdf8',
        padding: '8px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: '600'
      },
      onClick: () => openAddAssetDialog(() => {
        refreshList();
        const customCount = loadCustomAssets().length;
        header.firstChild.textContent = `乐高微缩资产库 (${registry?.byId?.size ?? 0} 项，含自定义 ${customCount} 项)`;
      })
    }, '+ 录入新的自定义乐高人仔 / 载具装备'),
    el('button', {
      style: {
        background: 'transparent',
        border: '1px solid #475569',
        color: '#94a3b8',
        padding: '8px 12px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px'
      },
      title: '管理/清除已录入的自定义资产',
      onClick: () => openManageCustomAssets(registry, () => refreshList())
    }, '管理自定义')
  );

  const wrapper = el('div', {
    style: {
      background: '#0b1320',
      border: '1px solid #1e3a5f',
      borderRadius: '8px',
      padding: '20px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.8)'
    }
  }, header, searchInput, catTabs, listContainer, addAssetBtn);

  container.appendChild(wrapper);
  refreshList();
}
