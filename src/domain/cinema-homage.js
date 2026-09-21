/**
 * LEGO War Universe - 经典电影视听拉片与乐高转译引擎 (Cinema Homage Engine)
 * 功能：
 * 1. 输入经典电影名字，自动解构其视听语法、标志性镜头母题与戏剧冲突
 * 2. 自动将其映射为 4/8/12 镜头高保真乐高微缩分镜脚本与标准积木资产
 * 3. 生成好莱坞专业拉片笔记（导演景别逻辑、运镜特征、灯光反差、音效配乐），助力创作者学习提升
 */

export const CINEMA_DATABASE = [
  {
    id: 'top-gun-maverick',
    title: '壮志凌云：独行侠',
    aliases: ['壮志凌云', 'top gun', '独行侠', 'maverick'],
    era: 'Modern High-Tech',
    setting: 'canyon',
    task: 'combat',
    directorNotes: {
      director: '约瑟夫·科辛斯基 (Joseph Kosinski)',
      visualStyle: '超低空超音速实拍质感 · 驾驶舱微型广角第一人称 · 剧烈G力压迫感 · 极低角度贴地跟拍',
      lighting: '炽热正午直射光与座舱内仪表反光交织，高对比强反差',
      audioScore: '狂暴喷气引擎呼啸、过载喘息声与战术告警蜂鸣 (BEEP-BEEP-PULL-UP)',
      pedagogyLesson: '【景别拉片教学】先用极远景交代险峻峡谷地貌（压迫感），切入座舱特写看飞行员神态绷紧（代入感），再切全景展现战机超低空机动划过岩壁，形成大-小-大的视觉节奏张力。'
    },
    assets: {
      subjects: ['AIR-620', 'CHR-401'],
      environment: 'ENV-001',
      camera: 'CAM-004',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    },
    beats: [
      { phase: 'establish', action: '隐形五代战机以极低高度高速掠过峡谷底部，翼尖卷起高速气流与沙尘，战术平显锁定前方防空雷达阵地。', screenDirection: 'left-to-right', damageState: 'clean' },
      { phase: 'build', action: '地面防空导弹呼啸升空破雾扑来，战机紧急释放热诱弹，剧烈俯冲侧滚紧贴岩石缝隙规避。', screenDirection: 'left-to-right', damageState: 'weathered' },
      { phase: 'climax', action: '战机垂直拉升冲破云层，以大过载眼镜蛇机动咬住敌方拦截机尾翼，机炮与近距格斗弹齐射击碎目标。', screenDirection: 'towards-camera', damageState: 'damaged' },
      { phase: 'resolve', action: '战机发动机喷口喷射微弱蓝焰，超低空脱离战场，掠过山脊阳光穿透座舱，安全返航。', screenDirection: 'away-from-camera', damageState: 'weathered' }
    ]
  },
  {
    id: 'black-hawk-down',
    title: '黑鹰坠落',
    aliases: ['黑鹰坠落', 'black hawk down', '摩加迪沙', '索马里'],
    era: 'Modern',
    setting: 'urban',
    task: 'rescue',
    directorNotes: {
      director: '雷德利·斯科特 (Ridley Scott)',
      visualStyle: '高帧率低快门开角抽帧摄影（跳跃顿挫感） · 颗粒感高反差 · 战术手持微晃跟拍 · 尘暴浓烟笼罩',
      lighting: '灼热荒漠沙尘暖黄调，阴影处深沉冷青色，强烈的死亡压迫感',
      audioScore: '狂乱旋翼呼啸切风声、突兀致命的RPG尾焰呼啸、近距离AK杂乱扫射与急促战术手语呼叫',
      pedagogyLesson: '【战争纪实拉片】避免炫技全景，将摄影机下沉至士兵肩膀与膝盖高度。通过遮挡镜头（建筑断壁、烟雾弥漫）营造战场迷雾与视线受阻的真实绝望感。'
    },
    assets: {
      subjects: ['AIR-004', 'CHR-401', 'CHR-601'],
      environment: 'ENV-004',
      camera: 'CAM-002',
      lighting: 'LGT-002',
      colorGrade: 'CLR-002'
    },
    beats: [
      { phase: 'establish', action: '两架战术直升机低空悬停于交错的城市街道上空，特战队员顺索降绳滑降至沙尘飞扬的街道。', screenDirection: 'towards-camera', damageState: 'clean' },
      { phase: 'build', action: '屋顶伏击者发射RPG火箭弹击中尾桨，直升机剧烈自旋拖着黑烟坠落在十字路口，队员迅速散开建立环形防线。', screenDirection: 'left-to-right', damageState: 'damaged' },
      { phase: 'climax', action: '被围困的废墟机体旁，特战队员依托残骸与迫近的敌方交火，弹壳飞溅，战地医护兵拖拽负伤飞行员。', screenDirection: 'right-to-left', damageState: 'damaged' },
      { phase: 'resolve', action: '重装步战车撞开路障破尘赶到接应，幸存队员边打边撤登车，残存直升机残骸在浓烟中燃烧。', screenDirection: 'away-from-camera', damageState: 'destroyed' }
    ]
  },
  {
    id: 'gravity',
    title: '地心引力',
    aliases: ['地心引力', 'gravity', '太空站', '空间站', '失重'],
    era: 'Orbital',
    setting: 'space',
    task: 'rescue',
    directorNotes: {
      director: '阿方索·卡隆 (Alfonso Cuarón)',
      visualStyle: '超长无剪辑运镜流 · 零重力无上下视点翻滚 · 极其深邃宏伟的地球背景与幽暗太空反差',
      lighting: '未经大气散射的硬质太阳强白光，阴影区为绝对漆黑，地球反光提供微弱蓝色辅光',
      audioScore: '真空完全静音（仅保留太空服内沉重的心跳声、粗重喘息声与无线电静噪破损声）',
      pedagogyLesson: '【长镜头与空间意识】在太空中摒弃地平线参照物，利用失重翻滚打破常规构图，让角色在画面边缘不断漂移，调动观众的失控恐惧与眩晕共鸣。'
    },
    assets: {
      subjects: ['CHR-702', 'AIR-701'],
      environment: 'ENV-701',
      camera: 'CAM-001',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    },
    beats: [
      { phase: 'establish', action: '宇航员在近地轨道空间站外壁进行机械臂维修作业，远处蔚蓝地球弧线缓缓流转，阳光洒在金色面罩上。', screenDirection: 'neutral', damageState: 'clean' },
      { phase: 'build', action: '高超音速报废卫星碎片风暴暴击空间站，太阳能帆板瞬间粉碎解体，安全绳索被切断，宇航员失控向太空深处翻滚。', screenDirection: 'left-to-right', damageState: 'damaged' },
      { phase: 'climax', action: '宇航员在疯狂自旋中冷静启动喷气背包微型姿态发动机，划出白色微气流精准反向制动，扑抓到残存气闸舱手柄。', screenDirection: 'towards-camera', damageState: 'damaged' },
      { phase: 'resolve', action: '宇航员重重撞入应急气闸舱反手锁闭外门，加压指示灯由红转绿，氧气喷涌，宇航员脱力蜷缩在失重舱中。', screenDirection: 'neutral', damageState: 'weathered' }
    ]
  },
  {
    id: 'edge-of-tomorrow',
    title: '明日边缘',
    aliases: ['明日边缘', 'edge of tomorrow', '外骨骼', '动力装甲'],
    era: 'Modern High-Tech',
    setting: 'beach',
    task: 'combat',
    directorNotes: {
      director: '道格·里曼 (Doug Liman)',
      visualStyle: '沉浸式主观战壕第一视角 · 外骨骼重型机械力量顿挫感 · 高速位移与瞬间急停',
      lighting: '阴霾暴风雨海滩，泥水混杂，火光与炮弹白烟瞬时撕裂天空',
      audioScore: '外骨骼伺服液压泵低频啸叫、智能重机枪连发沉闷轰鸣与地面剧烈震颤',
      pedagogyLesson: '【机械感动作拉片】每一个跳跃、落地都需要有强烈的动能反冲停顿。用微距定格突出机械轴承与活塞的微小液压行程，传递冰冷强大的工程力量感。'
    },
    assets: {
      subjects: ['CHR-630', 'VEH-620'],
      environment: 'ENV-001',
      camera: 'CAM-003',
      lighting: 'LGT-002',
      colorGrade: 'CLR-002'
    },
    beats: [
      { phase: 'establish', action: '动力外骨骼特战队员被轨道空降舱重摔投放在泥泞滩头，装甲解开卡扣，肩挂重型机炮伺服电机极速激活。', screenDirection: 'towards-camera', damageState: 'clean' },
      { phase: 'build', action: '外骨骼特战队员在枪林弹雨中借助液压弹跳翻越反坦克堑壕，伴随无人机蜂群呼啸掠过头顶对目标实施精确洗地。', screenDirection: 'left-to-right', damageState: 'weathered' },
      { phase: 'climax', action: '重装特战队员与突入防线的机械战车正面硬碰，外骨骼手臂硬顶钢板冲击，肩炮全自动贴脸扫射引发殉爆。', screenDirection: 'right-to-left', damageState: 'damaged' },
      { phase: 'resolve', action: '硝烟散去，外骨骼伺服电机冒出淡淡蒸汽，特战队员踩在残骸之上给重武器更换弹药箱，目光警惕巡视战场。', screenDirection: 'towards-camera', damageState: 'damaged' }
    ]
  },
  {
    id: 'sicario',
    title: '边境杀手',
    aliases: ['边境杀手', 'sicario', '暗夜突袭', '热成像', '夜视仪'],
    era: 'Modern',
    setting: 'border',
    task: 'patrol',
    directorNotes: {
      director: '丹尼斯·维伦纽瓦 (Denis Villeneuve)',
      visualStyle: '极简冷酷的对称构图 · 慢节奏潜伏与瞬间爆发 · 热成像与微光夜视交替 · 压迫感极强的地平线剪影',
      lighting: '落日余晖吞噬的苍凉荒原，进入室内切为深黑环境与幽绿夜视管微光',
      audioScore: '约翰·约翰逊大师级压迫感大提琴重音、消音器噗噗轻响与战术心跳监听',
      pedagogyLesson: '【悬念与静谧拉片】最强烈的紧张往往来自于“开火前的极度安静”。通过长达数秒的静音潜入与无声手势，压低视听刺激，随后用不到半秒的瞬间破门开火形成巨大情绪反差。'
    },
    assets: {
      subjects: ['CHR-401', 'CHR-405'],
      environment: 'ENV-640',
      camera: 'CAM-001',
      lighting: 'LGT-003',
      colorGrade: 'CLR-003'
    },
    beats: [
      { phase: 'establish', action: '四名全副武装的特战队员佩戴四目夜视仪，在幽暗的地下通道外围呈战术楔形队形无声潜伏推进。', screenDirection: 'left-to-right', damageState: 'clean' },
      { phase: 'build', action: '队员在防爆门两侧就位，贴上微型定向破障炸药，微光热成像红外激光线在门缝间交错校准。', screenDirection: 'towards-camera', damageState: 'standard' },
      { phase: 'climax', action: '爆破瞬间无声突入，加装消音器的短突击步枪连续两发点射精准压制掩体内部目标，战术手电在烟雾中切割光束。', screenDirection: 'right-to-left', damageState: 'weathered' },
      { phase: 'resolve', action: '队长打出安全手势，队员迅速回收战术情报硬盘，整队退入黑暗通道消失在阴影中。', screenDirection: 'away-from-camera', damageState: 'weathered' }
    ]
  },
  {
    id: 'the-wandering-earth',
    title: '流浪地球',
    aliases: ['流浪地球', 'wandering earth', '行星发动机', '太空电梯', '地下城'],
    era: 'Orbital',
    setting: 'space',
    task: 'rescue',
    directorNotes: {
      director: '郭帆 (Frant Gwo)',
      visualStyle: '中国重工业宏大硬核美学 · 超巨型积木机械结构 · 冰原极寒与深空冷峻 · 群体牺牲英雄主义',
      lighting: '零下80度地表惨白雪原光，地平线上喷射数千米蓝色等离子光柱，深空红巨星冷艳辉映',
      audioScore: '重型行星发动机重低音脉冲共振、工程装甲重卡粗犷履带轰响与宏大交响合唱',
      pedagogyLesson: '【工业巨物感拉片】通过微缩人仔与超巨型发动机底座的极悬殊尺寸比例（1:1000对比），让乐高积木也能呈现震撼人心的科幻工业史诗感。'
    },
    assets: {
      subjects: ['CHR-701', 'VEH-005', 'ENV-701'],
      environment: 'ENV-701',
      camera: 'CAM-001',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    },
    beats: [
      { phase: 'establish', action: '重型雪地运输车队驶过冰封零下八十度的废墟地表，远方行星发动机巨大的等离子蓝色光柱直刺幽暗深空。', screenDirection: 'left-to-right', damageState: 'weathered' },
      { phase: 'build', action: '空间站轨道发生偏移警报拉响，地面救援分队顶着漫天冰屑手动推动巨型击发核心插销，履带打滑火花四溅。', screenDirection: 'towards-camera', damageState: 'damaged' },
      { phase: 'climax', action: '空间站外舱突击队员点燃穿梭艇副油箱，以决死姿态将等离子推力峰值导向引爆窗口，在失重太空中爆发出耀眼白光。', screenDirection: 'right-to-left', damageState: 'damaged' },
      { phase: 'resolve', action: '冲击波划过近地轨道，地球平稳擦过木星轨道引力弹弓，微缩宇航员站在破碎气闸舱前凝望晨曦初现。', screenDirection: 'towards-camera', damageState: 'weathered' }
    ]
  },
  {
    id: 'saving-private-ryan',
    title: '拯救大兵瑞恩',
    aliases: ['拯救大兵瑞恩', 'saving private ryan', '诺曼底', '奥马哈'],
    era: 'WWII',
    setting: 'beach',
    task: 'combat',
    directorNotes: {
      director: '史蒂文·斯皮尔伯格 (Steven Spielberg)',
      visualStyle: '45度手持跳帧快门 · 溅水镜头模糊 · 绝望残酷的滩头平铺直叙',
      lighting: '灰白阴沉的诺曼底阴天，毫无浪漫色彩的残酷自然光',
      audioScore: '海水拍打登陆艇钢板、子弹撞击头盔沉闷金属音与短促震撼的战地耳鸣声',
      pedagogyLesson: '【主观生理沉浸拉片】在爆炸瞬间适度加入“失聪高频耳鸣音”，画面配合慢速抽搐，模拟士兵被震懵的生理真实体验。'
    },
    assets: {
      subjects: ['CHR-101', 'VEH-103'],
      environment: 'ENV-101',
      camera: 'CAM-002',
      lighting: 'LGT-002',
      colorGrade: 'CLR-002'
    },
    beats: [
      { phase: 'establish', action: '希金斯登陆艇在汹涌灰暗的海浪中冲向诺曼底滩头，海水不断拍打在紧握步枪的士兵头盔上。', screenDirection: 'towards-camera', damageState: 'clean' },
      { phase: 'build', action: '登陆艇钢制跳板轰然落下，密集的机枪弹雨瞬间泼洒而来，士兵前仆后继跳入冰冷的海水中泅渡。', screenDirection: 'left-to-right', damageState: 'weathered' },
      { phase: 'climax', action: '上尉带领工兵冒死匍匐至铁丝网和暗堡死角，引爆班加罗尔鱼雷炸药筒，在火光与沙尘中撕开突破口。', screenDirection: 'right-to-left', damageState: 'damaged' },
      { phase: 'resolve', action: '浓烟散去，幸存士兵登上悬崖战壕回望滩头，沾满沙砾的头盔靠在断壁旁，海风吹散战火硝烟。', screenDirection: 'away-from-camera', damageState: 'damaged' }
    ]
  },
  {
    id: 'dunkirk',
    title: '敦刻尔克',
    aliases: ['敦刻尔克', 'dunkirk', '克里斯托弗诺兰'],
    era: 'WWII',
    setting: 'naval',
    task: 'rescue',
    directorNotes: {
      director: '克里斯托弗·诺兰 (Christopher Nolan)',
      visualStyle: '海陆空三重视空交错 · 70mm 胶片大画幅苍凉质感 · 几乎零废话的纯视觉视听推进',
      lighting: '英吉利海峡惨淡微弱的日光，苍蓝海水与惨白沙滩形成空旷绝望感',
      audioScore: '汉斯·季默谢泼德音调（永远在无限上升紧迫加速的秒针滴答声）',
      pedagogyLesson: '【倒计时心理压迫拉片】用极其简单而恒定的滴答声作为全片节奏锚点，不需要过多的对白，镜头只专注在潮汐涨落与空中轰鸣的迫近。'
    },
    assets: {
      subjects: ['CHR-101', 'VEH-103', 'AIR-001'],
      environment: 'ENV-101',
      camera: 'CAM-001',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    },
    beats: [
      { phase: 'establish', action: '成千上万名士兵整齐列队在空旷苍凉的敦刻尔克海滩防波堤上，海风吹卷传单，天际隐隐传来轰炸机尖啸。', screenDirection: 'left-to-right', damageState: 'weathered' },
      { phase: 'build', action: '俯冲轰炸机贴海扑来投下炸弹，驱逐舰在近海中弹倾斜，民用小渔船与游艇冒着水柱逆向前来接应。', screenDirection: 'towards-camera', damageState: 'damaged' },
      { phase: 'climax', action: '最后一架喷火战斗机在燃料耗尽前以滑翔姿态超低空掠过沙滩，在最后时刻击落俯冲敌机，引发滩头官兵欢呼。', screenDirection: 'left-to-right', damageState: 'damaged' },
      { phase: 'resolve', action: '无动力的战机平稳迫降在退潮的金色沙滩上，飞行员从容点燃座舱，望着远去的救援船队缓缓走入黄昏。', screenDirection: 'away-from-camera', damageState: 'destroyed' }
    ]
  }
];

/**
 * 输入电影名字或关键词，转译出专属乐高脚本与拉片笔记
 * @param {string} query 电影名称或主题输入
 * @param {number} requestedShots 镜头数量 (4 / 8 / 12)
 * @returns {object} 包含电影解析、拉片教学笔记、四阶段乐高动作与推荐资产
 */
export function transpileMovieToLego(query, requestedShots = 4) {
  const q = String(query || '').trim().toLowerCase();

  // 1. 精确与别名匹配
  let match = CINEMA_DATABASE.find(item => {
    if (item.title.toLowerCase() === q || item.id.toLowerCase() === q) return true;
    return item.aliases.some(alias => q.includes(alias.toLowerCase()));
  });

  // 2. 若未直接命中，根据关键词推导电影风格原型
  if (!match) {
    if (/太空|空间站|星际|流浪|宇宙|gravity|interstellar|space/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'gravity');
    } else if (/空战|战机|飞机|飞行员|top gun|dogfight/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'top-gun-maverick');
    } else if (/外骨骼|机甲|科幻|未来|边缘|exoskeleton/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'edge-of-tomorrow');
    } else if (/夜战|特战|突袭|暗夜|夜视|sicario/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'sicario');
    } else if (/诺曼底|二战|登陆|拯救|ryan/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'saving-private-ryan');
    } else {
      match = CINEMA_DATABASE.find(m => m.id === 'black-hawk-down'); // 经典战术断后作为通用兜底
    }
  }

  // 3. 构建 4 / 8 / 12 镜头动作序列
  const baseBeats = match.beats;
  const shots = [];

  if (requestedShots === 4) {
    baseBeats.forEach((b, idx) => {
      shots.push({
        shotId: `shot_${idx + 1}`,
        phase: b.phase,
        action: b.action,
        screenDirection: b.screenDirection,
        damageState: b.damageState,
        subjects: match.assets.subjects,
        environment: match.assets.environment,
        camera: match.assets.camera,
        lighting: match.assets.lighting,
        colorGrade: match.assets.colorGrade
      });
    });
  } else {
    // 8 或 12 镜头进行深度拓展
    const count = Number(requestedShots) || 8;
    for (let i = 0; i < count; i++) {
      const beatIdx = Math.floor((i / count) * baseBeats.length);
      const b = baseBeats[beatIdx];
      const isSub = (i % 2 === 1);
      shots.push({
        shotId: `shot_${i + 1}`,
        phase: b.phase,
        action: isSub ? `[特写延续] ${b.action}，局部积木零件细节剧烈震颤。` : b.action,
        screenDirection: b.screenDirection,
        damageState: b.damageState,
        subjects: match.assets.subjects,
        environment: match.assets.environment,
        camera: match.assets.camera,
        lighting: match.assets.lighting,
        colorGrade: match.assets.colorGrade
      });
    }
  }

  return {
    matchedMovie: match.title,
    movieId: match.id,
    era: match.era,
    directorNotes: match.directorNotes,
    themeZh: `【${match.title} 经典视听致敬】${match.beats[0].action.slice(0, 30)}…`,
    shots,
    assets: match.assets
  };
}
