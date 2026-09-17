/**
 * LEGO War Universe - 镜头属性编辑器
 * 抽屉式镜头编辑面板：实时微调主体、环境、摄像机参数、损伤等级、动作描述
 * 并进行即时校验与错误反馈
 */

import { validateShotSpec } from '../domain/shot-spec.js';
import { DAMAGE_HIERARCHY, SCREEN_DIRECTIONS } from '../domain/continuity.js';

/**
 * 创建 DOM 元素
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

/**
 * 创建带标签的选择框
 */
function labeledSelect(label, options, currentValue, onChange) {
  const select = el('select', {
    style: { width: '100%', padding: '8px', background: '#0d1b2a', color: '#e7edf7', border: '1px solid #324256', borderRadius: '4px', fontSize: '13px' },
    onChange: (e) => onChange(e.target.value)
  });
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === currentValue) o.selected = true;
    select.appendChild(o);
  }
  return el('div', { style: { marginBottom: '12px' } },
    el('label', { style: { color: '#90a4ae', fontSize: '12px', marginBottom: '4px', display: 'block' } }, label),
    select
  );
}

/**
 * 渲染镜头编辑面板
 * @param {HTMLElement} container 容器元素
 * @param {object} shot 当前镜头
 * @param {number} shotIndex 镜头索引
 * @param {object} registry 资产注册表
 * @param {object} intent 规划意图（可选）
 * @param {Function} onUpdate 更新回调 (updatedShot) => void
 * @param {Function} onClose 关闭回调
 */
export function renderShotEditor(container, shot, shotIndex, registry, intent = {}, onUpdate = null, onClose = null) {
  container.replaceChildren();

  if (!shot) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  const shotLabel = `S${String(shotIndex + 1).padStart(3, '0')}`;
  const working = { ...shot };

  // 验证区域
  const violationsBox = el('div', { id: 'editor-violations', style: { marginBottom: '12px' } });

  function runValidation() {
    const result = validateShotSpec(working, registry, intent);
    violationsBox.replaceChildren();
    if (!result.ok) {
      for (const v of result.violations) {
        violationsBox.appendChild(
          el('div', { style: { color: '#ff5252', fontSize: '12px', padding: '4px 8px', background: 'rgba(255,82,82,0.1)', borderRadius: '4px', marginBottom: '4px' } },
            `⚠ ${v.code}${v.message ? ': ' + v.message : ''}${v.field ? ` [${v.field}]` : ''}`)
        );
      }
    } else {
      violationsBox.appendChild(
        el('div', { style: { color: '#84edbd', fontSize: '12px', padding: '4px 8px' } }, '✓ 镜头规范校验通过')
      );
    }
  }

  // 资产选项构建器
  const assetOptions = (kind) => {
    const items = registry.byKind.get(kind) || [];
    return items.map(a => ({ value: a.id, label: `${a.nameZh || a.name} (${a.id})` }));
  };

  // 头部
  const header = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' } },
    el('h3', { style: { color: '#e7edf7', margin: '0', fontSize: '16px' } }, `编辑 ${shotLabel} · ${working.phase || 'build'}`),
    el('button', {
      style: { background: 'transparent', border: '1px solid #546e7a', color: '#90a4ae', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
      onClick: () => onClose?.()
    }, '关闭')
  );

  // 动作描述编辑
  const actionArea = el('div', { style: { marginBottom: '12px' } },
    el('label', { style: { color: '#90a4ae', fontSize: '12px', marginBottom: '4px', display: 'block' } }, '动作描述'),
    el('textarea', {
      style: { width: '100%', boxSizing: 'border-box', padding: '8px', background: '#0d1b2a', color: '#e7edf7', border: '1px solid #324256', borderRadius: '4px', fontSize: '13px', minHeight: '60px', resize: 'vertical' },
      onInput: (e) => { working.action = e.target.value; runValidation(); }
    }, working.action || '')
  );

  // 主体选择（最多3个，目前展示第一个）
  const subjectSelect = labeledSelect(
    '主体 (Subject)',
    [{ value: '', label: '-- 选择 --' }, ...assetOptions('character'), ...assetOptions('vehicle')],
    working.subjects?.[0] || '',
    (val) => { working.subjects = val ? [val] : []; runValidation(); }
  );

  // 环境、摄像机、灯光、色彩
  const envSelect = labeledSelect('环境 (Environment)', assetOptions('environment'), working.environment, (val) => { working.environment = val; runValidation(); });
  const camSelect = labeledSelect('摄像机 (Camera)', assetOptions('camera'), working.camera, (val) => { working.camera = val; runValidation(); });
  const lightSelect = labeledSelect('灯光 (Lighting)', assetOptions('lighting'), working.lighting, (val) => { working.lighting = val; runValidation(); });
  const colorSelect = labeledSelect('色彩 (Color Grade)', assetOptions('colorGrade'), working.colorGrade, (val) => { working.colorGrade = val; runValidation(); });

  // 损伤状态
  const damageOptions = Object.keys(DAMAGE_HIERARCHY).map(k => ({ value: k, label: k }));
  const damageSelect = labeledSelect('损伤状态', damageOptions, working.damageState || 'weathered', (val) => { working.damageState = val; runValidation(); });

  // 屏幕方向
  const dirOptions = [...SCREEN_DIRECTIONS].map(d => ({ value: d, label: d }));
  const dirSelect = labeledSelect('屏幕轴线方向', dirOptions, working.screenDirection || 'left-to-right', (val) => { working.screenDirection = val; runValidation(); });

  // 应用按钮
  const applyBtn = el('button', {
    style: { background: '#40b9a6', border: '0', color: '#0a1628', padding: '10px 20px', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', width: '100%', fontSize: '14px', marginTop: '8px' },
    onClick: () => onUpdate?.(working)
  }, '应用修改');

  const panel = el('div', {
    style: { background: '#101722', border: '1px solid #1e3a5f', borderRadius: '8px', padding: '20px', maxHeight: '80vh', overflowY: 'auto' }
  }, header, violationsBox, actionArea, subjectSelect, envSelect, camSelect, lightSelect, colorSelect, damageSelect, dirSelect, applyBtn);

  container.appendChild(panel);
  runValidation();
}
