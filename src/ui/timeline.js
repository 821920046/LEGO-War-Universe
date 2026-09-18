/**
 * LEGO War Universe - 多轨视听时间线渲染器 (Audio-Visual Timeline)
 * 渲染：视频画面轨（关键帧缩略图/占位、镜头卡片、阶段、轴线、战损）+ 音轨（环境音、交战声、无线电）
 * 支持导出剪映 / CapCut 标准工程分镜表
 */

import { compileKeyframeImage } from '../domain/image-compiler.js';

const PHASE_COLORS = {
  establish: '#40b9a6',
  opening: '#40b9a6',
  build: '#5b9bd5',
  buildup: '#5b9bd5',
  climax: '#ff6b6b',
  resolve: '#ffd07a',
  resolution: '#ffd07a'
};

const DIR_ARROWS = {
  'left-to-right': '→',
  'right-to-left': '←',
  'towards-camera': '↑',
  'away-from-camera': '↓',
  'neutral': '·'
};

const DAMAGE_BADGES = {
  clean: { label: '全新', color: '#84edbd' },
  weathered: { label: '风化', color: '#b0bec5' },
  damaged: { label: '战损', color: '#ffa726' },
  destroyed: { label: '残骸', color: '#ff5252' }
};

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
 * 根据镜头属性推断音效与环境音
 */
function deriveAudioCues(shot, registry) {
  const cues = [];
  const action = (shot.action || '').toLowerCase();

  // 1. 环境音
  if (shot.environment && registry?.byId?.get(shot.environment)) {
    const envName = registry.byId.get(shot.environment).nameZh || registry.byId.get(shot.environment).name;
    cues.push(`环境: ${envName}`);
  }

  // 2. 作战与动作音效
  if (/combat|engage|fire|blast|strike|突击|交火|开火/i.test(action)) {
    cues.push('音效: 密集交火与爆破');
  } else if (/tank|vehicle|drive|patrol|坦克|装甲|巡逻/i.test(action)) {
    cues.push('音效: 重型履带轰鸣');
  } else if (/flight|aircraft|fly|airlift|战机|直升机|放飞/i.test(action)) {
    cues.push('音效: 喷气轰鸣/旋翼呼啸');
  } else {
    cues.push('音效: 战术战地微动');
  }

  // 3. 通信杂音
  if (shot.phase === 'climax' || /radio|signal|呼叫|引导/i.test(action)) {
    cues.push('对讲: 战地无线电静噪与呼叫');
  }

  return cues;
}

/**
 * 渲染首帧定格缩略图卡片
 */
function renderKeyframeThumb(shot, registry, onCopyKeyframePrompt) {
  const kf = compileKeyframeImage(shot, registry);

  const thumb = el('div', {
    style: {
      height: '70px',
      background: 'linear-gradient(135deg, #152238 0%, #0d1624 100%)',
      borderRadius: '4px',
      marginBottom: '8px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      border: '1px dashed #2c3e55',
      position: 'relative',
      overflow: 'hidden'
    }
  },
    el('span', { style: { fontSize: '18px', marginBottom: '2px' } }, '📷'),
    el('span', { style: { fontSize: '11px', color: '#90a4ae' } }, '35mm 定格首帧'),
    el('button', {
      style: {
        position: 'absolute',
        bottom: '2px',
        right: '2px',
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid #455a64',
        color: '#4fc3f7',
        fontSize: '10px',
        padding: '1px 4px',
        borderRadius: '3px',
        cursor: 'pointer'
      },
      title: '复制首帧静态图 Prompt (供 FLUX/Midjourney 生成)',
      onClick: (e) => {
        e.stopPropagation();
        onCopyKeyframePrompt?.(kf.prompt);
      }
    }, '复制Prompt')
  );

  return thumb;
}

/**
 * 渲染单个视频卡片
 */
function renderShotCard(shot, index, registry, onSelect, onCopyKeyframe) {
  const shotLabel = `S${String(index + 1).padStart(3, '0')}`;
  const phase = shot.phase || 'build';
  const phaseColor = PHASE_COLORS[phase] || '#5b9bd5';
  const dir = shot.screenDirection || 'neutral';
  const arrow = DIR_ARROWS[dir] || '·';
  const damage = shot.damageState || 'weathered';
  const damageBadge = DAMAGE_BADGES[damage] || DAMAGE_BADGES.weathered;
  const hasRef = !!(shot.referenceFrame || index > 0);

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
      background: '#0d1b2a',
      borderRadius: '8px',
      padding: '10px 14px',
      minWidth: '220px',
      maxWidth: '260px',
      cursor: 'pointer',
      transition: 'transform 0.15s, box-shadow 0.15s',
      flexShrink: '0'
    },
    onClick: () => onSelect?.(index, shot)
  },
    // 顶栏
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
      el('strong', { style: { color: '#e7edf7', fontSize: '13px' } }, shotLabel),
      el('span', { style: { background: phaseColor, color: '#0a1628', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700' } }, phase)
    ),
    // 首帧定格占位图
    renderKeyframeThumb(shot, registry, onCopyKeyframe),
    // 主体
    el('div', { style: { color: '#b0bec5', fontSize: '11px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, subjectNames || '无主体'),
    // 动作摘要
    el('div', { style: { color: '#78909c', fontSize: '11px', marginBottom: '6px', lineHeight: '1.3', maxHeight: '30px', overflow: 'hidden' } },
      (shot.action || '').slice(0, 70) + ((shot.action || '').length > 70 ? '…' : '')
    ),
    // 底部状态
    el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '10px' } },
      el('span', { style: { color: '#cfd8dc' }, title: `屏幕方向: ${dir}` }, `轴 ${arrow}`),
      el('span', { style: { color: damageBadge.color, background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: '3px' } }, damageBadge.label),
      hasRef ? el('span', { style: { color: '#4fc3f7' }, title: '已锁前序参考帧' }, '🔗') : null,
      el('span', { style: { color: '#38bdf8', background: 'rgba(56,189,248,0.1)', padding: '1px 4px', borderRadius: '3px' } }, shot.aspectRatio || '16:9')
    )
  );

  card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)'; });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.boxShadow = ''; });

  return card;
}

/**
 * 渲染音轨卡片
 */
function renderAudioCard(shot, registry) {
  const cues = deriveAudioCues(shot, registry);

  return el('div', {
    style: {
      minWidth: '220px',
      maxWidth: '260px',
      background: '#071019',
      border: '1px solid #1f293d',
      borderRadius: '6px',
      padding: '8px 10px',
      fontSize: '11px',
      color: '#94a3b8',
      flexShrink: '0'
    }
  },
    el('div', { style: { color: '#ffd07a', fontWeight: '600', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' } },
      '🔊 音效轨道'
    ),
    ...cues.map(c => el('div', { style: { lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `· ${c}`))
  );
}

/**
 * 渲染完整双轨时间线
 */
export function renderTimeline(container, shots = [], registry = null, onSelectShot = null, onCopyKeyframe = null) {
  container.replaceChildren();

  if (shots.length === 0) {
    container.appendChild(
      el('div', { style: { color: '#546e7a', textAlign: 'center', padding: '32px', fontSize: '14px' } },
        '暂无镜头，请输入主题并生成分镜计划。')
    );
    return;
  }

  const trackWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });

  // 1. 视频轨标题
  trackWrap.appendChild(
    el('div', { style: { fontSize: '12px', color: '#64748b', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' } },
      '🎬 画面轨道 (Video Track) · 8秒/镜'
    )
  );

  // 视频轨道横向排列
  const videoRow = el('div', {
    style: { display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px', scrollBehavior: 'smooth' }
  });

  for (let i = 0; i < shots.length; i++) {
    if (i > 0) {
      videoRow.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', color: '#334155', fontSize: '18px', flexShrink: '0' } }, '─'));
    }
    videoRow.appendChild(renderShotCard(shots[i], i, registry, onSelectShot, onCopyKeyframe));
  }
  trackWrap.appendChild(videoRow);

  // 2. 音频轨标题
  trackWrap.appendChild(
    el('div', { style: { fontSize: '12px', color: '#64748b', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '6px' } },
      '🎙️ 伴随音效与环境音轨 (Audio Track)'
    )
  );

  // 音频轨道横向排列
  const audioRow = el('div', {
    style: { display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px', scrollBehavior: 'smooth' }
  });

  for (let i = 0; i < shots.length; i++) {
    if (i > 0) {
      audioRow.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', color: '#1e293b', fontSize: '18px', flexShrink: '0' } }, '─'));
    }
    audioRow.appendChild(renderAudioCard(shots[i], registry));
  }
  trackWrap.appendChild(audioRow);

  container.appendChild(trackWrap);
}

/**
 * 导出剪映 / CapCut / Premiere 分镜脚本 CSV
 * 显式带 UTF-8 BOM，防止 Excel / 剪映打开中文乱码
 */
export function exportToCapCutCSV(shots = [], registry = null, filmTheme = '未命名电影') {
  const rows = [
    ['镜头号', '剧作阶段', '画幅比例', '时长(秒)', '时间码入点', '时间码出点', '屏幕轴向', '主体装备', '中文动作分镜脚本', '音效配音建议', '首帧静态图Prompt(生图)', '视频动态Prompt(生视频)']
  ];

  let currentSecond = 0;
  const shotDuration = 8; // 8秒定格

  const formatTC = (sec) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `00:${m}:${s}:00`;
  };

  shots.forEach((s, idx) => {
    const shotLabel = `S${String(idx + 1).padStart(3, '0')}`;
    const inTC = formatTC(currentSecond);
    const outTC = formatTC(currentSecond + shotDuration);
    currentSecond += shotDuration;

    const subjects = (s.subjects || []).map(id => {
      const a = registry?.byId?.get(id);
      return a ? `${a.nameZh || a.name} (${id})` : id;
    }).join('; ');

    const cues = deriveAudioCues(s, registry).join(' / ');
    const kf = compileKeyframeImage(s, registry);

    rows.push([
      shotLabel,
      s.phase || 'build',
      s.aspectRatio || '16:9',
      String(shotDuration),
      inTC,
      outTC,
      s.screenDirection || 'neutral',
      subjects,
      s.action || '',
      cues,
      kf.prompt,
      s.prompt || ''
    ]);
  });

  // 转为 CSV 文本并加 \uFEFF BOM
  const csvContent = '\uFEFF' + rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filmTheme.replace(/[\\/:*?"<>|]/g, '_')}_剪映分镜导入表.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
