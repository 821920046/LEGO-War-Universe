/**
 * LEGO War Universe - 时间线视图渲染器
 * 渲染可视化的镜头时间线：镜头卡片 + 叙事阶段标签 + 轴线方向箭头 + 损伤状态 + 参考帧连接线
 */

/**
 * 叙事阶段对应的配色
 */
const PHASE_COLORS = {
  establish: '#40b9a6',
  opening: '#40b9a6',
  build: '#5b9bd5',
  buildup: '#5b9bd5',
  climax: '#ff6b6b',
  resolve: '#ffd07a',
  resolution: '#ffd07a'
};

/**
 * 轴线方向箭头映射
 */
const DIR_ARROWS = {
  'left-to-right': '→',
  'right-to-left': '←',
  'towards-camera': '↑',
  'away-from-camera': '↓',
  'neutral': '·'
};

/**
 * 损伤状态标签配色
 */
const DAMAGE_BADGES = {
  clean: { label: '全新', color: '#84edbd' },
  weathered: { label: '风化', color: '#b0bec5' },
  damaged: { label: '战损', color: '#ffa726' },
  destroyed: { label: '残骸', color: '#ff5252' }
};

/**
 * 创建 DOM 元素的辅助函数
 * @param {string} tag 标签名
 * @param {object} attrs 属性
 * @param  {...(string|Node)} children 子元素
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k.startsWith('on')) {
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
 * 渲染单个镜头卡片
 * @param {object} shot 镜头对象
 * @param {number} index 镜头索引
 * @param {object} registry 资产注册表（可选）
 * @param {Function} onSelect 点击回调
 * @returns {HTMLElement}
 */
function renderShotCard(shot, index, registry, onSelect) {
  const shotLabel = `S${String(index + 1).padStart(3, '0')}`;
  const phase = shot.phase || 'build';
  const phaseColor = PHASE_COLORS[phase] || '#5b9bd5';

  const dir = shot.screenDirection || shot.continuityIn?.screenDirection || 'neutral';
  const arrow = DIR_ARROWS[dir] || '·';

  const damage = shot.damageState || shot.continuityOut?.damageState || 'weathered';
  const damageBadge = DAMAGE_BADGES[damage] || DAMAGE_BADGES.weathered;

  const hasRef = !!(shot.referenceFrame || shot.continuityIn?.referenceFrame);

  // 主体名称
  const subjectNames = (shot.subjects || []).map(id => {
    if (registry) {
      const a = registry.byId.get(id);
      return a ? (a.nameZh || a.name) : id;
    }
    return id;
  }).join(', ');

  const card = el('div', {
    class: 'tl-card',
    style: {
      borderLeft: `4px solid ${phaseColor}`,
      background: '#0a1628',
      borderRadius: '8px',
      padding: '12px 16px',
      minWidth: '200px',
      maxWidth: '260px',
      cursor: 'pointer',
      transition: 'transform 0.15s, box-shadow 0.15s',
      position: 'relative',
      flexShrink: '0'
    },
    onClick: () => onSelect?.(index, shot)
  },
    // 标题行：镜头号 + 阶段
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
      el('strong', { style: { color: '#e7edf7', fontSize: '14px' } }, shotLabel),
      el('span', { style: { background: phaseColor, color: '#0a1628', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' } }, phase)
    ),
    // 主体
    el('div', { style: { color: '#90a4ae', fontSize: '12px', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, subjectNames || '无主体'),
    // 动作摘要
    el('div', { style: { color: '#78909c', fontSize: '11px', marginBottom: '8px', lineHeight: '1.4', maxHeight: '32px', overflow: 'hidden' } },
      (shot.action || '').slice(0, 80) + ((shot.action || '').length > 80 ? '…' : '')
    ),
    // 底栏：轴线 + 损伤 + 参考帧
    el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px' } },
      el('span', { style: { color: '#b0bec5' }, title: `屏幕方向: ${dir}` }, `轴 ${arrow}`),
      el('span', { style: { color: damageBadge.color, background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '3px' } }, damageBadge.label),
      hasRef ? el('span', { style: { color: '#4fc3f7' }, title: '已绑定参考帧' }, '🔗') : null
    )
  );

  // 悬停效果
  card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)'; });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.boxShadow = ''; });

  return card;
}

/**
 * 渲染完整时间线
 * @param {HTMLElement} container 容器元素
 * @param {Array<object>} shots 镜头列表
 * @param {object} registry 资产注册表
 * @param {Function} onSelectShot 选中镜头回调
 */
export function renderTimeline(container, shots = [], registry = null, onSelectShot = null) {
  container.replaceChildren();

  if (shots.length === 0) {
    container.appendChild(
      el('div', { style: { color: '#546e7a', textAlign: 'center', padding: '32px', fontSize: '14px' } },
        '暂无镜头，请输入主题并生成分镜计划。')
    );
    return;
  }

  // 时间线容器
  const timeline = el('div', {
    class: 'tl-track',
    style: {
      display: 'flex',
      gap: '12px',
      overflowX: 'auto',
      padding: '16px 0',
      scrollBehavior: 'smooth'
    }
  });

  for (let i = 0; i < shots.length; i++) {
    // 如果不是第一个镜头，插入连接线
    if (i > 0) {
      const connector = el('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          color: '#324256',
          fontSize: '18px',
          flexShrink: '0'
        }
      }, '─');
      timeline.appendChild(connector);
    }
    timeline.appendChild(renderShotCard(shots[i], i, registry, onSelectShot));
  }

  container.appendChild(timeline);
}
