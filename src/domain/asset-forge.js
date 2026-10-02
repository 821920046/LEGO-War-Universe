/**
 * LEGO War Universe - 现代战争资产锻造炉 (Asset Forge)
 *
 * 使命：当题材需要资产库里没有的现代化 / 未来战争装备时（巡飞弹、忠诚僚机、
 * 高超音速滑翔体、定向能武器、电磁脉冲、无人艇、外骨骼、太空轨道陆战队……），
 * 由锻造炉「当场生成」结构合法、可被编译器消费的新资产，而不是让模型凭空
 * 描述一堆无法落地的名词。
 *
 * 设计要点：
 * - 纯函数 + 种子随机（mulberry32）：同一题材 + 同一种子必然产出同一批资产，
 *   保证可复现、可测试，也避免每次刷新都刷出一堆杂乱的新资产。
 * - ID 从 800 段起分配，与人工维护的 001–702 认证资产物理隔离，一眼可辨。
 * - 产出严格满足 assets.schema.json：PREFIX-NNN、非空 lines、载具带合法 class。
 */

const FORGE_ID_START = 800;
const FORGE_ID_END = 999;

const GROUPS_WITH_CLASS = new Set(['vehicles']);

/**
 * 现代 / 未来战争蓝图库。
 * lines 中的 {pick:a|b|c} 会由种子随机解析为其中一个选项，制造合理的多样性。
 */
export const FORGE_BLUEPRINTS = [
  // ── 角色 ──────────────────────────────────────────────────────────────
  {
    key: 'exo-assault', group: 'characters', prefix: 'CHR', series: 'Modern High-Tech', faction: 'NATO', unit: 'Powered Infantry',
    name: 'Exoskeleton Assault Trooper', nameZh: '动力外骨骼突击兵',
    keywords: ['外骨骼', '机甲', '动力装甲', 'exoskeleton', 'powered armor', '机甲战士'],
    lines: [
      'LEGO minifigure in a {pick:sleek matte-black|gunmetal-grey|digital-camo} powered exoskeleton',
      'articulated brick-built hydraulic struts on the legs, {pick:twin shoulder-mounted micro-missile pods|a back-mounted ammunition drum|a chest-mounted tactical display}',
      'glowing {pick:cyan|amber|ice-blue} visor HUD, armored plating with visible LEGO studs and mold seams',
      'authentic LEGO plastic texture, consistent minifigure proportions'
    ]
  },
  {
    key: 'c-uas-operator', group: 'characters', prefix: 'CHR', series: 'Modern High-Tech', faction: 'NATO', unit: 'Counter-UAS',
    name: 'Counter-Drone Operator', nameZh: '反无人机电子战操作员',
    keywords: ['反无人机', '电子战', '干扰', 'counter-drone', 'electronic warfare', 'jammer', '无人机'],
    lines: [
      'LEGO minifigure counter-UAS specialist wearing a {pick:grey tactical rig|ranger-green plate carrier}',
      'carrying a brick-built anti-drone jammer rifle with a dish antenna and glowing signal LEDs',
      'a ruggedized tactical tablet showing a drone-tracking radar sweep, headset with boom mic',
      'authentic LEGO plastic texture, consistent proportions'
    ]
  },
  {
    key: 'cyber-officer', group: 'characters', prefix: 'CHR', series: 'Modern High-Tech', faction: 'Coalition', unit: 'Cyber Command',
    name: 'Cyber Warfare Officer', nameZh: '网络战指挥军官',
    keywords: ['网络战', '黑客', '赛博', 'cyber', 'hacker', 'information warfare', '数据'],
    lines: [
      'LEGO minifigure cyber warfare officer in a {pick:navy blue|charcoal} uniform with glowing circuit-print torso',
      'surrounded by holographic brick-built data panels with {pick:green|cyan} scrolling code tiles',
      'wearing a lightweight headset, a tactical keyboard gauntlet on one arm',
      'authentic LEGO plastic texture, consistent minifigure proportions'
    ]
  },
  {
    key: 'orbital-marine', group: 'characters', prefix: 'CHR', series: 'Orbital', faction: 'Coalition', unit: 'Orbital Marines',
    name: 'Orbital Drop Marine', nameZh: '轨道空降陆战队员',
    keywords: ['太空', '轨道', '轨道空降', 'orbital', 'space marine', '零重力', 'space'],
    lines: [
      'LEGO minifigure orbital marine in a {pick:white and orange|grey and cyan} vacuum-rated powered suit',
      'sealed helmet with gold reflective visor, magnetic boot plates, brick-built maneuvering thrusters on the back',
      'a compact gauss rifle with glowing energy cell',
      'authentic LEGO plastic texture, consistent minifigure proportions'
    ]
  },
  {
    key: 'cbrn-trooper', group: 'characters', prefix: 'CHR', series: 'Modern', faction: 'NATO', unit: 'CBRN Defense',
    name: 'CBRN Defense Trooper', nameZh: '生化防护兵',
    keywords: ['生化', '核生化', '防护', 'cbrn', 'nbc', 'decontamination', '防化'],
    lines: [
      'LEGO minifigure CBRN trooper in a {pick:bright yellow|olive} sealed hazmat suit with hood and respirator',
      'a brick-built portable detector wand and a sample case with biohazard tiles',
      'overboots and heavy gloves, sealed seams',
      'authentic LEGO plastic texture, consistent minifigure proportions'
    ]
  },

  // ── 地面载具 ───────────────────────────────────────────────────────────
  {
    key: 'ugv-combat', group: 'vehicles', prefix: 'VEH', class: 'ugv', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Autonomous Combat UGV', nameZh: '无人战斗战车',
    keywords: ['无人战车', '无人地面载具', 'ugv', 'unmanned ground vehicle', '机器人战车', '无人'],
    lines: [
      'LEGO unmanned ground combat vehicle with {pick:eight|six} chunky rubber-tired wheels and no crew compartment',
      'a {pick:remote weapon station with a 30mm autocannon|turret-mounted missile pod} and a mast-mounted sensor ball',
      '{pick:sand|olive-drab|urban-grey} brick armor with anti-tank slat panels, visible studs and mold seams',
      'high detail, realistic LEGO stickers and unit markings'
    ]
  },
  {
    key: 'dew-airdefense', group: 'vehicles', prefix: 'VEH', class: 'ground', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Directed Energy Air Defense Vehicle', nameZh: '定向能激光防空车',
    keywords: ['激光', '定向能', '防空', 'laser', 'directed energy', 'dew', '反导', '防空车'],
    lines: [
      'LEGO wheeled air-defense vehicle carrying a brick-built high-energy laser turret with a large focusing lens',
      'glowing {pick:blue-white|violet} emitter coils, cooling fins and capacitor banks with translucent energy tiles',
      'a rotating radar panel on the rear deck',
      '{pick:desert-tan|arctic-white|dark grey} armor plating, visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'ew-vehicle', group: 'vehicles', prefix: 'VEH', class: 'ground', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Mobile Electronic Warfare Vehicle', nameZh: '机动电子战车',
    keywords: ['电子战', '干扰车', '电磁', 'electronic warfare', 'jammer', 'spectrum', '电子对抗'],
    lines: [
      'LEGO 8x8 electronic warfare vehicle with a {pick:telescoping sensor mast|large dish array} on the roof',
      'brick-built jamming pods with blinking signal tiles, a fold-out operations shelter with a glowing map table',
      '{pick:green|grey} camouflage plates, cable reels and antenna farm',
      'visible LEGO studs and mold seams, high detail'
    ]
  },
  {
    key: 'himars-mlrs', group: 'vehicles', prefix: 'VEH', class: 'ground', series: 'Modern', faction: 'NATO',
    name: 'Precision Rocket Artillery Vehicle', nameZh: '高机动精确火箭炮车',
    keywords: ['火箭炮', '远程火力', 'mlrs', 'himars', 'artillery', '远程打击', '制导火箭'],
    lines: [
      'LEGO wheeled rocket artillery truck with a rear launcher pod raised at a firing angle',
      '{pick:six|four} loaded precision rocket tubes with red tip cones',
      'cab with armored window tiles, outrigger stabilizers deployed',
      '{pick:olive-drab|desert-tan} finish, visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'aps-mbt', group: 'vehicles', prefix: 'VEH', class: 'ground', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Active Protection Main Battle Tank', nameZh: '主动防护主战坦克',
    keywords: ['坦克', '主动防护', '主战坦克', 'tank', 'active protection', '装甲'],
    lines: [
      'LEGO main battle tank with angular composite brick armor and small radar panels for active protection',
      'a low-profile unmanned turret with a 120mm smoothbore gun and a coaxial remote machine gun',
      'brick-built explosive-reactive armor tiles on the hull sides, rubber tracks',
      '{pick:urban-grey|desert-tan} paint with weathered decals, visible LEGO studs and mold seams'
    ]
  },

  // ── 空中载具 ───────────────────────────────────────────────────────────
  {
    key: 'loyal-wingman', group: 'vehicles', prefix: 'AIR', class: 'aircraft', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Loyal Wingman Combat Drone', nameZh: '忠诚僚机无人战机',
    keywords: ['忠诚僚机', '无人战机', '无人机', 'loyal wingman', 'uav', 'stealth drone', '协同作战飞机'],
    lines: [
      'LEGO stealthy unmanned combat aircraft with a {pick:tailless cranked-kite|lambda} wing and no cockpit',
      'smooth {pick:matte grey|dark charcoal} radar-absorbent brick skin with serrated weapon-bay edges',
      'an internal bay with small air-to-air missiles, a single dorsal engine intake',
      'high detail, visible LEGO studs and mold seams, realistic panel-line stickers'
    ]
  },
  {
    key: 'hypersonic-hgv', group: 'vehicles', prefix: 'AIR', class: 'aircraft', series: 'Modern High-Tech', faction: 'Coalition',
    name: 'Hypersonic Glide Vehicle', nameZh: '高超音速滑翔载具',
    keywords: ['高超音速', '滑翔', '乘波体', 'hypersonic', 'glide vehicle', 'hsv', '极速'],
    lines: [
      'LEGO hypersonic glide vehicle with a {pick:waverider|delta} lifting body and sharp heat-shield nose',
      'trailing a glowing {pick:orange|blue-white} plasma sheath made of translucent energy bricks',
      'no windows, small control fins at the tail, boost-glide booster mount on the belly',
      '{pick:black|dark grey} thermal-protection tiles, visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'vtol-gunship', group: 'vehicles', prefix: 'AIR', class: 'aircraft', series: 'Modern High-Tech', faction: 'NATO',
    name: 'VTOL Attack Gunship', nameZh: '垂直起降武装炮艇机',
    keywords: ['垂直起降', '炮艇机', 'vtol', 'gunship', '倾转旋翼', '空中炮艇'],
    lines: [
      'LEGO tiltrotor VTOL gunship with two large proprotor nacelles on the wingtips',
      'side-mounted {pick:30mm chain gun|rocket pod} and a chin sensor turret with a glowing lens',
      'loading ramp open at the rear, troop cabin with brick seats',
      '{pick:grey|green} tactical paint, visible LEGO studs and mold seams, high detail'
    ]
  },
  {
    key: 'ew-aircraft', group: 'vehicles', prefix: 'AIR', class: 'aircraft', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Airborne Electronic Attack Aircraft', nameZh: '电子战飞机',
    keywords: ['电子战飞机', '预警机', '干扰机', 'electronic attack', 'awacs', 'jammer aircraft'],
    lines: [
      'LEGO four-engine transport aircraft converted into an electronic-attack platform',
      'a large {pick:rotodome|blade antenna} on the spine and podded jammers under the wings',
      'glowing signal tiles along the fuselage, satellite-communications hump',
      '{pick:grey|white} livery with unit markings, visible LEGO studs and mold seams'
    ]
  },

  // ── 旋翼机 ─────────────────────────────────────────────────────────────
  {
    key: 'armed-recon-helo', group: 'vehicles', prefix: 'AIR', class: 'helicopter', series: 'Modern', faction: 'NATO',
    name: 'Armed Reconnaissance Helicopter', nameZh: '察打一体武装侦察直升机',
    keywords: ['武装直升机', '侦察直升机', 'helicopter', 'attack helo', '阿帕奇'],
    lines: [
      'LEGO two-seat attack helicopter with a mast-mounted sight ball above the rotor',
      'stub wings carrying {pick:rocket pods and anti-tank missiles|quad missile rails}',
      'a chin-mounted chain gun, IR-suppressor exhaust nozzles',
      '{pick:dark olive|grey} tactical paint, visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'cargo-drone-helo', group: 'vehicles', prefix: 'AIR', class: 'helicopter', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Autonomous Cargo Resupply Drone', nameZh: '无人货运补给直升机',
    keywords: ['无人直升机', '补给', '货运无人机', 'cargo drone', 'resupply', '后勤'],
    lines: [
      'LEGO unmanned cargo helicopter with a large boxy fuselage and no cockpit',
      'a slung cargo container with palletized supply crates, belly hook and cable',
      'four-blade rotor, {pick:orange|grey} high-visibility markings',
      'visible LEGO studs and mold seams, high detail'
    ]
  },

  // ── 海上 / 水下 ────────────────────────────────────────────────────────
  {
    key: 'usv-strike', group: 'vehicles', prefix: 'SHP', class: 'ship', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Unmanned Surface Strike Vessel', nameZh: '无人水面攻击艇',
    keywords: ['无人艇', '水面无人', 'usv', 'unmanned surface', '快艇', '自杀艇'],
    lines: [
      'LEGO unmanned surface vessel with a {pick:trimaran|planing} hull and no bridge windows',
      'a low, angular sensor mast and a forward {pick:missile launcher|remote gun mount}',
      'glowing navigation lights, a wake of translucent splash bricks',
      '{pick:grey|navy} naval paint, visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'uuv-sub', group: 'vehicles', prefix: 'SHP', class: 'ship', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Extra-Large Unmanned Underwater Vehicle', nameZh: '超大型无人潜航器',
    keywords: ['潜航器', '无人潜航', 'uuv', 'submarine drone', '水下无人', '潜艇'],
    lines: [
      'LEGO extra-large unmanned underwater vehicle with a {pick:torpedo|flatfish} hull and no sail windows',
      'a pump-jet propulsor at the stern, sensor array along the flanks, tethered docking cradle',
      'translucent bubble-trail bricks behind it, {pick:yellow|black} test-livery panels',
      'visible LEGO studs and mold seams, high detail'
    ]
  },
  {
    key: 'littoral-combat', group: 'vehicles', prefix: 'SHP', class: 'ship', series: 'Modern', faction: 'NATO',
    name: 'Littoral Combat Ship', nameZh: '濒海战斗舰',
    keywords: ['濒海', '护卫舰', 'littoral', 'frigate', '军舰', '水面舰艇'],
    lines: [
      'LEGO littoral combat ship with a {pick:trimaran|monohull} design and a stealthy angled superstructure',
      'a flight deck for a small helicopter, a modular mission bay at the stern',
      'brick-built phased-array radar panels and a 57mm gun turret',
      '{pick:haze-grey|navy blue} naval paint, visible LEGO studs and mold seams'
    ]
  },

  // ── 无人机 / 巡飞弹 ────────────────────────────────────────────────────
  {
    key: 'loitering-munition', group: 'vehicles', prefix: 'VEH', class: 'drone', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Loitering Munition', nameZh: '巡飞弹',
    keywords: ['巡飞弹', '自杀无人机', '游荡弹药', 'loitering munition', 'kamikaze drone', '徘徊弹药'],
    lines: [
      'LEGO loitering munition with a long slender fuselage, pop-out {pick:X|straight} wings and a pusher propeller',
      'a nose-mounted seeker ball with a glowing lens, a small warhead section with red warning tiles',
      'launch-rail canister lying beside it, folding transport fins',
      '{pick:tan|grey} body, visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'fpv-strike-drone', group: 'vehicles', prefix: 'VEH', class: 'drone', series: 'Modern', faction: 'Opposing Force',
    name: 'FPV Strike Drone', nameZh: 'FPV 自杀穿越机',
    keywords: ['fpv', '穿越机', '自杀无人机', 'quadcopter', 'fpv drone', '四旋翼'],
    lines: [
      'LEGO FPV quadcopter drone with a {pick:carbon-black|camo} frame and four exposed propellers',
      'a slung shaped-charge munition underneath, a small camera pod on the nose',
      'thin wire antennas, glowing LED strip tiles',
      'visible LEGO studs and mold seams, high detail'
    ]
  },
  {
    key: 'drone-swarm', group: 'vehicles', prefix: 'VEH', class: 'drone', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Swarm Drone Carrier Pod', nameZh: '蜂群无人机母舱',
    keywords: ['蜂群', '无人机蜂群', 'swarm', 'drone swarm', '集群', '母舱'],
    lines: [
      'LEGO canister-style swarm carrier pod with honeycomb launch cells and stacked micro-drones',
      'several tiny {pick:quadcopter|tube-launched} micro-drones in mid-deployment above it',
      'glowing status tiles on each cell, cable harness to a control unit',
      'visible LEGO studs and mold seams, high detail'
    ]
  },
  {
    key: 'recon-microdrone', group: 'vehicles', prefix: 'VEH', class: 'drone', series: 'Modern', faction: 'NATO',
    name: 'Micro Reconnaissance Drone', nameZh: '微型侦察无人机',
    keywords: ['微型无人机', '侦察无人机', 'micro drone', 'recon drone', '鸟形无人机', '黑蜂'],
    lines: [
      'LEGO hand-launched micro reconnaissance drone with a {pick:bird-like|twin-boom} silhouette',
      'a gimbaled camera ball with a glowing lens, whisper-quiet propeller at the tail',
      'small landing skids, folded under a soldier-sized scale reference',
      '{pick:grey|olive} body, visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'decoy-drone', group: 'vehicles', prefix: 'VEH', class: 'drone', series: 'Modern High-Tech', faction: 'NATO',
    name: 'Radar Decoy Drone', nameZh: '雷达诱饵无人机',
    keywords: ['诱饵', '欺骗', 'decoy', '雷达诱饵', '假目标', '干扰'],
    lines: [
      'LEGO radar decoy drone with a boxy fuselage and corner-reflector tiles to mimic a large aircraft',
      'a small jet engine at the rear, no sensors or weapons fitted',
      'inflatable-looking brick panels, {pick:orange|grey} test markings',
      'visible LEGO studs and mold seams'
    ]
  },

  // ── 武器 ──────────────────────────────────────────────────────────────
  {
    key: 'dew-laser-cannon', group: 'weapons', prefix: 'WPN', series: 'Modern High-Tech',
    name: 'High-Energy Laser Cannon', nameZh: '高能激光炮',
    keywords: ['激光炮', '定向能武器', 'laser cannon', 'directed energy weapon', '光束', '反无人机'],
    lines: [
      'LEGO high-energy laser cannon with a long barrel of stacked translucent {pick:blue|violet} energy tiles',
      'a large focusing lens at the muzzle, glowing capacitor coils along the receiver',
      'a heavy tripod or vehicle mount, cooling fins',
      'visible LEGO studs and mold seams, high detail'
    ]
  },
  {
    key: 'hpm-weapon', group: 'weapons', prefix: 'WPN', series: 'Modern High-Tech',
    name: 'High-Power Microwave Emitter', nameZh: '高功率微波武器',
    keywords: ['微波武器', '电磁脉冲', 'emp', 'high power microwave', 'hpm', '电磁'],
    lines: [
      'LEGO high-power microwave emitter shaped like a large rectangular dish on a turret mount',
      'concentric ring tiles radiating outward, glowing amber capacitor stack',
      'thick armored cabling and a heat-sink block',
      'visible LEGO studs and mold seams, high detail'
    ]
  },
  {
    key: 'railgun', group: 'weapons', prefix: 'WPN', series: 'Modern High-Tech',
    name: 'Electromagnetic Railgun', nameZh: '电磁轨道炮',
    keywords: ['轨道炮', '电磁炮', 'railgun', 'electromagnetic', '超高速弹丸', '电磁发射'],
    lines: [
      'LEGO electromagnetic railgun with two long parallel rails and a bulky breech of capacitor bricks',
      'a glowing {pick:blue|white} arc between the rails, a dart-like kinetic projectile',
      'cooling vents and armored power conduits',
      'visible LEGO studs and mold seams, high detail'
    ]
  },
  {
    key: 'hypersonic-missile', group: 'weapons', prefix: 'WPN', series: 'Modern High-Tech',
    name: 'Hypersonic Cruise Missile', nameZh: '高超音速巡航导弹',
    keywords: ['高超音速导弹', 'hypersonic missile', '极速导弹', '乘波体导弹', '突防'],
    lines: [
      'LEGO hypersonic cruise missile with a {pick:waverider|cone} nose and small scramjet inlet underneath',
      'folding fins, glowing exhaust plume of translucent orange bricks',
      'a ground-transport erector cradle included',
      '{pick:grey|white} body with red band markings, visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'anti-radiation-missile', group: 'weapons', prefix: 'WPN', series: 'Modern', 
    name: 'Anti-Radiation Missile', nameZh: '反辐射导弹',
    keywords: ['反辐射导弹', 'anti-radiation', 'arm', '雷达压制', '反雷达'],
    lines: [
      'LEGO anti-radiation missile with a slender body and a wide-band radar-homing seeker nose',
      'four mid-body fins and a ring of small control vanes at the tail',
      '{pick:white|grey} body with black seeker band, stencil markings',
      'visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'smart-mine', group: 'weapons', prefix: 'WPN', series: 'Modern High-Tech',
    name: 'Networked Smart Mine', nameZh: '网络化智能地雷',
    keywords: ['智能地雷', 'smart mine', '传感器', '网络化', '自寻的'],
    lines: [
      'LEGO networked smart mine with a squat cylindrical body and pop-up sensor mast',
      'a cluster of small self-guided sub-munitions, glowing arming indicator tiles',
      'camouflaged top plates, a short antenna',
      'visible LEGO studs and mold seams'
    ]
  },

  // ── 道具 ──────────────────────────────────────────────────────────────
  {
    key: 'drone-jammer-gun', group: 'props', prefix: 'PRP', series: 'Modern High-Tech',
    name: 'Portable Drone Jammer Gun', nameZh: '便携式无人机干扰枪',
    keywords: ['干扰枪', '反无人机枪', 'jammer gun', 'anti-drone gun', '便携'],
    lines: [
      'LEGO portable anti-drone jammer gun shaped like a bulky rifle with a {pick:parabolic dish|flat panel} antenna',
      'glowing signal-bar tiles, a shoulder stock and foregrip',
      'a small battery pack with cable to the emitter head',
      'visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'tactical-datalink', group: 'props', prefix: 'PRP', series: 'Modern High-Tech',
    name: 'Tactical Datalink Terminal', nameZh: '战术数据链终端',
    keywords: ['数据链', '终端', '指挥', 'datalink', 'command terminal', '态势'],
    lines: [
      'LEGO ruggedized tactical datalink terminal with a fold-out screen showing a glowing tactical map',
      'a brick-built antenna and a keyboard, armored rubber corners',
      'a rugged carrying case open beside it',
      'visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'satcom-terminal', group: 'props', prefix: 'PRP', series: 'Modern High-Tech',
    name: 'Man-Portable SATCOM Terminal', nameZh: '便携卫星通信终端',
    keywords: ['卫星通信', 'satcom', '卫星终端', '通信', '天线'],
    lines: [
      'LEGO man-portable satellite communications terminal with a {pick:flat phased-array|small dish} antenna',
      'a tripod mount, glowing status tiles, a cable reel',
      'an operator backpack power unit',
      'visible LEGO studs and mold seams'
    ]
  },
  {
    key: 'holo-sandbox', group: 'props', prefix: 'PRP', series: 'Modern High-Tech',
    name: 'Holographic Tactical Sandbox', nameZh: '全息战术沙盘',
    keywords: ['全息', '沙盘', '指挥所', 'holographic', 'sand table', '兵棋'],
    lines: [
      'LEGO holographic tactical sand table projecting a translucent {pick:blue|cyan} 3D terrain grid above it',
      'tiny glowing unit markers and arrow tiles on the projection',
      'a console base with knobs and a rim of status lights',
      'visible LEGO studs and mold seams, cinematic glow'
    ]
  },
  {
    key: 'field-medpod', group: 'props', prefix: 'PRP', series: 'Modern',
    name: 'Field Trauma Pod', nameZh: '战地急救舱',
    keywords: ['医疗', '急救', '救护', 'medevac', 'trauma pod', '伤员'],
    lines: [
      'LEGO field trauma pod with a fold-out stretcher and a rack of medical supply tiles',
      'a glowing vital-signs monitor, IV stand and blood bags',
      'stacked bandage and plasma crates, a red-cross marking',
      'visible LEGO studs and mold seams'
    ]
  },

  // ── 特效 ──────────────────────────────────────────────────────────────
  {
    key: 'fx-dew-beam', group: 'fx', prefix: 'FX', series: 'Modern High-Tech',
    name: 'Directed Energy Beam', nameZh: '定向能光束',
    keywords: ['激光束', '光束', '定向能', 'beam', 'laser blast', '能量'],
    lines: [
      'photorealistic coherent {pick:blue-white|violet} laser beam with intense bloom and lens flare',
      'air ionization haze along the beam path, glowing molten impact point on LEGO bricks',
      'volumetric light scattering, cinematic anamorphic flare'
    ]
  },
  {
    key: 'fx-emp', group: 'fx', prefix: 'FX', series: 'Modern High-Tech',
    name: 'Electromagnetic Pulse Burst', nameZh: '电磁脉冲爆发',
    keywords: ['电磁脉冲', 'emp', '冲击波', 'electromagnetic', '干扰波纹'],
    lines: [
      'photorealistic electromagnetic pulse burst with expanding concentric {pick:cyan|white} shock rings',
      'arcing static electricity crawling over LEGO surfaces, blown-out highlight in the center',
      'volumetric haze and dust lifting off the ground'
    ]
  },
  {
    key: 'fx-hypersonic-boom', group: 'fx', prefix: 'FX', series: 'Modern High-Tech',
    name: 'Hypersonic Shock Cone', nameZh: '高超音速音爆环',
    keywords: ['音爆', '激波', '高超音速', 'shock cone', 'sonic boom', '马赫环'],
    lines: [
      'photorealistic hypersonic shock cone with a ring of condensed vapor around a fast-moving LEGO vehicle',
      'glowing plasma sheath of {pick:orange|blue} trailing behind',
      'heat distortion and trailing smoke ribbons'
    ]
  },
  {
    key: 'fx-swarm-shadow', group: 'fx', prefix: 'FX', series: 'Modern High-Tech',
    name: 'Drone Swarm Shadow', nameZh: '无人机蜂群掠影',
    keywords: ['蜂群', '无人机群', 'swarm', 'shadow', '遮蔽'],
    lines: [
      'photorealistic dense drone swarm darkening the sky like a moving shadow',
      'hundreds of small quadcopter silhouettes with blinking navigation lights',
      'dust and paper debris swirling upward from the rotor wash'
    ]
  },
  {
    key: 'fx-cyber-flood', group: 'fx', prefix: 'FX', series: 'Modern High-Tech',
    name: 'Cyber Data Flood', nameZh: '网络战数据洪流',
    keywords: ['数据洪流', '网络战', 'cyber', 'data flood', '代码', '全息'],
    lines: [
      'photorealistic cascading holographic data stream with glowing {pick:green|cyan} code tiles',
      'torn network-diagram graphics and glitch artifacts floating over LEGO equipment',
      'volumetric projection light and lens distortion'
    ]
  },

  // ── 环境 ──────────────────────────────────────────────────────────────
  {
    key: 'env-future-ruins', group: 'environments', prefix: 'ENV', series: 'Modern High-Tech',
    name: 'Future Megacity Ruins', nameZh: '未来都市废墟',
    keywords: ['未来都市', '废墟', '赛博城市', 'future city', 'ruins', '都市战'],
    lines: [
      'brick-built LEGO set at minifigure scale: terrain, buildings and props are LEGO elements with visible studs and seams, while weather, smoke and fire are photorealistic',
      'shattered high-rise ruins with exposed steel frames and glowing broken signage',
      'rubble-strewn streets, drifting smoke and ash, cold overcast light with neon accents'
    ]
  },
  {
    key: 'env-orbital-station', group: 'environments', prefix: 'ENV', series: 'Orbital',
    name: 'Orbital Battle Station', nameZh: '轨道空间站战场',
    keywords: ['空间站', '轨道', '太空', 'space station', 'orbital', '零重力'],
    lines: [
      'brick-built LEGO set at minifigure scale: station modules and props are LEGO elements with visible studs and seams, while stars and nebulae are photorealistic',
      'modular white-and-grey station corridors with gold solar arrays and airlock hatches',
      'deep black space beyond the viewports, hard unfiltered sunlight, floating debris bricks'
    ]
  },
  {
    key: 'env-underground-bunker', group: 'environments', prefix: 'ENV', series: 'Modern High-Tech',
    name: 'Hardened Underground Command Bunker', nameZh: '地下加固指挥掩体',
    keywords: ['掩体', '地下', '指挥所', 'bunker', 'underground', '隧道', '加固'],
    lines: [
      'brick-built LEGO set at minifigure scale: walls, blast doors and consoles are LEGO elements with visible studs and seams, while dust and haze are photorealistic',
      'reinforced concrete corridor with steel blast doors and cable trays overhead',
      'dim emergency lighting, glowing console screens, dust motes in the beams'
    ]
  },
  {
    key: 'env-polar-station', group: 'environments', prefix: 'ENV', series: 'Modern High-Tech',
    name: 'Arctic Research Outpost', nameZh: '极地研究哨站',
    keywords: ['极地', '雪原', '北极', 'arctic', 'polar', '冰原', '雪'],
    lines: [
      'brick-built LEGO set at minifigure scale: buildings, vehicles and props are LEGO elements with visible studs and seams, while snow and wind are photorealistic',
      'modular polar research outpost with antenna masts and fuel bladders on a frozen plain',
      'blowing snow, pale low sun, long blue shadows, ice haze on the horizon'
    ]
  },
  {
    key: 'env-naval-screen', group: 'environments', prefix: 'ENV', series: 'Modern',
    name: 'Open-Ocean Fleet Screen', nameZh: '远洋舰队阵位',
    keywords: ['舰队', '远洋', '海战', 'fleet', 'ocean', 'naval', '海面'],
    lines: [
      'brick-built LEGO set at minifigure scale: ships and deck structures are LEGO elements with visible studs and seams, while ocean water and spray are photorealistic',
      'open ocean with a screen of warships in formation under a vast sky',
      'photoreal rolling swell, whitecaps and sea spray, dramatic cloud banks'
    ]
  },

  // ── 运镜 / 灯光 ───────────────────────────────────────────────────────
  {
    key: 'cam-fpv-dive', group: 'cameras', prefix: 'CAM', series: 'Modern High-Tech',
    name: 'FPV Drone Dive', nameZh: 'FPV 无人机俯冲',
    keywords: ['fpv', '俯冲', '第一人称', 'dive', 'drone cam', '穿越'],
    lines: [
      'FPV drone first-person dive, aggressive downward rush toward the target, wide-angle 14mm lens',
      'fast parallax, slight roll and vibration, kinetic high-speed motion blur'
    ]
  },
  {
    key: 'cam-thermal-track', group: 'cameras', prefix: 'CAM', series: 'Modern High-Tech',
    name: 'Thermal Tracking Shot', nameZh: '热成像追踪镜头',
    keywords: ['热成像', '夜视', 'thermal', 'tracking', '红外'],
    lines: [
      'thermal-imaging tracking shot, white-hot subjects against a cool dark background',
      'smooth motorized pan following the target, slight sensor grain and scanline overlay'
    ]
  },
  {
    key: 'lgt-emp-flash', group: 'lighting', prefix: 'LGT', series: 'Modern High-Tech',
    name: 'EMP Cold Flash', nameZh: '电磁脉冲冷闪',
    keywords: ['电磁', '冷光', '闪光', 'emp flash', '蓝光', '冷色'],
    lines: [
      'sudden cold {pick:blue-white|violet} electromagnetic flash, hard rim light on LEGO edges',
      'deep blue ambient with a blown-out white core, arcing highlights on plastic surfaces'
    ]
  },
  {
    key: 'lgt-holo-glow', group: 'lighting', prefix: 'LGT', series: 'Modern High-Tech',
    name: 'Holographic Console Glow', nameZh: '全息控制台辉光',
    keywords: ['全息', '辉光', '控制台', 'holographic', 'console glow', '科幻光'],
    lines: [
      'soft volumetric {pick:cyan|green} holographic glow from console screens',
      'low-key ambient with colored practical light on minifigure faces, subtle atmospheric haze'
    ]
  },

  // ── 音效 ──────────────────────────────────────────────────────────────
  {
    key: 'aud-dew-charge', group: 'audio', prefix: 'AUD', series: 'Modern High-Tech',
    name: 'Directed Energy Charge', nameZh: '定向能充能啸叫',
    keywords: ['充能', '激光音', '定向能', 'charge', 'laser sound', '啸叫'],
    lines: [
      'rising capacitor whine building to a sharp crack as the directed-energy weapon discharges'
    ]
  },
  {
    key: 'aud-emp-thump', group: 'audio', prefix: 'AUD', series: 'Modern High-Tech',
    name: 'EMP Low-Frequency Thump', nameZh: '电磁脉冲低频轰击',
    keywords: ['电磁音', '低频', 'emp sound', '轰击', '脉冲'],
    lines: [
      'deep subsonic thump followed by a crackling static wash and the hum of dying electronics'
    ]
  },
  {
    key: 'aud-swarm-buzz', group: 'audio', prefix: 'AUD', series: 'Modern High-Tech',
    name: 'Drone Swarm Buzz', nameZh: '无人机蜂群嗡鸣',
    keywords: ['蜂群音', '嗡鸣', 'drone buzz', '旋翼', '群'],
    lines: [
      'dense layered buzz of many small rotors, doppler-shifting as the swarm sweeps past'
    ]
  },
  {
    key: 'aud-datalink', group: 'audio', prefix: 'AUD', series: 'Modern High-Tech',
    name: 'Datalink Tone', nameZh: '数据链电子音',
    keywords: ['数据链', '电子音', 'datalink', '通信', '哔声'],
    lines: [
      'clean encrypted datalink chirps and soft UI blips over a low tactical radio hiss'
    ]
  }
];

/* ── 种子随机 ─────────────────────────────────────────────────────────── */

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fillTemplate(text, rng) {
  return String(text).replace(/\{pick:([^}]+)\}/g, (_, options) => {
    const list = options.split('|').map(s => s.trim()).filter(Boolean);
    if (!list.length) return '';
    return list[Math.floor(rng() * list.length) % list.length];
  });
}

/** 在 800–999 段中分配一个未被占用的 ID，必要时回退到 300 段 */
export function allocateForgedId(prefix, usedIds) {
  for (let n = FORGE_ID_START; n <= FORGE_ID_END; n++) {
    const id = `${prefix}-${String(n).padStart(3, '0')}`;
    if (!usedIds.has(id)) return id;
  }
  for (let n = 300; n < FORGE_ID_START; n++) {
    const id = `${prefix}-${String(n).padStart(3, '0')}`;
    if (!usedIds.has(id)) return id;
  }
  throw new Error(`Asset forge exhausted ID space for prefix ${prefix}`);
}

function scoreBlueprint(bp, tokens, era) {
  let score = 0;
  const hay = `${bp.name} ${bp.nameZh} ${(bp.keywords || []).join(' ')}`.toLowerCase();
  for (const t of tokens) {
    if (hay.includes(t)) score += 50;
    else if (t.length >= 3 && hay.includes(t.slice(0, 3))) score += 8;
  }
  if (era && bp.series === era) score += 30;
  else if (era && bp.series !== era) score -= 6;
  // 未命中任何关键词时，仍让每类都有机会被选中（打破平局，避免顺序固化）
  return score;
}

/** 把蓝图实例化为一个符合 schema 的资产对象 */
export function forgeFromBlueprint(bp, rng, usedIds) {
  const id = allocateForgedId(bp.prefix, usedIds);
  usedIds.add(id);
  const name = fillTemplate(bp.name, rng);
  const asset = {
    id,
    name,
    nameZh: bp.nameZh,
    series: bp.series,
    faction: bp.faction || 'Coalition',
    keywords: bp.keywords || [],
    kw: (bp.keywords || []).join(' '),
    lines: bp.lines.map(line => fillTemplate(line, rng)),
    variants: bp.group === 'characters' ? ['standard', 'battle-worn', 'damaged'] : ['clean', 'weathered', 'damaged', 'destroyed'],
    version: '1.0',
    origin: 'forge',
    forgedFrom: bp.key,
    changelog: ['1.0 forged by LWU self-evolution engine']
  };
  if (GROUPS_WITH_CLASS.has(bp.group)) {
    asset.class = bp.class;
    if (bp.group === 'characters') asset.unit = bp.unit || 'Specialist';
  }
  return asset;
}

/**
 * 锻造一批现代 / 未来战争资产
 * @param {object} options
 * @param {string} options.theme 题材文本（用于关键词匹配与种子）
 * @param {string} [options.era] 目标时代
 * @param {Iterable<string>} [options.existingIds] 已存在的 ID（避免冲突）
 * @param {number} [options.count] 期望产出数量
 * @param {number|string} [options.seed] 额外种子，缺省由 theme 派生
 * @returns {Array<object>} 结构合法的资产数组
 */
export function forgeAssets({ theme = '', era = null, existingIds = [], count = 6, seed } = {}) {
  const used = new Set(existingIds);
  const tokens = String(theme || '')
    .toLowerCase()
    .split(/[\s,，、/|;；:：()（）【】\[\]]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);

  const rng = mulberry32(fnv1a(`${theme}|${era || ''}|${seed ?? ''}`));

  const ranked = FORGE_BLUEPRINTS
    .map(bp => ({ bp, score: scoreBlueprint(bp, tokens, era) }))
    .sort((a, b) => b.score - a.score || (fnv1a(a.bp.key) - fnv1a(b.bp.key)));

  const target = Math.max(0, Math.min(FORGE_BLUEPRINTS.length, Number(count) || 0));
  const chosen = [];
  const seenGroups = new Map();

  // 第一轮：优先高分蓝图，同时尽量让每个分组都有产出（题材越新，词汇越丰富）
  for (const { bp } of ranked) {
    if (chosen.length >= target) break;
    const g = seenGroups.get(bp.group) || 0;
    if (g >= 3) continue;
    seenGroups.set(bp.group, g + 1);
    chosen.push(bp);
  }
  // 第二轮：若仍未达标，放宽分组配额
  if (chosen.length < target) {
    for (const { bp } of ranked) {
      if (chosen.length >= target) break;
      if (chosen.includes(bp)) continue;
      chosen.push(bp);
    }
  }

  return chosen.map(bp => forgeFromBlueprint(bp, rng, used));
}

/**
 * 校验锻造出的资产是否满足 assets.schema.json 的硬性约束。
 * 供测试与运行时自检使用。
 */
export function validateForgedAsset(asset) {
  const errors = [];
  if (!asset?.id || !/^[A-Z]{2,5}-[0-9]{3}$/.test(asset.id)) errors.push('bad id pattern');
  if (!asset?.name) errors.push('missing name');
  if (!Array.isArray(asset?.lines) || asset.lines.length === 0) errors.push('empty lines');
  const isVehicle = /^(VEH|AIR|SHP)-/.test(asset?.id || '');
  if (isVehicle && !['ground', 'aircraft', 'helicopter', 'ship', 'drone', 'ugv'].includes(asset.class)) {
    errors.push(`invalid vehicle class ${asset.class}`);
  }
  return { ok: errors.length === 0, errors };
}
