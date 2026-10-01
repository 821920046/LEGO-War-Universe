/**
 * LEGO War Universe - 全片全阵营角色定妆表引擎 v4.3 (Character Lineup Engine)
 * 功能：
 * 1. 按时代/体裁自动生成正反两大阵营完整角色名册（每阵营 4-6 人）
 * 2. 每个角色附带唯一代号名牌 (callsign)，用于视频生成时精准调用
 * 3. 编译【正反派双排站位 + 代号名牌标签】的全员合影生图 Prompt
 * 4. 锁死全片角色的服装、头盔、装备配色，杜绝视频中途换脸穿帮
 */

/**
 * 按时代/场景分类的阵营角色模板库
 * 每个模板提供一套"正方 (coalition)" + "反方 (opposing)" 完整阵容
 * 生成定妆照时会自动根据影片时代选用对应模板
 */
const FACTION_TEMPLATES = {
  'Modern': {
    coalition: [
      { callsign: 'GHOST',   name: '幽灵队长',   role: '特战小队指挥官',     outfit: '炭黑色战术背心与多地形迷彩作战服，四目全景夜视仪头盔，胸挂战术电台与荧光信号棒' },
      { callsign: 'FALCON',  name: '猎鹰狙击手', role: '远程精确射手',       outfit: '丛林暗夜双面吉利伪装服，背负消音重型狙击步枪，护目镜反射微弱绿光' },
      { callsign: 'REAPER',  name: '收割者',     role: '近战破门突击手',     outfit: '黑色防弹背心与膝垫护肘全套，手持霰弹枪与破门锤，面罩下仅露双眼' },
      { callsign: 'DOC',     name: '军医',       role: '战地医护兵',         outfit: '多地形迷彩制服佩红十字臂章，背负急救医疗包与止血带，蓝色丁腈手套' },
      { callsign: 'HOUND',   name: '猎犬',       role: '军犬训导员',         outfit: '沙棕色防撞盔配耳麦，腰间系犬绳，身旁伴随穿战术犬衣的德牧军犬' },
      { callsign: 'SIGNAL',  name: '信号官',     role: '通信与电子战专家',   outfit: '橄榄绿制服配便携干扰天线阵列，头戴耳麦无钢盔，笔记本电脑置于加固箱上' }
    ],
    opposing: [
      { callsign: 'VIPER',   name: '毒蛇指挥',   role: '敌方作战指挥官',     outfit: '深橄榄绿军官制服佩军衔章，腰挎手枪皮套，手持战术双筒望远镜' },
      { callsign: 'JACKAL',  name: '豺狼突击手', role: '武装突击步枪手',     outfit: '深灰色头巾与民用夹克，胸挂弹匣挂袋，手持AK系步枪' },
      { callsign: 'SCORPION',name: '毒蝎炮手',   role: '反装甲火箭射手',     outfit: '迷彩外套与弹药背心，肩扛RPG火箭筒，护目镜推至额头' },
      { callsign: 'SHADOW',  name: '暗影',       role: '敌方狙击手',         outfit: '全身深色伪装布条裹缠，仅露一只瞄准眼，趴伏姿态持长管消音狙击步枪' },
      { callsign: 'WRAITH',  name: '亡灵通讯员', role: '敌方通信协调员',     outfit: '灰色制服背负大功率电台天线，头戴耳机，手持无线电话筒' }
    ]
  },
  'Modern High-Tech': {
    coalition: [
      { callsign: 'MAVERICK',name: '独行侠',     role: '王牌战斗机飞行员',   outfit: '橄榄绿飞行服与抗荷裤，带HUD瞄准单眼的飞行头盔，肩缝飞行中队臂章' },
      { callsign: 'PHOENIX', name: '凤凰',       role: '僚机飞行员',         outfit: '深蓝色飞行服与救生背心，飞行头盔面罩反射座舱仪表光' },
      { callsign: 'ROOSTER', name: '公鸡',       role: '武器系统官',         outfit: '卡其色飞行服，头盔贴有公鸡涂鸦标志，胸前挂载救生信标' },
      { callsign: 'HALO',    name: '光环',       role: '地面引导控制员',     outfit: '沙色作战服配战术背心，手持激光目标指示器与通信手持机' },
      { callsign: 'MERLIN',  name: '梅林教官',   role: '战术指挥教官',       outfit: '深色飞行员夹克与军帽，胸前佩勋章绶带，手持作战简报板' }
    ],
    opposing: [
      { callsign: 'COBRA',   name: '眼镜蛇',     role: '敌方飞行指挥官',     outfit: '深灰色飞行服与暗色头盔，座舱盖反射红色警告灯光' },
      { callsign: 'TALON',   name: '鹰爪防空手', role: '地对空导弹操作员',   outfit: '橄榄绿迷彩制服，肩扛便携式地空导弹发射管，紧张仰望天空' },
      { callsign: 'HAMMER',  name: '铁锤',       role: '敌方地面装甲指挥',   outfit: '坦克车组制服与车载通话头盔，半身探出坦克舱盖' },
      { callsign: 'RADAR',   name: '雷达兵',     role: '敌方防空雷达操作员', outfit: '灰绿色军服，坐在雷达屏幕前，耳戴通讯耳机，面部被屏幕绿光照亮' }
    ]
  },
  'WWII': {
    coalition: [
      { callsign: 'CAPTAIN', name: '米勒上尉',   role: '游骑兵连长',         outfit: '橄榄绿M41野战夹克，带白色条纹M1钢盔，腰系军用皮带与水壶' },
      { callsign: 'RANGER',  name: '莱恩伞兵',   role: '101空降师步枪手',   outfit: '美军空降兵伞兵服与网兜迷彩M1钢盔，手持M1加兰德步枪' },
      { callsign: 'DUKE',    name: '公爵炮手',   role: '坦克车组炮手',       outfit: '橄榄棕色坦克车组连体服，CVC通话头盔，手持炮弹' },
      { callsign: 'WINGS',   name: '飞翼',       role: '战斗机飞行员',       outfit: '棕色皮飞行夹克与飞行护目镜，白色丝巾，肩章飞行中队徽记' },
      { callsign: 'MEDIC',   name: '十字军医',   role: '前线卫生员',         outfit: '橄榄绿制服袖带红十字标记，背负大号急救医疗箱，手持绷带' }
    ],
    opposing: [
      { callsign: 'PANZER',  name: '装甲指挥',   role: '敌方坦克指挥官',     outfit: '黑色装甲兵制服佩铁十字勋章，半身探出虎式坦克炮塔，手持望远镜' },
      { callsign: 'IRON',    name: '铁壁步兵',   role: '敌方机枪阵地射手',   outfit: '灰色野战服与钢盔，趴在沙袋掩体后操作MG42机枪' },
      { callsign: 'WOLF',    name: '灰狼侦察兵', role: '敌方前线侦察兵',     outfit: '灰色迷彩斗篷与带伪装的钢盔，手持信号枪与地图' },
      { callsign: 'BARON',   name: '男爵军官',   role: '敌方前线指挥军官',   outfit: '灰色军官制服佩军衔肩章，手持指挥棒与地图包，面容冷峻' }
    ]
  },
  'Orbital': {
    coalition: [
      { callsign: 'ASTRO',   name: '轨道突击手',   role: '近地轨道空降特遣兵', outfit: '哑光深空黑抗辐射气密作战服，外挂小型姿态喷气背包，金色抗强光镀膜面罩' },
      { callsign: 'EVA',     name: '舱外救援员',   role: '零重力工程与救生员', outfit: '纯白加厚舱外航天服，胸前高亮反光安全条，透明球形微缩航天头盔' },
      { callsign: 'ORBIT',   name: '轨道工程师',   role: '空间站维修工程师',   outfit: '蓝色舱内工作服配多功能工具腰带，面罩上方装有头灯，手持电焊枪' },
      { callsign: 'NOVA',    name: '新星指挥官',   role: '空间站舰长',         outfit: '深蓝色指挥官制服佩金色肩章，胸前挂载通讯徽章，手持全息战术板' },
      { callsign: 'PULSE',   name: '脉冲医官',     role: '太空医疗急救官',     outfit: '白色医疗航天服配红十字荧光臂章，手持便携诊断仪，零重力急救包' }
    ],
    opposing: [
      { callsign: 'DEBRIS',  name: '碎片幽灵',     role: '失控太空碎片威胁',   outfit: '被碎片击穿的破损航天服残骸，头盔裂纹中透出红色警告灯光' },
      { callsign: 'VOID',    name: '虚空叛变者',   role: '叛变的空间站人员',   outfit: '灰色舱内服，面罩下表情阴鸷，手持改装的等离子焊枪作为武器' },
      { callsign: 'STATIC',  name: '静电干扰手',   role: '敌方电子战操作员',   outfit: '深灰色航天服配电子干扰装置背包，面罩显示屏闪烁杂波信号' },
      { callsign: 'GRAVITY', name: '引力囚徒',     role: '被困太空漂流者',     outfit: '破旧的橙色应急航天服，氧气管漂浮，头盔内面有凝结水雾' }
    ]
  }
};

/**
 * 根据时代/关键词自动选择最佳阵营模板
 * @param {string} era 影片时代标签（如 'Modern', 'WWII', 'Orbital'）
 * @param {string} theme 影片主题文本（用于关键词辅助匹配）
 * @returns {object} 选中的 FACTION_TEMPLATES 条目
 */
function selectFactionTemplate(era = 'Modern', theme = '') {
  const q = `${era} ${theme}`.toLowerCase();

  // 优先按 era 直接匹配
  if (FACTION_TEMPLATES[era]) return FACTION_TEMPLATES[era];

  // 关键词辅助推断
  if (/orbital|太空|空间站|宇宙|星际|外太空|零重力/i.test(q)) return FACTION_TEMPLATES['Orbital'];
  if (/wwii|二战|诺曼底|太平洋|珍珠港|normandy|d-day/i.test(q)) return FACTION_TEMPLATES['WWII'];
  if (/high.?tech|五代机|隐身|stealth|空战|战斗机|top.?gun/i.test(q)) return FACTION_TEMPLATES['Modern High-Tech'];

  // 兜底使用现代模板
  return FACTION_TEMPLATES['Modern'];
}

/**
 * 从镜头序列中提取角色，并自动补齐为完整正反双阵营名册
 * @param {Array} shots 分镜脚本数组
 * @param {object|null} registry 资产注册表（可选）
 * @param {string} era 影片时代标签
 * @param {string} theme 影片主题文本
 * @returns {{ coalition: Array, opposing: Array }} 正反双阵营角色列表
 */
export function extractCharacterLineup(shots = [], registry = null, era = 'Modern', theme = '') {
  const template = selectFactionTemplate(era, theme);

  // 从模板生成完整的正方阵营，每个角色附带唯一 id 和阵营标识
  const coalition = template.coalition.map((c, idx) => ({
    id: `CHR-C${String(idx + 1).padStart(2, '0')}`,
    callsign: c.callsign,
    name: c.name,
    role: c.role,
    outfit: c.outfit,
    faction: 'coalition'
  }));

  // 从模板生成完整的反方阵营
  const opposing = template.opposing.map((c, idx) => ({
    id: `CHR-O${String(idx + 1).padStart(2, '0')}`,
    callsign: c.callsign,
    name: c.name,
    role: c.role,
    outfit: c.outfit,
    faction: 'opposing'
  }));

  return { coalition, opposing };
}

/**
 * 生成【正反派双排站位 + 代号名牌标签】的全员合影定妆照生图 Prompt
 * @param {{ coalition: Array, opposing: Array }} factions 双阵营角色数据
 * @param {string} filmTheme 影片主题
 * @param {string} era 时代
 * @param {string} aspectRatio 画幅比例
 * @returns {object} 包含 promptEn, promptZh, characterCount, factions, aspectRatio
 */
export function generateLineupPrompt(factions = { coalition: [], opposing: [] }, filmTheme = '', era = 'Modern', aspectRatio = '16:9') {
  // 兜底：如果传入空阵营，用 Modern 模板补齐
  if ((!factions.coalition || factions.coalition.length === 0) && (!factions.opposing || factions.opposing.length === 0)) {
    factions = extractCharacterLineup([], null, era, filmTheme);
  }

  const allChars = [...factions.coalition, ...factions.opposing];
  const totalCount = allChars.length;
  const coalitionCount = factions.coalition.length;
  const opposingCount = factions.opposing.length;

  // 正方角色逐一描述（含代号名牌）
  const coalitionDesc = factions.coalition.map((c, idx) =>
    `Front Row Position ${idx + 1}: "${c.name}" (callsign [${c.callsign}], ${c.role}), wearing ${c.outfit}. A small white printed nameplate label at their feet reads "[${c.callsign}]".`
  ).join(' ');

  // 反方角色逐一描述（含代号名牌）
  const opposingDesc = factions.opposing.map((c, idx) =>
    `Back Row Position ${idx + 1}: "${c.name}" (callsign [${c.callsign}], ${c.role}), wearing ${c.outfit}. A small white printed nameplate label at their feet reads "[${c.callsign}]".`
  ).join(' ');

  // 纯英文高保真 Prompt (适用于 Midjourney v6 / FLUX.1 / DALL-E 3)
  const promptEn = [
    `A studio character lineup portrait of ${totalCount} distinct LEGO minifigures arranged in two clear rows facing forward towards the camera, full body shot on a LEGO collector display stand.`,
    `FRONT ROW (${coalitionCount} protagonist coalition forces, standing shoulder to shoulder): ${coalitionDesc}`,
    `BACK ROW (${opposingCount} antagonist opposing forces, standing slightly elevated behind the front row): ${opposingDesc}`,
    `Each minifigure has a small white printed nameplate label on the display stand at their feet showing their callsign code in bold black text.`,
    `The two rows are visually separated: front row protagonists on a dark blue base section, back row antagonists on a dark red base section.`,
    `Studio lighting, clean solid neutral grey background, crisp soft shadows beneath their plastic feet, 35mm tilt-shift macro lens photography, sharp focus, authentic ABS plastic glossy injection texture, micro plastic mold seams and studs visible, high-end toy photography, masterpiece, photorealistic, 8k, --ar ${aspectRatio}`
  ].join(' ');

  // 中文对照说明
  const promptZh = [
    `【全片角色定妆全家福参考图 · 正反派双排站位 · 代号名牌标签】`,
    `在纯净中性灰影棚背景前，${totalCount} 位乐高人仔角色分两排正面全身站立于收藏展示台上。`,
    ``,
    `🔵 前排（正方联军 · ${coalitionCount} 人）：`,
    ...factions.coalition.map((c, idx) => `  ${idx + 1}. 【${c.name}】代号 [${c.callsign}] · ${c.role} · ${c.outfit}`),
    ``,
    `🔴 后排（反方势力 · ${opposingCount} 人）：`,
    ...factions.opposing.map((c, idx) => `  ${idx + 1}. 【${c.name}】代号 [${c.callsign}] · ${c.role} · ${c.outfit}`),
    ``,
    `每个角色脚下的展示台上有白色代号名牌标签 [CALLSIGN]，正方底座为深蓝色，反方底座为暗红色。`,
    `棚拍柔光箱，脚底微弱阴影，35mm 移轴微距摄影，真实 ABS 塑料注塑反光与微观接缝细节清晰可见。`
  ].join('\n');

  return {
    characterCount: totalCount,
    factions,
    promptEn,
    promptZh,
    aspectRatio
  };
}
