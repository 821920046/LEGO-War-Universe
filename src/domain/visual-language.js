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

/** 资产是否允许出现在这些场景类型里（未标注 setting = 不限） */
function settingOk(asset, settings) {
  if (!Array.isArray(asset?.setting) || asset.setting.length === 0) return true;
  if (asset.setting.includes('any')) return true;
  return settings.some(s => asset.setting.includes(s));
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
export function selectCameras({ r, intent, domain, tod, settings = ['open'], fns, themeText = '' }) {
  const all = poolFor(r, 'camera', intent.era);
  if (all.length === 0) return fns.map(() => null);

  // 逐层放宽：时段 + 场景 → 时段 → 场景 → 全部。
  // 机位也必须过时段这一关：「夜视主视角」是夜间器材，出现在白昼草原上是穿帮。
  const strict = all.filter(a => hits(a.tod, tod) && settingOk(a, settings));
  const todOnly = all.filter(a => hits(a.tod, tod));
  const pool = strict.length ? strict : (todOnly.length ? todOnly : all);

  const score = (a, fn) => {
    let s = 0;
    if (hits(a.domain, domain)) s += 40;
    if (isSpecific(a.domain, domain)) s += 6;
    if (Array.isArray(a.fn) && a.fn.includes(fn)) s += 30;
    s += themeMatch(a, themeText) * 2;
    return s;
  };

  const used = new Set();
  const out = [];
  fns.forEach((fn, idx) => {
    const ranked = [...pool].sort((x, y) => {
      const dx = score(x, fn) - score(y, fn);
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
export function selectLightings({ r, intent, domain, tod, settings = ['open'], fns, themeText = '' }) {
  const all = poolFor(r, 'lighting', intent.era);
  if (all.length === 0) return { lightings: fns.map(() => null), tod };

  const rank = (pool) => [...pool].sort((x, y) => {
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
  // 次要灯必须与主灯同域同时段，否则宁可不换
  const secondary = ordered.slice(1).find(a => hits(a.tod, tod)) || null;

  const lightings = fns.map(fn => (
    secondary && INTIMATE_FNS.has(fn) ? secondary.id : primary.id
  ));
  return { lightings, tod };
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
 * @returns {string|null} 调色资产 ID
 */
export function selectColorGrade({ r, intent, domain, settings = ['open'], theme = '' }) {
  const pool = poolFor(r, 'colorGrade', intent.era);
  if (pool.length === 0) return null;
  const ranked = [...pool].sort((x, y) => {
    const domTier = a => (isSpecific(a.domain, domain) ? 2 : (hits(a.domain, domain) ? 1 : 0));
    const dx = domTier(x) - domTier(y);
    if (dx !== 0) return -dx;
    const sx = (settingOk(x, settings) && !(x.setting || []).includes('any') ? 1 : 0)
      - (settingOk(y, settings) && !(y.setting || []).includes('any') ? 1 : 0);
    if (sx !== 0) return -sx;
    const kx = kwHits(x.kw, theme) - kwHits(y.kw, theme);
    if (kx !== 0) return -kx;
    return hash(x.id) - hash(y.id);
  });
  return ranked[0].id;
}

/**
 * 一次性产出整片的视觉语言方案。
 *
 * @returns {{ cameras: string[], lightings: string[], colorGrade: string|null, tod: string }}
 */
export function planVisualLanguage({ r, intent, domain, fns, theme = '', envText = '', settingText = null }) {
  const themeText = `${theme} ${envText}`;
  const tod = timeOfDayOf({ intent, envText });
  // 场景类型只从环境的**名称与关键词**推导，不用整段正文 ——
  // 正文里会出现布景细节（「远处一道村庄矮墙」），那不代表这场戏发生在城市。
  const settings = settingsOf(settingText === null ? envText : settingText);
  const cameras = selectCameras({ r, intent, domain, tod, settings, fns, themeText });
  const { lightings } = selectLightings({ r, intent, domain, tod, settings, fns, themeText });
  const colorGrade = selectColorGrade({ r, intent, domain, settings, theme });
  return { cameras, lightings, colorGrade, tod, settings };
}
