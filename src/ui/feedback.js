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
    style: {
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '9999',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      alignItems: 'center',
      pointerEvents: 'none'
    }
  });
  document.body.appendChild(toastLayer);
  return toastLayer;
}

const TOAST_STYLES = {
  info: { border: '1px solid #38bdf8', bg: 'rgba(8, 47, 73, 0.96)', fg: '#bae6fd', icon: 'ℹ' },
  success: { border: '1px solid #34d399', bg: 'rgba(6, 46, 36, 0.96)', fg: '#a7f3d0', icon: '✔' },
  warn: { border: '1px solid #f59e0b', bg: 'rgba(69, 45, 6, 0.96)', fg: '#fde68a', icon: '⚠' },
  error: { border: '1px solid #ef4444', bg: 'rgba(69, 10, 10, 0.96)', fg: '#fecaca', icon: '✕' }
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
    role: 'status',
    style: {
      maxWidth: '560px',
      padding: '12px 18px',
      background: s.bg,
      border: s.border,
      borderRadius: '8px',
      color: s.fg,
      fontSize: '13px',
      lineHeight: '1.5',
      boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
      pointerEvents: 'auto',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
      whiteSpace: 'pre-wrap',
      opacity: '0',
      transition: 'opacity 0.18s ease, transform 0.18s ease',
      transform: 'translateY(-6px)'
    }
  },
    createEl('span', { style: { fontWeight: '800' } }, s.icon),
    createEl('span', {}, String(message ?? ''))
  );

  ensureToastLayer().appendChild(node);
  requestAnimationFrame(() => {
    node.style.opacity = '1';
    node.style.transform = 'translateY(0)';
  });

  if (duration > 0) {
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transform = 'translateY(-6px)';
      setTimeout(() => node.remove(), 200);
    }, duration);
  }
  return node;
}

let dialogLayer = null;

function ensureDialogLayer() {
  if (dialogLayer && document.body.contains(dialogLayer)) return dialogLayer;
  dialogLayer = createEl('div', {
    style: {
      position: 'fixed',
      inset: '0',
      background: 'rgba(2, 6, 16, 0.72)',
      zIndex: '10000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }
  });
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

    const card = createEl('div', {
      style: {
        width: '100%',
        maxWidth: '440px',
        background: '#0c1424',
        border: '1px solid #1e293b',
        borderRadius: '12px',
        padding: '22px 24px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)'
      }
    },
      createEl('h3', { style: { margin: '0 0 10px 0', fontSize: '16px', color: '#f1f5f9' } }, title),
      createEl('p', { style: { margin: '0 0 20px 0', fontSize: '13px', lineHeight: '1.6', color: '#94a3b8', whiteSpace: 'pre-wrap' } }, message),
      createEl('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
        createEl('button', {
          style: {
            background: 'transparent', border: '1px solid #475569', color: '#cbd5e1',
            padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
          },
          onClick: () => finish(false)
        }, cancelText),
        createEl('button', {
          style: {
            background: danger ? '#ef4444' : '#40b9a6', border: '0',
            color: danger ? '#fff' : '#0a1628',
            padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '700'
          },
          onClick: () => finish(true)
        }, confirmText)
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
      value: defaultValue,
      placeholder,
      style: {
        width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: '13px',
        background: '#030712', border: '1px solid #334155', borderRadius: '6px',
        color: '#f1f5f9', marginBottom: '20px'
      }
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

    const card = createEl('div', {
      style: {
        width: '100%', maxWidth: '440px', background: '#0c1424',
        border: '1px solid #1e293b', borderRadius: '12px', padding: '22px 24px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)'
      }
    },
      createEl('h3', { style: { margin: '0 0 10px 0', fontSize: '16px', color: '#f1f5f9' } }, title),
      createEl('label', { style: { display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' } }, label),
      input,
      createEl('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
        createEl('button', {
          style: { background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
          onClick: () => finish(null)
        }, cancelText),
        createEl('button', {
          style: { background: '#40b9a6', border: '0', color: '#0a1628', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' },
          onClick: submit
        }, confirmText)
      )
    );

    layer.appendChild(card);
    layer.onclick = (e) => { if (e.target === layer) finish(null); };
    input.focus();
    input.select();
  });
}
