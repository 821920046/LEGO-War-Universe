import { parseIntent } from './intent.js';
import { enforceContinuityChain } from './continuity.js';
import { isEraCompatible } from './shot-spec.js';
import { selectCast, buildRoster, rosterToJSON, aliasLabel } from './roster.js';
import { selectBeats, fillTemplate, seedOf, buildOriginality } from './narrative.js';

/**
 * 依据时代、意图与关键词从注册表中筛选最适资产
 */
const pick = (r, kind, intent, term = '', excludeTerm = '') => {
  const all = r.byKind.get(kind) || [];
  const eraMatches = all.filter(a => a.series === intent.era);
  const pool = eraMatches.length > 0 ? eraMatches : all;

  if (term) {
    const termRegex = new RegExp(term, 'i');
    const matched = pool.find(a => {
      const full = `${a.name} ${a.nameZh || ''} ${a.kw || ''}`;
      if (excludeTerm && new RegExp(excludeTerm, 'i').test(full)) return false;
      return termRegex.test(full);
    });
    if (matched) return matched;
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
export function planFilm({ theme, requestedShots = 4, profileId }, r) {
  const intent = parseIntent(theme);
  const n = Math.max(1, Math.min(150, Number(requestedShots) || 4));
  const profile = r.profileById.get(profileId);
  if (!profile) throw new Error('Unknown profile');

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
  let envTerm = '';
  let envExclude = '';
  if (intent.setting === 'naval') {
    envTerm = 'sea|carrier|ocean|远海|航母';
  } else if (intent.weather === 'snow') {
    envTerm = 'snow|arctic|winter|雪原|雪山';
    envExclude = 'desert|沙丘|沙漠';
  } else if (intent.setting === 'urban') {
    envTerm = 'urban|city|street|城市|巷战';
  }

  const env = pick(r, 'environment', intent, envTerm, envExclude) || pick(r, 'environment', intent);

  // 2. 从真实资产库挑选演员（正反双方），并给出逐镜轮换的摄影机/灯光短名单
  const cast = selectCast(r, { era: intent.era || 'Modern', task: intent.task, theme });

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

  // 3. 选节拍（同一阶段内不重复）
  const seed = seedOf(`${theme}|${n}`);
  const beats = selectBeats({
    n,
    seed,
    hasEnemy: enemies.length > 0,
    hasSupport: heroes.length >= 2,
    hasVehicle: vehicles.length > 0
  });

  // 3a. 第一遍：只确定逐镜「主体组合」。
  // 动作文本里要写角色代号，而代号由「最终上镜的资产集合」决定，
  // 因此必须先定主体、再用 buildRoster 求代号、最后才生成文本。
  const drafts = beats.map((beat, i) => {
    const lead = heroes[i % Math.max(1, heroes.length)];
    const support = heroes[(i + 1) % Math.max(1, heroes.length)];
    const enemy = enemies[i % Math.max(1, enemies.length)];
    const vehicle = vehicles[i % Math.max(1, vehicles.length)];

    let subjects;
    switch (beat.focus) {
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

    return { beat, i, subjects, envName: env?.nameZh || env?.name || '' };
  });

  // 3b. 由最终主体集合求名册（代号与 buildRoster 在 UI 侧完全一致）
  const roster = buildRoster(drafts.map(d => ({ subjects: d.subjects })), r);

  const rawShots = drafts.map(({ beat, i, subjects, envName }) => {
    const entryOf = id => roster.byId.get(id);
    const labelOf = id => aliasLabel(roster, id, entryOf(id)?.name || id);

    // 按 focus 明确区分「谁是主角 / 谁是配角 / 谁是敌人 / 哪个是载具」，
    // 否则敌人会被当成主角写进文本（例如「【我方】压制【我方】」这种低级错误）。
    let heroId = subjects[0];
    let supportId = subjects[1] || subjects[0];
    let enemyId = subjects[1] || subjects[0];
    let vehicleId = subjects[0];
    if (beat.focus === 'enemy') { enemyId = subjects[0]; heroId = subjects[1] || subjects[0]; }
    else if (beat.focus === 'vehicle') { vehicleId = subjects[0]; heroId = subjects[1] || subjects[0]; }
    else if (beat.focus === 'squad') { heroId = subjects[0]; supportId = subjects[1] || subjects[0]; }
    else if (beat.focus === 'clash') { heroId = subjects[0]; enemyId = subjects[1] || subjects[0]; }

    const ctx = {
      heroCallsign: labelOf(heroId),
      supportCallsign: labelOf(supportId),
      enemyCallsign: labelOf(enemyId),
      vehicle: labelOf(vehicleId),
      env: envName,
      weather: intent.weather === 'snow' ? '风雪'
        : intent.weather === 'rain' ? '暴雨'
          : intent.lightingCondition === 'night' ? '夜色' : '尘雾'
    };

    const camera = cameras[i % cameras.length];
    const lighting = lightings[i % lightings.length];

    return {
      phase: beat.phase,
      shotType: beat.shotType,
      beatId: beat.id,
      subjects,
      environment: env?.id,
      camera: camera?.id,
      lighting: lighting?.id,
      colorGrade: color?.id,
      fx: beat.phase === 'climax' && fxPool.length > 0 ? [fxPool[i % fxPool.length].id] : [],
      audio: [],
      action: fillTemplate(beat.action, ctx),
      audioCue: fillTemplate(beat.audioCue || '', ctx),
      radioVoice: fillTemplate(beat.radioVoice || '', ctx)
    };
  });

  // 4. 注入强制连续性链条（角色外观、损伤累积、180度轴线、参考帧）
  const continuousShots = enforceContinuityChain(rawShots);

  // 5. 原创层：与参考影片解耦的立意 / 转折 / 开场钩子
  const originality = buildOriginality({ theme, intent, reference: null, seed });

  const plan = {
    intent,
    profileId,
    shots: continuousShots,
    cast: {
      heroes: heroes.map(a => a.id),
      enemies: enemies.map(a => a.id),
      vehicles: vehicles.map(a => a.id),
      enemyFallback: cast.enemyFallback
    },
    // 名册随计划一起冻结：后续任何环节（自我进化补资产 / UI 重渲染 / 编译 Prompt）
    // 都必须以这份代号为准，绝不能重新分配，否则台词与定妆表会串戏。
    roster: rosterToJSON(roster),
    originality
  };

  return {
    intent,
    plan,
    warnings,
    governance: intent.governance,
    originality,
    roster: plan.roster
  };
}
