import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { planFilm } from '../src/domain/planner.js';
import { compileShot } from '../src/domain/compiler.js';
import { validateFilmPlan } from '../src/domain/shot-spec.js';
import { checkContentGovernance } from '../src/domain/governance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 25 个跨时代主题（WWII, Pacific, Cold War, Gulf War, Iraq War, Modern 涵盖陆海空、雪山、夜战、CQB、搜救）
const themes = [
  '二战诺曼底海滩登陆',
  '太平洋舰队在中途岛空战',
  '冷战富尔达缺口坦克对峙',
  '海湾战争沙漠风暴M1A1坦克突击',
  '伊拉克战争城市巷战',
  '现代特种部队夜间突袭',
  '航母战斗群在远海风暴中放飞舰载机',
  '搜救直升机在雪山峡谷营救落难飞行员',
  '现代城市CQB近距离突入清剿',
  '特种部队在丛林中渗透侦察',
  '二战斯大林格勒废墟狙击战',
  '二战大西洋反潜护航战',
  '冷战装甲集群野战快速推进',
  '现代无人机前沿空中引导与侦察',
  '索马里海域快艇突击解救商船',
  '现代高空伞降突入敌后集结',
  '二战北非沙漠装甲追击',
  '现代特战队员执行战地紧急医疗救援',
  '海湾战争夜战防空导弹阵地伏击',
  '现代边境山地巡逻遭遇战',
  '二战美军步兵协同谢尔曼坦克突破防线',
  '太平洋热带岛屿滩头两栖登陆作战',
  '现代潜水蛙人秘密水下潜入渗透',
  '现代重装机械化步兵班城市外围清剿',
  '极地严寒环境下特种侦察分队行动'
];

async function run() {
  const registry = createRegistry(assets, profiles, { references: [] });
  const profileId = 'veo-3.1-lite';
  const profile = registry.profileById.get(profileId);

  const isVerify = process.argv.includes('--verify');
  const results = {};
  let totalConsistency = 0;
  let totalCutability = 0;
  let totalCompliance = 0;
  let totalRegenRate = 0;

  console.log(`\n=== 开始执行 25 个跨时代 Flow 盲测样片生成与评分 ===\n`);

  for (const theme of themes) {
    try {
      const gov = checkContentGovernance(theme);
      const { intent, plan, warnings } = planFilm({ theme, requestedShots: 4, profileId }, registry);
      const shots = plan.shots || [];

      // 1. Consistency（连续性与参考帧锚点）
      let anchorsFound = 0;
      for (const shot of shots) {
        const compiled = compileShot(shot, registry, profile);
        if (
          compiled.prompt.includes('Screen direction:') &&
          compiled.prompt.includes('Subject state:')
        ) {
          anchorsFound++;
        }
      }
      const consistency = shots.length > 0 ? anchorsFound / shots.length : 0;

      // 2. Cutability（四阶段叙事覆盖：establish, build, climax, resolve）
      const phases = shots.map(s => s.phase);
      const requiredPhases = ['establish', 'build', 'climax', 'resolve'];
      const covered = requiredPhases.filter(p => phases.includes(p)).length;
      const cutability = covered / requiredPhases.length;

      // 3. Compliance（ShotSpec 与物理/阵营/连续性规则合规）
      const vResult = validateFilmPlan(plan, registry);
      const compliance = vResult.ok ? 1.0 : Math.max(0, 1.0 - vResult.violations.length * 0.2);

      // 4. RegenRate / Stability（无警告即 1.0，每次 warning 扣减）
      const regenRate = warnings.length === 0 ? 1.0 : Math.max(0.2, 1.0 - warnings.length * 0.25);

      results[theme] = {
        Consistency: Number(consistency.toFixed(2)),
        Cutability: Number(cutability.toFixed(2)),
        Compliance: Number(compliance.toFixed(2)),
        RegenRate: Number(regenRate.toFixed(2)),
        era: intent.era,
        safetyStatus: gov.status
      };

      totalConsistency += consistency;
      totalCutability += cutability;
      totalCompliance += compliance;
      totalRegenRate += regenRate;

      console.log(`[${intent.era || 'Unknown'}] ${theme} -> C:${consistency.toFixed(2)} | Cut:${cutability.toFixed(2)} | Comp:${compliance.toFixed(2)} | Regen:${regenRate.toFixed(2)}`);
    } catch (err) {
      console.error(`题材 [${theme}] 处理失败:`, err.message);
      results[theme] = { Consistency: 0, Cutability: 0, Compliance: 0, RegenRate: 0, error: err.message };
    }
  }

  const n = themes.length;
  const avg = {
    Consistency: Number((totalConsistency / n).toFixed(2)),
    Cutability: Number((totalCutability / n).toFixed(2)),
    Compliance: Number((totalCompliance / n).toFixed(2)),
    RegenRate: Number((totalRegenRate / n).toFixed(2))
  };

  console.log('\n=== 跨时代 Flow 盲测基线汇总平均分 ===');
  console.log(`一致性 (Consistency): ${(avg.Consistency * 100).toFixed(1)}%`);
  console.log(`可剪辑性 (Cutability): ${(avg.Cutability * 100).toFixed(1)}%`);
  console.log(`规则合规性 (Compliance): ${(avg.Compliance * 100).toFixed(1)}%`);
  console.log(`稳定性/重生成率 (RegenRate): ${(avg.RegenRate * 100).toFixed(1)}%\n`);

  const outputData = {
    project: 'LEGO War Universe',
    testedThemesCount: n,
    generatedAt: new Date().toISOString(),
    average: avg,
    results
  };

  const baselinePath = path.join(__dirname, '../tests/flow-benchmark-baseline.json');

  if (isVerify) {
    try {
      const baselineData = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
      const oldAvg = baselineData.average;
      console.log('--- 验证 Baseline 门禁 ---');
      let failed = false;
      for (const key of ['Consistency', 'Cutability', 'Compliance', 'RegenRate']) {
        if (avg[key] < oldAvg[key] - 0.05) {
          console.error(`门禁失败: ${key} 得分 (${avg[key]}) 严重低于 Baseline (${oldAvg[key]})`);
          failed = true;
        }
      }
      if (failed) {
        process.exit(1);
      }
      console.log('✓ Flow 盲测 Baseline 门禁验证通过！\n');
    } catch (e) {
      console.log('未发现 baseline 文件，写入最新 baseline。');
      await fs.writeFile(baselinePath, JSON.stringify(outputData, null, 2), 'utf8');
    }
  } else {
    await fs.writeFile(baselinePath, JSON.stringify(outputData, null, 2), 'utf8');
    console.log(`已更新 Baseline 基准文件: ${baselinePath}`);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
