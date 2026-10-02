/**
 * LEGO War Universe - 人工审核队列面板
 * 集中管理被内容治理规则标记为 review_required 的题材与分镜
 * 提供批准、修改放行与驳回操作
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
 * 渲染审核队列面板
 * @param {HTMLElement} container 容器
 * @param {Array<object>} queue 待审核列表项 [{ id, theme, flags, reasons, createdAt, status }]
 * @param {object} callbacks 回调 { onApprove(item), onReject(item) }
 */
export function renderReviewQueue(container, queue = [], callbacks = {}) {
  container.replaceChildren();

  const title = el('div', { class: 'section__head', style: { marginBottom: '12px' } },
    el('h3', { class: 'section__title' }, `人工审核队列`, el('span', { class: 'badge badge--warn' }, String(queue.length))),
    el('span', { class: 'section__hint' }, '内容治理前置分流')
  );
  container.appendChild(title);

  if (queue.length === 0) {
    container.appendChild(
      el('div', { class: 'empty' }, '当前无待审任务，所有生成均符合自动放行策略。')
    );
    return;
  }

  const list = el('div', { class: 'grid', style: { gap: '8px' } });

  for (const item of queue) {
    const card = el('div', { class: 'card', style: { borderColor: 'rgba(210, 153, 34, .4)' } },
      el('div', { class: 'card__body', style: { padding: '14px 16px' } },
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
          el('strong', { style: { fontSize: '13px' } }, item.theme || '未命名'),
          el('span', { class: 'badge badge--warn' }, (item.flags || []).join(', ') || '待审核')
        ),
        el('div', { style: { color: 'var(--text-2)', fontSize: '12.5px', marginBottom: '12px', lineHeight: '1.5' } },
          (item.reasons || []).join('；') || '命中敏感冲突规则'
        ),
        el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
          el('button', {
            class: 'btn btn--primary btn--sm',
            onClick: () => callbacks.onApprove?.(item)
          }, '批准放行'),
          el('button', {
            class: 'btn btn--danger btn--sm',
            onClick: () => callbacks.onReject?.(item)
          }, '驳回')
        )
      )
    );
    list.appendChild(card);
  }

  container.appendChild(list);
}
