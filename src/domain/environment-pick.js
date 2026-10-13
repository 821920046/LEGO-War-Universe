/**
 * 环境语义选型 —— 从「正则首个命中」改为「主题词加权 + 场地域 + 物理约束」。
 *
 * **为什么必须重写（6.8.0 之前的实测）**
 *
 * 旧算法（`planner.js` 的 `pick()`）是两步：
 *   1. 用 `ARC_ENV[arc.id]` 这类正则把池子筛成一个子集；
 *   2. 在子集里按 `themeMatch` 排序，**取第一个**。
 *
 * 第二步在「题材词命中环境名」时工作良好（库尔斯克 → 库尔斯克草原）；
 * 一旦题材词与环境名对不上，`themeMatch` 全为 0，排序退化成**资产库数组顺序**，
 * 于是子集的第一个环境胜出。实测 12 条任意提示词：
 *
 *   「强渡冰河」       → armor-clash 子集 = 平原/沙漠类      → ENV-001 中东沙漠
 *   「月球表面夺舱」   → ground 兜底子集 = 城市/沙漠          → ENV-001 中东沙漠（库里有 ENV-703 月面基地）
 *   「雨夜潜入敌方港口」→ submarine-hunt 子集 = 深海/水下     → ENV-904 核潜艇控制舱（库里有 ENV-407 工业港口）
 *   「穿越沼泽」       → 同上兜底                            → ENV-001 中东沙漠（库里有 ENV-507 沼泽地）
 *
 * **资产库是够的，选型算法是瞎的。** 106 个环境里沼泽、渡河点、月面基地、工业港口都在，
 * 只是没人把它们和题材里那两个词对上。
 *
 * **本模块的六条腿**
 *
 *   1. **最长公共子串（专名腿）**：`库尔斯克` 这种专名不能被切成二字碎片
 *      （第一版按二元词切，`库尔斯克` → `库尔|尔斯|斯克`，一个都匹配不上，
 *      26 个内置题材当场劣化 10 个）。专名用 LCS 直接量长度。
 *   2. **主题词加权（字面腿）**：二元词命中 `nameZh` / `kw` 值得 4 分。
 *   3. **概念桥（词汇腿）**：用户说「强渡」，库里写「渡河点」。这一类**用词不同、
 *      意思相同**的对应无法用子串匹配发现，用一张概念表补。刻意只收「概念」
 *      不收「题材」—— 收题材就等于把 26 个主题硬编码进选型器，
 *      换一种说法立刻失效。桥出来的词**只认强字段**：`sky` / `ocean` 这类词
 *      在每个室外环境的正文里都出现，让它们进弱字段等于白送分
 *      （第一版实测：「雷雨云缝隙缠斗」因此选了使馆楼顶停机坪）。
 *   4. **场地域**：只从**人写的字段**（名称 / 关键词）推。从正文推会把「中东沙漠」
 *      因为 `clear sky` 判成 air（第一版实测，26 个内置题材劣化 10 个）。
 *   5. **任务词剥离**：「伏击」「拦截」「争夺」是**动作**不是**地点**。
 *      不剥掉它们，「海湾战争夜战防空导弹阵地伏击」会因为「伏击」命中
 *      `ENV-308 中欧森林伏击地带`（+17 分夺冠），真正的导弹阵地排第五。
 *      这是本模块第二个自己踩过的坑。
 *   6. **时代亲和是软加分不是硬过滤**。硬过滤把「五代机云层拦截」
 *      （判成 Modern High-Tech，池里只有 7 个该系列环境）最合适的
 *      `战略空军基地跑道`（Modern 系列）挡在池外，只能拿到反无人机防御阵地。
 *
 * 排序保持确定性：同分按 id 散列打散。
 */

import { fnv1a } from './roster.js';
import { isEraCompatible } from './shot-spec.js';

/** 中文功能词：切二元词时命中它们没有信息量 */
const STOP_WORDS = new Set([
  '一支', '一名', '一个', '一群', '一队', '两台', '两名', '两人', '几个',
  '在', '的', '了', '与', '和', '被', '把', '从', '向', '对', '为', '以',
  '时分', '之内', '之后', '之前', '里', '上', '中', '下', '前', '后',
  '敌军', '敌方', '敌人', '我方', '我军', '小队', '小组', '部队', '编队',
  '时候', '开始', '准备', '执行', '完成', '进行', '试图'
]);

/**
 * 任务 / 动作词 —— **不是地点**。
 *
 * 它们在环境名里随处可见（`伏击地带`、`争夺中的桥梁`、`突入走廊`），
 * 而题材里提到它们只是说明「这一镜要干什么」。
 * 留着它们，环境选型会被动词语境带跑：
 * 「防空导弹阵地**伏击**」→ 中欧森林伏击地带（实测 +17 分夺冠）。
 */
const TASK_WORDS = new Set([
  '伏击', '拦截', '缠斗', '争夺', '突袭', '突击', '进攻', '防守', '交战',
  '扫荡', '清剿', '营救', '撤离', '撤退', '搜索', '搜寻', '观察', '巡逻',
  '警戒', '侦察', '渗透', '破坏', '轰炸', '护送', '夺取', '抢占', '压制',
  '阻击', '反击', '突围', '接应', '潜伏', '埋伏', '驻守', '夺舱', '潜入',
  '偷袭', '奇袭', '强攻', '佯攻', '牵制', '护卫', '巡航', '封锁', '来袭'
]);

/**
 * 概念桥：用户词汇 → 库内词汇。
 *
 * **为什么必须有这一层。** 子串匹配只能发现「字面重合」：
 * 「强渡冰河」与「渡河点」没有一个二元词相同，「沼泽」与「泛滥的沼泽地」反而有。
 * 没有桥，语义相同但用词不同的题材永远选不对环境 —— 那是选型器最大的窟窿。
 *
 * **只收概念，不收题材。** 「渡河 / 涉水 / 横渡」都指向渡河点，这是**概念**；
 * 而「库尔斯克」「费卢杰」是专名，交给 LCS 那条腿。把专名写进来，
 * 这个表就退化成一堆 if-else，换一种说法立刻失效。
 */
const CONCEPT_BRIDGE = [
  { match: /渡河|强渡|涉水|横渡|过河|河段|抢渡|冰河/, tokens: ['渡河', 'river', 'pontoon', '冰'] },
  { match: /沼泽|湿地|滩涂|泥泞|洼地/, tokens: ['沼泽', 'marsh', 'wetland'] },
  { match: /月球|月面|登月|低重力|表面争夺/, tokens: ['月面', 'lunar', 'moon'] },
  { match: /港口|码头|军港|泊地|潜艇码头|工业港/, tokens: ['港口', '港', 'port', 'harbour'] },
  { match: /云层|云端|云缝|高空|超高空/, tokens: ['高空', '空域', 'sky', 'cloud'] },
  { match: /机场|跑道|空降/, tokens: ['机场', '跑道', 'airbase', 'runway', 'airfield'] },
  { match: /城市|城区|巷战|街道|街区|楼顶/, tokens: ['城市', '城区', '巷战', 'urban', 'city', 'street'] },
  { match: /海滩|滩头|抢滩|登陆|两栖/, tokens: ['滩头', '海滩', '登陆', 'beach', 'shore'] },
  { match: /海面|远海|舰队|编队|航母|护卫舰|驱逐舰|舰艇|军舰|运输船/, tokens: ['海', '航母', '舰队', 'sea', 'ocean', 'carrier', 'naval'] },
  { match: /深海|水下|潜航|潜艇|反潜/, tokens: ['深海', '水下', '潜艇', 'underwater', 'submarine'] },
  { match: /沙漠|荒漠|沙丘|戈壁/, tokens: ['沙漠', '荒漠', 'desert', 'dunes'] },
  { match: /雪山|雪原|严寒|冰原|暴风雪|冬季|冰河|冰封/, tokens: ['雪', '冰', 'snow', 'arctic', 'winter', 'frozen'] },
  { match: /丛林|密林|雨林|森林/, tokens: ['丛林', '密林', '森林', 'jungle', 'forest'] },
  { match: /空间站|轨道|太空|失重|气闸|舱外/, tokens: ['空间站', '轨道', '太空', 'station', 'orbital', 'space'] },
  { match: /指挥所|指挥部|掩体|地下指挥|坑道|隧道/, tokens: ['掩体', '指挥', 'bunker', 'command'] },
  { match: /桥梁|大桥|渡口/, tokens: ['桥梁', '桥', 'bridge'] },
  { match: /发射井|导弹阵地|导弹旅|防空导弹/, tokens: ['发射', '导弹', 'silo', 'missile'] },
  { match: /雷雨|暴雨|暴风雨|风雨/, tokens: ['暴风', '风雨', 'storm'] },
  { match: /雷达站|预警雷达|雷达阵地/, tokens: ['雷达', 'radar'] }
];

/** 场地域判定。**只认人写的字段**（名称 / 关键词），不认正文布景描述 */
const DOMAIN_RULES = [
  ['orbital', /空间站|轨道|月面|月球|太空|失重|零重力|气闸|舱外|station|orbital|lunar|moon|space|zero-?g|satellite/i],
  ['air', /空军|机场|停机坪|跑道|高空|空域|airbase|airfield|runway|air ?base|sky|cloud|air/i],
  ['naval', /海|洋|港|航母|舰队|潜艇|舰|滩头|登陆|两栖|码头|海上|sea|ocean|port|harbou?r|carrier|naval|fleet|beach|shore|submarine|dock/i],
  ['strategic', /发射|导弹|阵地|靶场|silo|missile|launch|range/i]
];

/** 地面专属景物：题材锁定空中 / 轨道 / 海上时不得入选 */
const GROUND_ONLY = /沙漠|荒漠|戈壁|丛林|密林|森林|城区|城市|巷战|街道|村庄|平原|草原|田野|沼泽|渡河|桥梁|山地|雪原|desert|jungle|forest|urban|city|village|plain|swamp/i;

/** 场地域只从人写字段推（正文里的 `clear sky` 曾是沙漠被误判成 air 的原因） */
export function envDomain(env) {
  const text = `${env?.name || ''} ${env?.nameZh || ''} ${env?.kw || ''}`;
  for (const [dom, re] of DOMAIN_RULES) if (re.test(text)) return dom;
  return 'ground';
}

/**
 * 题材的场地域 —— **优先级与 `roster.domainOfText` 刻意不同**。
 *
 * `domainOfText` 的顺序是「地面、空中、海上…」，它是为**选角**设计的：
 * 「一群机器人在月球表面争夺登月舱」里的「机器人」命中 ground，
 * 于是域被判成 ground —— 对选角没错（出场的是机器人步兵），
 * 但拿这个域去选环境，`ENV-703 月面基地` 会因为「域冲突 −8」被扣死。
 *
 * 选环境要的是**事件发生在哪个空间**，所以这里按
 * 「轨道 → 空中 → 海上 → 战略 → 地面」判，最具体的空间赢。
 */
const THEME_DOMAIN_RULES = [
  ['orbital', /空间站|轨道|月面|月球|太空|失重|零重力|气闸|舱外|登月|station|orbital|lunar|moon|space|zero-?g|satellite/i],
  ['air', /空军|机场|停机坪|跑道|高空|空域|云层|云端|空战|制空|战机|战斗机|轰炸机|飞行员|跳伞|空降|拦截|airbase|airfield|runway|air ?base|fighter|bomber|jet|airborne|aerial|sky|cloud|air/i],
  ['naval', /海军|航母|舰队|潜艇|驱逐舰|护卫舰|巡洋舰|舰|滩头|抢滩|登陆|两栖|海上|远海|深海|运输船|港口|码头|navy|naval|carrier|fleet|submarine|destroyer|frigate|warship|ocean|sea|port|harbou?r|beach|shore|amphibious|naval/i],
  ['strategic', /发射井|导弹|洲际|silo|missile|icbm/i]
];

export function themeDomainOf(theme) {
  const t = String(theme || '');
  for (const [dom, re] of THEME_DOMAIN_RULES) if (re.test(t)) return dom;
  return 'ground';
}

/** 剥掉任务词后的题材文本：只留下「这件事发生在哪」的线索 */
function placeTextOf(theme) {
  let t = String(theme || '');
  for (const w of TASK_WORDS) t = t.split(w).join(' ');
  return t;
}

/** 二元词（长度 2 的中文连续段切片） */
function bigramsOf(text) {
  const out = new Set();
  for (const seg of (String(text || '').match(/[\u4e00-\u9fa5]+/g) || [])) {
    if (seg.length < 2) continue;
    for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2));
  }
  return out;
}

/** 最长公共子串长度（专名匹配的核心：`库尔斯克` 不能被切成碎片） */
function lcsLen(a, b) {
  const A = String(a || ''), B = String(b || '');
  if (!A || !B) return 0;
  let best = 0;
  let prev = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    const cur = new Array(B.length + 1).fill(0);
    for (let j = 1; j <= B.length; j++) {
      if (A[i - 1] === B[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * 主题词表：二元词 + 概念桥展开出的候选词 + 剥离任务词后的「地点文本」。
 * LCS 那条腿对每个环境单独算，用 `place` 文本（已剥任务词）。
 */
export function themeTokens(theme) {
  const t = String(theme || '');
  const place = placeTextOf(t);
  const big = [...bigramsOf(place)].filter(w => !STOP_WORDS.has(w));
  const bridged = [];
  for (const c of CONCEPT_BRIDGE) {
    if (c.match.test(t)) bridged.push(...c.tokens);
  }
  return { big, bridged: [...new Set(bridged)], place };
}

/**
 * 环境得分。
 * @returns {{ score: number, hits: string[], domain: string }}
 */
export function scoreEnvironment(env, tokens, { domain = null, arcTerm = '', arcWeight = 1, eraMatch = false, useDomain = true } = {}) {
  if (!env) return { score: 0, hits: [], domain: null };
  const strong = `${env.nameZh || ''} ${env.kw || ''}`;
  const strongLow = strong.toLowerCase();
  const hits = [];
  let score = 0;

  // 1. 专名腿：LCS ≥3 才按长度计分（×2.5，封顶 8），LCS = 2 只给 2 分。
  //    为什么卡 3：`机` / `空军` / `基地` 这类两字片段在几十个环境名里都出现，
  //    给它们 5 分等于白送（实测「五代机拦截」让 ENV-207 中途岛环礁
  //    凭一个两字片段 +5 夺冠，而它是个海军环境）。
  //    库尔斯克(4)、中途岛(3)、月面基地(4) 这类真专名不受影响。
  //    用**剥过任务词**的文本算 —— 否则「伏击」会命中 `伏击地带`。
  const lcs = lcsLen(strong, tokens.place || '');
  let specificity = 0;
  if (lcs >= 3) { score += Math.min(8, lcs * 2.5); specificity += lcs; hits.push(`专名×${lcs}`); }
  else if (lcs === 2) { score += 2; specificity += 2; hits.push('专名×2(弱)'); }

  // 2. 二元词腿：强字段 4 分
  for (const b of tokens.big) {
    if (strong.includes(b) || strongLow.includes(b)) { score += 4; specificity += 2; hits.push(b); }
  }
  // 3. 概念桥腿：桥出来的词命中强字段 3 分（低于字面二元词）。
  //    **不认弱字段** —— `sky` / `ocean` 在每个室外环境正文里都出现，
  //    让它们进弱字段等于给所有室外环境白送 1.5 分（第一版实测：
  //    「雷雨云缝隙缠斗」因此选了使馆楼顶停机坪）。
  for (const b of tokens.bridged) {
    if (strong.includes(b) || strongLow.includes(b)) { score += 3; specificity += 1; hits.push(`桥:${b}`); }
  }
  // 4. 场地域。`useDomain` 三档：
  //      `true`   → 一致 +8 / 冲突 −8（第二轮、扩容轮）
  //      `'soft'` → **只罚不一致（−3），不给一致加分**（第一轮）
  //      `false`  → 完全不看域（调试用）
  //    为什么第一轮要「软罚」：`ENV-703 月面基地` 被 `机器人` 拖累成 ground 域时，
  //    −8 会把「月球」这个直接证据压到不及格，于是第二轮原型亲和上位、
  //    月球片拿到未来都市街区。但完全不罚也不行 —— 「海湾战争夜战防空导弹阵地伏击」
  //    会让 `联军空军基地` 与 `前进作战基地` 凭一个两字片段（专名×2 弱）各得 7 分
  //    过线，而正确的 `中东沙漠` 只有 5 分。−3 刚好把两个空军基地压到 4 分退回第二轮，
  //    又不影响月球（主题域已是 orbital，一致不罚，9 分照样过线）。
  const dom = envDomain(env);
  if (domain && useDomain === true) score += dom === domain ? 8 : -8;
  else if (domain && useDomain === 'soft' && dom !== domain) score -= 3;
  // 5. 时代亲和：**软加分不是硬过滤**。硬过滤把「五代机云层拦截」
  //    （判成 Modern High-Tech，池里只有 7 个该系列环境）最合适的
  //    `战略空军基地跑道`（Modern 系列）挡在池外，只能拿到反无人机防御阵地。
  if (eraMatch) score += 5;
  // 6. 原型亲和：命中强字段 +10。
  //    `arcWeight = 0` 用于第一轮（只看题材直接证据）。没有这一手，
  //    「潜入敌方港口炸毁潜艇」会被原型亲和一路送进核潜艇控制舱 ——
  //    arcTerm 命中「潜艇」+10，而题材点名的「港口」只有桥 +3。
  if (arcTerm && arcWeight > 0) {
    let re;
    try { re = new RegExp(arcTerm, 'i'); } catch { re = null; }
    if (re && re.test(strong)) score += 10 * arcWeight;
  }
  return { score: Math.round(score * 10) / 10, specificity, hits, domain: dom };
}

/** 题材直接证据的及格线：够了就以题材为准，不再请原型说话 */
const DIRECT_EVIDENCE_MIN = 6;

/** 时代池内择优的强分数线：够高就用时代池，不够才扩容到全库 */
const ERA_POOL_STRONG = 8;

/**
 * 环境选型主入口。
 *
 * 三道闸：
 *   **第一道 · 题材直接证据**：只用专名 / 字面二元词 / 概念桥给池内环境打分，
 *   最高分过线（≥6）就直接定 —— 原型亲和**没有说话的分**。
 *   **第二道 · 原型亲和**：没过线才让原型亲和按 +10 参与排序（旧算法的有效部分），
 *   分数够高（≥8）就定。
 *   **第三道 · 时代扩容**：前两道在 era 池里的最好成绩仍然弱时，
 *   把池子扩容到全库重排，时代匹配退化为 +5 软加分。
 *
 * 没有这三道闸，要么题材点名被原型亲和压死（「港口炸潜艇」进潜艇舱），
 * 要么没有直接证据的题材退回资产库数组顺序（「强渡冰河」进中东沙漠），
 * 要么 era 池太窄把更合适的环境一票否决（「五代机拦截」拿到反无人机阵地）。
 *
 * @param {object} o
 * @param {Array}  o.pool      已按时代筛过的环境池
 * @param {Array}  o.all       全部环境（池内无好答案时扩容用）
 * @param {string} o.theme     用户题材原文
 * @param {string} [o.domain]  题材推出的战场域
 * @param {string} [o.arcTerm] 原型环境亲和正则
 * @param {string[]} [o.hardExclude] 物理硬约束（暴雪题材排除沙漠）
 * @param {string} [o.era]     推断出的时代（用于 +5 软加分）
 */
export function pickEnvironment({ pool = [], all = [], theme = '', domain = null, arcTerm = '', hardExclude = [], era = null } = {}) {
  const tokens = themeTokens(theme);
  const exRes = (hardExclude || []).map(x => { try { return new RegExp(x, 'i'); } catch { return null; } }).filter(Boolean);
  const clean = list => list.filter(env => !exRes.some(re => re.test(`${env.nameZh || ''} ${env.name || ''} ${env.kw || ''}`)));
  const scope = (list) => {
    // 战场域硬互斥：题材锁定空中 / 轨道 / 海上时，另一面的地面景物不得入选
    // （空战片不能落在沙漠里，潜艇片不能开进草原）。
    //
    // **`strategic` 不参与互斥** —— 6.8.0 实测：导弹 / 阵地类题材被判成 strategic，
    // 而导弹阵地本身**就建在地面上**，`中东沙漠` 因此被当成「地面专属景物」滤掉，
    // 「海湾战争夜战防空导弹阵地伏击」被送进了 `ENV-003 联军空军基地`，
    // 连带把沙漠暖调（《黑鹰坠落》）换成了二战冷调（《兄弟连》）。
    // 战略域与地面域是**上下位**关系，不是并列互斥关系。
    const domLock = domain && domain !== 'ground' && domain !== 'strategic';
    const scoped = domLock
      ? list.filter(e => envDomain(e) === domain || !GROUND_ONLY.test(`${e.nameZh || ''} ${e.kw || ''}`))
      : list;
    return scoped.length ? scoped : list;
  };

  const base = pool.length ? pool : all;
  const candidates = clean(base);
  if (candidates.length === 0) return pool[0] || all[0] || null;
  const use = scope(candidates);
  //
  // 扩容视图：**时代相容是硬约束，不是偏好。**
  // 之前这里直接取全库，于是「海湾战争夜战防空导弹阵地伏击」（判为 Gulf War）
  // 在时代池里最好只有 7 分（「沙漠」原型亲和），全库里 `ENV-107 北非沙漠绿洲阵地`
  // （WWII 系列）却靠字面「阵地」拿到 29.5 分 —— 一部海湾战争的片子被送进了
  // 北非战场，还顺带让调色从沙漠暖调变成二战冷调。环境的时代不符在校验器里
  // 只是 warning，但它会把整片的光质、调色与载具一起带偏。
  // 因此扩容只在**时代相容**的范围内扩；全库只作为「一个相容环境都没有」的兜底。
  const eraOk = env => !era || isEraCompatible(env.series, era);
  const widen = clean(all).filter(eraOk);
  const wide = widen.length > 0
    ? scope(widen)
    : (all.length > use.length ? scope(clean(all)) : use);

  const rank = (list, arcWeight, useDomain) => {
    let best = null;
    let bestScore = -Infinity;
    let bestSpec = -Infinity;
    for (const env of list) {
      const { score, specificity } = scoreEnvironment(env, tokens, {
        domain, arcTerm, arcWeight, eraMatch: !!era && env.series === era, useDomain
      });
      // 三级排序：分数 → 具体度（字面命中数 + 专名长度）→ id 散列。
      // **具体度必须是第二键，不能直接跳到散列。** 同分太常见：
      // 「穿越沼泽」里 ENV-507 泛滥的沼泽地（字面「沼泽」+桥）与
      // ENV-610 争夺中的桥梁（纯桥）同得 17 分，散列一锤定音就把沼泽片送到了桥上。
      const better = score > bestScore
        || (score === bestScore && specificity > bestSpec)
        || (score === bestScore && specificity === bestSpec && best && fnv1a(env.id) < fnv1a(best.id));
      if (better) {
        best = env;
        bestScore = score;
        bestSpec = specificity;
      }
    }
    return { env: best, score: bestScore };
  };

  const direct = rank(use, 0, 'soft');
  if (direct.env && direct.score >= DIRECT_EVIDENCE_MIN) return direct.env;
  const withArc = rank(use, 1, true);
  if (withArc.env && withArc.score >= ERA_POOL_STRONG) return withArc.env;

  // 时代池里没有一个像样的答案：扩容到全库，时代退化为 +5 软加分。
  const expanded = rank(wide, 1, true);
  return expanded.env || withArc.env || direct.env || use[0];
}
