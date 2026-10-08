import { parseIntentWithOverrides } from './intent.js';
import { enforceContinuityChain } from './continuity.js';
import { isEraCompatible } from './shot-spec.js';
import { selectCast, buildRoster, rosterToJSON, aliasLabel, domainOfText, themeMatch } from './roster.js';
import { selectBeats, renderTemplate, seedOf, buildOriginality, tagDramaticFunctions } from './narrative.js';
import { buildStory, linkFor, detectArc, shotTypeFor, weatherFor } from './story.js';

/**
 * 依据时代、意图与关键词从注册表中筛选最适资产
 */
const pick = (r, kind, intent, term = '', excludeTerm = '', theme = '') => {
  const all = r.byKind.get(kind) || [];
  const eraMatches = all.filter(a => a.series === intent.era);
  const pool = eraMatches.length > 0 ? eraMatches : all;

  if (term) {
    const termRegex = new RegExp(term, 'i');
    const exRegex = excludeTerm ? new RegExp(excludeTerm, 'i') : null;
    const matched = pool.filter(a => {
      const full = `${a.name} ${a.nameZh || ''} ${a.kw || ''}`;
      if (exRegex && exRegex.test(full)) return false;
      return termRegex.test(full);
    });
    if (matched.length > 0) {
      // **题材点名的环境优先**。
      //
      // 没有这一层，`find` 会取「资产库数组里靠前的那个」—— 于是「库尔斯克坦克对决」
      // 拿到的是 ENV-107 北非沙漠绿洲（它只是恰好排在 ENV-109 库尔斯克草原之前），
      // 而库里明明有名字里就写着「库尔斯克」的环境。
      // 用 themeMatch 做一次排序，题材里出现的字越多越靠前，其余保持原顺序（稳定排序）。
      if (theme) {
        const scored = matched.map(a => ({ a, s: themeMatch(a, theme) }));
        scored.sort((x, y) => y.s - x.s);
        if (scored[0].s > 0) return scored[0].a;
      }
      return matched[0];
    }
  }

  if (excludeTerm) {
    const exRegex = new RegExp(excludeTerm, 'i');
    const filtered = pool.filter(a => !exRegex.test(`${a.name} ${a.nameZh || ''}`));
    if (filtered.length > 0) return filtered[0];
  }

  return pool[0] || all[0];
};

/**
 * 取一小组同类资产，供逐镜轮换使用（摄影机/灯光）
 */
const pickMany = (r, kind, intent, limit = 3) => {
  const all = r.byKind.get(kind) || [];
  const eraMatches = all.filter(a => a.series === intent.era);
  const pool = eraMatches.length > 0 ? eraMatches : all;
  const picked = pool.slice(0, limit);
  return picked.length > 0 ? picked : all.slice(0, 1);
};

/** 该载具能否安全出现在这个环境里（避免「坦克开进深海」的物理穿帮） */
function vehicleFitsEnv(vehicle, env) {
  if (!vehicle || !env) return false;
  const envName = `${env.name} ${env.nameZh || ''}`.toLowerCase();
  const isSea = /ocean|sea|深海|海域|ocean|carrier|航母/.test(envName);
  if (isSea && vehicle.class === 'ground') return false;
  const isLand = /desert|mountain|沙漠|山地|城市|urban|city/.test(envName);
  if (isLand && vehicle.class === 'submarine') return false;
  return true;
}

/**
 * 确定性影片分镜规划器
 *
 * 设计要点（相对旧实现的第一性修正）：
 *   - 演员从**真实资产库**挑选（selectCast），正反双方都上镜，不再是「一个主体演完全片」。
 *   - 主体 / 摄影机 / 灯光 / 动作模板都是**逐镜变量**，且同一阶段内不重复使用同一节拍。
 *   - 额外的原创层（logline / 转折 / 开场钩子）与参考影片解耦，避免「照着电影抄」。
 *
 * @param {object} params
 * @param {string} params.theme 影片主题
 * @param {number} params.requestedShots 镜头数量
 * @param {string} params.profileId 模型配置文件 ID
 * @param {object} r 资产注册表
 * @returns {{ intent: object, plan: object, warnings: string[], governance: object }}
 */
export function planFilm({ theme, requestedShots = 4, profileId, era: eraOverride = null }, r) {
  // 时代可以由用户在界面上显式钉死（历史题材的年代识别永远是启发式的，
  // 给用户一个否决权比让它猜更可靠）。覆盖后 needsConfirmation 自动为 false。
  const intent = parseIntentWithOverrides(theme, { era: eraOverride });
  const n = Math.max(1, Math.min(150, Number(requestedShots) || 4));
  const profile = r.profileById.get(profileId);
  if (!profile) throw new Error('Unknown profile');

  // 任务原型：整条链路的第一分叉点。选环境、选装备、写剧本都要用它。
  // 抢滩题材点名要登陆艇（而不是被 taskAffinity 判成 combat 的谢尔曼坦克），
  // 反潜题材点名要潜艇，舰队题材点名要航母与驱逐舰。
  const arc = detectArc(theme, intent);

  const warnings = [];
  if (intent.needsConfirmation) {
    warnings.push('Era needs confirmation');
  }
  if (intent.needsReview) {
    warnings.push('Content flagged for human review: ' + intent.governance.reasons.join('; '));
  }
  if (intent.isBlocked) {
    warnings.push('Content blocked by safety policy: ' + intent.governance.reasons.join('; '));
  }

  // 1. 环境自适应挑选（考虑气象物理兼容）
  //
  // 优先级：**气象物理约束 > 任务原型点名 > 显式战场设定 > 战场域**。
  //
  // 任务原型排在最前，是因为它最具体：「抢滩」要的是滩头而不是任何一片海，
  // 「使馆撤侨」要的是院落而不是任何一条城市街道 —— 这两者都会同时命中 naval / urban
  // 这类宽泛设定。原型不覆盖时，才退到设定与战场域。
  //
  // 没有这一层，era 为空的题材会退化成「环境库第一项」，于是空战片的环境写成
  // 「中东沙漠」——正文里的 {place} 也跟着全错。
  const ARC_ENV = {
    'submarine-hunt': '深海|水下|海底|反潜|sea|ocean|underwater|submarine',
    'fleet-ops': 'sea|ocean|远海|海域|海面|风暴|甲板|航母|舰队|fleet',
    'air-superiority': '高空|云|机场|停机坪|跑道|sky|cloud|airbase|runway|山地|峡谷',
    'strategic-strike': '发射|导弹|silo|基地|跑道|airbase|runway|沙漠|山地|target',
    'beach-landing': '滩头|海滩|登陆|岛屿|海岸|beach|island|shore',
    'armor-clash': '平原|草原|田野|沙漠|公路|村庄|开阔|plain|field|desert|highway|village',
    'orbital-ops': '空间站|轨道|太空|失重|零重力|气闸|舱外|月面|station|orbital|zero-g',
    'rescue-extract': '坠机|河谷|丛林|山地|森林|沼泽|jungle|river|mountain|forest|crash',
    'urban-raid': '城市|街区|巷战|公寓|地铁|废墟|urban|city|street|metro',
    // ── 6.7.2 新增原型 ──────────────────────────────────────────────
    'counter-uas': '基地|阵地|机场|airbase|山地|城市|工业|urban',
    'swarm-strike': '城市|基地|机场|工业|废墟|urban|city|airbase',
    'hypersonic-strike': '发射|导弹|silo|靶场|基地|沙漠|山地|runway',
    'ew-cyber': '地下|掩体|指挥|工业|bunker|urban|城市|港',
    'mech-assault': '城市|废墟|街区|地下|urban|city|工业',
    'embassy-evac': '使馆|大使馆|撤离|embassy|城市|街区|urban'
  };

  let envTerm = '';
  let envExclude = '';
  if (intent.weather === 'snow') {
    // 气象是**物理约束**，优先级高于一切题材偏好：沙漠里不会下暴雪。
    envTerm = 'snow|arctic|winter|雪原|雪山|雪地|冰原';
    envExclude = 'desert|沙丘|沙漠|绿洲';
  } else if (ARC_ENV[arc.id]) {
    envTerm = ARC_ENV[arc.id];
  } else if (intent.setting === 'naval') {
    envTerm = 'sea|carrier|ocean|远海|海域|海面|风暴|甲板|航母';
  } else if (intent.setting === 'urban') {
    envTerm = 'urban|city|street|城市|巷战';
  } else if (intent.setting === 'underground') {
    envTerm = '地下|坑道|隧道|掩体|指挥|bunker|tunnel|metro|地铁';
  } else {
    const dom = domainOfText(theme);
    if (dom?.key === 'orbital') envTerm = '空间站|轨道|太空|失重|零重力|气闸|舱外|月面|station|orbital|zero-g';
    else if (dom?.key === 'air') envTerm = 'air|sky|cloud|机场|停机坪|山地|峡谷|观察哨|高空';
    else if (dom?.key === 'naval') envTerm = 'sea|ocean|远海|海域|海面|风暴|甲板|航母';
    else if (dom?.key === 'strategic') envTerm = 'silo|missile|基地|沙漠|山地|发射';
    else if (dom?.key === 'ground') envTerm = 'urban|city|desert|street|城市|巷战|沙漠|山地';
  }

  const env = pick(r, 'environment', intent, envTerm, envExclude, theme) || pick(r, 'environment', intent);

  // 2. 从真实资产库挑选演员（正反双方），并给出逐镜轮换的摄影机/灯光短名单
  // 必须把 theme 与 setting 都传进去：选角引擎据此判定「战场域」，
  // 否则海军/空战/战略题材都会拿到同一组陆战装备（「装备太单一」的根因）。
  //
  const cast = selectCast(r, {
    era: intent.era || 'Modern',
    task: intent.task,
    theme,
    setting: intent.setting || '',
    vehicleHint: arc.vehicleHint || null
  });

  // 兜底：若某时代确实没有任何可用人仔，退回按关键词挑一个真实角色
  let heroes = cast.heroes;
  if (heroes.length === 0) {
    const fallbackSubject = pick(r, 'character', intent) || pick(r, 'vehicle', intent);
    if (fallbackSubject) heroes = [fallbackSubject];
  }
  const enemies = cast.enemies;
  const vehicles = cast.vehicles.filter(v => vehicleFitsEnv(v, env));

  if (cast.enemyFallback && enemies.length === 0) {
    warnings.push('该时代资产库暂无敌对阵营角色，本片以单向行动叙事呈现。');
  }

  const cameras = pickMany(r, 'camera', intent, 3);
  const lightings = pickMany(r, 'lighting', intent, 3);
  const color = pick(r, 'colorGrade', intent);
  const fxPool = (r.byKind.get('fx') || []).filter(a => isEraCompatible(a.series, intent.era));

  // 3. 选节拍（同一阶段内不重复）。
  //    这一层只负责**结构**：相位覆盖、相邻戏剧功能互异、载具与敌军必须上镜。
  //    它回答的是「这一镜在故事里做什么」，不回答「这一镜具体发生了什么」。
  const seed = seedOf(`${theme}|${n}`);
  const gates = {
    hasEnemy: enemies.length > 0,
    hasSupport: heroes.length >= 2,
    hasVehicle: vehicles.length > 0
  };
  const beats = selectBeats({ n, seed, ...gates });

  // 3-0. 剧本内核：按题材识别任务原型，取本片专属的剧本骨架。
  //
  //   这是「没有剧情」的根治点。6.6.0 之前每一镜的正文都来自通用节拍模板，
  //   与题材无关，镜头之间也没有因果关系 —— 8 个镜头读起来是一叠并置的卡片。
  //   现在正文改由骨架提供：按题材写死的「这一镜发生什么」，并且承接上一镜的结果
  //   （{link} 因果连接词）。结构骨架仍然保留，因此既有的不变式全部不受影响。
  const story = buildStory({ theme, intent, cast, env, gates });

  // 场景氛围词：按**战场域**取词池，域内按题材哈希确定性轮转。
  // 此前是「雪 / 雨 / 夜，否则尘雾」，实测 20 个题材里 19 个都是尘雾，
  // 而且尘雾是地面现象，被写到了海面、高空与轨道上。
  const filmWeather = weatherFor({ domain: story.domain, intent, seed });

  // 3a. 第一遍：只确定逐镜「主体组合」+「正文内容」。
  // 动作文本里要写角色代号，而代号由「最终上镜的资产集合」决定，
  // 因此必须先定主体、再用 buildRoster 求代号、最后才生成文本。
  //
  // 载具用**独立游标**而不是镜头序号 i 取模：vehicles[0] 是选角引擎按
  // 「战场域 + 题材点名度」排出来的主载具（题材写 F-22 就是 F-22、写核潜艇就是核潜艇）。
  // 旧实现 `vehicles[i % len]` 下，载具镜若落在 i=1，主载具就永远轮不到 —— 题材点名了
  // F-22，片子里出现的却是 RQ-4 侦察机。游标只在真正用到载具时前进，保证主载具先上镜。
  //
  // 骨架步骤的消费规则：同一 fn 的骨架按顺序取用（取尽即回退通用节拍，保证文本不重复）；
  // 但「载具镜 / 敌我对峙镜」这两类**必须保住自己的 focus** —— 否则 selectBeats 好不容易
  // 排出来的载具镜与对峙镜会被换成主角独白镜，「题材点名的装备上镜」这条保证就失效了。
  const queues = new Map();
  // 敌我对峙镜（clash / enemy）是「成片里有没有对抗」的底线：全片至少要留一镜。
  // 因此当本片只有一镜对峙时，即使骨架里没有同 focus 的步骤，也保住结构节拍；
  // 若还有别的对峙镜兜底，就放行骨架内容（否则大量骨架会因 focus 不匹配而白白浪费）。
  const hostileBeats = beats.filter(b => b.focus === 'clash' || b.focus === 'enemy').length;
  const takeSlot = (fn, wantFocus) => {
    const list = queues.get(fn) || (story.slots[fn] ? [...story.slots[fn]] : []);
    if (list.length === 0) return null;
    queues.set(fn, list);
    // `close` 是**收尾**，必须用本原型自己写的那一句，不能因为 focus 不匹配就丢掉。
    // 此前 close 也走「保住 focus」的严格路径：结构节拍想要载具收尾、而原型写的是人物收尾时
    // `findIndex` 落空 → 回退通用节拍模板，成片收尾于是变成
    // 「衣阿华级战列舰载着归队的队员缓缓驶离太平洋」这种拼凑句（实测 20 个题材里 10 个）。
    const strict = (wantFocus === 'vehicle' && fn !== 'close') || wantFocus === 'clash' || wantFocus === 'enemy';
    if (!strict) {
      let idx = list.findIndex(s => s.focus === wantFocus);
      if (idx === -1) idx = 0;
      return list.splice(idx, 1)[0];
    }
    // 载具镜必须保住 focus（否则「题材点名的装备上镜」这条保证失效）；
    // 对峙镜只有在「还有别的对峙镜」时才允许让位。
    if (wantFocus === 'clash' || wantFocus === 'enemy') {
      if (hostileBeats <= 1) {
        const idx = list.findIndex(s => s.focus === wantFocus);
        return idx === -1 ? null : list.splice(idx, 1)[0];
      }
      let idx = list.findIndex(s => s.focus === wantFocus);
      if (idx === -1) idx = list.findIndex(s => s.focus === 'clash' || s.focus === 'enemy');
      if (idx === -1) idx = 0;
      return list.splice(idx, 1)[0];
    }
    const idx = list.findIndex(s => s.focus === wantFocus);
    return idx === -1 ? null : list.splice(idx, 1)[0];
  };

  let vehicleCursor = 0;
  let prevFn = null;
  // 指挥类节拍：固定由主角（heroes[0]，与 logline 的「主角」同一个人）承担
  const LEADER_FNS = new Set(['goal', 'plan', 'decision', 'close']);
  const drafts = beats.map((beat, i) => {
    const slot = takeSlot(beat.fn, beat.focus);
    const focus = slot ? slot.focus : beat.focus;
    // 骨架取尽 → 回退通用节拍模板（那条路径自带门控，且文本与骨架不重复）
    const action = slot ? slot.action : beat.action;
    const audioCue = slot ? slot.audioCue : (beat.audioCue || '');
    const radioVoice = slot ? slot.radioVoice : (beat.radioVoice || '');
    // 因果连接词：本镜必须承接上一镜的结果。这是「一叠卡片」与「一条链」的分界。
    // 首镜或无需承接时 link 为空串 —— 此时必须把 {link} **删掉**而不是留着，
    // 因为 renderTemplate 对空值不做替换（它要保留未提供的占位符以便排查），
    // 结果会在成片正文里留下一个裸的 {link}。
    const link = linkFor(prevFn, beat.fn);
    prevFn = beat.fn;
    const linkable = (text) => (link ? text : String(text || '').replace(/\{link\}/g, ''));

    // 主角轮转：默认按镜号轮换，让每个角色都有露脸机会。
    //
    // 但「下达任务 / 制定计划 / 拍板 / 收尾」这四类节拍例外 —— 它们必须由主角承担。
    // 否则会出现「【SEXTANT】塔里克（联军战斗医护兵）在图上画出两条进攻箭头」这种错位：
    // 军医在镜头前布置战术，观众一眼就知道这是机器拼的，整片可信度随之崩掉。
    // 这几类节拍在整个剧本里各只出现一次，全部落在主角身上也不会挤掉别人的戏份。
    const lead = LEADER_FNS.has(beat.fn)
      ? heroes[0]
      : heroes[i % Math.max(1, heroes.length)];
    const support = heroes[(i + 1) % Math.max(1, heroes.length)];
    const enemy = enemies[i % Math.max(1, enemies.length)];
    // 收尾镜固定用**主载具**（vehicles[0] —— 选角引擎按「战场域 + 题材点名度」排出的那件），
    // 而不是轮转游标：轮转会让收尾抽到本片的第 3 台装备，实测出现过
    // 「F-22 制空巡逻」的收尾是 V-22 鱼鹰、「核潜艇深海猎杀」的收尾是反潜护卫舰。
    const vehicle = (focus === 'vehicle' && vehicles.length)
      ? (beat.fn === 'close' ? vehicles[0] : vehicles[(vehicleCursor++) % vehicles.length])
      : null;

    let subjects;
    switch (focus) {
      case 'clash':
        subjects = [lead, enemy];
        break;
      case 'enemy':
        subjects = [enemy, lead];
        break;
      case 'squad':
        subjects = [lead, support];
        break;
      case 'vehicle':
        subjects = vehicle ? [vehicle, lead] : [lead];
        break;
      default:
        subjects = [lead];
    }
    subjects = subjects.filter(Boolean).map(a => a.id);
    if (subjects.length === 0) subjects = [heroes[0]?.id || vehicles[0]?.id].filter(Boolean);

    return { beat, i, subjects, slot, action: linkable(action), audioCue, radioVoice, link };
  });

  // 3b. 由最终主体集合求名册（代号与 buildRoster 在 UI 侧完全一致）
  //
  // 必须把主角 id 传进去：名册要保证主角拿到**指挥职务**（车长 / 舰长 / 突击队长…），
  // 否则会出现「装填手沃尔科夫在炮塔上摊开地图：全车注意，任务已下达」。
  const roster = buildRoster(drafts.map(d => ({ subjects: d.subjects })), r, { leadId: heroes[0]?.id || null });

  const rawShots = drafts.map(({ beat, i, subjects, slot, action, audioCue, radioVoice, link }) => {
    const entryOf = id => roster.byId.get(id);
    const labelOf = id => aliasLabel(roster, id, entryOf(id)?.name || id);
    const focus = slot ? slot.focus : beat.focus;

    // 按 focus 明确区分「谁是主角 / 谁是配角 / 谁是敌人 / 哪个是载具」，
    // 否则敌人会被当成主角写进文本（例如「【我方】压制【我方】」这种低级错误）。
    let heroId = subjects[0];
    let supportId = subjects[1] || subjects[0];
    let enemyId = subjects[1] || subjects[0];
    let vehicleId = subjects[0];
    if (focus === 'enemy') { enemyId = subjects[0]; heroId = subjects[1] || subjects[0]; }
    else if (focus === 'vehicle') { vehicleId = subjects[0]; heroId = subjects[1] || subjects[0]; }
    else if (focus === 'squad') { heroId = subjects[0]; supportId = subjects[1] || subjects[0]; }
    else if (focus === 'clash') { heroId = subjects[0]; enemyId = subjects[1] || subjects[0]; }

    const envName = env?.nameZh || env?.name || '';
    const ctx = {
      heroCallsign: labelOf(heroId),
      supportCallsign: labelOf(supportId),
      enemyCallsign: labelOf(enemyId),
      vehicle: labelOf(vehicleId),
      env: envName,
      // 剧本内核槽位：题材化的具体名词 + 因果连接词。
      // 没有它们，正文里就只剩一个 {env} 与题材有关 —— 那正是「内容太单一」的根因。
      place: story.locations[i % story.locations.length] || envName,
      target: story.nouns.target,
      threat: story.nouns.threat,
      stake: story.nouns.stake,
      deadline: story.nouns.deadline,
      objective: story.nouns.objective,
      link,
      weather: filmWeather
    };

    const camera = cameras[i % cameras.length];
    const lighting = lightings[i % lightings.length];

    return {
      phase: beat.phase,
      // 景别随内容走：骨架步骤用功能推导的景别，回退节拍才用它自己的。
      // 否则会出现「正文写跳板砸进浅水、景别写拐角遭遇手持近景」的自相矛盾。
      shotType: slot ? shotTypeFor(slot) : beat.shotType,
      beatId: beat.id,
      // 戏剧功能与镜头时长随节拍一起带下去：前者让 UI 能显示「这一镜在故事里做什么」，
      // 后者让整片有快切/长镜的节奏差，而不是等权重的幻灯片。
      fn: beat.fn || null,
      duration: beat.duration || 8,
      subjects,
      environment: env?.id,
      camera: camera?.id,
      lighting: lighting?.id,
      colorGrade: color?.id,
      fx: beat.phase === 'climax' && fxPool.length > 0 ? [fxPool[i % fxPool.length].id] : [],
      audio: [],
      action: renderTemplate(action, ctx),
      audioCue: renderTemplate(audioCue || '', ctx),
      radioVoice: renderTemplate(radioVoice || '', ctx),
      // 剧本信息随镜头落库：UI 与导出可以直接展示「这一镜在故事里承担什么」
      story: {
        arc: story.arc,
        purpose: slot ? slot.fn : null,
        place: ctx.place,
        target: ctx.target
      }
    };
  });

  // 4. 注入强制连续性链条（角色外观、损伤累积、180度轴线、参考帧）
  const continuousShots = enforceContinuityChain(rawShots);

  // 4b. 戏剧功能不变式：相邻两镜绝不承担同一戏剧功能。
  //     selectBeats 在规划期已按 PHASE_ARC 保证这一点，这里再做一次强制兜底，
  //     让「本地规划器 / 电影致敬引擎 / 云端大模型」三条路径共用同一道保险，
  //     彻底杜绝「每一镜都在干同一件戏剧上的事」这种「不成电影」的输出。
  const functioned = tagDramaticFunctions(continuousShots);

  // 5. 原创层：与参考影片解耦的立意 / 转折 / 开场钩子
  const originality = buildOriginality({ theme, intent, reference: null, seed });

  // 5b. 用剧本内核重写 logline：把「主角是谁、要什么、多久、赌注是什么」说清楚。
  //     旧 logline 是「{时代}的{场景}，{主题}被投入一场{任务}」——主语是「主题」而不是人，
  //     读起来像公告，不像故事。这里改为以人物为锚点。
  const lead = heroes[0];
  const leadEntry = lead ? roster.byId.get(lead.id) : null;
  const leadName = leadEntry ? `${leadEntry.persona || leadEntry.name}` : '这支小队';
  const leadRole = leadEntry?.personaRole || leadEntry?.role || '队长';
  // 「带着小队进入战场」里的动词按战场域取：潜艇是「潜入」、飞机是「飞向」。
  // 一句「突击手米勒带着小队进入太平洋」在潜艇片里是错的 —— 潜艇不下水。
  //
  // 但 naval 这一个域里同时住着潜艇与水面舰艇，两者不能共用一个动词：
  // 修复前「中途岛航母对决」的 logline 是「舰长佩德罗带着小队**潜入**太平洋」——
  // 航母不会下潜。因此潜艇按**原型**单独取词（`submarine-hunt`），水面舰艇用「驶入」。
  const ENTER_VERB = { naval: '驶入', air: '飞向', strategic: '前出到', orbital: '进入' };
  const ARC_ENTER_VERB = { 'submarine-hunt': '潜入' };
  const enterVerb = ARC_ENTER_VERB[story.arc] || ENTER_VERB[story.domain] || '进入';
  // 移动从句的目标用**区域**（`locations[0]`），不用环境名。
  // 环境名（「核潜艇控制舱」）已经出现在 premise 里，再写一次是重复；
  // 而且它是「舱室」不是「区域」，「潜入核潜艇控制舱」读不通。
  // 用 `locations[0]` 还顺带保证了 logline 与分镜正文指的是同一个地方。
  const enterPlace = story.locations?.[0] || story.nouns.place;
  const logline = `${story.premise}${leadRole}${leadName}带着小队${enterVerb}${enterPlace}；`
    + `而${String(originality.twist || '').replace(/。$/, '')}。`;

  const plan = {
    intent,
    profileId,
    shots: functioned.shots,
    cast: {
      heroes: heroes.map(a => a.id),
      enemies: enemies.map(a => a.id),
      vehicles: vehicles.map(a => a.id),
      enemyFallback: cast.enemyFallback,
      nation: cast.nation || null
    },
    // 剧本内核随计划一起冻结：UI / 导出 / 后续重排都以这一份为准，
    // 否则「重渲染一次剧本就换一个故事」。
    story: {
      arc: story.arc,
      arcLabel: story.arcLabel,
      domain: story.domain,
      premise: story.premise,
      nouns: story.nouns,
      locations: story.locations,
      protagonist: lead ? {
        id: lead.id,
        name: leadEntry?.persona || leadEntry?.name || '',
        role: leadRole
      } : null
    },
    // 名册随计划一起冻结：后续任何环节（自我进化补资产 / UI 重渲染 / 编译 Prompt）
    // 都必须以这份代号为准，绝不能重新分配，否则台词与定妆表会串戏。
    roster: rosterToJSON(roster),
    originality: { ...originality, logline }
  };

  return {
    intent,
    plan,
    warnings,
    governance: intent.governance,
    originality: plan.originality,
    story: plan.story,
    roster: plan.roster
  };
}
