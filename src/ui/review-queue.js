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

  const title = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } },
    el('h3', { style: { margin: '0', fontSize: '15px', color: '#ffd07a' } }, `人工审核队列 (${queue.length})`),
    el('span', { style: { fontSize: '12px', color: '#90a4ae' } }, '内容治理前置分流')
  );
  container.appendChild(title);

  if (queue.length === 0) {
    container.appendChild(
      el('div', { style: { color: '#546e7a', padding: '16px', textAlign: 'center', fontSize: '13px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' } },
        '当前无待审任务，所有生成均符合自动放行策略。')
    );
    return;
  }

  const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });

  for (const item of queue) {
    const card = el('div', {
      style: {
        background: '#0d1b2a',
        border: '1px solid #ffb74d',
        borderRadius: '6px',
        padding: '12px 16px'
      }
    },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' } },
        el('strong', { style: { color: '#e7edf7', fontSize: '13px' } }, item.theme || '未命名'),
        el('span', { style: { color: '#ffb74d', fontSize: '11px', background: 'rgba(255,183,77,0.1)', padding: '2px 6px', borderRadius: '3px' } },
          (item.flags || []).join(', ') || '待审核'
        )
      ),
      el('div', { style: { color: '#cfd8dc', fontSize: '12px', marginBottom: '8px', lineHeight: '1.4' } },
        (item.reasons || []).join('；') || '命中敏感冲突规则'
      ),
      el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
        el('button', {
          style: { background: '#40b9a6', border: '0', color: '#0a1628', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' },
          onClick: () => callbacks.onApprove?.(item)
        }, '批准放行'),
        el('button', {
          style: { background: 'transparent', border: '1px solid #ff5252', color: '#ff5252', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
          onClick: () => callbacks.onReject?.(item)
        }, '驳回')
      )
    );
    list.appendChild(card);
  }

  container.appendChild(list);
}
