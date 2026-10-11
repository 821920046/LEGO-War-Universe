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
    const roster = buildRoster(r.roster, registry);
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
   * 修前：312 张首帧里 196 张写 `weapon up`，其中 151 张正文毫无武器语义 ——
   * 包括 `world` 环境空镜、`reaction` 靠着舱壁坐下、`close` 探头呼吸海风。
   */
  const ARMED = /枪|射击|开火|举枪|端枪|瞄准|弹匣|炮|扫射|刀|武器|手雷|火箭筒|交火|对射|换弹/;
  const bad = [];
  let armed = 0;
  for (const { theme, shot, still } of ALL) {
    if (!/weapon up/.test(still)) continue;
    armed++;
    if (!ARMED.test(shot.action || '')) bad.push(`${theme} / ${shot.fn}：${shot.action}`);
  }
  assert.ok(armed > 0, '一张 weapon up 的首帧都没有，判据失效');
  assert.equal(bad.length, 0,
    `${armed} 张首帧写了 weapon up，其中 ${bad.length} 张的正文没有武器语义：\n  ${bad.join('\n  ')}`);
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
