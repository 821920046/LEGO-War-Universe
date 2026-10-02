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
 * 按严重度分级渲染规则校验结果
 *
 * 分级渲染的理由：早期实现把所有违规一律渲染成红色警告。由于环境资产的时代
 * 覆盖极不均衡，一次转译就能刷出十几条红色提示，真正的穿帮错误反而被淹没。
 * error 用红色阻断式呈现，warning 用琥珀色提示式呈现。
 *
 * @param {HTMLElement} node 容器
 * @param {{ violations?: Array<object>, errors?: Array<object>, warnings?: Array<object> }} result 校验结果
 */
export function continuityRepairWarnings(shots = []) {
  return shots.flatMap((shot, index) => shot?.axisRepairedFrom ? [{
    code: 'AXIS_DIRECTION_AUTO_REPAIRED',
    severity: 'warning',
    message: `S${String(index + 1).padStart(3, '0')} 的作者方向 ${shot.axisRepairedFrom} 与前镜头构成越轴，已自动调整为 neutral（中性骑轴）。请确认该镜头仍符合创作意图。`
  }] : []);
}

export function renderViolations(node, result) {
  if (!node) return;
  node.replaceChildren();
  if (!result) return;

  const errors = result.errors ?? (result.violations || []).filter(v => v.severity !== 'warning');
  const warnings = result.warnings ?? (result.violations || []).filter(v => v.severity === 'warning');

  if (errors.length === 0 && warnings.length === 0) return;

  if (errors.length > 0) {
    node.appendChild(createEl('div', {
      style: { color: '#ff9292', fontSize: '12px', fontWeight: '700', margin: '8px 0 6px 0' }
    }, `⛔ 阻断级问题 ${errors.length} 项`));
    for (const v of errors) {
      node.appendChild(createEl('div', {
        style: { color: '#ff9292', padding: '6px 12px', background: 'rgba(255,146,146,0.08)', borderLeft: '3px solid #ef4444', borderRadius: '4px', marginBottom: '6px', fontSize: '13px' }
      }, `⚠ 规则警告 [${v.code}] ${v.message || ''}`));
    }
  }

  if (warnings.length > 0) {
    node.appendChild(createEl('div', {
      style: { color: '#ffd07a', fontSize: '12px', fontWeight: '700', margin: '10px 0 6px 0' }
    }, `💡 提示级建议 ${warnings.length} 项（不影响生成）`));
    for (const v of warnings) {
      node.appendChild(createEl('div', {
        style: { color: '#ffd07a', padding: '6px 12px', background: 'rgba(245,158,11,0.07)', borderLeft: '3px solid #f59e0b', borderRadius: '4px', marginBottom: '6px', fontSize: '13px' }
      }, `[${v.code}] ${v.message || `资产 ${v.id || ''} 属 ${v.era || '?'} 系列，与设定的 ${v.targetEra || '?'} 题材略有出入`}`));
    }
  }
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
