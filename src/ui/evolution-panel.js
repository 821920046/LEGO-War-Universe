/**
 * LEGO War Universe - 自我进化面板 (Evolution Panel)
 *
 * 把 evolution.js 的学习账本可视化：让用户直观看到项目「越用越聪明」——
 * 累计生成次数、覆盖题材、被反复复用的主力资产、以及当场锻造出的新装备。
 */

import { createEl, text } from './render.js';
import { ledgerStats, exportLedger } from '../domain/evolution.js';
import { toast } from './feedback.js';

function statCard(label, value, accent) {
  return createEl('div', {
    style: {
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '8px',
      padding: '12px 14px',
      minWidth: '120px',
      flex: '1 1 120px'
    }
  },
    createEl('div', { style: { fontSize: '22px', fontWeight: '800', color: accent || '#38bdf8' } }, String(value)),
    createEl('div', { style: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' } }, label)
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

  const header = createEl('div', {
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px', gap: '12px', flexWrap: 'wrap' }
  },
    createEl('div', {},
      createEl('h2', { style: { margin: '0', fontSize: '17px', color: '#a78bfa', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' } },
        createEl('span', {}, '🧬'), '自我进化学习引擎 (Self-Evolution Engine)'),
      createEl('p', { style: { margin: '4px 0 0 0', color: '#94a3b8', fontSize: '12px', lineHeight: '1.5' } },
        '每次生成都会留下学习痕迹：高分资产被优先复用，多个题材反复验证的资产会被晋升；题材需要而资产库缺失的现代/未来战争装备，会由锻造炉当场生成并纳入记忆。')
    )
  );

  const actions = createEl('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  actions.append(
    createEl('button', {
      style: { background: '#1e293b', border: '1px solid #475569', color: '#a78bfa', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' },
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
      style: { background: 'transparent', border: '1px solid #7f1d1d', color: '#f87171', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' },
      onClick: () => callbacks.onReset?.()
    }, '重置记忆')
  );
  header.append(actions);
  container.append(header);

  container.append(createEl('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' } },
    statCard('累计生成', stats.generations, '#38bdf8'),
    statCard('覆盖题材', stats.distinctThemes, '#34d399'),
    statCard('记忆资产', stats.trackedAssets, '#fbbf24'),
    statCard('资产调用', stats.totalUses, '#f472b6'),
    statCard('锻造新装备', stats.forgedCount, '#a78bfa'),
    statCard('晋升主力', stats.promotedCount, '#f59e0b')
  ));

  const cols = createEl('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' } });

  // 高分主力资产
  const topBox = createEl('div', { style: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '14px 16px' } },
    createEl('div', { style: { color: '#38bdf8', fontWeight: '700', fontSize: '13px', marginBottom: '10px' } }, '⭐ 高分主力资产 (记忆权重 Top 8)')
  );
  if (stats.top.length === 0) {
    topBox.append(createEl('div', { style: { color: '#64748b', fontSize: '12px' } }, '暂无记录，生成一部影片后即可看到学习成果。'));
  } else {
    for (const item of stats.top) {
      const asset = callbacks.registry?.byId?.get(item.id);
      topBox.append(createEl('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed rgba(255,255,255,0.05)' } },
        createEl('span', { style: { fontSize: '12px', color: '#e2e8f0' } }, `${item.id} · ${asset?.nameZh || asset?.name || '资产'}`),
        createEl('span', { style: { fontSize: '11px', color: '#94a3b8' } }, `${item.count} 次 · 权重 ${item.score}`)
      ));
    }
  }
  cols.append(topBox);

  // 锻造资产
  const forgedBox = createEl('div', { style: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '14px 16px' } },
    createEl('div', { style: { color: '#a78bfa', fontWeight: '700', fontSize: '13px', marginBottom: '10px' } }, '⚒️ 锻造炉产出的现代化装备 (最近 8 件)')
  );
  const forged = (ledger?.forged || []).slice(-8).reverse();
  if (forged.length === 0) {
    forgedBox.append(createEl('div', { style: { color: '#64748b', fontSize: '12px' } }, '尚未锻造新装备。输入现代/未来战争题材（如「无人机蜂群突袭」）即可触发。'));
  } else {
    for (const asset of forged) {
      forgedBox.append(createEl('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed rgba(255,255,255,0.05)' } },
        createEl('span', { style: { fontSize: '12px', color: '#e2e8f0' } }, `${asset.id} · ${asset.nameZh || asset.name}`),
        createEl('span', { style: { fontSize: '11px', color: '#a78bfa', background: 'rgba(167,139,250,0.12)', padding: '1px 8px', borderRadius: '10px' } }, asset.series || 'shared')
      ));
    }
  }
  cols.append(forgedBox);

  container.append(cols);
}
