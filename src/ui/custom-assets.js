/**
 * LEGO War Universe - 自定义资产登记册 (Custom Asset Registry)
 *
 * 原先的「录入新资产」流程是：连续 4 个 window.prompt 收集字段，
 * 最后下载一个 JSON 文件，并提示用户「自行合并进 02_Assets/assets.json」。
 * 也就是说这个按钮根本不会让资产变得可用 —— 用户必须手工改源文件并重新构建。
 * 这里改为：弹一次表单，资产立即注入运行时注册表并持久化，当场就能在镜头编辑器里选到。
 */

import { createEl } from './render.js';
import { toast, confirmDialog } from './feedback.js';

const STORAGE_KEY = 'lwu_custom_assets';
const ID_PATTERN = /^[A-Z]{2,5}-[0-9]{3}$/;

const KIND_BY_PREFIX = {
  CHR: 'character',
  VEH: 'vehicle',
  AIR: 'vehicle',
  SHP: 'vehicle',
  WPN: 'weapon',
  ENV: 'environment',
  CAM: 'camera',
  LGT: 'lighting',
  CLR: 'colorGrade',
  PRP: 'prop',
  FX: 'fx',
  AUD: 'audio'
};

export function loadCustomAssets() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistCustomAssets(list) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    toast('本地存储空间不足，自定义资产无法保存', 'error', 5000);
    return false;
  }
}

export function kindFromId(id) {
  return KIND_BY_PREFIX[String(id || '').split('-')[0]] || null;
}

/**
 * 把自定义资产并入运行时注册表，使其可被引擎检索与校验
 * @returns {{ added: number, skipped: string[] }}
 */
export function applyCustomAssets(registry, customAssets = []) {
  const skipped = [];
  let added = 0;
  for (const raw of customAssets) {
    const kind = kindFromId(raw.id);
    if (!kind) { skipped.push(raw.id); continue; }
    if (registry.byId.has(raw.id)) { skipped.push(raw.id); continue; }
    const asset = { ...raw, kind, series: raw.series || 'shared', custom: true };
    registry.byId.set(asset.id, asset);
    if (!registry.byKind.has(kind)) registry.byKind.set(kind, []);
    registry.byKind.get(kind).push(asset);
    added++;
  }
  return { added, skipped };
}

/**
 * 录入新资产的模态表单（替代连续的 window.prompt）
 */
export function openAddAssetDialog(onRegistered) {
  let dialogLayer = null;
  const close = () => {
    if (dialogLayer) { dialogLayer.remove(); dialogLayer = null; }
  };

  const field = (label, input) => createEl('div', { class: 'field' },
    createEl('label', { class: 'field__label' }, label),
    input
  );

  const idInput = createEl('input', { type: 'text', class: 'input', placeholder: 'VEH-901' });
  const zhInput = createEl('input', { type: 'text', class: 'input', placeholder: '特战全地形车' });
  const enInput = createEl('input', { type: 'text', class: 'input', placeholder: 'Special Forces ATV' });
  const seriesInput = createEl('select', { class: 'select' },
    ...['shared', 'Modern', 'Modern High-Tech', 'WWII', 'Pacific', 'Cold War', 'Gulf War', 'Iraq War', 'Orbital']
      .map(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; return o; })
  );
  const descInput = createEl('textarea', {
    class: 'textarea',
    rows: '3',
    placeholder: 'LEGO model of ..., authentic LEGO plastic texture with visible studs and seams.'
  });
  const errorBox = createEl('div', { style: { color: 'var(--danger)', fontSize: '12px', minHeight: '18px', marginBottom: '8px' } });

  const submit = () => {
    const id = idInput.value.trim().toUpperCase();
    const nameZh = zhInput.value.trim();
    const name = enInput.value.trim() || nameZh;

    if (!ID_PATTERN.test(id)) {
      errorBox.textContent = '资产 ID 必须为 PREFIX-NNN 格式，例如 VEH-901 或 CHR-888';
      return;
    }
    if (!nameZh) {
      errorBox.textContent = '请填写中文名称';
      return;
    }
    const existing = loadCustomAssets();
    if (existing.some(a => a.id === id)) {
      errorBox.textContent = `资产 ${id} 已存在`;
      return;
    }

    const asset = {
      id,
      name,
      nameZh,
      series: seriesInput.value,
      faction: 'Coalition',
      variants: ['clean', 'weathered', 'damaged'],
      lines: [
        `LEGO model of ${name}, authentic LEGO plastic texture with visible studs and seams.`,
        descInput.value.trim() || 'high detail miniature scale, realistic military camouflage print.'
      ]
    };

    if (!persistCustomAssets([...existing, asset])) return;
    close();
    onRegistered?.(asset);
    toast(`资产 ${id} 已录入并即时生效，可在镜头编辑器中直接选用`, 'success', 4500);
  };

  const card = createEl('div', {
    class: 'modal',
    style: { maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto' }
  },
    createEl('h3', { class: 'modal__title', style: { marginBottom: '16px' } }, '录入自定义乐高资产'),
    field('资产 ID（PREFIX-NNN，前缀决定类别：CHR/VEH/AIR/ENV/CAM/LGT/CLR…）', idInput),
    field('中文名称', zhInput),
    field('英文名称（留空则复用中文名）', enInput),
    field('所属时代系列', seriesInput),
    field('外观描述（写入 Prompt 的英文描述行）', descInput),
    errorBox,
    createEl('div', { class: 'modal__actions' },
      createEl('button', {
        class: 'btn btn--ghost',
        onClick: close
      }, '取消'),
      createEl('button', {
        class: 'btn btn--primary',
        onClick: submit
      }, '录入并生效')
    )
  );

  dialogLayer = createEl('div', { class: 'modal-layer' });
  dialogLayer.appendChild(card);
  dialogLayer.onclick = (e) => { if (e.target === dialogLayer) close(); };
  document.body.appendChild(dialogLayer);
  idInput.focus();
}

/**
 * 列出并支持移除已录入的自定义资产
 */
export async function openManageCustomAssets(registry, onChange) {
  const list = loadCustomAssets();
  if (list.length === 0) {
    toast('尚未录入任何自定义资产', 'info');
    return;
  }
  const ok = await confirmDialog({
    title: `已录入 ${list.length} 项自定义资产`,
    message: list.map(a => `· ${a.id}  ${a.nameZh}`).join('\n') + '\n\n是否全部清除？（清除后引用它们的镜头将无法通过校验）',
    confirmText: '全部清除',
    danger: true
  });
  if (!ok) return;
  persistCustomAssets([]);
  onChange?.();
  toast('已清除全部自定义资产，刷新页面后生效', 'info', 4500);
}
