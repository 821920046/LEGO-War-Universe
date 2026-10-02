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

  const wrap = createEl('div', { class: 'tabs' });

  for (const p of projects) {
    const isActive = p.id === currentId;
    const tab = createEl('button', {
      class: `tab${isActive ? ' is-active' : ''}`,
      'aria-current': isActive ? 'true' : 'false',
      onClick: () => callbacks.onSelect?.(p.id)
    },
      p.name || '未命名影片',
      projects.length > 1 ? createEl('span', {
        class: 'tab__close',
        title: '删除影片',
        'aria-label': `删除影片 ${p.name || ''}`,
        onClick: (e) => { e.stopPropagation(); callbacks.onDelete?.(p.id); }
      }, '✕') : null
    );
    wrap.appendChild(tab);
  }

  wrap.appendChild(createEl('button', {
    class: 'tab tab--add',
    onClick: () => callbacks.onCreate?.()
  }, '+ 新建影片'));

  container.appendChild(wrap);
}

/**
 * 连续性自动修复提示
 */
export function continuityRepairWarnings(shots = []) {
  return shots.flatMap((shot, index) => shot?.axisRepairedFrom ? [{
    code: 'AXIS_DIRECTION_AUTO_REPAIRED',
    severity: 'warning',
    message: `S${String(index + 1).padStart(3, '0')} 的作者方向 ${shot.axisRepairedFrom} 与前镜头构成越轴，已自动调整为 neutral（中性骑轴）。请确认该镜头仍符合创作意图。`
  }] : []);
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
export function renderViolations(node, result) {
  if (!node) return;
  node.replaceChildren();
  if (!result) return;

  const errors = result.errors ?? (result.violations || []).filter(v => v.severity !== 'warning');
  const warnings = result.warnings ?? (result.violations || []).filter(v => v.severity === 'warning');

  if (errors.length === 0 && warnings.length === 0) return;

  const block = (title, items, kind) => {
    const group = createEl('div', { style: { marginTop: '12px' } },
      createEl('div', { class: 'field__label', style: { marginBottom: '8px' } }, title)
    );
    for (const v of items) {
      group.appendChild(createEl('div', { class: `alert alert--${kind}` },
        createEl('span', { class: 'alert__icon' }, kind === 'danger' ? '⛔' : '💡'),
        createEl('span', {}, `[${v.code}] ${v.message || `资产 ${v.id || ''} 属 ${v.era || '?'} 系列，与设定的 ${v.targetEra || '?'} 题材略有出入`}`)
      ));
    }
    return group;
  };

  if (errors.length > 0) node.appendChild(block(`阻断级问题 ${errors.length} 项`, errors, 'danger'));
  if (warnings.length > 0) node.appendChild(block(`提示级建议 ${warnings.length} 项（不影响生成）`, warnings, 'warn'));
}

/**
 * 渲染已编译的镜头输出列表
 *
 * @param {HTMLElement} node 容器
 * @param {object} plan 分镜计划
 * @param {Function} compile 编译函数 (shot, registry, profile, roster) => { prompt }
 * @param {object} registry 资产注册表
 * @param {object} profile 模型配置
 * @param {Function} [onEditShot] 编辑回调
 * @param {object|null} [roster] 角色名册（用于把代号写进编译出的视频脚本）
 */
export function renderPlan(node, plan, compile, registry, profile, onEditShot = null, roster = null) {
  node.replaceChildren();
  if (!plan || !plan.shots || plan.shots.length === 0) return;

  // 本片阵容速览：一眼看到「哪些角色、什么代号」，与脚本正文完全一致
  if (roster && Array.isArray(roster.all) && roster.all.length > 0) {
    const strip = createEl('div', { class: 'panel', style: { marginBottom: '14px' } },
      createEl('div', { class: 'field__label', style: { marginBottom: '8px' } },
        `🎭 本片阵容（${roster.all.length}）· 代号已写入下方每一段视频脚本`)
    );
    const row = createEl('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    for (const e of roster.all) {
      const isFoe = e.side === 'opposing';
      row.appendChild(createEl('span', {
        class: `badge ${isFoe ? 'badge--danger' : 'badge--info'}`,
        title: `${e.name} · ${e.role} · ${e.id}`
      }, `${isFoe ? '⚔️' : '🛡️'} 【${e.callsign}】${e.name}`));
    }
    strip.appendChild(row);
    node.appendChild(strip);
  }

  for (const [i, shot] of plan.shots.entries()) {
    const card = createEl('div', { class: 'card', style: { marginBottom: '14px' } });

    const header = createEl('div', { class: 'card__head' },
      createEl('h3', { class: 'card__title', style: { fontSize: '14px' } },
        createEl('span', { class: 'badge badge--mono' }, `S${String(i + 1).padStart(3, '0')}`),
        createEl('span', { class: 'badge' }, shot.phase || 'build'),
        createEl('span', { class: 'badge' }, `轴线 ${shot.screenDirection || 'neutral'}`)
      ),
      createEl('div', { class: 'card__actions' },
        createEl('button', {
          class: 'btn btn--subtle btn--sm',
          onClick: () => onEditShot?.(i, shot)
        }, '编辑镜头')
      )
    );

    const out = createEl('pre', { class: 'codeblock' });
    try {
      out.textContent = compile(shot, registry, profile, roster).prompt;
    } catch (err) {
      out.textContent = `编译失败: ${err.message}`;
      out.classList.add('bad');
    }

    card.append(header, createEl('div', { class: 'card__body', style: { paddingTop: '14px' } }, out));
    node.append(card);
  }
}
