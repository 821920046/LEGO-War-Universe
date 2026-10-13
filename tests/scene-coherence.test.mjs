/**
 * 6.7.5「画面自洽」回归测试
 *
 * 这一轮的缺陷不是靠读 `action` 正文发现的，而是靠**把编译产物里的
 * Scene / Camera / Lighting / Color grade / Framing 五条指令并排读**：
 * 它们每一条单独看都合理，放在一起就互相打架。
 *
 *   1. 潜艇指挥舱（Scene）配高空俯拍舰队（Camera）+ 开阔海面烈日（Lighting）。
 *      根因：`settingOk()` 用「相交即放行」，而 `interior` 与室外类型是**互斥**
 *      关系不是并列关系 —— 一间舱室不可能同时是开阔海面。
 *      实测 48 镜室内场景里 12 镜（25%）错配。
 *   2. 盛夏正午无云硬光（Lighting）配 cool overcast 阴天冷调（Color grade）。
 *      根因：`tod` 只有 day/night/dawn/dusk，**表达不了光质**。
 *   3. 首帧姿势写死 `weapon up`，而 312 张首帧里 151 张的正文毫无武器语义
 *      （环境空镜、靠着舱壁坐下、探头呼吸海风都被画成举枪站立）。
 *      严重性在于：首帧是 image-to-video 的输入，错姿势会带完整镜。
 *   4. 首帧的 `Action context` 取到的是上一镜的连接词（「手按住地图」）。
 *
 * 这四条有一个共同点：**每一条都能通过当时全部 253 项测试**，
 * 因为测试从不检查两条指令之间是否自洽。所以这里断言的全部是**跨字段**关系。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { planFilm } from '../src/domain/planner.js';
import { buildRoster } from '../src/domain/roster.js';
import { compileShot } from '../src/domain/compiler.js';
import { compileKeyframeImage } from '../src/domain/image-compiler.js';
import { sizeForShot, cameraSizeOf } from '../src/domain/visual-language.js';
import { LINK_BY_PREV } from '../src/domain/story.js';

const registry = createRegistry(assets, profiles, { references: [] });
const PROFILE = [...registry.profileById.keys()][0];

const THEMES = [
  '库尔斯克坦克对决', '核潜艇深海猎杀', '中途岛航母对决', '诺曼底登陆抢滩', 'F-22 制空巡逻',
  '轨道空间站失压事故', '跳伞飞行员敌后营救', '现代特战小队城市废墟夜间突袭', 'B-2 轰炸敌方雷达站',
  '斯大林格勒巷战', '海湾战争夜战防空导弹阵地伏击', '太平洋热带岛屿滩头两栖登陆作战',
  '沙漠风暴装甲突击', '伊拉克战争城市清剿', '二战北非沙漠装甲追击', '航母战斗群远海编队作战',
  '阿登森林冬季反击战', '敌后渗透破坏桥梁', '护航编队反潜警戒', '近地轨道卫星争夺战',
  '无人机蜂群突防压制敌方雷达', '动力外骨骼小队突击城市废墟', '使馆撤侨掩护平民撤离',
  '高超音速滑翔弹打击敌方反导阵地', '电子战与网络战压制敌方指挥节点', '反无人机阵地防御'
];

/** 一次编译出全部镜头的视频 prompt 与首帧 prompt */
function compileAll() {
  const out = [];
  for (const theme of THEMES) {
    const r = planFilm({ theme, requestedShots: 12, profileId: PROFILE }, registry);
    // **必须传镜头数组，不是 plan.roster。** `buildRoster(shots, …)` 读的是
    // `shot.subjects`，而名册条目没有这个字段 —— 传错会让名册变成空表，
    // 于是 `Subject(s)` 行丢掉代号、`Cast` 行整行消失，
    // 「代号必须出现在视频脚本里」这条保证就永远测不到。
    const roster = buildRoster(r.plan.shots, registry, { leadId: r.story?.protagonist?.id });
    const prof = registry.profileById.get(PROFILE);
    for (const s of r.plan.shots) {
      out.push({
        theme, shot: s,
        video: compileShot(s, registry, prof, roster).prompt || '',
        still: compileKeyframeImage(s, registry, roster).prompt || ''
      });
    }
  }
  return out;
}

const ALL = compileAll();
const line = (p, k) => (String(p).split('\n').find(l => l.startsWith(k + ':')) || '').replace(k + ':', '').trim();

/* ───────────────── A. 室内场景不得配室外机位 / 光照 ───────────────── */

test('6.7.5 · 室内 Scene 不得配室外机位或室外光照', () => {
  /**
   * 判定只用**编译产物里真实出现的英文**，不去猜内部字段。
   * 注意两条例外，否则会误报：
   *   - 「俯视顶拍 overhead」「潜望镜视角 periscope view」在舱内都成立，不算错。
   *   - 场景写明 `exterior`（空间站外壳）的不是室内。
   */
  const INDOOR = /control room|cockpit|interior|bunker|tunnel|corridor|compartment|cabin|hangar|inside the|room\b/i;
  const EXTERIOR = /exterior|outside|outdoors/i;
  const OUTDOOR_CAM = /naval task force|armoured column|beachhead|treetop|open sky|high-altitude reconnaissance|satellite surveillance|open sea/i;
  const OUTDOOR_LGT = /sunlight over open|open sea|open field|hard clear midday|harsh overhead sunlight|no cloud cover|heat shimmer|snowfield|jungle/i;

  let indoor = 0;
  const bad = [];
  for (const { theme, shot, video } of ALL) {
    const scene = line(video, 'Scene');
    if (!INDOOR.test(scene) || EXTERIOR.test(scene)) continue;
    indoor++;
    const cam = line(video, 'Camera');
    const lgt = line(video, 'Lighting');
    if (OUTDOOR_CAM.test(cam) || OUTDOOR_LGT.test(lgt)) {
      bad.push(`${theme} / ${shot.fn}\n     Scene    ${scene.slice(0, 62)}\n     Camera   ${cam.slice(0, 62)}\n     Lighting ${lgt.slice(0, 62)}`);
    }
  }
  // 修前：48 镜室内场景 12 镜（25%）错配 —— 潜艇舱里出现高空俯拍航母编队
  assert.ok(indoor >= 20, `样本里室内场景只有 ${indoor} 镜，判据可能失效了`);
  assert.equal(bad.length, 0, `${indoor} 镜室内场景里 ${bad.length} 镜配了室外机位/光照：\n  ${bad.join('\n  ')}`);
});

test('6.7.5 · interior 与室外类型互斥：标了室外类型的机位/灯光不得进室内场景', () => {
  // 这是上一条的**机制层**断言：只测成品会让「恰好没被选中」的漏洞溜过去。
  // 直接验证语义：场景含 interior 时，任何标了具体室外 setting 却没标 interior 的资产都必须出局。
  const cameras = assets.cameras || [];
  const lighting = assets.lighting || [];
  const outdoorOnly = [...cameras, ...lighting].filter(a =>
    Array.isArray(a.setting) && a.setting.length > 0
    && !a.setting.includes('any')
    && !a.setting.includes('interior')
  );
  assert.ok(outdoorOnly.length > 0, '没有任何室外专用资产，判据失效');

  // 39 个机位必须全部标注 —— 未标注会走「不限」分支，等于绕过互斥规则
  const unlabeled = cameras.filter(c => !Array.isArray(c.setting) || c.setting.length === 0);
  assert.equal(unlabeled.length, 0,
    `${unlabeled.length} 个机位没有 setting 标注，室内场景会拿到它们：${unlabeled.map(c => c.id).join(',')}`);
});

/* ───────────────── B. 调色与光照的光质必须一致 ───────────────── */

test('6.7.5 · 调色的光质不得与灯光打架（硬光不得配阴天冷调）', () => {
  /**
   * `tod` 只有 day/night/dawn/dusk，正午与阴天同属 day —— 所以必须看 `sky`。
   * 修前：库尔斯克开场镜 `hard clear midday sunlight, no cloud cover`
   *       配 `cool overcast, muted palette, soft contrast`。
   */
  const bad = [];
  let compared = 0;
  for (const { theme, shot } of ALL) {
    const lgt = registry.byId.get(shot.lighting);
    const grade = registry.byId.get(shot.colorGrade);
    if (!lgt || !grade) continue;
    const ls = (lgt.sky || []).find(x => x !== 'any');
    const gs = (grade.sky || []).find(x => x !== 'any');
    if (!ls || !gs) continue;         // 有一方不挑光质就不可能冲突
    compared++;
    if (ls !== gs) {
      bad.push(`${theme} / ${shot.fn}：灯「${lgt.nameZh}」(${ls}) 配调色「${grade.nameZh}」(${gs})`);
    }
  }
  assert.ok(compared > 0, '没有任何镜头同时标注了灯光与调色的光质，判据失效');
  assert.equal(bad.length, 0,
    `${compared} 镜有明确光质标注，其中 ${bad.length} 镜冲突：\n  ${bad.join('\n  ')}`);
});

test('6.7.5 · sky 判定不得被 terrain 之类的子串骗到', () => {
  // 每一个环境资产的第一行都是 `... terrain, buildings and props ...`，
  // 裸 `rain` 会命中 `terrain`，于是 26 个题材全部被判成阴天。
  // 这个断言锁住「库尔斯克草原必须是硬光晴天」这个具体事实。
  const r = planFilm({ theme: '库尔斯克坦克对决', requestedShots: 12, profileId: PROFILE }, registry);
  const lgt = registry.byId.get(r.plan.shots[0].lighting);
  assert.ok(lgt, '库尔斯克没有选到灯光');
  assert.deepEqual(lgt.sky, ['sunny'],
    `库尔斯克草原是夏季硬光白昼，灯光「${lgt.nameZh}」的 sky 却是 ${JSON.stringify(lgt.sky)}`);
});

/* ───────────────── C. 首帧姿势必须配得上正文 ───────────────── */

test('6.7.5 · 首帧姿势不得与正文矛盾（无武器语义的镜头不得写 weapon up）', () => {
  /**
   * 首帧是 image-to-video 的输入，姿势错了整镜都会带着这个错姿势走完。
   * 修前：312 张首帧里 196 张写 `weapon up`，其中 151 张正文毫无武器语义。
   *
   * **6.7.6：判据换成语义独立的**，不再复用源码的正则。
   * 旧判据 `/枪|射击|开火|举枪|端枪|瞄准|弹匣|炮|.../` 会把「炮塔」判成持械
   * （第一版就是这样漏掉 38 镜的）；换成贴脸的短词也照样翻车 ——
   * 「第一架**起飞**」跨词命中 `架起`：一架飞机起飞，人却被画成举枪站立
   * （6.7.6 自引入缺陷，由本测试抓出）。
   * 所以正判据必须是「动词 + 手持物」的完整说法，而不是任何武器字。
   */
  const HELD = /举枪|端枪|持枪|握枪|扛着枪|肩上.{0,2}枪|肩扛|瞄准|开火|射击|扫射|对射|换弹匣|换弹|压紧弹匣|顶上弹匣|推弹上膛|扣动|扣扳机|抵肩|火箭筒|反坦克.{0,3}筒|手雷|榴弹|掷弹|匕首|刺刀|举起.{0,3}枪|架起.{0,6}(枪|炮|筒|武器)|端起.{0,6}(枪|炮|筒)|扛起.{0,6}(枪|炮|筒)|操起.{0,6}(枪|炮|筒)|步枪在手|机枪在手|手枪在手|冲锋枪在手|武器对准|武器上肩/;
  /** 反向陷阱：含武器字，但说的**不是此人手里的东西**。命中陷阱又无持械说法 → 判失败。 */
  const TRAPS = [
    ['炮塔', '坦克炮塔是物件，不是手里的武器'],
    ['装甲集群', '装甲集群是敌军编队'],
    ['炮兵阵地', '炮兵阵地是别人的阵地'],
    ['机枪巢', '机枪巢是工事'],
    ['舰炮', '舰炮是舰上装备'],
    ['第一架起飞', '「第一架」是飞机量词 —— 曾经跨词命中「架起」'],
    ['第二架起飞', '同上']
  ];
  const linkAlt = Object.values(LINK_BY_PREV).filter(Boolean)
    .map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const bad = [];
  let armed = 0, trapped = 0;
  for (const { theme, shot, still } of ALL) {
    if (!/weapon up/.test(still)) continue;
    armed++;
    // 只看画面动作：台词是说出来的；连接词是上一镜的遗留
    const visual = String(shot.action || '')
      .replace(/「[^」]*」/g, '')
      .replace(linkAlt ? new RegExp(`^(?:${linkAlt})`) : /$^/, '');
    const trap = TRAPS.find(([w]) => visual.includes(w));
    if (trap && !HELD.test(visual)) {
      bad.push(`${theme} / ${shot.fn}：命中陷阱「${trap[0]}」（${trap[1]}）→ ${shot.action}`);
      continue;
    }
    if (!HELD.test(visual)) bad.push(`${theme} / ${shot.fn}：正文没有持械说法 → ${shot.action}`);
    else if (trap) trapped++;
  }
  assert.equal(bad.length, 0,
    `${armed} 镜写了 weapon up，其中 ${bad.length} 镜与正文矛盾：\n  ${bad.join('\n  ')}`);

  /**
   * **判据金丝雀：不能用语料校准。**
   * 原断言是 `armed > 0` —— 它拿 6.7.5 时代的 38 个假阳性当基线，
   * 修好之后全线归零，金丝雀反而误报「判据失效」。
   * 而真正需要防的是「正则退化成永不命中」——那同样会得到 0。
   * 所以金丝雀改成**正样例夹具**：明确持械的正文必须判出 weapon up，
   * 含武器字的物件、以及飞机量词，必须判不出。
   * 196 个 hero 镜的实测持械命中为 0，这是正确结果（hero 镜多为非战斗节拍）。
   */
  const frame = (action) => compileKeyframeImage({
    focus: 'hero', shotType: '测试特写 (Test Close-Up)', action,
    subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401',
    lighting: 'LGT-001', colorGrade: 'CLR-001', screenDirection: 'left-to-right', aspectRatio: '9:16'
  }, registry).prompt || '';
  for (const armed of ['士兵举枪瞄准对面的火力点', '他把弹匣压紧，继续射击', '射手肩扛火箭筒对准掩体']) {
    assert.match(frame(armed), /weapon up/, `正样例应判持械：${armed}`);
  }
  for (const notArmed of [
    '【DELTA】沃尔科夫在炮塔上摊开地图',
    '第一架无人机滑出跑道，准备起飞',
    '装甲集群从山脊后面压过来',
    '远处的炮兵阵地开始炮击'
  ]) {
    assert.doesNotMatch(frame(notArmed), /weapon up/, `陷阱样例不得判持械：${notArmed}`);
  }
});

test('6.7.5 · 首帧的 Action context 必须是本镜动作，不能是上一镜的连接词', () => {
  /**
   * `LINK_BY_PREV` 的连接词被前置到本镜正文开头，而首帧取的是第一个分句 ——
   * 于是首帧描述的是上一镜的画面（实测第 5 镜首帧写成「手按住地图」）。
   */
  const links = Object.values(LINK_BY_PREV).filter(Boolean);
  assert.ok(links.length > 0, '连接词表是空的，判据失效');

  const bad = [];
  let checked = 0;
  for (const { theme, shot, still } of ALL) {
    const m = still.match(/Action context \(Chinese\):\s*(.*)/);
    if (!m) continue;
    const ctx = m[1].trim();
    if (!ctx) continue;
    checked++;
    // 画面提示里若整个就是连接词，或以其开头，说明剥链失败
    for (const l of links) {
      if (ctx === l.replace(/，\s*$/, '') || ctx.startsWith(l)) {
        bad.push(`${theme} / ${shot.fn}：首帧画面提示是「${ctx}」（连接词）`);
        break;
      }
    }
  }
  assert.ok(checked > 0, '没有首帧带 Action context，判据失效');
  assert.equal(bad.length, 0,
    `${checked} 张首帧里 ${bad.length} 张的 Action context 是连接词：\n  ${bad.join('\n  ')}`);
});

/* ───────────────── D. 6.7.6「字段投递」：设计好的景别必须到得了 Veo ───────────────── */

test('6.7.6 · 每一镜都必须发射景别，且机位自身的景别不得与它矛盾', () => {
  /**
   * `compiler.js` 对 `shotType` 的引用数曾经是 **0** —— 分镜设计好的景别
   * （特写 / 中景 / 大远景）只进了首帧图，从未进视频 prompt。
   * 实测 66% 镜头把画面构图完全交给 Veo 决定。
   *
   * 而光加一行景别会制造新的矛盾：机位资产自身的描述也带构图
   * （`tight insert close-up on hands` / `high aerial of a naval task force`），
   * 74 镜两侧都可判定的镜头里 46 镜（62%）互斥。
   * 所以这条断言**双向**：既要有景别，又不能和机位自带景别打架。
   *
   * 判定刻意不用「镜头焦距词」——`wide 28mm lens` 说的是焦距不是景别，
   * 第一版把它算成景别档，得出 33 镜冲突的虚高数字。
   */
  const INSTR = { ews: 'extreme wide', ws: 'wide shot', fs: 'full shot', ms: 'medium shot', cu: 'close-up' };
  const missing = [], wrong = [], conflict = [];
  for (const { theme, shot, video } of ALL) {
    const want = sizeForShot(shot.shotType, shot.fn);
    if (!want) continue;
    const f = line(video, 'Shot framing');
    if (!f) { missing.push(`${theme} / ${shot.fn}: ${shot.shotType}`); continue; }
    if (!f.includes(INSTR[want])) wrong.push(`${theme} / ${shot.fn}：发射「${f}」但应是 ${want}`);
    const cs = cameraSizeOf(registry.byId.get(shot.camera));
    if (cs && cs !== want) conflict.push(`${theme} / ${shot.fn}：景别 ${want} vs 机位 ${shot.camera} 自带 ${cs}`);
  }
  assert.equal(missing.length, 0, `${missing.length} 镜没有发射景别：\n  ${missing.slice(0, 8).join('\n  ')}`);
  assert.equal(wrong.length, 0, `${wrong.length} 镜发射的景别与设计不符：\n  ${wrong.slice(0, 8).join('\n  ')}`);
  assert.equal(conflict.length, 0, `${conflict.length} 镜的机位景别与设计景别矛盾：\n  ${conflict.slice(0, 8).join('\n  ')}`);
});

test('6.7.6 · 内部【…】标记不得进 Action / Radio 行，但 Subject(s) 仍须带代号', () => {
  /**
   * `【DELTA】` / `【无线电】` 是名册标签。出现在交付给 Veo 的 Action 与 Radio 行里，
   * 视频模型可能把它渲染成屏幕文字 —— 而 negative prompt 恰恰写着
   * `no on-screen text, no subtitles`，自己跟自己矛盾（实测 592 处）。
   *
   * 但代号**必须还在**：它由 `Subject(s)` / `Cast` 两行承载，那是角色一致性的锚点。
   * 所以这条断言是「一边必须留、一边必须净」。
   */
  const leaked = [], lostCall = [];
  for (const { theme, shot, video } of ALL) {
    if (/【/.test(line(video, 'Action'))) leaked.push(`${theme} / ${shot.fn}: Action 行`);
    if (/【/.test(line(video, 'Radio dialogue'))) leaked.push(`${theme} / ${shot.fn}: Radio 行`);
    if (!/【[A-Z][A-Z0-9-]*】/.test(video)) lostCall.push(`${theme} / ${shot.fn}: 全 prompt 找不到代号`);
  }
  assert.equal(leaked.length, 0, `内部标记泄漏：\n  ${[...new Set(leaked)].slice(0, 8).join('\n  ')}`);
  assert.equal(lostCall.length, 0, `代号丢失：\n  ${lostCall.slice(0, 8).join('\n  ')}`);
});

test('6.7.6 · 首帧 Action context 不得以悬空标点收尾', () => {
  /**
   * 「在炮塔上摊开地图：」被拼成 `. ` 之后变成「在炮塔上摊开地图：.」——
   * 一个冒号紧跟句号，读起来是半句话。
   * 旧探针用 `[：:，,]$` 抓不到，因为它的正则只看行尾，而这里整段是单行
   * （各部分以 `. ` 连接），冒号后面还有内容。
   */
  const bad = [];
  let checked = 0;
  for (const { theme, shot, still } of ALL) {
    const m = String(still).match(/Action context \(Chinese\):\s*([^.]+)\./);
    if (!m) continue;
    checked++;
    if (/[：:，,。；;]\s*$/.test(m[1].trim())) bad.push(`${theme} / ${shot.fn}：${m[1]}`);
  }
  assert.ok(checked > 0, '没有首帧带 Action context，判据失效');
  assert.equal(bad.length, 0, `${bad.length} 张首帧的画面提示是半句话：\n  ${bad.slice(0, 8).join('\n  ')}`);
});
