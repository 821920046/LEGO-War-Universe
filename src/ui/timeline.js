/**
 * LEGO War Universe - 多轨视听时间线渲染器 (Audio-Visual Timeline)
 * 渲染：视频画面轨（关键帧缩略图/占位、镜头卡片、阶段、轴线、战损）+ 音轨（环境音、交战声、无线电）
 * 支持导出剪映 / CapCut 标准工程分镜表
 */

import { compileKeyframeImage } from '../domain/image-compiler.js';
import { labelFor, aliasLabel } from '../domain/roster.js';
import { FUNCTION_LABELS } from '../domain/narrative.js';

const PHASE_COLORS = {
  establish: '#3FB950',
  opening: '#3FB950',
  build: '#4C8DF6',
  buildup: '#4C8DF6',
  climax: '#F85149',
  resolve: '#E8A33D',
  resolution: '#E8A33D'
};

const DIR_ARROWS = {
  'left-to-right': '→',
  'right-to-left': '←',
  'towards-camera': '↑',
  'away-from-camera': '↓',
  'neutral': '·'
};

const DAMAGE_BADGES = {
  clean: { label: '全新', cls: 'badge--ok' },
  weathered: { label: '风化', cls: '' },
  damaged: { label: '战损', cls: 'badge--warn' },
  destroyed: { label: '残骸', cls: 'badge--danger' }
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
function renderKeyframeThumb(shot, registry, onCopyKeyframePrompt, roster = null) {
  const kf = compileKeyframeImage(shot, registry, roster);

  const thumb = el('div', { class: 'tl-thumb' },
    el('span', { style: { fontSize: '17px', opacity: '.85' } }, '📷'),
    el('span', { style: { fontSize: '10.5px', color: 'var(--text-3)' } }, '35mm 定格首帧'),
    el('button', {
      class: 'tl-thumb__btn',
      type: 'button',
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
function renderShotCard(shot, index, registry, onSelect, onCopyKeyframe, roster = null) {
  const shotLabel = `S${String(index + 1).padStart(3, '0')}`;
  const phase = shot.phase || 'build';
  const phaseColor = PHASE_COLORS[phase] || 'var(--text-3)';
  const dir = shot.screenDirection || 'neutral';
  const arrow = DIR_ARROWS[dir] || '·';
  const damage = shot.damageState || 'weathered';
  const damageBadge = DAMAGE_BADGES[damage] || DAMAGE_BADGES.weathered;
  // 只认真实的参考帧锚点。此前写成 `referenceFrame || index > 0`，
  // 会让所有非首镜都显示已锁帧图标，即便该镜头根本没绑定前序尾帧。
  const hasRef = !!shot.referenceFrame;

  // 有真实名册时优先显示「【代号】角色名」，让分镜卡片与视频脚本里的称呼完全一致
  const subjectNames = (shot.subjects || []).map(id => {
    if (roster?.byId?.has(id)) return aliasLabel(roster, id);
    if (registry) {
      const a = registry.byId.get(id);
      return a ? (a.nameZh || a.name) : id;
    }
    return id;
  }).join(' · ');

  const card = el('div', {
    class: 'tl-card',
    // 卡片是纯 div + onClick，键盘用户完全无法触达；补上语义与 Tab 焦点
    role: 'button',
    tabindex: '0',
    title: `${shotLabel} · 点击编辑镜头`,
    // 阶段色是数据驱动的，用内联变量注入左侧色条与阶段胶囊
    style: { borderLeftColor: phaseColor, '--phase': phaseColor },
    onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect?.(index, shot);
      }
    },
    onClick: () => onSelect?.(index, shot)
  },
    // 顶栏
    el('div', { class: 'tl-card__top' },
      el('strong', { class: 'tl-card__id' }, shotLabel),
      el('span', { class: 'tl-card__phase', style: { color: phaseColor } }, phase)
    ),
    // 戏剧功能：让「这一镜对故事做了什么」一眼可见（治「动作单一」的可视化手段）
    shot.fn ? el('div', { class: 'tl-card__fn', title: '戏剧功能' }, FUNCTION_LABELS[shot.fn] || shot.fn) : null,
    // 首帧定格占位图
    renderKeyframeThumb(shot, registry, onCopyKeyframe, roster),
    // 主体
    el('div', { class: 'tl-card__subjects' }, subjectNames || '无主体'),
    // 动作摘要
    el('div', { class: 'tl-card__action' },
      (shot.action || '').slice(0, 70) + ((shot.action || '').length > 70 ? '…' : '')
    ),
    // 底部状态
    el('div', { class: 'tl-card__meta' },
      el('span', { class: 'badge badge--mono', title: '镜头时长' }, `${Number(shot.duration) || 8}s`),
      el('span', { class: 'badge', title: `屏幕方向: ${dir}` }, `轴 ${arrow}`),
      el('span', { class: `badge ${damageBadge.cls}`.trim() }, damageBadge.label),
      hasRef ? el('span', { class: 'badge badge--info', title: '已锁前序参考帧' }, '🔗 锁帧') : null,
      el('span', { class: 'badge badge--info badge--mono' }, shot.aspectRatio || '9:16')
    )
  );

  return card;
}

/**
 * 渲染音轨卡片
 */
function renderAudioCard(shot, registry) {
  const cues = deriveAudioCues(shot, registry);

  return el('div', { class: 'tl-audio' },
    el('div', { class: 'tl-audio__title' }, '🔊 音效轨道'),
    ...cues.map(c => el('div', { class: 'tl-audio__cue' }, `· ${c}`))
  );
}

/**
 * 渲染完整双轨时间线
 */
export function renderTimeline(container, shots = [], registry = null, onSelectShot = null, onCopyKeyframe = null, roster = null) {
  container.replaceChildren();

  if (shots.length === 0) {
    container.appendChild(
      el('div', { class: 'empty' }, '暂无镜头，请输入主题并生成分镜计划。')
    );
    return;
  }

  const trackWrap = el('div');

  // 1. 视频轨标题
  trackWrap.appendChild(
    el('div', { class: 'tl-track' }, '🎬 画面轨道 (Video Track) · 8秒/镜')
  );

  // 视频轨道横向排列
  const videoRow = el('div', { class: 'tl-row' });

  for (let i = 0; i < shots.length; i++) {
    if (i > 0) {
      videoRow.appendChild(el('span', { class: 'tl-link' }, '─'));
    }
    videoRow.appendChild(renderShotCard(shots[i], i, registry, onSelectShot, onCopyKeyframe, roster));
  }
  trackWrap.appendChild(videoRow);

  // 2. 音频轨标题
  trackWrap.appendChild(
    el('div', { class: 'tl-track', style: { marginTop: '18px' } }, '🎙️ 伴随音效与环境音轨 (Audio Track)')
  );

  // 音频轨道横向排列
  const audioRow = el('div', { class: 'tl-row' });

  for (let i = 0; i < shots.length; i++) {
    if (i > 0) {
      audioRow.appendChild(el('span', { class: 'tl-link' }, '─'));
    }
    audioRow.appendChild(renderAudioCard(shots[i], registry));
  }
  trackWrap.appendChild(audioRow);

  container.appendChild(trackWrap);
}

/**
 * 单元格防公式注入。
 *
 * 第一性原则：Excel / WPS 打开 CSV 时，**带引号并不能阻止公式解析** ——
 * `"=1+1"` 会被还原成 `=1+1` 并按公式求值。而本表里的「动作脚本 / 生图 Prompt」
 * 在云端模式下来自大模型，属于不可信输入；一旦模型吐出 `=HYPERLINK(...)` 之类的文本，
 * 用户一打开表格就会执行。因此在最前面补一个单引号，强制 Excel 按文本处理
 * （Excel 会隐藏这个前导单引号，不影响观感）。
 */
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;
const neutralizeCell = (value) => {
  const s = String(value ?? '');
  return FORMULA_PREFIX_RE.test(s) ? `'${s}` : s;
};

/**
 * 导出剪映 / CapCut / Premiere 分镜脚本 CSV
 * 显式带 UTF-8 BOM，防止 Excel / 剪映打开中文乱码
 */
export function exportToCapCutCSV(shots = [], registry = null, filmTheme = '未命名电影', roster = null) {
  const rows = [
    ['镜头号', '剧作阶段', '画幅比例', '时长(秒)', '时间码入点', '时间码出点', '屏幕轴向', '主体装备', '中文动作分镜脚本', '音效配音建议', '首帧静态图Prompt(生图)', '视频动态Prompt(生视频)']
  ];

  let currentSecond = 0;

  // 标准时间码 HH:MM:SS:FF。时位此前被写死为 00，长片（>150 镜）会溢出。
  const pad = (n) => String(n).padStart(2, '0');
  const formatTC = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}:00`;
  };

  shots.forEach((s, idx) => {
    const shotLabel = `S${String(idx + 1).padStart(3, '0')}`;
    // 逐镜时长：叙事层按戏剧功能给了快切(4s)/常规(6s)/长镜(8s)的节奏差，
    // 早期实现把全片时长写死为 8 秒，等于把电影压成等权重的幻灯片。
    const shotDuration = Number(s.duration) || 8;
    const inTC = formatTC(currentSecond);
    const outTC = formatTC(currentSecond + shotDuration);
    currentSecond += shotDuration;

    const subjects = (s.subjects || []).map(id => {
      if (roster?.byId?.has(id)) return labelFor(roster, id);
      const a = registry?.byId?.get(id);
      return a ? `${a.nameZh || a.name} (${id})` : id;
    }).join('; ');

    const cues = deriveAudioCues(s, registry).join(' / ');
    const kf = compileKeyframeImage(s, registry, roster);

    rows.push([
      shotLabel,
      s.phase || 'build',
      s.aspectRatio || '9:16',
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
  const csvContent = '\uFEFF' + rows.map(r => r.map(cell => `"${neutralizeCell(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filmTheme.replace(/[\\/:*?"<>|]/g, '_')}_剪映分镜导入表.csv`;
  a.click();
  // 同步 revoke 会在部分浏览器上赶在下载真正开始前销毁 blob
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
