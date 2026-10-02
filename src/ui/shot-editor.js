/**
 * LEGO War Universe - 镜头属性编辑器
 * 抽屉式镜头编辑面板：实时微调主体、环境、摄像机参数、损伤等级、动作描述
 * 并进行即时校验与错误反馈
 */

import { validateShotSpec } from '../domain/shot-spec.js';
import { DAMAGE_HIERARCHY, SCREEN_DIRECTIONS } from '../domain/continuity.js';

/** 与时间线保持一致的中文标签。此前编辑器直接暴露英文枚举，与时间线显示割裂。 */
const DAMAGE_LABELS = {
  clean: '全新 / 出厂状态',
  weathered: '风化做旧',
  damaged: '战损',
  destroyed: '摧毁残骸'
};

const DIRECTION_LABELS = {
  'left-to-right': '从左向右 →',
  'right-to-left': '从右向左 ←',
  'towards-camera': '迎向镜头 ↑',
  'away-from-camera': '远离镜头 ↓',
  neutral: '中性 / 骑轴 ·'
};

const MAX_SUBJECTS = 3;

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
    class: 'select',
    onChange: (e) => onChange(e.target.value)
  });
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === currentValue) o.selected = true;
    select.appendChild(o);
  }
  return el('div', { class: 'field' },
    el('label', { class: 'field__label' }, label),
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
  container.style.display = 'flex';

  const shotLabel = `S${String(shotIndex + 1).padStart(3, '0')}`;
  const working = { ...shot };

  // 验证区域
  const violationsBox = el('div', { id: 'editor-violations', style: { marginBottom: '16px' } });

  function runValidation() {
    const result = validateShotSpec(working, registry, intent);
    violationsBox.replaceChildren();
    if (!result.ok) {
      for (const v of result.violations) {
        violationsBox.appendChild(
          el('div', { class: 'alert alert--danger' },
            el('span', { class: 'alert__icon' }, '⚠'),
            el('span', {}, `${v.code}${v.message ? ': ' + v.message : ''}${v.field ? ` [${v.field}]` : ''}`))
        );
      }
    } else {
      violationsBox.appendChild(
        el('div', { class: 'alert alert--ok' },
          el('span', { class: 'alert__icon' }, '✓'),
          el('span', {}, '镜头规范校验通过'))
      );
    }
  }

  // 资产选项构建器
  const assetOptions = (kind) => {
    const items = registry.byKind.get(kind) || [];
    return items.map(a => ({ value: a.id, label: `${a.nameZh || a.name} (${a.id})` }));
  };

  // 头部
  const header = el('div', { class: 'drawer__head' },
    el('h3', { class: 'drawer__title' }, `编辑 ${shotLabel} · ${working.phase || 'build'}`),
    el('button', {
      class: 'btn btn--ghost btn--sm',
      onClick: () => onClose?.()
    }, '关闭')
  );

  // 动作描述编辑
  const actionArea = el('div', { class: 'field' },
    el('label', { class: 'field__label' }, '动作描述'),
    el('textarea', {
      class: 'textarea',
      rows: '3',
      onInput: (e) => { working.action = e.target.value; runValidation(); }
    }, working.action || '')
  );

  // 主体选择（最多 3 个）
  // 此前只渲染第一个主体，且提交时把 subjects 整个替换成 [val]，
  // 编辑任何多主体镜头（如「坦克 + 步兵」）都会静默丢掉其余主体。
  const subjectOptions = [{ value: '', label: '-- 移除该主体 --' }, ...assetOptions('character'), ...assetOptions('vehicle')];
  const subjectsBox = el('div', { style: { marginBottom: '4px' } });

  function renderSubjects() {
    subjectsBox.replaceChildren();
    subjectsBox.appendChild(
      el('label', { class: 'field__label', style: { display: 'block', marginBottom: '8px' } },
        `主体 (Subject) · ${(working.subjects || []).length}/${MAX_SUBJECTS}`)
    );

    (working.subjects || []).forEach((sid, i) => {
      subjectsBox.appendChild(labeledSelect(
        `主体 ${i + 1}`,
        subjectOptions,
        sid,
        (val) => {
          const next = [...(working.subjects || [])];
          if (val) next[i] = val;
          else next.splice(i, 1);
          working.subjects = next;
          renderSubjects();
          runValidation();
        }
      ));
    });

    if ((working.subjects || []).length < MAX_SUBJECTS) {
      subjectsBox.appendChild(el('button', {
        class: 'btn btn--subtle btn--block',
        style: { borderStyle: 'dashed' },
        onClick: () => {
          working.subjects = [...(working.subjects || []), ''];
          renderSubjects();
          runValidation();
        }
      }, '+ 增加主体'));
    }
  }

  // 环境、摄像机、灯光、色彩
  const envSelect = labeledSelect('环境 (Environment)', assetOptions('environment'), working.environment, (val) => { working.environment = val; runValidation(); });
  const camSelect = labeledSelect('摄像机 (Camera)', assetOptions('camera'), working.camera, (val) => { working.camera = val; runValidation(); });
  const lightSelect = labeledSelect('灯光 (Lighting)', assetOptions('lighting'), working.lighting, (val) => { working.lighting = val; runValidation(); });
  const colorSelect = labeledSelect('色彩 (Color Grade)', assetOptions('colorGrade'), working.colorGrade, (val) => { working.colorGrade = val; runValidation(); });

  // 损伤状态
  const damageOptions = Object.keys(DAMAGE_HIERARCHY).map(k => ({ value: k, label: `${DAMAGE_LABELS[k] || k} (${k})` }));
  const damageSelect = labeledSelect('损伤状态', damageOptions, working.damageState || 'weathered', (val) => { working.damageState = val; runValidation(); });

  // 屏幕方向
  const dirOptions = [...SCREEN_DIRECTIONS].map(d => ({ value: d, label: `${DIRECTION_LABELS[d] || d} (${d})` }));
  const dirSelect = labeledSelect('屏幕轴线方向', dirOptions, working.screenDirection || 'left-to-right', (val) => { working.screenDirection = val; runValidation(); });

  // 应用按钮
  const applyBtn = el('button', {
    class: 'btn btn--primary btn--block',
    style: { marginTop: '14px' },
    onClick: () => onUpdate?.(working)
  }, '应用修改');

  const body = el('div', { class: 'drawer__body' },
    violationsBox, actionArea, subjectsBox, envSelect, camSelect, lightSelect, colorSelect, damageSelect, dirSelect, applyBtn);

  container.replaceChildren(header, body);
  renderSubjects();
  runValidation();
}
