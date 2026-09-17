/**
 * LEGO War Universe - UI 渲染辅助工具集
 * 遵循无 innerHTML 的安全渲染规范
 */

export const text = (node, value) => {
  if (node) node.textContent = String(value ?? '');
  return node;
};

/**
 * 创建元素辅助
 */
export function createEl(tag, attrs = {}, ...children) {
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

/**
 * 渲染多影片工程切换 Tab 栏
 */
export function renderProjectTabs(container, projects = [], currentId = null, callbacks = {}) {
  container.replaceChildren();

  const wrap = createEl('div', {
    style: { display: 'flex', gap: '8px', alignItems: 'center', overflowX: 'auto', paddingBottom: '4px' }
  });

  for (const p of projects) {
    const isActive = p.id === currentId;
    const tab = createEl('button', {
      style: {
        background: isActive ? '#40b9a6' : '#1e293b',
        color: isActive ? '#0a1628' : '#cbd5e1',
        border: '1px solid ' + (isActive ? '#40b9a6' : '#334155'),
        borderRadius: '6px',
        padding: '6px 14px',
        fontSize: '13px',
        fontWeight: isActive ? '700' : '500',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        whiteSpace: 'nowrap'
      },
      onClick: () => callbacks.onSelect?.(p.id)
    },
      p.name || '未命名影片',
      projects.length > 1 ? createEl('span', {
        style: { color: isActive ? '#0f172a' : '#94a3b8', fontSize: '11px', cursor: 'pointer' },
        title: '删除影片',
        onClick: (e) => { e.stopPropagation(); callbacks.onDelete?.(p.id); }
      }, '✕') : null
    );
    wrap.appendChild(tab);
  }

  const addBtn = createEl('button', {
    style: {
      background: 'transparent',
      border: '1px dashed #64748b',
      color: '#94a3b8',
      borderRadius: '6px',
      padding: '6px 12px',
      fontSize: '13px',
      cursor: 'pointer'
    },
    onClick: () => callbacks.onCreate?.()
  }, '+ 新建影片');

  wrap.appendChild(addBtn);
  container.appendChild(wrap);
}

/**
 * 渲染已编译的镜头输出列表
 */
export function renderPlan(node, plan, compile, registry, profile, onEditShot = null) {
  node.replaceChildren();
  if (!plan || !plan.shots || plan.shots.length === 0) return;

  for (const [i, shot] of plan.shots.entries()) {
    const section = createEl('section', {
      style: {
        background: '#071019',
        border: '1px solid #324256',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px'
      }
    });

    const header = createEl('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }
    });

    const title = createEl('h3', {
      style: { margin: '0', fontSize: '15px', color: '#e7edf7' }
    }, `S${String(i + 1).padStart(3, '0')} · ${shot.phase} · 轴线: ${shot.screenDirection || 'neutral'}`);

    const editBtn = createEl('button', {
      style: {
        background: '#1e293b',
        border: '1px solid #475569',
        color: '#38bdf8',
        borderRadius: '4px',
        padding: '4px 10px',
        fontSize: '12px',
        cursor: 'pointer'
      },
      onClick: () => onEditShot?.(i, shot)
    }, '编辑镜头');

    header.append(title, editBtn);

    const out = createEl('pre', {
      style: {
        whiteSpace: 'pre-wrap',
        margin: '0',
        background: '#030712',
        border: '1px solid #1f2937',
        padding: '12px',
        borderRadius: '6px',
        fontSize: '13px',
        lineHeight: '1.5',
        color: '#e2e8f0'
      }
    });

    try {
      out.textContent = compile(shot, registry, profile).prompt;
    } catch (err) {
      out.textContent = `编译失败: ${err.message}`;
      out.style.color = '#f87171';
    }

    section.append(header, out);
    node.append(section);
  }
}
