/**
 * LEGO War Universe - 全角色定妆表与全局全家福参考图生成引擎 (Character Lineup Engine)
 * 功能：
 * 1. 从全部分镜中自动提取所有出场角色人仔资产与角色特征
 * 2. 编译用于生成【包含全片所有角色的同框大合影 (Character Lineup Sheet)】生图 Prompt (MJ / FLUX)
 * 3. 锁死全片角色的服装、头盔、装备配色，彻底杜绝视频中途换脸、衣服变形穿帮
 */

/**
 * 角色默认原型字典（用于资产库或大模型自定义角色的特征补齐）
 */
const CHARACTER_PROFILES = {
  'CHR-401': { name: '幽灵队长 (Ghost)', role: '特战小队指挥官', outfit: '炭黑色战术背心与迷彩紧身作战服，带四目全景夜视仪头盔，胸前挂载战术电台与荧光信号棒' },
  'CHR-405': { name: '猎鹰狙击手 (Falcon)', role: '远程精确射手', outfit: '丛林与暗夜双面伪装吉利服，背负消音重型狙击步枪，护目镜反射微弱绿光' },
  'CHR-101': { name: '米勒上尉 (Miller)', role: '二战游骑兵连长', outfit: '橄榄绿M41野战夹克，带白色白色条纹的M1钢盔，腰系美军战术皮带与水壶' },
  'CHR-102': { name: '莱恩二等兵 (Ryan)', role: '伞兵步枪手', outfit: '二战美军101空降师伞兵服，带网兜迷彩M1钢盔，手持M1加兰德步枪' },
  'CHR-630': { name: '铁锤先锋 (Vanguard)', role: '重装动力外骨骼兵', outfit: '工业金属灰全覆式液压外骨骼装甲，背部装载双联重弹箱，全封闭战术呼吸面罩' },
  'CHR-701': { name: '轨道突击队员 (Orbital Shock)', role: '近地轨道空降特遣队', outfit: '哑光深空黑抗辐射气密作战服，外挂小型姿态控制喷气背包，金色抗强光镀膜面罩' },
  'CHR-702': { name: '舱外救援宇航员 (EVA Specialist)', role: '零重力工程与救生员', outfit: '纯白色加厚舱外航天服，胸前高亮反光安全条，头戴透明球形微缩航天头盔' }
};

/**
 * 从镜头序列中提取所有登场角色人仔
 */
export function extractCharacterLineup(shots = [], registry = null) {
  const charMap = new Map();

  for (const shot of shots) {
    const subjects = Array.isArray(shot.subjects) ? shot.subjects : [];
    for (const subId of subjects) {
      if (typeof subId === 'string' && subId.startsWith('CHR-')) {
        if (!charMap.has(subId)) {
          let assetData = null;
          if (registry && registry.byId && registry.byId.has(subId)) {
            assetData = registry.byId.get(subId);
          }
          const preset = CHARACTER_PROFILES[subId] || {};
          charMap.set(subId, {
            id: subId,
            name: preset.name || assetData?.name || `乐高战术角色 (${subId})`,
            role: preset.role || assetData?.category || '战术战斗员',
            outfit: preset.outfit || assetData?.prompt || '标准乐高战术军服与模块化装具配件'
          });
        }
      }
    }
  }

  // 兜底保障：若镜头中未明确标记角色资产，默认补入双人战术小组
  if (charMap.size === 0) {
    charMap.set('CHR-401', { id: 'CHR-401', ...CHARACTER_PROFILES['CHR-401'] });
    charMap.set('CHR-405', { id: 'CHR-405', ...CHARACTER_PROFILES['CHR-405'] });
  }

  return Array.from(charMap.values());
}

/**
 * 生成【全角色同框合影定妆照 (Character Lineup Sheet)】生图提示词
 */
export function generateLineupPrompt(characters = [], filmTheme = '', era = 'Modern', aspectRatio = '16:9') {
  if (!characters || characters.length === 0) {
    characters = [
      { id: 'CHR-401', ...CHARACTER_PROFILES['CHR-401'] },
      { id: 'CHR-405', ...CHARACTER_PROFILES['CHR-405'] }
    ];
  }

  const count = characters.length;
  const charDescriptions = characters.map((c, idx) => {
    return `Character ${idx + 1} (${c.name}, ${c.role}): wearing ${c.outfit}, authentic LEGO minifigure proportions, detailed printed torso and legs.`;
  }).join(' ');

  // 纯英文高保真 Prompt (适用于 Midjourney v6 / FLUX.1 / DALL-E 3)
  const promptEn = [
    `A studio character lineup portrait of ${count} distinct LEGO minifigures standing together side by side in a straight horizontal line, facing forward directly towards the camera, full body shot.`,
    `${charDescriptions}`,
    `Studio lighting, clean solid neutral grey background, crisp soft shadows beneath their plastic feet, 35mm tilt-shift macro lens photography, sharp focus, authentic ABS plastic glossy injection texture, micro plastic mold seams and studs visible, high-end toy photography, masterpiece, photorealistic, 8k, --ar ${aspectRatio}`
  ].join(' ');

  // 中文对照说明与描述
  const promptZh = [
    `【全角色定妆全家福参考图】在纯净中性灰影棚背景前，${count} 位乐高人仔角色一字排开，正面全身站立合影。`,
    characters.map((c, idx) => `角色${idx + 1}【${c.name}·${c.role}】：${c.outfit}`).join('；'),
    `棚拍柔光箱，脚底微弱阴影，35mm 移轴微距摄影，真实 ABS 塑料注塑反光与微观接缝细节清晰可见。`
  ].join('\n');

  return {
    characterCount: count,
    characters,
    promptEn,
    promptZh,
    aspectRatio
  };
}
