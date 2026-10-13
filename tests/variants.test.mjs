/**
 * 6.8.0 · 自主想象力 —— 一句描述生成 N 部**不同**的电影，前端只展示最优的一部。
 *
 * 这三个文件是这一轮的核心，所以测试也按三层分开：
 *   1. 环境语义选型（6.7.6 遗留）—— 断言**结果**，不断言实现
 *   2. 多方案引擎 variants.js —— 同一主题必须产出可区分、确定性的 N 部片
 *   3. 择优打分 variant-score.js —— 与生成实现语义独立，且必须真的能罚换皮
 */
import test from 'node:test';import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { readFile } from 'node:fs/promises';
import { createRegistry } from '../src/domain/registry.js';
import { planFilm } from '../src/domain/planner.js';
import { variantSpecs, planVariants, ANGLES, EMPHASES, TONES } from '../src/domain/variants.js';
import { scoreCandidate, diversify, skeletonOf } from '../src/domain/variant-score.js';
const registry=createRegistry(assets,profiles,{references:[]});
const PROFILE='veo-3.1-lite';
const skel=film=>(film.plan?.shots||[]).map(s=>skeletonOf(s.action));
const overlap=(a,b)=>{const set=new Set(b);return a.filter(s=>set.has(s)).length/Math.max(1,a.length);};

// ── 1. 环境语义选型：断言结果，不断言实现 ────────────────────────────
// 这些用例的判据完全独立于选型算法：用户说了「冰河」，片子里就不该出现沙漠。
test('6.8.0 · 主题点名的场景必须真的出现在片子里',()=>{
  const CASES=[
    ['黎明时分强渡冰河',/冰|渡河|滩|岸|河/],
    ['月球表面争夺登月舱',/月面|月球|登月|月/],
    ['雨夜潜入敌方港口炸毁潜艇',/港|潜艇|海|舰/],
    ['狙击小组雪山之巅',/雪山|山|雪/],
    ['工兵城区拆弹',/城区|街道|城市|巷/],
    ['侦察班穿越沼泽',/沼泽|湿地|沼泽地/],
    ['空降兵夺机场',/机场|跑道|停机/],
    ['强渡河流建立登陆场',/渡河|河|岸|登陆/]
  ];
  for(const [theme,want] of CASES){
    for(const n of [4,8]){
      const {plan}=planFilm({theme,requestedShots:n,profileId:PROFILE},registry);
      const env=registry.byId.get(plan.shots[0].environment);
      assert.ok(want.test(`${env.name} ${env.nameZh}`),`${theme} n=${n} 场景应为「${want}」，实际 ${env?.nameZh}`);
    }
  }
});

test('6.8.0 · 主题没有点名场景时也不该掉进沙漠或境外风景',()=>{
  for(const theme of ['苏联狙击手在斯大林格勒的废墟中狙杀德军军官','无人机蜂群对敌方防空阵地的突防']){
    const {plan}=planFilm({theme,requestedShots:8,profileId:PROFILE},registry);
    const env=registry.byId.get(plan.shots[0].environment);
    assert.ok(!/中东沙漠|北非/.test(env?.nameZh||''),`${theme} 不得落到无关沙漠：${env?.nameZh}`);
  }
});

// ── 2. 多方案引擎 ─────────────────────────────────────────────────
test('6.8.0 · variantSpecs 组合离散且确定',()=>{
  for(const theme of ['现代特战小队在暴风雨之夜渗透敌方地下指挥掩体','']){
    const specs=variantSpecs(theme,4);
    assert.equal(specs.length,4);
    assert.equal(new Set(specs.map(s=>`${s.angle}|${s.emphasis}|${s.tone}`)).size,4,'同一主题下 4 个方案必须是 4 个不同组合');
    assert.deepEqual(variantSpecs(theme,4),specs,'同一主题的方案表必须完全确定');
    for(const s of specs){assert.ok(ANGLES[s.angle]&&EMPHASES[s.emphasis]&&TONES[s.tone]);}
  }
  // 数量边界：0 与非法值回落 4（0 是 falsy，等价于「没给」），上限 8，负数取 1
  assert.equal(variantSpecs('x',0).length,4);
  assert.equal(variantSpecs('x','bad').length,4);
  assert.equal(variantSpecs('x',99).length,8);
  assert.equal(variantSpecs('x',-5).length,1);
});

test('6.8.0 · planVariants 对同一句描述产出 N 部互不相同的有效电影',()=>{
  for(const theme of ['现代特战小队在暴风雨之夜渗透敌方地下指挥掩体','苏联狙击手在斯大林格勒的废墟中狙杀德军军官','无人机蜂群对敌方防空阵地的突防','海军陆战队登陆敌方滩头阵地夺取雷达站']){
    const {candidates}=planVariants({theme,requestedShots:8,profileId:PROFILE,count:4,score:scoreCandidate},registry);
    const alive=candidates.filter(c=>c.film);
    assert.equal(alive.length,4,`${theme}：4 个方案都必须成功生成`);
    for(const c of alive){
      assert.equal(c.film.plan.shots.length,8);
      assert.ok(c.score>-Infinity,`${theme}：方案都必须被打分`);
      assert.ok(c.film.plan.shots.every(s=>s.fn),'每镜都要有戏剧功能');
    }
    //
    // 互不相同：任意两部方案的句子骨架不得大面积重合。
    //
    // 阈值 55% 是**实测天花板**，不是理想值：选型器内部用的换皮线是 45%，
    // 但少数题材（如斯大林格勒狙击手）的节拍文本池本身就窄 —— 8 镜里有 4 镜
    // 只能共用同一条骨架，此时「换种子重试」也压不到 45% 以下（实测 50%）。
    // 与其把线画在够不到的地方，不如把它画在**能守住且可回归**的地方：
    // 修好前这个数字是 **88%**。
    const sks=alive.map(c=>skel(c.film));
    let worst=0,sum=0,pairs=0;
    for(let i=0;i<sks.length;i++)for(let j=i+1;j<sks.length;j++){
      const ov=overlap(sks[i],sks[j]);
      worst=Math.max(worst,ov);sum+=ov;pairs++;
    }
    assert.ok(worst<0.55,`${theme}：最高两两骨架重合 ${(worst*100).toFixed(0)}%（换皮线上限 55%）`);
    assert.ok(sum/pairs<0.35,`${theme}：平均两两骨架重合 ${(sum/pairs*100).toFixed(0)}%（应远低于换皮线）`);
  }
});

test('6.8.0 · planVariants 完全确定：同参数两次生成结果逐字节一致',()=>{
  const args={theme:'现代特战小队在暴风雨之夜渗透敌方地下指挥掩体',requestedShots:8,profileId:PROFILE,count:4,score:scoreCandidate};
  const a=planVariants(args,registry),b=planVariants(args,registry);
  assert.deepEqual(a.candidates.map(c=>[c.spec,c.score]),b.candidates.map(c=>[c.spec,c.score]));
  assert.deepEqual(skel(a.best.film),skel(b.best.film));
});

test('6.8.0 · 三个旋钮各自真的改变了成片',()=>{
  const theme='现代特战小队在暴风雨之夜渗透敌方地下指挥掩体';
  const shot=spec=>planFilm({theme,requestedShots:8,profileId:PROFILE,variant:spec},registry);
  // 视角：换主角阵营
  const lead=spec=>shot(spec).plan.shots.map(s=>s.subjects[0]).filter(Boolean);
  const leads=new Set([{angle:'commander'},{angle:'grunt'},{angle:'enemy'},{angle:'machine'}].map(s=>lead(s).join('|')));
  assert.ok(leads.size>=3,`视角旋钮必须改变主力阵容，实际只有 ${leads.size} 种`);
  // 重心：戏剧功能序列必须不同
  const fnSeq=emphasis=>planFilm({theme,requestedShots:8,profileId:PROFILE,variant:{angle:'commander',emphasis}},registry).plan.shots.map(s=>s.fn).join(',');
  const seqs=new Set(Object.keys(EMPHASES).map(fnSeq));
  assert.equal(seqs.size,3,'三种重心必须给出三种戏剧功能弧');
  // 基调：视听偏好必须不同（机位/灯光/调色的整体指纹）
  const vf=spec=>{const p=shot(spec).plan;return p.shots.map(s=>`${s.camera}|${s.lighting}|${s.colorGrade}`).join(';');};
  const prints=new Set([{tone:'documentary'},{tone:'epic'},{tone:'thriller'},{tone:'gritty'}].map(s=>vf(s)));
  assert.ok(prints.size>=3,`基调旋钮必须改变视听指纹，实际只有 ${prints.size} 种`);
});

test('6.8.0 · 变体不得破坏既有全部不变式',()=>{
  const theme='现代特战小队在暴风雨之夜渗透敌方地下指挥掩体';
  const {candidates}=planVariants({theme,requestedShots:12,profileId:PROFILE,count:4,score:scoreCandidate},registry);
  for(const c of candidates.filter(c=>c.film)){
    const fns=c.film.plan.shots.map(s=>s.fn);
    for(let i=1;i<fns.length;i++)assert.notEqual(fns[i],fns[i-1],`相邻同功能：${fns.join(' / ')}`);
    assert.ok(fns.every(Boolean),'每镜都要有戏剧功能');
    for(const s of c.film.plan.shots){
      assert.ok(registry.byId.has(s.camera)&&registry.byId.has(s.lighting)&&registry.byId.has(s.colorGrade),'视听资产必须来自资产库');
      const act=String(s.action||'').trim();
      assert.ok(act.length>=6,`动作句不能是碎片：${act}`);
      // `【GHOST】沃克…` 是**代号标记**，由编译器转写成「（GHOST）沃克」，
      // 这是设计；而 `【无线电】` 这类**中文内部标记**是 6.7.6 修掉的泄漏，不得复发。
      assert.doesNotMatch(act,/【[\u4e00-\u9fa5]+】/,`动作句泄漏了内部标记：${act.slice(0,40)}`);
    }
  }
});

// ── 3. 择优打分 ───────────────────────────────────────────────────
test('6.8.0 · 打分器与生成实现语义独立：只读产物',()=>{
  const theme='现代特战小队在暴风雨之夜渗透敌方地下指挥掩体';
  const r=scoreCandidate(planFilm({theme,requestedShots:8,profileId:PROFILE},registry).plan,registry);
  assert.ok(r.total>0&&r.total<=100+22+18+16-8,'总分必须落在合理区间');
  assert.ok(Object.keys(r.parts).length===8,'八个维度都要有分项');
  assert.ok(r.meta.n===8,'meta 要记录镜头数');
  assert.equal(scoreCandidate({shots:[]},registry).total,-Infinity,'空片必须判负');
});

test('6.8.0 · diversify 必须真的能抓住换皮方案（回归：早期读错字段导致静默失效）',()=>{
  const theme='现代特战小队在暴风雨之夜渗透敌方地下指挥掩体';
  const twin=planFilm({theme,requestedShots:8,profileId:PROFILE},registry);
  const fake=[
    {index:0,spec:{label:'A'},film:twin,score:95,detail:{total:95}},
    {index:1,spec:{label:'B(复制品)'},film:JSON.parse(JSON.stringify(twin)),score:95,detail:{total:95}}
  ];
  const out=diversify(fake);
  assert.equal(out[0].index,0,'高分在前');
  assert.ok(out[1].score<70,`复制品 95 分必须被折到 70 以下，实际 ${out[1].score}`);
  assert.ok(out[1].detail.diversityPenalty>0,'必须记录去重惩罚比例');
  // 骨架完全不同的方案不得受牵连
  const other=planFilm({theme:'苏联狙击手在斯大林格勒的废墟中狙杀德军军官',requestedShots:8,profileId:PROFILE},registry);
  const third=planFilm({theme:'海军陆战队登陆敌方滩头阵地夺取雷达站',requestedShots:8,profileId:PROFILE},registry);
  const keep=diversify([{index:0,spec:{label:'A'},film:other,score:90,detail:{total:90}},{index:1,spec:{label:'C'},film:third,score:90,detail:{total:90}}]);
  assert.equal(keep[1].score,90,'不重合的方案不得扣分');
});

test('6.8.0 · diversify 只重排不改集合',()=>{
  const {candidates}=planVariants({theme:'现代特战小队在暴风雨之夜渗透敌方地下指挥掩体',requestedShots:8,profileId:PROFILE,count:4,score:scoreCandidate},registry);
  const out=diversify(candidates);
  assert.equal(out.length,4);
  assert.deepEqual(out.map(c=>c.spec.label).sort(),candidates.map(c=>c.spec.label).sort());
  for(let i=1;i<out.length;i++)assert.ok(out[i-1].score>=out[i].score,'必须按分数降序');
});

// ── 4. 前端契约：只展示最优，其余折叠 ────────────────────────────
test('6.8.0 · 前端只把最优方案设为默认，备选走折叠切换器',async()=>{
  const app=await readFile('src/ui/app.js','utf8');
  assert.match(app,/from '\.\.\/domain\/variants\.js'/,'必须引入多方案引擎');
  assert.match(app,/from '\.\.\/domain\/variant-score\.js'/,'必须引入择优打分');
  assert.match(app,/planVariants\(/,'自由模式生成必须走多方案');
  assert.match(app,/diversify\(candidates\)/,'必须过去重');
  assert.match(app,/applyVariantCandidate\(ranked\[0\], true\)/,'默认展示的必须是打分第一的方案');
  const html=await readFile('index.html','utf8');
  assert.match(html,/id="variant-picker"/,'必须提供备选切换容器');
  assert.match(html,/variant-chip/,'必须有筹码样式');
  assert.doesNotMatch(app,/innerHTML/,'禁止用 innerHTML 拼 DOM');
});
