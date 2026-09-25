/**
 * LEGO War Universe - 全阵营角色双排定妆大合照与脚底代号名牌引擎
 * 规范：
 * 1. 严格分为两排：前排（正义主角特战小队）与后排（反派敌对武装势力）
 * 2. 每个角色正下方均有清晰的激光印刷代号名牌 (Printed Nameplate Label)
 * 3. 方便用户直接在后续具体视频生成时，通过代号精准调用对应角色的参考特征
 */

/**
 * 经典题材正反双阵营全员角色预置库
 */
const FACTION_PRESETS = {
  modern: {
    protagonists: [
      { callsign: 'GHOST', name: '幽灵队长', role: '特战小队指挥官', outfit: '炭黑战术背心，战术四目夜视仪，战术电台挂件' },
      { callsign: 'FALCON', name: '猎鹰狙击手', role: '远程精确射手', outfit: '双面伪装吉利作战服，消音重型狙击枪，微光夜视目镜' },
      { callsign: 'HAMMER', name: '铁锤突击手', role: '防暴破门破障手', outfit: '重型防弹胸甲，战术防暴盾牌，突击霰弹枪' },
      { callsign: 'MEDIC', name: '战地天使', role: '战术救援军医', outfit: '带有红十字臂章的战术医疗背心，轻便战术头盔，急救包' }
    ],
    antagonists: [
      { callsign: 'WARLORD', name: '军阀首领', role: '武装势力头目', outfit: '墨绿迷彩贝雷帽，红褐色战术马甲，手持镀金AK突击步枪' },
      { callsign: 'VIPER', name: '毒蛇冷面', role: '雇佣军首席杀手', outfit: '骷髅图案防风面罩，全黑战术皮衣，背部交叉双短刃' },
      { callsign: 'RPG-GUNNER', name: '暴风射手', role: '重火力火箭筒手', outfit: '沙漠数码迷彩服，护目风镜，肩扛墨绿RPG火箭筒' },
      { callsign: 'GRENADIER', name: '铁血机枪手', role: '火力压制狂徒', outfit: '无袖迷彩背心露出塑料强壮手臂，斜跨重型机枪帆布弹链' }
    ]
  },
  wwii: {
    protagonists: [
      { callsign: 'CAPTAIN', name: '米勒上尉', role: '盟军突击连长', outfit: '橄榄绿M41野战夹克，带白色横条的M1钢盔，柯尔特手枪' },
      { callsign: 'SNIPER', name: '杰克逊神枪手', role: '盟军精确狙击手', outfit: '深绿风衣，带麻布缠绕的斯普林菲尔德狙击步枪' },
      { callsign: 'RYAN', name: '莱恩伞兵', role: '101空降师步枪兵', outfit: '伞兵战术服，网眼M1钢盔，加兰德M1步枪' },
      { callsign: 'GUNNER', name: '重火力机枪手', role: 'BAR轻机枪手', outfit: '弹药携行带，厚实防尘手套，手持勃朗宁自动步枪' }
    ],
    antagonists: [
      { callsign: 'COMMANDER', name: '敌军要塞指挥官', role: '要塞守备长官', outfit: '铁灰军官大衣，银色胸章大檐帽，瓦尔特P38手枪' },
      { callsign: 'MG42-GUNNER', name: '暗堡撕布机手', role: '重机枪主射手', outfit: '双色迷彩罩衫，沉重防破片风镜，MG42弹鼓' },
      { callsign: 'PANZER-CREW', name: '装甲突击队长', role: '虎式坦克车长', outfit: '全黑双排扣装甲作战服，头戴铁灰通信耳机' },
      { callsign: 'GRENADIER', name: '掷弹突击兵', role: '堑壕伏击手', outfit: '铁灰色野战军服，腰间插着木柄手榴弹，毛瑟98k步枪' }
    ]
  },
  orbital: {
    protagonists: [
      { callsign: 'COMMANDER', name: '领航者队长', role: '轨道空降指挥官', outfit: '深空黑抗辐射气密舱外服，金色抗光微缩面罩，姿态喷气包' },
      { callsign: 'SPECS-EVA', name: '零重力工程师', role: '空间站抢修专家', outfit: '纯白加厚宇航服，胸前高亮反光条，多功能等离子焊枪' },
      { callsign: 'RECON-ACE', name: '轨道穿梭驾驶员', role: '高机动穿梭艇飞行员', outfit: '轻量化深蓝飞行气密服，微型HUD抬头显示头盔' },
      { callsign: 'EXO-GUARD', name: '太空防暴重装兵', role: '轨道站安保先锋', outfit: '外挂钛合金加固外骨骼支架，磁吸靴，重型电磁步枪' }
    ],
    antagonists: [
      { callsign: 'PIRATE-LORD', name: '深空劫掠领主', role: '废弃轨道海盗头目', outfit: '改装修补的生锈机械义肢宇航服，骷髅涂装太空头盔' },
      { callsign: 'CYBER-HACKER', name: '幽灵潜入骇客', role: '轨道中继站劫持者', outfit: '哑光暗红气密服，面部集成大量发光传感器与微电缆' },
      { callsign: 'SHADOW-GUNNER', name: '轨道突击死士', role: '无重力破门突击手', outfit: '全黑吸波隐形太空服，手持无反冲力定向能量爆破枪' },
      { callsign: 'CORSAIR', name: '深空爆破手', role: '空间站外壁破坏者', outfit: '橙灰警戒色工程服，背负大容量高压切割气罐' }
    ]
  }
};

/**
 * 提取并构建正反两派全员角色名单（支持前排与后排划分）
 */
export function extractDualFactionLineup(filmQuery = '', era = 'Modern') {
  let presetKey = 'modern';
  const q = String(filmQuery || '').toLowerCase();
  const e = String(era || '').toLowerCase();

  if (/太空|空间站|星际|流浪|宇宙|gravity|space|orbital/i.test(q) || e.includes('orbital')) {
    presetKey = 'orbital';
  } else if (/二战|诺曼底|海滩|瑞恩|敦刻尔克|wwii|dunkirk/i.test(q) || e.includes('wwii')) {
    presetKey = 'wwii';
  }

  const selected = FACTION_PRESETS[presetKey] || FACTION_PRESETS.modern;

  // 深拷贝并注入名牌标识
  const frontRow = selected.protagonists.map(c => ({
    ...c,
    row: 'Front Row (前排 · 正派特战小队)',
    faction: 'protagonist',
    nameplate: `[${c.callsign}]`
  }));

  const backRow = selected.antagonists.map(c => ({
    ...c,
    row: 'Back Row (后排 · 反派敌对武装)',
    faction: 'antagonist',
    nameplate: `[${c.callsign}]`
  }));

  return {
    era: presetKey,
    frontRow,
    backRow,
    allCharacters: [...frontRow, ...backRow]
  };
}

/**
 * 组装正反两排全员合影生图 Prompt（包含脚底印刷代号名牌）
 */
export function generateLineupPrompt(lineupData, filmTheme = '', aspectRatio = '16:9') {
  const frontRow = lineupData.frontRow || [];
  const backRow = lineupData.backRow || [];
  const totalCount = frontRow.length + backRow.length;

  // 前排描述（正派特战小队）
  const frontDescriptions = frontRow.map((c, i) => {
    return `Front Row #${i + 1} (${c.name}): stands on the ground level, wearing ${c.outfit}, authentic LEGO minifigure. DIRECTLY BENEATH THIS MINIFIGURE, there is a prominent black display stand angled nameplate with laser-engraved bold white text: "${c.nameplate}".`;
  }).join(' ');

  // 后排描述（反派敌对势力）
  const backDescriptions = backRow.map((c, i) => {
    return `Back Row #${i + 1} (${c.name}): stands on an elevated tier riser directly behind, wearing ${c.outfit}, authentic LEGO minifigure with hostile battle-ready expression. DIRECTLY BENEATH THIS MINIFIGURE, there is an elevated black display stand nameplate with laser-engraved bold white text: "${c.nameplate}".`;
  }).join(' ');

  // Midjourney / FLUX 格式英文提示词
  const promptEn = [
    `A professional studio character lineup portrait of ${totalCount} LEGO minifigures arranged in EXACTLY TWO CLEAR TIERS / ROWS for video character reference sheet.`,
    `FRONT ROW (Protagonists Special Forces): ${frontDescriptions}`,
    `ELEVATED BACK ROW (Antagonists Hostile Force standing on a higher step behind): ${backDescriptions}`,
    `CRUCIAL FEATURE: Underneath every single minifigure, there is an individual black LEGO display brick stand with a crisp, high-contrast white printed NAMEPLATE LABEL clearly displaying their call sign nameplate (e.g. [GHOST], [FALCON], [WARLORD], [VIPER]).`,
    `Studio lighting, clean solid neutral grey seamless background, sharp crisp shadows beneath feet, 35mm tilt-shift macro lens photography, sharp focus on all characters, authentic glossy ABS plastic injection texture with visible micro molding lines and studs, masterpiece, photorealistic toy photography, 8k, --ar ${aspectRatio}`
  ].join(' ');

  // 中文对照说明
  const promptZh = [
    `【全阵营双排定妆大合照参考图 · 带脚底代号名牌】`,
    `整张图片严格分为前后两排，所有角色脚底底座上均有清晰白字印刷的代号名牌：`,
    `🔵 前排（正派特遣队）：` + frontRow.map(c => `${c.nameplate} ${c.name} (${c.role})`).join(' | '),
    `🔴 后排（反派敌对势力）：` + backRow.map(c => `${c.nameplate} ${c.name} (${c.role})`).join(' | '),
    `摄影棚中性灰背景，35mm 移轴微距棚拍，真实 ABS 塑料质感。生成该图后，可直接在视频制作时通过脚底代号（如 [GHOST]、[WARLORD]）精准调用指定角色图！`
  ].join('\n');

  return {
    totalCount,
    frontRow,
    backRow,
    promptEn,
    promptZh,
    aspectRatio
  };
}

/**
 * 兼容旧接口（无缝桥接）
 */
export function extractCharacterLineup(shots = [], registry = null) {
  const dual = extractDualFactionLineup('', 'Modern');
  return dual.allCharacters;
}
