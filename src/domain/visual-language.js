/**
 * LEGO War Universe - 视觉语言选取（6.7.3）
 *
 * 为什么需要这个模块：
 *
 * 6.7.2 之前，机位 / 灯光 / 调色是这样选的 ——
 *
 *   const pickMany = (r, kind, intent, limit = 3) => {
 *     const eraMatches = all.filter(a => a.series === intent.era);
 *     const pool = eraMatches.length > 0 ? eraMatches : all;
 *     return pool.slice(0, limit);          // ← 取数组前三个
 *   };
 *
 * 两个致命点：
 *   1. `eraMatches` 是**只含该时代专属资产**的子集，它**替换**了整个池，
 *      而不是并入。WWII 只有 1 个专属机位（CAM-101），于是整部二战片
 *      只有 1 个机位。这就是「滩头低角度推进跟拍」跨 10 个题材被用 48 次的原因 ——
 *      库尔斯克草原、斯大林格勒巷战、阿登雪原、现代城市巷战，全是海滩登陆机位。
 *   2. `slice(0, limit)` 完全不看**战场域**与**时段**。39 个机位里 36 个是死代码，
 *      5 个调色里 4 个是死代码（216/216 全是「好莱坞大片」）。
 *
 * 于是出现这样的成品：夏季硬光白昼的库尔斯克草原，配了「战火映照的夜空」；
 * 核潜艇猎杀 / F-22 制空 / 城市巷战三个题材拿到**完全相同**的机位与灯光。
 * 这不是「不够多样」，这是**画面语言与故事无关**。
 *
 * 本模块把选取建立在三个字段上（见 02_Assets/assets.json 的机位/灯光/调色资产）：
 *   domain —— 物理事实：这段镜头语言属于哪个战场域
 *   tod    —— 物理事实：这段光照属于一天中的哪一段（灯光的硬约束）
 *   fn     —— 叙事事实：这个机位天然承担哪个戏剧功能
 *
 * 选取顺序：时代兼容 → 战场域 → 时段 → 戏剧功能 → 全片去重。
 * 每一层都是「过滤 + 排序」，不是「取前 N 个」；任何一层过滤后为空就回退上一层，
 * 因此永远有解，且回退是**有优先级**的（域优先于时段：画面里出现不该出现的兵种
 * 比光照略偏更刺眼）。
 */
import { isEraCompatible } from './shot-spec.js';
import { themeMatch } from './roster.js';

/** 戏剧功能里「近身 / 私密」的一类：这些镜头允许换一盏次要灯，制造景别差 */
const INTIMATE_FNS = new Set(['character', 'plan', 'decision', 'cost', 'reaction', 'close', 'quiet']);

/** 数组字段是否命中某个取值（`any` 表示通用） */
function hits(list, value) {
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.includes(value) || list.includes('any');
}

/** 该字段是否是「具体值」而非「通用」——用于让具体优于通用 */
function isSpecific(list, value) {
  return Array.isArray(list) && list.includes(value) && !list.includes('any');
}

/**
 * 场景类型（地貌 / 场所）。灯光与「场景限定」的机位都要与它相容。
 *
 * 为什么单独一个维度：`domain`（战场域）与 `tod`（时段）回答不了「什么地貌」。
 * 开阔草原与热带丛林同属 ground、同为白昼，但把「丛林斑驳光」打在库尔斯克草原上，
 * 观众一眼就出戏。反过来「开阔原野硬光」也不能用在丛林里。
 *
 * 从环境资产的正文推导（环境资产没有 setting 字段，且数量多、改动风险大）：
 * 这里的词都是**具体名词**，不是「可能骗人」的暗示 —— 与 UNIT_DOMAIN 同一原则，
 * 但允许一词多命中（斯大林格勒废墟既是 urban 也可能是 snow）。
 */
const SETTING_RULES = [
  ['orbital', /轨道|空间站|太空|真空|舱外|零重力|orbital|space station|zero-g/i],
  ['interior', /舱内|控制舱|驾驶舱|指挥所|地下|坑道|隧道|室内|内部|机库|发射井|cockpit|interior|bunker|tunnel/i],
  ['water', /海|洋|水面|水下|舰|甲板|船|港|湾|河|湖|滩|岸|潜|ocean|sea|deck|harbou?r|river|lake|shore|beach|submarine|carrier|fleet/i],
  ['urban', /城市|市街|街区|街|巷|废墟|市区|楼|村镇|村庄|村落|要塞|城|urban|city|street|rubble|village|town/i],
  // 注意：**不能写裸的「林」**。「斯大林格勒废墟」的名字里有「林」，
  // 于是巷战会被判成丛林 —— 与 UNIT_DOMAIN 之前三次被关键词骗是同一类错。
  // 只认真正的植被词。
  ['forest', /丛林|森林|树林|密林|林地|林区|雨林|jungle|forest|woodland|treeline/i],
  ['snow', /雪|冰|极地|冬|snow|ice|arctic|winter|glacier/i],
  ['desert', /沙漠|荒漠|沙丘|沙地|desert|dune/i]
];

/** 由环境资产的名称与正文推出场景类型集合（可多值）；识别不出时给 ['open'] */
export function settingsOf(envText = '') {
  const out = new Set();
  for (const [name, re] of SETTING_RULES) if (re.test(envText)) out.add(name);
  // 「滩」同时属于 water 与 shore
  if (/滩|岸|beach|shore/i.test(envText)) out.add('shore');
  if (out.size === 0) out.add('open');
  return [...out];
}

/**
 * 资产是否允许出现在这些场景类型里（未标注 setting = 不限）。
 *
 * **为什么 `interior` 必须单独一档 —— 6.7.5 修复的头号缺陷。**
 *
 * 旧实现只有一句 `settings.some(s => asset.setting.includes(s))`，即「相交即放行」。
 * 于是《核潜艇深海猎杀》这样翻车：场景 `nuclear submarine control room` 被正确推出
 * `['interior','water']`，而 `LGT-015 开阔海面烈日` 标的是 `['water']` —— 二者相交，
 * **一盏海面烈日就打进了潜艇舱**；机位同理，`CAM-905 编队航拍`（`['water']`）
 * 让潜艇舱里出现了高空俯拍航母编队。Scene / Camera / Lighting 三条指令互相打架。
 *
 * 根因是 `interior` 与室外类型**不是并列关系，而是互斥关系**：
 * 一间舱室不可能同时是开阔海面。所以判定必须分两档：
 *   1. 场景含 interior → 资产必须**显式**支持 interior，否则出局（哪怕它标的是 water）。
 *   2. 其余情况才用「相交即放行」。
 *
 * 实测：48 镜室内 Scene 中 12 镜（25%）错配室外机位/光照，修后为 0。
 */
function settingOk(asset, settings) {
  const st = asset?.setting;
  if (!Array.isArray(st) || st.length === 0) return true;
  if (st.includes('any')) return true;
  if (settings.includes('interior') && !st.includes('interior')) return false;
  return settings.some(s => st.includes(s));
}

/**
 * 场景类型匹配档位：`2` = 精确命中该场景的专属类型 / `1` = 通用（`any`）/ `0` = 其他。
 *
 * **光有过滤不够 —— 还必须参与排序。** 旧代码里 setting 只用于 `filter`，
 * 从不进 `sort`，于是「通过了过滤的」和「真正为这个场景设计的」同分，
 * 由哈希决定胜负：潜艇舱里能用的 `LGT-902 潜艇红色战斗照明` 与
 * 通用 `LGT-004 暴风雨光照` 打平，谁被选中全看运气。
 */
function settingTier(asset, settings) {
  const st = asset?.setting;
  if (!Array.isArray(st) || st.length === 0) return 0;
  const specific = settings.find(s => s !== 'any' && st.includes(s));
  if (specific) return 2;
  if (st.includes('any')) return 1;
  return 0;
}

/* ------------------------------------------------------------------ *
 * 景别档（6.7.6 新增维度）
 *
 * 6.7.3–6.7.5 三轮都在选「哪台机器、什么角度、什么运动」，唯独没人问
 * 「这台机器拍出来的**画幅大小**对不对」。于是分镜写好的
 * `环境铺陈大远景 (Establishing Extreme Wide)` 会拿到
 * `CAM-609 tight insert close-up on hands working, 85mm macro feel` ——
 * 远景建镜头被拍成手部微距特写。实测 74 镜两侧都能判出景别，
 * 其中 46 镜（62%）互相矛盾，且全部通过了当时 259 个测试。
 *
 * **焦距词不是景别档** —— 这是第一版实测翻车的地方。`wide 28mm lens` /
 * `wide 14mm lens` 说的是焦距，`overhead` / `top-down` / `low-angle`
 * 说的是机位角度。把它们当景别档算，第一版得出「33 镜冲突」的虚高数字。
 * 只认**真正的构图描述**。
 * ------------------------------------------------------------------ */

/** 景别档的远近序：越近越大。用于给「差几档」定惩罚轻重。 */
export const SIZE_RANK = { ews: 0, ws: 1, fs: 2, ms: 3, cu: 4 };

/** 景别标签（中文）→ 尺寸档。识别不出返回 null（不猜）。 */
const SIZE_ZH_RULES = [
  ['cu', /特写|近景|微距/],
  ['ms', /中景|双人|二人/],
  ['fs', /全景/],
  ['ews', /大远景/],
  ['ws', /远景|远摄/]
];

export function sizeOfLabel(shotType = '') {
  const t = String(shotType || '');
  for (const [v, re] of SIZE_ZH_RULES) if (re.test(t)) return v;
  return null;
}

/**
 * 标签没写尺寸档时的兜底 —— 按**戏剧功能的通行惯例**，不是猜。
 *
 * 「建立世界 / 揭示」按惯例是宽景；「人物 / 计划 / 抉择 / 静默」这类私密镜头
 * 按惯例是中景。只给 `ws` 与 `ms` 两档（最通行、最不容易错），
 * **不给 `cu`** —— 特写必须由分镜明说，兜底不能替导演决定拍多近。
 *
 * 实测 78 镜（25%）的标签只声明了运镜与氛围（`揭示推轨镜头` /
 * `载具主导 · 压力升级跟拍` / `残局静默收尾`），不兜底就等于把构图留给随机。
 */
const DEFAULT_SIZE_BY_FN = {
  world: 'ws', goal: 'ws', reveal: 'ws',
  character: 'ms', plan: 'ms', decision: 'ms', quiet: 'ms', reaction: 'ms',
  observe: 'ms', approach: 'ms', aftermath: 'ms', contact: 'ms', escalate: 'ms',
  reversal: 'ms', cost: 'ms', clash: 'ms', close: 'ms'
};

/** 本镜应有的尺寸档：优先分镜明说的，其次按戏剧功能兜底。**探针与编译器必须同用这个函数**，
 *  否则「选机器时信的景别」与「写进 prompt 的景别」又会各说各话。 */
export function sizeForShot(shotType, fn) {
  return sizeOfLabel(shotType) || DEFAULT_SIZE_BY_FN[fn] || null;
}

/** 机位资产自带的构图档；只认构图描述，不认焦距与机位角度。 */
const CAMERA_SIZE_RULES = [
  ['cu', /close-?up|insert close-?up|macro|tight on/i],
  ['ms', /over-the-shoulder|two-?shot/i],
  ['ws', /full battlefield|reveal the (full|whole)|high aerial|aerial of |overlook|high-altitude (drone|reconnaissance)|drone shot|very high altitude|top-down satellite/i]
];

export function cameraSizeOf(asset) {
  const t = (asset?.lines || []).join(' ');
  for (const [v, re] of CAMERA_SIZE_RULES) if (re.test(t)) return v;
  return null;
}

/** 尺寸档 → 英文构图指令。视频 prompt 里此前一个景别字都没有，
 *  `shotType` 被 image-compiler 消费，**视频编译器引用数为 0**。 */
export function framingInstruction(size) {
  const INSTR = {
    ews: 'extreme wide establishing shot, the subject small within a vast frame',
    ws: 'wide shot, the whole subject in frame with generous headroom',
    fs: 'full shot, the subject framed head to toe',
    ms: 'medium shot, the subject framed from the waist up',
    cu: "close-up on the subject's face and hands"
  };
  return INSTR[size] || null;
}

/** 时代兼容的候选池。注意是**并集**，不是替换。 */
function poolFor(r, kind, era) {
  const all = r.byKind.get(kind) || [];
  const compatible = all.filter(a => isEraCompatible(a.series, era));
  return compatible.length > 0 ? compatible : all;
}

/** 稳定的字符串散列，用于在评分相同的候选之间做确定性打散 */
function hash(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

/**
 * 从环境正文推断**光质**（硬光晴天 / 漫射阴天）。
 *
 * 为什么不能只看 `tod`：`tod` 只有 day / night / dawn / dusk，正午与阴天同属 day。
 * 而环境资产自己是写了光质的 —— `ENV-101 诺曼底海滩` 的正文里明明白白有
 * `overcast sky, sea foam, smoke, gritty cinematic atmosphere`。
 *
 * 不看这个线索的代价很具体：诺曼底抢滩因为 `LGT-015 开阔海面强光` 的
 * `domain` 是 `['naval']`（比通用阴天灯更"具体"）而被选中，
 * 于是 D-Day 的阴天海滩被拍成了烈日海滩，还顺带把《拯救大兵瑞恩》
 * （`sky=overcast`）挤出了候选池。
 *
 * @returns {'sunny'|'overcast'|'any'}
 */
export function skyOfText(envText = '') {
  const t = String(envText || '');
  /**
   * **必须带词边界。** 第一版写的是裸 `rain`，而每一个环境资产的第一行都是
   * `brick-built LEGO set at minifigure scale: terrain, buildings and props…`
   * —— `rain` 命中了 `terrain`，于是 26 个题材**全部**被判成阴天，
   * 库尔斯克草原的烈日也变成了阴天。（这是本次修复自己引入的缺陷，记在这里以防复发。）
   */
  /**
   * **明确的硬光词最优先。** 费卢杰的正文是 `harsh desert sun, dust haze` ——
   * 烈日 + 悬浮沙尘，是晴天。把 `haze` 当阴天会让伊拉克城市战整片变成阴天，
   * 而《黑鹰坠落》的 `warm dusty, golden-tan cast` 恰恰就是这种暖沙尘。
   */
  const HARD_SUN = /\bharsh (desert )?sun|\bhard sun|\bhard summer|\bblazing\b|\bno cloud\b|烈日|骄阳|曝晒/i;
  const OVERCAST = /\bovercast\b|\bgreys?\b|\bgrays?\b|\bdiffuse\b|\bstorms?\b|\bclouds?\b|\bfogs?\b|\bmists?\b|\bdrizzle\b|\brain\b|阴|灰|雾|霾|云|阴沉/i;
  const SUNNY = /\bbright sun|\bclear sky\b|\bsunlight\b|\bsunlit\b|\bmidday\b|\bheat shimmer\b|晴朗|强光/i;
  if (HARD_SUN.test(t)) return 'sunny';
  // 其余情况阴天优先：环境里同时出现「阴云」与「阳光」时，通常是阴云压住了阳光
  if (OVERCAST.test(t)) return 'overcast';
  if (SUNNY.test(t)) return 'sunny';
  return 'any';
}

/**
 * 推断影片时段。
 *
 * 时段是灯光的硬约束。此前只有「夜间」一种信号，其余全靠轮转，
 * 于是夏季正午的草原拿到了夜空灯光。这里补齐 dawn / dusk，
 * 并允许从环境文本反推（「库尔斯克草原」的资产正文里写着 harsh summer sunlight）。
 *
 * @returns {'day'|'night'|'dawn'|'dusk'}
 */
export function timeOfDayOf({ intent = {}, envText = '' } = {}) {
  const cond = intent.lightingCondition;
  if (cond === 'night' || cond === 'dawn' || cond === 'dusk') return cond;
  if (/黎明|拂晓|破晓|晨曦|日出|清晨|dawn|daybreak|sunrise/i.test(envText)) return 'dawn';
  if (/黄昏|傍晚|日落|夕阳|暮色|dusk|sunset|twilight|golden hour/i.test(envText)) return 'dusk';
  if (/夜|night|nocturnal/i.test(envText)) return 'night';
  return 'day';
}

/**
 * 为一组镜头挑选机位。
 *
 * @param {object} p
 * @param {object} p.r 资产注册表
 * @param {object} p.intent 意图
 * @param {string} p.domain 战场域
 * @param {string[]} p.fns 逐镜戏剧功能（长度 = 镜头数）
 * @param {string} [p.themeText] 题材 + 环境文本，用于「点名优先」
 * @returns {string[]} 与 fns 等长的机位资产 ID 数组
 */
export function selectCameras({ r, intent, domain, tod, settings = ['open'], fns, sizes, themeText = '' }) {
  const all = poolFor(r, 'camera', intent.era);
  if (all.length === 0) return fns.map(() => null);

  // 逐层放宽：时段 + 场景 → 时段 → 场景 → 全部。
  // 机位也必须过时段这一关：「夜视主视角」是夜间器材，出现在白昼草原上是穿帮。
  const strict = all.filter(a => hits(a.tod, tod) && settingOk(a, settings));
  const todOnly = all.filter(a => hits(a.tod, tod));
  const pool = strict.length ? strict : (todOnly.length ? todOnly : all);

  const score = (a, fn, size) => {
    let s = 0;
    if (hits(a.domain, domain)) s += 40;
    if (isSpecific(a.domain, domain)) s += 6;
    if (Array.isArray(a.fn) && a.fn.includes(fn)) s += 30;
    // 场景匹配进排序：为这个场景设计的机位必须压过「恰好没被过滤掉」的机位
    s += settingTier(a, settings) * 8;
    // 景别：**冲突按差几档线性重罚**。差 4 档（远景建镜头 vs 手部微距）
    // 要能被域与戏剧功能的总分压过去 —— 那正是 6.7.5 的同族错误。
    // 域 40 + 功能 30 = 70，4 档罚 140，所以冲突时景别必胜。
    const cs = cameraSizeOf(a);
    if (size && cs) s += (cs === size ? 20 : -35 * Math.abs(SIZE_RANK[cs] - SIZE_RANK[size]));
    s += themeMatch(a, themeText) * 2;
    return s;
  };

  const used = new Set();
  const out = [];
  fns.forEach((fn, idx) => {
    const size = Array.isArray(sizes) ? (sizes[idx] || null) : null;
    const ranked = [...pool].sort((x, y) => {
      const dx = score(x, fn, size) - score(y, fn, size);
      if (dx !== 0) return -dx;
      // 同分时按散列打散，让不同题材从不同的机位起手（确定性，但不同片不同）
      return (hash(x.id + fn + idx) - hash(y.id + fn + idx));
    });
    // 首选：未被用过、且评分大于 0（即真的与该戏剧功能或战场域有关）
    const fresh = ranked.find(a => !used.has(a.id) && score(a, fn) > 0);
    const fallback = ranked.find(a => !used.has(a.id));
    const pick = fresh || fallback || ranked[0];
    used.add(pick.id);
    out.push(pick.id);
  });
  return out;
}

/**
 * 为一组镜头挑选灯光。
 *
 * 与机位不同，灯光**不应该逐镜变化** —— 同一场戏换灯就是穿帮。
 * 因此这里选一盏主灯（覆盖全片），只在「近身 / 私密」的戏剧功能上允许换一盏
 * 同域同时段的次要灯，制造景别差。两盏灯共享同一个时段与战场域。
 *
 * @returns {{ lightings: string[], tod: string }}
 */
export function selectLightings({ r, intent, domain, tod, settings = ['open'], fns, themeText = '', sky = 'any' }) {
  const all = poolFor(r, 'lighting', intent.era);
  if (all.length === 0) return { lightings: fns.map(() => null), tod };

  const rank = (pool) => [...pool].sort((x, y) => {
    // 光质最优先：环境正文写了 `overcast sky`，就不能因为某盏灯的 domain 更具体
    // 而选一盏烈日灯（诺曼底抢滩此前就是这么被拍成海滩晴天的）
    if (sky !== 'any') {
      const gx = (skyOf(x) === sky ? 1 : 0) - (skyOf(y) === sky ? 1 : 0);
      if (gx !== 0) return -gx;
    }
    // 场景匹配次之：潜艇舱就该用潜艇舱的灯，而不是「恰好没被过滤掉」的通用灯
    const sx = settingTier(x, settings) - settingTier(y, settings);
    if (sx !== 0) return -sx;
    const dx = (isSpecific(x.domain, domain) ? 1 : 0) - (isSpecific(y.domain, domain) ? 1 : 0);
    if (dx !== 0) return -dx;
    const tx = themeMatch(x, themeText) - themeMatch(y, themeText);
    if (tx !== 0) return -tx;
    return hash(x.id) - hash(y.id);
  });

  // 逐层放宽。**时段与场景优先于战场域**：
  // 光照时段错了（白天拍成黑夜）、地貌错了（草原打丛林光）比域略宽更刺眼。
  const strict = all.filter(a => hits(a.domain, domain) && hits(a.tod, tod) && settingOk(a, settings));
  const todSetting = all.filter(a => hits(a.tod, tod) && settingOk(a, settings));
  const todOnly = all.filter(a => hits(a.tod, tod));
  const pool = strict.length ? strict
    : (todSetting.length ? todSetting
      : (todOnly.length ? todOnly : all));

  const ordered = rank(pool);
  const primary = ordered[0];
  /**
   * 次要灯必须与主灯**同时段、同光质**，否则宁可不换。
   *
   * 旧代码只校验了 `hits(a.tod, tod)`，于是「北非沙漠」的成片里
   * 主灯是「沙漠正午」(sunny)，而 character / plan / decision 这些私密镜
   * 换成了「暴风雨光线」(overcast) —— 同一场戏的阳光在特写里突然变成阴天，
   * 还顺带让调色（按主灯选的 sunny）在这些镜上自相矛盾（实测 10 镜）。
   */
  const sameSky = (a) => skyOf(a) === skyOf(primary) || skyOf(a) === 'any' || skyOf(primary) === 'any';
  const secondary = ordered.slice(1).find(a => hits(a.tod, tod) && sameSky(a)) || null;

  const lightings = fns.map(fn => (
    secondary && INTIMATE_FNS.has(fn) ? secondary.id : primary.id
  ));
  // 主灯的光质要往下传给调色：正午硬光配阴天冷调是自相矛盾（见 selectColorGrade）
  return { lightings, tod, sky: skyOf(primary) };
}

/** 资产的光质倾向；未标注视为不挑光质 */
function skyOf(asset) {
  const s = asset?.sky;
  if (!Array.isArray(s) || s.length === 0) return 'any';
  return s.find(x => x !== 'any') || 'any';
}

/**
 * 调色的 `kw` 词元命中数（**只在题材串上数，不在环境正文上数**）。
 *
 * 第一版用 `themeMatch()`（最长公共子串）。实测它在调色上**完全失效**：
 * 传进去的 `themeText` 含整段英文环境描述，LCS 在长文本上到处找到 4 字巧合，
 * 5 个调色的得分变成 12 / 12 / 12 / 12 —— 平局由哈希决定，
 * 于是「伊拉克战争城市清剿」拿到《兄弟连》（二战欧洲阴天步兵）。
 *
 * 这里改成「调色自己声明的关键词，有几个真的出现在题材里」。
 * 可解释、可回归，且不会被环境正文的长英文稀释。
 */
function kwHits(kw, theme) {
  const t = String(theme || '');
  if (!t) return 0;
  return String(kw || '')
    .split(/\s+/)
    .filter(tok => tok.length >= 2 && t.includes(tok))
    .length;
}

/**
 * 挑选调色。
 *
 * 此前 `pick()` 在无关键词时返回 `pool[0]`，而调色资产全是 shared，
 * 于是 216/216 镜全部是「好莱坞大片」—— 二战苏联草原与轨道科幻同色。
 *
 * 修好「只用 1 个」之后，第二个缺陷暴露出来：**选得不准**。
 * 三档打分，从强到弱：
 *   1. **战场域三档** —— 命中 `+2` / `any` `+1` / **不符 `0`**。
 *      三档是必须的：二档时「any」与「地面专用」同分，
 *      于是轨道题材拿到了《黑鹰坠落》（它的 `domain` 是 `['ground']`，物理不符）。
 *   2. **场景命中** —— `setting` 与影片场景（滩头 / 海面 / 城市 / 空域 / 野战）相交 `+1`。
 *      这是区分「同为 ground 的《黑鹰坠落》与《兄弟连》」的唯一依据。
 *   3. **关键词命中** —— 见 `kwHits()`，只作末位区分。
 *
 * 6.7.5 又加了一层 **光质一致性**（`sky`）：
 *   `tod` 只有 day / night / dawn / dusk，**表达不了光质** —— 正午与阴天同属 day。
 *   于是库尔斯克草原开场镜出现 `Lighting: hard clear midday sunlight, no cloud cover`
 *   配 `Color grade: cool overcast, muted palette, soft contrast`，两条指令互相打架。
 *   光质由主灯的 `sky` 给出，调色也标注了自己的倾向。
 *
 * 6.7.5 把排序从**字典序改成加权求和**。为什么必须改：
 *   字典序下这些维度会互相"吃掉" —— 先比域，同域再比光质，光质就把
 *   **题材点名**（`kw`，如「诺曼底」「城市」）挤到了最后，
 *   于是「伊拉克战争城市清剿」丢掉了 kw 命中的《黑鹰坠落》。
 *   加权求和让四个维度各占一个量级，谁都不会被完全盖住：
 *
 *     域     × 100   —— 物理事实，错了最刺眼（轨道片配地面调色）
 *     光质    +20 / 0 / −150
 *     题材点名 × 10
 *     场景    × 2
 *
 * 光质是**三档而不是加分项**，这一点是实测逼出来的：
 *   加分档（+20）压不住题材点名（+10）的组合拳 —— 库尔斯克草原是硬光晴天，
 *   《兄弟连》凭题材点名也能拿下，于是 `hard midday sun` 配 `cool overcast` 照旧。
 *   而**冲突必须重罚到能压过「域」**：作品的调色池里某个域可能只有一两个候选，
 *   域分（+100）会把唯一候选顶上来，哪怕它的光质和灯正好相反。
 *   −150 让「通用且不挑光质」的调色（如《好莱坞大片》）在这种情况下胜出 ——
 *   **宁可不够贴切，也不能自相矛盾。**
 *
 * @returns {string|null} 调色资产 ID
 */
export function selectColorGrade({ r, intent, domain, settings = ['open'], theme = '', sky = 'any' }) {
  const pool = poolFor(r, 'colorGrade', intent.era);
  if (pool.length === 0) return null;

  const scoreOf = (a) => {
    const dom = isSpecific(a.domain, domain) ? 2 : (hits(a.domain, domain) ? 1 : 0);
    // 光质三档：匹配 +20 / 有一方不挑光质 0 / **冲突 −150**
    const gs = skyOf(a);
    let lit = 0;
    if (sky !== 'any' && gs !== 'any') lit = (sky === gs) ? 20 : -150;
    return dom * 100 + lit + kwHits(a.kw, theme) * 10 + settingTier(a, settings) * 2;
  };
  //
  // 光质**不能做硬过滤**。第一版硬过滤让 F-22 制空巡逻（域 air）拿到《兄弟连》
  // （域 ground）—— 唯一 air 域的《壮志凌云》是 sunny，被 overcast 的光质滤掉了。
  // 改成重罚而不是滤除：域候选少时，宁可退到「不挑光质」的通用调色。
  const ranked = [...pool].sort((x, y) => {
    const d = scoreOf(y) - scoreOf(x);
    if (d !== 0) return d;
    return hash(x.id) - hash(y.id);
  });
  return ranked[0].id;
}

/**
 * 一次性产出整片的视觉语言方案。
 *
 * @returns {{ cameras: string[], lightings: string[], colorGrade: string|null, tod: string }}
 */
export function planVisualLanguage({ r, intent, domain, fns, sizes, theme = '', envText = '', settingText = null }) {
  const themeText = `${theme} ${envText}`;
  const tod = timeOfDayOf({ intent, envText });
  // 光质同样从环境正文推 —— 「诺曼底海滩」的正文里写着 overcast sky
  const skyHint = skyOfText(envText);
  // 场景类型只从环境的**名称与关键词**推导，不用整段正文 ——
  // 正文里会出现布景细节（「远处一道村庄矮墙」），那不代表这场戏发生在城市。
  const settings = settingsOf(settingText === null ? envText : settingText);
  const cameras = selectCameras({ r, intent, domain, tod, settings, fns, sizes, themeText });
  // 先定灯再定调色：调色必须知道自己要配的是硬光还是阴天
  const { lightings, sky } = selectLightings({ r, intent, domain, tod, settings, fns, themeText, sky: skyHint });
  const colorGrade = selectColorGrade({ r, intent, domain, settings, theme, sky });
  return { cameras, lightings, colorGrade, tod, settings, sky };
}
