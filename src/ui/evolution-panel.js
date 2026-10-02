/**
 * LEGO War Universe - 自我进化面板 (Evolution Panel)
 *
 * 把 evolution.js 的学习账本可视化：让用户直观看到项目「越用越聪明」——
 * 累计生成次数、覆盖题材、被反复复用的主力资产、以及当场锻造出的新装备。
 */

import { createEl, text } from './render.js';
import { ledgerStats, exportLedger } from '../domain/evolution.js';
import { toast } from './feedback.js';

function statCard(label, value, color) {
  return createEl('div', { class: 'stat' },
    createEl('div', { class: 'stat__value', style: { color } }, String(value)),
    createEl('div', { class: 'stat__label' }, label)
  );
}

/**
 * @param {HTMLElement} container
 * @param {object} ledger 进化账本
 * @param {{ registry?: object, onImport?: (ledger: object) => void, onReset?: () => void }} callbacks
 */
export function renderEvolutionPanel(container, ledger, callbacks = {}) {
  if (!container) return;
  container.replaceChildren();

  const stats = ledgerStats(ledger);

  const header = createEl('div', { class: 'card__head' },
    createEl('div', {},
      createEl('h2', { class: 'card__title' },
        createEl('span', {}, '🧬'), '自我进化学习引擎 (Self-Evolution Engine)'),
      createEl('p', { class: 'card__sub' },
        '每次生成都会留下学习痕迹：高分资产被优先复用，多个题材反复验证的资产会被晋升；题材需要而资产库缺失的现代/未来战争装备，会由锻造炉当场生成并纳入记忆。')
    )
  );

  const actions = createEl('div', { class: 'card__actions' });
  actions.append(
    createEl('button', {
      class: 'btn btn--subtle btn--sm',
      onClick: () => {
        try {
          const blob = new Blob([exportLedger(ledger)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'lwu-evolution-ledger.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          toast('进化记忆已导出', 'success');
        } catch {
          toast('导出失败', 'error');
        }
      }
    }, '⬇ 导出记忆'),
    createEl('button', {
      class: 'btn btn--danger btn--sm',
      onClick: () => callbacks.onReset?.()
    }, '重置记忆')
  );
  header.append(actions);
  container.append(header);

  container.append(createEl('div', { class: 'card__body' },
    createEl('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px' } },
      statCard('累计生成', stats.generations, 'var(--info)'),
      statCard('覆盖题材', stats.distinctThemes, 'var(--ok)'),
      statCard('记忆资产', stats.trackedAssets, 'var(--accent)'),
      statCard('资产调用', stats.totalUses, 'var(--violet)'),
      statCard('锻造新装备', stats.forgedCount, 'var(--violet)'),
      statCard('晋升主力', stats.promotedCount, 'var(--warn)')
    ),

    createEl('div', { class: 'grid grid--2' },
      buildListBox('⭐ 高分主力资产 (记忆权重 Top 8)', 'var(--info)', stats.top.length === 0
        ? '暂无记录，生成一部影片后即可看到学习成果。'
        : null,
        stats.top.map(item => {
          const asset = callbacks.registry?.byId?.get(item.id);
          return { name: `${item.id} · ${asset?.nameZh || asset?.name || '资产'}`, meta: `${item.count} 次 · 权重 ${item.score}` };
        })),
      buildListBox('⚒️ 锻造炉产出的现代化装备 (最近 8 件)', 'var(--violet)', (ledger?.forged || []).length === 0
        ? '尚未锻造新装备。输入现代/未来战争题材（如「无人机蜂群突袭」）即可触发。'
        : null,
        (ledger?.forged || []).slice(-8).reverse().map(asset => ({
          name: `${asset.id} · ${asset.nameZh || asset.name}`,
          meta: asset.series || 'shared',
          metaCls: 'badge badge--violet'
        })))
    )
  ));
}

function buildListBox(title, color, emptyText, rows) {
  const box = createEl('div', { class: 'panel' },
    createEl('div', { style: { color, fontWeight: '700', fontSize: '13px', marginBottom: '10px' } }, title)
  );
  if (emptyText) {
    box.append(createEl('div', { style: { color: 'var(--text-3)', fontSize: '12.5px', lineHeight: '1.5' } }, emptyText));
    return box;
  }
  for (const row of rows) {
    box.append(createEl('div', { class: 'row' },
      createEl('span', { class: 'row__name', style: { fontSize: '12.5px' } }, row.name),
      createEl('span', { class: row.metaCls || 'row__meta' }, row.meta)
    ));
  }
  return box;
}
