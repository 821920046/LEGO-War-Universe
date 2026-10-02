/**
 * LEGO War Universe - 轻量反馈组件 (Toast / Dialog)
 * 目标：彻底替换原生 alert / confirm / prompt。
 * 原生弹窗会阻塞主线程、无法样式化、在部分部署环境（含沙箱 iframe）被直接禁用，
 * 一旦被禁用，用户将完全收不到任何操作结果反馈。
 */

import { createEl } from './render.js';

let toastLayer = null;

function ensureToastLayer() {
  if (toastLayer && document.body.contains(toastLayer)) return toastLayer;
  toastLayer = createEl('div', {
    id: 'lwu-toast-layer',
    class: 'toast-layer',
    role: 'region',
    'aria-live': 'polite'
  });
  document.body.appendChild(toastLayer);
  return toastLayer;
}

const TOAST_STYLES = {
  info: { cls: 'toast--info', icon: 'ℹ' },
  success: { cls: 'toast--ok', icon: '✔' },
  warn: { cls: 'toast--warn', icon: '⚠' },
  error: { cls: 'toast--error', icon: '✕' }
};

/**
 * 显示一条自动消失的浮层提示
 * @param {string} message 文案
 * @param {'info'|'success'|'warn'|'error'} type 类型
 * @param {number} duration 毫秒，0 表示不自动消失
 */
export function toast(message, type = 'info', duration = 3200) {
  const s = TOAST_STYLES[type] || TOAST_STYLES.info;
  const node = createEl('div', {
    class: `toast ${s.cls}`,
    role: 'status'
  },
    createEl('span', { class: 'toast__icon' }, s.icon),
    createEl('span', {}, String(message ?? ''))
  );

  ensureToastLayer().appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-in'));

  if (duration > 0) {
    setTimeout(() => {
      node.classList.remove('is-in');
      setTimeout(() => node.remove(), 200);
    }, duration);
  }
  return node;
}

let dialogLayer = null;

function ensureDialogLayer() {
  if (dialogLayer && document.body.contains(dialogLayer)) return dialogLayer;
  dialogLayer = createEl('div', { class: 'modal-layer' });
  document.body.appendChild(dialogLayer);
  return dialogLayer;
}

function closeDialog() {
  if (dialogLayer) {
    dialogLayer.remove();
    dialogLayer = null;
  }
}

/**
 * 模态确认框，替代 window.confirm
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title = '请确认', message = '', confirmText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    const layer = ensureDialogLayer();
    layer.replaceChildren();

    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      closeDialog();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter') finish(true);
    };
    document.addEventListener('keydown', onKey);

    const card = createEl('div', { class: 'modal' },
      createEl('h3', { class: 'modal__title' }, title),
      createEl('p', { class: 'modal__text' }, message),
      createEl('div', { class: 'modal__actions' },
        createEl('button', { class: 'btn btn--ghost', onClick: () => finish(false) }, cancelText),
        createEl('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, onClick: () => finish(true) }, confirmText)
      )
    );

    layer.appendChild(card);
    layer.onclick = (e) => { if (e.target === layer) finish(false); };
    card.querySelector('button:last-child')?.focus();
  });
}

/**
 * 模态输入框，替代 window.prompt
 * @returns {Promise<string|null>} 用户取消时返回 null
 */
export function promptDialog({ title = '请输入', label = '', defaultValue = '', placeholder = '', confirmText = '确定', cancelText = '取消' } = {}) {
  return new Promise((resolve) => {
    const layer = ensureDialogLayer();
    layer.replaceChildren();

    const input = createEl('input', {
      type: 'text',
      class: 'input',
      value: defaultValue,
      placeholder,
      style: { marginBottom: '20px' }
    });

    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      closeDialog();
      resolve(value);
    };
    const submit = () => {
      const v = input.value.trim();
      finish(v ? v : null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter') submit();
    };
    document.addEventListener('keydown', onKey);

    const card = createEl('div', { class: 'modal' },
      createEl('h3', { class: 'modal__title' }, title),
      createEl('label', { class: 'field__label', style: { display: 'block', marginBottom: '6px' } }, label),
      input,
      createEl('div', { class: 'modal__actions' },
        createEl('button', { class: 'btn btn--ghost', onClick: () => finish(null) }, cancelText),
        createEl('button', { class: 'btn btn--primary', onClick: submit }, confirmText)
      )
    );

    layer.appendChild(card);
    layer.onclick = (e) => { if (e.target === layer) finish(null); };
    input.focus();
    input.select();
  });
}
