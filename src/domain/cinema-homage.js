/**
 * LEGO War Universe - 经典电影深度视听解构与乐高转译引擎 (Cinema Transpiler 3.0)
 * 将真人电影的核心戏剧冲突、导演视听语法与声画对齐，深度转译为乐高微缩定格大片
 */

export const CINEMA_DATABASE = [
  {
    id: 'top-gun-maverick',
    title: '壮志凌云：独行侠 (Top Gun: Maverick)',
    aliases: ['壮志凌云', 'top gun', '独行侠', 'maverick', '阿汤哥', '战斗机'],
    director: '约瑟夫·科辛斯基 (Joseph Kosinski)',
    year: '2022',
    genre: '现代空战 / 极限超音速突防',
    dramaticConflict: '在两分钟严苛时限内，以超低空贴地穿透雷达盲区与密集萨姆导弹网，摧毁高山深处重兵把守的目标。',
    visualGrammar: {
      cameraMotion: '超低空贴地跟拍 · 驾驶舱微型广角第一人称特写 · 翼尖超音速拉烟螺旋翻滚',
      lightingTone: '高反差炽烈戈壁烈日，暗红座舱仪表背光与刺眼阳光交织，极高动态范围',
      soundDesign: '双发大推力涡扇加力咆哮、飞行员高G压迫沉重呼吸声、防空雷达锁定尖锐警报 (BEEP-BEEP-PULL-UP)'
    },
    legoAdaptation: '采用乐高暗哑吸波涂层五代隐形战机零件，通过微缩透明座舱件反射微弱摄影棚柔光箱，用高速风扇与微细粉尘在镜头前吹拂模拟气流拉烟。',
    creatorTips: '【前3秒吸睛钩子】第一镜头切忌平淡，开场就是座舱仪表剧烈红光与发动机喷火特写，瞬间拉满完播率。',
    assets: {
      subjects: ['AIR-620', 'CHR-401'],
      environment: 'ENV-001',
      camera: 'CAM-004',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    },
    shots: [
      {
        phase: 'establish',
        shotType: '超低空掠地全景 (Extreme Low Aerial Wide)',
        action: '两架隐形五代战机以两马赫速度超低空掠过崎岖峡谷裂隙，翼下高速喷流吹散地面乐高沙砾，地平线上防空导弹雷达天线旋转锁定。',
        screenDirection: 'left-to-right',
        damageState: 'clean',
        audioCue: '震耳欲聋的双发涡扇加力轰鸣 · 呼啸撕裂空气声',
        radioVoice: '【无线电】猎鹰小队，高度50英尺，进入雷达盲区，保持无线电静默！'
      },
      {
        phase: 'build',
        shotType: '驾驶舱特写与过载规避 (Cockpit Close-Up & Break)',
        action: '三枚萨姆地对空导弹破雾腾空扑来，座舱告警红光闪烁，特战飞行员猛拉操纵杆，战机释放热诱弹并在两座垂直悬崖间做90度大角度侧翻。',
        screenDirection: 'left-to-right',
        damageState: 'weathered',
        audioCue: '急促警报短促蜂鸣 · 热诱弹连续爆裂闷响',
        radioVoice: '【无线电】导弹来袭！热诱弹投放！拉起！全力拉起！'
      },
      {
        phase: 'climax',
        shotType: '俯冲攻顶与垂直反杀 (Dive Attack & G-Turn)',
        action: '战机在山脊拐角处瞬间垂直跃升冲顶，机腹弹舱全自动开启，制导炸弹垂直精准贯穿深坑掩体，后方敌方拦截机咬尾，战机大过载眼镜蛇机动反客为主。',
        screenDirection: 'towards-camera',
        damageState: 'damaged',
        audioCue: '炸药引爆山体巨震回响 · 机炮连续撕扯破空声',
        radioVoice: '【无线电】命中目标！直接摧毁！准备进行高G脱离！'
      },
      {
        phase: 'resolve',
        shotType: '高速超音速返航长镜头 (High-Speed Extraction)',
        action: '尾喷管喷出微弱幽蓝马赫环，两架战机破空穿云而出，夕阳金光穿透机翼塑料积木质感，在金色晚霞中低空编队安全返航。',
        screenDirection: 'away-from-camera',
        damageState: 'weathered',
        audioCue: '远去引擎低频余音 · 战术电台清脆信标音',
        radioVoice: '【无线电】指挥部，任务达成，全员存活，正在返航航母。'
      }
    ]
  },
  {
    id: 'black-hawk-down',
    title: '黑鹰坠落 (Black Hawk Down)',
    aliases: ['黑鹰坠落', 'black hawk down', '摩加迪沙', '城市巷战', '索降'],
    director: '雷德利·斯科特 (Ridley Scott)',
    year: '2001',
    genre: '现代战术突入 / 城市绞杀断后',
    dramaticConflict: '原本一小时的闪电抓捕任务突遭RPG击坠直升机，被困小队在数十倍敌人的包围网中固守待援，不放弃任何一个战友。',
    visualGrammar: {
      cameraMotion: '高快门开角抽帧顿挫感（跳跃硬朗） · 士兵下沉机位跟跑 · 浓烟断壁穿梭遮挡',
      lightingTone: '灼热浑浊沙尘暖黄，建筑物阴影冷灰蓝，强烈的战地燥热与窒息压迫感',
      audioScore: '黑鹰旋翼沉重破风切片声、突兀致命的RPG破空呼啸、近距离AK杂乱连射与弹壳跳跃脆响'
    },
    legoAdaptation: '通过乐高砖块搭建破败水泥公寓楼，在地上散落大量灰色单凸点积木充当混凝土碎块，使用低角度微距镜头捕捉士兵塑料战术背心上的微观泥垢洗色。',
    creatorTips: '【纪实感拉片】镜头永远不要居中摆放，多利用断墙、燃烧的油桶作为前景遮挡，让观众觉得摄影师也是趴在战壕里的士兵。',
    assets: {
      subjects: ['AIR-004', 'CHR-401', 'CHR-601'],
      environment: 'ENV-004',
      camera: 'CAM-002',
      lighting: 'LGT-002',
      colorGrade: 'CLR-002'
    },
    shots: [
      {
        phase: 'establish',
        shotType: '直升机悬停索降全景 (Helo Hover Insertion)',
        action: '两架战术直升机在灰尘弥漫的城市街道低空悬停，四根粗索降绳掷下，特战队员呈战术姿态顺绳滑降，周围街道楼顶人影攒动。',
        screenDirection: 'towards-camera',
        damageState: 'clean',
        audioCue: '巨大下洗气流狂风呼啸 · 沉重索降绳撞击地面声',
        radioVoice: '【无线电】粉笔四号，落地建立周界防线，RPG射手在两点钟方向屋顶！'
      },
      {
        phase: 'build',
        shotType: 'RPG伏击与坠毁迫降 (Ambush & Crash Impact)',
        action: '屋顶伏击者发射RPG破空拖着白烟贯穿后尾桨，直升机机身剧烈打转，黑烟滚滚重重砸在十字路口，旋翼在水泥墙上砸成碎片飞溅。',
        screenDirection: 'left-to-right',
        damageState: 'damaged',
        audioCue: '尾桨碎裂金属尖啸 · 机身重击地面撞击碎裂声',
        radioVoice: '【无线电】Super 64坠落！重复！黑鹰坠落！立即前往坠机点搜救！'
      },
      {
        phase: 'climax',
        shotType: '残骸依托360度环形阻击 (Perimeter Defense)',
        action: '被困特战队员依托冒烟的直升机机体残骸建立360度防线，子弹在积木装甲上溅起火星，医护兵冒死将重伤飞行员拖入死角包扎。',
        screenDirection: 'right-to-left',
        damageState: 'damaged',
        audioCue: '连续密集枪火射击声 · 破片飞溅反弹音',
        radioVoice: '【无线电】子弹打光了！弹药箱告急！我们守不住这个街角了！'
      },
      {
        phase: 'resolve',
        shotType: '重装护航车队冲关突围 (Armored Convoy Breakout)',
        action: '装甲步战车撞碎燃烧的路障轰鸣冲入战场，重机枪压制两侧屋顶火力，幸存队员互相搀扶登车，直升机残骸在浓烟中渐行渐远。',
        screenDirection: 'away-from-camera',
        damageState: 'destroyed',
        audioCue: '大口径机枪压制扫射 · 重型履带碾压路障碎裂声',
        radioVoice: '【无线电】所有人登车，回家了，我们把所有人都带回去了。'
      }
    ]
  },
  {
    id: 'gravity',
    title: '地心引力 (Gravity)',
    aliases: ['地心引力', 'gravity', '太空站', '空间站', '失重', '宇航员'],
    director: '阿方索·卡隆 (Alfonso Cuarón)',
    year: '2013',
    genre: '近未来太空轨道硬科幻 / 绝境求生',
    dramaticConflict: '轨道卫星连锁解体产生万物皆灭的高速碎片风暴，摧毁空间站，落单宇航员在绝氧与失重深渊中孤身泅渡求生。',
    visualGrammar: {
      cameraMotion: '超长无剪辑连续长镜头 · 无上下天地视点自由旋转 · 巨大地球圆弧与深邃宇宙虚空对比',
      lightingTone: '未经大气层散射的高纯度硬直射阳光，阴影区为纯粹幽黑，地球反射出微弱清澈蓝晕',
      audioScore: '外太空真空绝对寂静，仅保留航天服内部粗重压抑的心跳声、加压气体微喘与无线电杂音断续'
    },
    legoAdaptation: '在深黑布景前搭建白色与亮灰乐高模块化空间站舱段，利用金色电镀砖块还原太阳能电池帆板，镜头微距聚焦宇航员头盔面罩上的地球反光细节。',
    creatorTips: '【太空电影精髓】声画克制。在灾难最剧烈时不要加震耳爆炸音，反而要完全静音，只听急促的呼吸与心跳，惊悚感提升十倍。',
    assets: {
      subjects: ['CHR-702', 'AIR-701'],
      environment: 'ENV-701',
      camera: 'CAM-001',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    },
    shots: [
      {
        phase: 'establish',
        shotType: '近地轨道舱外漫步全景 (LEO Spacewalk Wide)',
        action: '两名乐高宇航员固定在空间站外部机械臂上维修仪器，巨大的地球蓝色大气层在下方缓缓旋转，宇宙静谧深邃，金色面罩反射晨光。',
        screenDirection: 'neutral',
        damageState: 'clean',
        audioCue: '绝对静音 · 太空服生命维持系统轻微气流声',
        radioVoice: '【无线电】休斯敦，通信阵列校准完成，视野绝美，一切正常。'
      },
      {
        phase: 'build',
        shotType: '碎片风暴毁灭性撞击 (Debris Cloud Impact)',
        action: '超音速报废卫星碎片风暴无声破空穿刺而来，太阳能电池翼瞬间粉碎炸裂成无数碎片，机械臂折断，安全缆绳绷断，宇航员被巨力甩飞向太空深渊。',
        screenDirection: 'left-to-right',
        damageState: 'damaged',
        audioCue: '真空震动传导闷响 · 急促粗重的呼吸声和心跳声加速',
        radioVoice: '【无线电】注意碎片！快抓紧！缆绳断了！我正在失控翻滚！'
      },
      {
        phase: 'climax',
        shotType: '喷气背包极限反向姿态修正 (MMU Thruster Burn)',
        action: '宇航员在黑暗太空中急速旋转，冷静启动喷气背包微型姿态发动机，白色微冷气喷射精准抵消角动量，拼尽全力伸手扣抓到逃生舱外壁把手。',
        screenDirection: 'towards-camera',
        damageState: 'damaged',
        audioCue: '微型喷嘴短促喷气嘶嘶声 · 手套金属挂钩卡入锁定清脆声',
        radioVoice: '【无线电】锁定姿态！抓住了！抓住气闸舱门把手了！'
      },
      {
        phase: 'resolve',
        shotType: '气闸舱闭门复压与释怀 (Airlock Ingress & Re-press)',
        action: '宇航员翻入狭小气闸舱拉紧外舱门旋转锁死，加压指示灯由红转绿，氧气喷涌，宇航员摘掉头盔脱力蜷缩在失重舱中，泪水化作积木圆点在空中漂浮。',
        screenDirection: 'neutral',
        damageState: 'weathered',
        audioCue: '空气涌入气闸舱高压充气嘶鸣声 · 释怀的长长吐气声',
        radioVoice: '【无线电】气闸已加压，我活下来了，准备点火返回地球。'
      }
    ]
  },
  {
    id: 'edge-of-tomorrow',
    title: '明日边缘 (Edge of Tomorrow)',
    aliases: ['明日边缘', 'edge of tomorrow', '外骨骼', '动力机甲', '阿汤哥科幻'],
    director: '道格·里曼 (Doug Liman)',
    year: '2014',
    genre: '重工业科幻战争 / 时间轮回强袭',
    dramaticConflict: '人类身穿笨重简陋的液压动力外骨骼，在滩头阵地迎战以绝对速度与数量碾压的外星生物，一次次在绝望中寻找破局密码。',
    visualGrammar: {
      cameraMotion: '战壕主观第一视角随身冲刺 · 机械重击地面动能反冲停顿 · 超高动态泥水飞溅',
      lightingTone: '泥泞暴雨灰冷天光，炮火殉爆与等离子射流瞬时强白光撕破阴暗',
      audioScore: '外骨骼伺服液压泵高负荷啸叫、手控重武器粗暴换弹机械咔嚓声与地面剧烈震颤'
    },
    legoAdaptation: '人仔外部拼接黑色与金属灰乐高机械组细小连杆，背部装载双联重弹箱，微距定格展现关节转动时的活塞行程，强调工业零件粗犷的受力美。',
    creatorTips: '【外骨骼动作要领】每个落脚点和开火动作必须有强烈的“后坐力缓冲”定格顿挫，不要平滑划过，顿挫感是机械力量感的源泉。',
    assets: {
      subjects: ['CHR-630', 'VEH-620'],
      environment: 'ENV-001',
      camera: 'CAM-003',
      lighting: 'LGT-002',
      colorGrade: 'CLR-002'
    },
    shots: [
      {
        phase: 'establish',
        shotType: '空降舱落地与机甲激活 (Drop Pod Crash & Arming)',
        action: '重型装甲空降舱在泥泞滩头摔得粉碎，动力外骨骼特战队员被甩出舱外，脚部液压支柱深陷泥坑，背部双联重机枪全自动旋转上膛。',
        screenDirection: 'towards-camera',
        damageState: 'clean',
        audioCue: '空降舱撞击撕裂巨响 · 液压伺服电机瞬时充电高频蜂鸣',
        radioVoice: '【无线电】全员着陆！解除保险！跟上主攻步兵连推进！'
      },
      {
        phase: 'build',
        shotType: '泥泞战壕极限弹跳冲锋 (Trench Sprint & Leap)',
        action: '特战队员在外骨骼增力辅助下一跃跃过三米宽的反坦克战壕，伴随无人机蜂群低空掠地扫射压制敌方阵地，弹壳如雨点般砸在胸甲上。',
        screenDirection: 'left-to-right',
        damageState: 'weathered',
        audioCue: '外骨骼重力踏步泥浆飞溅声 · 蜂群无人机群呼啸撕破长空',
        radioVoice: '【无线电】掩护左翼！无人机蜂群已锁定掩体，引爆！'
      },
      {
        phase: 'climax',
        shotType: '零距离近身硬撼重装殉爆 (Point-Blank Mechanical Duel)',
        action: '敌方重型机械从沙土中暴起扑杀，特战队员用外骨骼机械臂硬生生抗住钢爪冲击，肩扛重炮零距离抵住敌人核心全速连射引发毁灭殉爆。',
        screenDirection: 'right-to-left',
        damageState: 'damaged',
        audioCue: '金属剧烈形变尖锐摩擦声 · 贴身炮火近距轰鸣震裂音',
        radioVoice: '【无线电】去死吧！开火！全弹发射！'
      },
      {
        phase: 'resolve',
        shotType: '硝烟中的机械喘息特写 (Stand on the Wreckage)',
        action: '烈焰在焦黑沙滩上燃烧，外骨骼散热排气孔喷涌出白色高压蒸汽，特战队员将空弹夹扔在残骸上，单手提起重炮站立在废墟顶端。',
        screenDirection: 'towards-camera',
        damageState: 'damaged',
        audioCue: '泄压阀高压蒸汽嘶鸣声 · 炽热枪管微弱噼啪声',
        radioVoice: '【无线电】阵地已被肃清，我是唯一幸存者，正在重新校准时间。'
      }
    ]
  },
  {
    id: 'the-wandering-earth',
    title: '流浪地球 (The Wandering Earth)',
    aliases: ['流浪地球', 'wandering earth', '行星发动机', '太空电梯', '吴京', '郭帆'],
    director: '郭帆 (Frant Gwo)',
    year: '2019',
    genre: '硬核重工业科幻 / 宏大行星尺度史诗',
    dramaticConflict: '太阳即将熄灭，人类建造一万座巨型行星发动机推走地球，在面对木星引力死局时，唯有凡人微光汇聚成拯救文明的行星级决绝。',
    visualGrammar: {
      cameraMotion: '极端悬殊尺寸对比（极小微缩人仔 vs 万米巨型等离子发动机） · 俯视苍茫冰原大地 · 重机械硬朗切角',
      lightingTone: '极寒地表惨白雪原冷光，冲天而起的数千米深蓝等离子光柱照亮天际，木星赤红巨眼压迫苍穹',
      audioScore: '行星发动机百万吨级地壳共振超低频脉冲、重型工程步战车十二轮粗犷碾雪声与磅礴合唱交响'
    },
    legoAdaptation: '利用大批量深灰基础砖堆叠倾斜支撑架构呈现工业发动机基座，人仔搭配重型防寒面罩与微型火石推车，用蓝白色透明发光件在底部打出等离子火焰。',
    creatorTips: '【工业史诗感拉片】人一定要小，机械一定要大！把乐高人仔放在画面最底部的微小角落，上方留出80%画面给耸入云霄的工业钢铁结构。',
    assets: {
      subjects: ['CHR-701', 'VEH-005', 'ENV-701'],
      environment: 'ENV-701',
      camera: 'CAM-001',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    },
    shots: [
      {
        phase: 'establish',
        shotType: '冰封地表与发动机巨柱全景 (Frozen Earth & Engine Spire)',
        action: '零下八十度的冰封城市废墟间，运载车队艰难破雪行驶，远景中高达万米的行星发动机喷出直插云霄的蓝色等离子光柱。',
        screenDirection: 'left-to-right',
        damageState: 'weathered',
        audioCue: '风雪呼啸极寒冷啸声 · 行星发动机低频大地心跳共鸣',
        radioVoice: '【无线电】北京第三区交通委提醒您：道路千万条，安全第一条。'
      },
      {
        phase: 'build',
        shotType: '火石核心装载与发动机抢修 (Fuel Core Manual Transport)',
        action: '发动机转向节因地震卡死，救援小队队员冒着暴风雪在冰裂断崖边用绳索拼死稳住巨大的发光火石核心，履带重卡全负荷倒车绞盘绷直。',
        screenDirection: 'towards-camera',
        damageState: 'damaged',
        audioCue: '高强度钢缆受力紧绷呻吟声 · 引擎狂暴空转雪屑横飞',
        radioVoice: '【无线电】救援队集合！火石必须在三十秒内送进点火室！'
      },
      {
        phase: 'climax',
        shotType: '空间站引力弹弓决死引爆 (Space Station Ignition Sacrifice)',
        action: '空间站近地轨道上，穿梭艇载着宇航员手动切断自动化限制，全力冲向空间站主燃料舱，在失重虚空中点燃了点燃木星大气的壮丽火炬。',
        screenDirection: 'right-to-left',
        damageState: 'damaged',
        audioCue: '主发动机全功率过载剧烈呼啸 · 震天动地的等离子烈焰席卷',
        radioVoice: '【无线电】地球，这里是领航员空间站，我们决定选择希望。'
      },
      {
        phase: 'resolve',
        shotType: '擦过木星晨曦照亮新家园 (Dawn on New Orbit)',
        action: '巨大的冲击波将地球缓缓推离木星引力死线，晨光穿透冰封雪原洒在积木运载车顶端，微缩人仔推开驾驶舱门仰望天际那一抹金色曙光。',
        screenDirection: 'towards-camera',
        damageState: 'weathered',
        audioCue: '激昂宏大的管弦交响乐渐起 · 清脆的风声掠过车顶',
        radioVoice: '【无线电】引力死线已突破，地球平稳启航，微光照亮前路。'
      }
    ]
  },
  {
    id: 'sicario',
    title: '边境杀手 (Sicario)',
    aliases: ['边境杀手', 'sicario', '暗夜突击', '夜视仪', '微光暗杀'],
    director: '丹尼斯·维伦纽瓦 (Denis Villeneuve)',
    year: '2015',
    genre: '现代暗夜高危特战 / 极度压迫感冷峻渗透',
    dramaticConflict: '深入法外之地的黑暗地下隧道网络，在黑白难辨的灰色秩序中执行致命突袭，任何一丝声响都将招致毁灭伏击。',
    visualGrammar: {
      cameraMotion: '冷酷严谨的水平对称构图 · 慢节奏潜伏与瞬间爆发 · 热成像/绿色微光夜视仪主观视点',
      lightingTone: '荒漠血色残阳落幕，转入地下伸手不见五指的深黑，红外红点与激光线在夜视管中交织',
      audioScore: '大师级大提琴重音缓慢拖曳（宛如地底野兽沉闷呼吸）、消音器轻响与微弱心跳声'
    },
    legoAdaptation: '在全黑摄影棚使用单束幽暗侧光，人仔佩戴战术四目夜视仪，用极细半透明红棒模拟战术激光指示线，镜头对准砖块枪口消音器处的火光微喷。',
    creatorTips: '【悬念与静谧拉片】最强烈的紧张往往来自于“开火前的极度安静”。通过长达数秒的静音潜入与无声手势，压低视听刺激，随后用瞬间破门开火形成巨大情绪反差。',
    assets: {
      subjects: ['CHR-401', 'CHR-405'],
      environment: 'ENV-640',
      camera: 'CAM-001',
      lighting: 'LGT-003',
      colorGrade: 'CLR-003'
    },
    shots: [
      {
        phase: 'establish',
        shotType: '残阳地平线战术推进全景 (Dusk Silhouette Advance)',
        action: '夕阳血红色的余晖中，四名全副武装的特战队员呈战术楔形无声走下斜坡，缓缓消失在幽深黑暗的地下掩体隧道入口。',
        screenDirection: 'left-to-right',
        damageState: 'clean',
        audioCue: '压抑深沉的大提琴低音轰鸣 · 战术军靴踩踏干燥泥土细微声',
        radioVoice: '【无线电】进入隧道，切换热成像，发现目标立即清除。'
      },
      {
        phase: 'build',
        shotType: '夜视管微光瞄准与破障 (Night Vision Breach Point)',
        action: '夜视仪第一人称视角下，幽绿画面中热成像红外激光线划过紧闭的防爆门，队员在门轴贴上定向切口炸药，打出三指倒数手势。',
        screenDirection: 'towards-camera',
        damageState: 'weathered',
        audioCue: '极度死寂 · 呼吸面罩微弱吸气声 · 炸药贴覆金属轻响',
        radioVoice: '【无线电】3、2、1，破门！'
      },
      {
        phase: 'climax',
        shotType: '瞬间无声歼敌肃清 (Suppressed CQC Takedown)',
        action: '防爆门轰然洞开，消音突击步枪瞬间两连点射，微弱枪口火花闪烁，敌方掩体指挥台在烟雾未散之前被精准点射瘫痪。',
        screenDirection: 'right-to-left',
        damageState: 'weathered',
        audioCue: '消音步枪短促沉闷的噗噗声 · 弹壳落入水洼沉闷轻响',
        radioVoice: '【无线电】房间干净！目标已清除，迅速回收战术服务器硬盘。'
      },
      {
        phase: 'resolve',
        shotType: '撤入阴影与深渊回望 (Retreat into the Void)',
        action: '队员收缴情报箱，关闭战术手电，整齐倒退融入地下隧道的绝对黑暗中，唯有残破门缝透出一丝惨白冷光。',
        screenDirection: 'away-from-camera',
        damageState: 'weathered',
        audioCue: '大提琴低音再度拉长渐弱 · 战地无线电静噪单音截断',
        radioVoice: '【无线电】行动完毕，全队安全，正在脱离接触。'
      }
    ]
  },
  {
    id: 'saving-private-ryan',
    title: '拯救大兵瑞恩 (Saving Private Ryan)',
    aliases: ['拯救大兵瑞恩', 'saving private ryan', '诺曼底', '奥马哈海滩', '斯皮尔伯格'],
    director: '史蒂文·斯皮尔伯格 (Steven Spielberg)',
    year: '1998',
    genre: '二战纪实残酷写实 / 战火中的人性光辉',
    dramaticConflict: '八名士兵冒着枪林弹雨在敌后废墟中寻找一名普通二等兵，拷问战争中生命价值与牺牲代价的永恒悖论。',
    visualGrammar: {
      cameraMotion: '45度手持跳帧快门（海水溅湿镜头） · 剧烈晃动第一人称冲锋 · 极具生理冲击力的写实',
      lightingTone: '灰冷无情的诺曼底阴霾天光，完全抽离浪漫色彩的惨白冷灰色调',
      audioScore: '机枪弹雨泼洒在登陆艇钢板上的沉重敲击声、爆炸瞬间的高频耳鸣声与士兵急促的呼号'
    },
    legoAdaptation: '登陆艇跳板放下的一瞬，用透明浅蓝斜坡零件配合白色浪花件模拟汹涌拍岸海浪，士兵人仔头盔喷涂细致的泥泞与水渍效果。',
    creatorTips: '【生理级真实感】在爆炸发生的瞬间，把所有音效抽空，只留下一道刺耳的高频耳鸣持续3秒，模拟士兵被震懵的真实生理体验。',
    assets: {
      subjects: ['CHR-101', 'VEH-103'],
      environment: 'ENV-101',
      camera: 'CAM-002',
      lighting: 'LGT-002',
      colorGrade: 'CLR-002'
    },
    shots: [
      {
        phase: 'establish',
        shotType: '颠簸登陆艇与恐惧特写 (Landing Craft Approaching Beach)',
        action: '希金斯登陆艇在汹涌灰暗的海水中剧烈颠簸冲向奥马哈海滩，海水拍打在士兵紧握步枪颤抖的手套与带星钢盔上。',
        screenDirection: 'towards-camera',
        damageState: 'clean',
        audioCue: '海浪撞击船体剧烈轰响 · 柴油机粗重咆哮声',
        radioVoice: '【呼号】三十秒！上帝保佑我们，跳板放下立即往两边跑！'
      },
      {
        phase: 'build',
        shotType: '跳板落下枪林弹雨扑面 (Ramp Down & Direct Fire)',
        action: '钢制跳板轰然砸在浅滩上，正面碉堡交叉重机枪火网瞬间席卷而来，上尉大喊着带队翻滚跳入冰冷的海水中，水花与弹片四溅。',
        screenDirection: 'left-to-right',
        damageState: 'weathered',
        audioCue: '钢板密集撞击脆响 · 子弹破水呼啸噗嗤声',
        radioVoice: '【呼号】离开跳板！跳海！全部趴下！不要停在原地！'
      },
      {
        phase: 'climax',
        shotType: '悬崖绝壁炸毁铁丝网暗堡 (Bangalore Torpedo Breach)',
        action: '工兵冒死匍匐至绝壁铁丝网死角拼装班加罗尔爆破筒，火柴擦亮引信引爆，伴随冲天沙泥将暗堡工事撕开关键突破缺口。',
        screenDirection: 'right-to-left',
        damageState: 'damaged',
        audioCue: '近距离巨响爆破震鸣 · 随后是长达两秒的高频生理耳鸣声',
        radioVoice: '【呼号】缺口打开了！跟上上尉！冲上去夺取战壕！'
      },
      {
        phase: 'resolve',
        shotType: '硝烟散尽回望血色滩头 (Looking Back at the Beachhead)',
        action: '夺下悬崖战壕的士兵脱力坐在沙袋旁，沾满海沙的头盔靠在断壁上，硝烟散去露出海滩上连绵无尽的登陆船只与远去的白浪。',
        screenDirection: 'away-from-camera',
        damageState: 'damaged',
        audioCue: '狂风吹过战壕的萧瑟呼啸 · 远方低沉而哀伤的小号独奏',
        radioVoice: '【呼号】滩头已拿下，我们活着冲过来了，伙计。'
      }
    ]
  },
  {
    id: 'dunkirk',
    title: '敦刻尔克 (Dunkirk)',
    aliases: ['敦刻尔克', 'dunkirk', '诺兰战争', '防波堤'],
    director: '克里斯托弗·诺兰 (Christopher Nolan)',
    year: '2017',
    genre: '非线性时空海陆空三重奏 / 悬念绝境撤离',
    dramaticConflict: '四十万大军被围困在窄小滩头，敌军装甲近在咫尺，唯有依靠头顶微弱的皇家空军与民用小船逆浪而行创造奇迹。',
    visualGrammar: {
      cameraMotion: '70mm IMAX 胶片苍凉大画幅 · 贴海俯冲主观狗斗 · 几乎零废话的纯视觉视听推进',
      lightingTone: '英吉利海峡惨淡微弱的日光，苍蓝海水与惨白沙滩形成空旷绝望感',
      audioScore: '汉斯·季默谢泼德音调（永远在无限上升紧迫加速的秒针滴答声）与斯图卡俯冲死神鸣笛'
    },
    legoAdaptation: '用成百上千个微缩无名士兵人仔在白色积木长堤上排成长龙，头顶掠过灰色喷火战斗机，海面浮动微缩木纹平底渔船，营造极致的空旷与渺小。',
    creatorTips: '【紧迫感拉片】用恒定加速的“秒针滴答声”作为全片BGM骨架，哪怕画面只是士兵静止站在海边，秒针声也能死死抓紧观众心脏。',
    assets: {
      subjects: ['CHR-101', 'VEH-103', 'AIR-001'],
      environment: 'ENV-101',
      camera: 'CAM-001',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    },
    shots: [
      {
        phase: 'establish',
        shotType: '防波堤漫长队列全景 (The Mole & Sea of Waiting)',
        action: '成排士兵整齐列队在简陋的防波堤延伸至冰冷海水中，传单随风在滩头飘散，远方灰蒙蒙的天空隐隐传来引擎死神尖啸。',
        screenDirection: 'left-to-right',
        damageState: 'weathered',
        audioCue: '永不停歇的秒针滴答声 · 海水拍打木桩空旷回声',
        radioVoice: '【电台】潮汐正在退去，大船进不来，我们只能在这里等死吗？'
      },
      {
        phase: 'build',
        shotType: '俯冲轰炸与民船逆行 (Stuka Dive & Civilian Armada)',
        action: '敌机刺耳尖啸俯冲炸断栈桥激起数丈水柱，驱逐舰侧倾沉没，海平线上无数民用小渔船与私人游艇冒着硝烟逆向涌来。',
        screenDirection: 'towards-camera',
        damageState: 'damaged',
        audioCue: '死神警报尖厉呼啸 · 炸弹入水爆炸撕裂声',
        radioVoice: '【电台】看那边！不是皇家海军，是平民！老百姓开着渔船来接我们了！'
      },
      {
        phase: 'climax',
        shotType: '无动力战机滑翔绝杀 (Engine Out Gliding Kill)',
        action: '燃油耗尽的喷火式战斗机在发动机完全熄火的死寂中超低空滑翔掠过沙滩，在最后两秒用机枪精准击落俯冲敌机，全海滩官兵仰头挥帽。',
        screenDirection: 'left-to-right',
        damageState: 'damaged',
        audioCue: '滑翔风阻柔和呼啸 · 机枪最后三发点射清脆断音 · 海滩爆发万人欢呼',
        radioVoice: '【电台】好枪法，道森！他没有燃料了，他救了整个海滩！'
      },
      {
        phase: 'resolve',
        shotType: '沙滩迫降与夕阳焚机 (Sunset Beach Landing)',
        action: '优雅的战机在退潮的金色沙滩上收起起落架平稳迫降，飞行员从容点燃座舱，负手站在燃烧的机体旁目送千艘小船驶向日落彼岸。',
        screenDirection: 'away-from-camera',
        damageState: 'destroyed',
        audioCue: '机体烈火噼啪轻响 · 温暖宏大的英格玛变奏曲升华',
        radioVoice: '【旁白】我们将战斗到底，我们在海滩战斗，我们决不投降。'
      }
    ]
  }
];

/**
 * 输入电影名字或关键词，进行好莱坞深度视听解构与乐高分镜转译
 * @param {string} query 电影名称或搜索词
 * @param {number} requestedShots 镜头数量 (4 / 8 / 12)
 * @returns {object} 包含完整的电影解构档案、导演视听语法拉片笔记、乐高分镜脚本
 */
export function transpileMovieToLego(query, requestedShots = 4) {
  const q = String(query || '').trim().toLowerCase();

  // 1. 精确与别名深度匹配
  let match = CINEMA_DATABASE.find(item => {
    if (item.title.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)) return true;
    return item.aliases.some(alias => q.includes(alias.toLowerCase()) || alias.toLowerCase().includes(q));
  });

  // 2. 若未命中具体电影，智能推导电影视听原型
  if (!match) {
    if (/太空|空间站|星际|流浪|宇宙|gravity|interstellar|space|三体/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'gravity');
    } else if (/空战|战机|飞机|飞行员|top gun|dogfight|歼|战斗机/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'top-gun-maverick');
    } else if (/外骨骼|机甲|科幻|未来|边缘|机甲|exoskeleton/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'edge-of-tomorrow');
    } else if (/夜战|特战|突袭|暗夜|夜视|sicario|潜入|狙击/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'sicario');
    } else if (/诺曼底|二战|登陆|拯救|ryan|海滩/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'saving-private-ryan');
    } else if (/流浪|地球|重工|发动机/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'the-wandering-earth');
    } else if (/撤退|海峡|敦刻尔克|诺兰/i.test(q)) {
      match = CINEMA_DATABASE.find(m => m.id === 'dunkirk');
    } else {
      match = CINEMA_DATABASE.find(m => m.id === 'black-hawk-down'); // 通用硬派军事兜底
    }
  }

  // 3. 构建 4 / 8 / 12 镜头高密度剧本
  const count = Number(requestedShots) || 4;
  const baseShots = match.shots;
  const shots = [];

  for (let i = 0; i < count; i++) {
    const beatIdx = Math.floor((i / count) * baseShots.length);
    const b = baseShots[beatIdx];
    const isSubShot = (count > 4 && i % 2 === 1);

    shots.push({
      shotId: `shot_${i + 1}`,
      phase: b.phase,
      shotType: isSubShot ? `[特写延续] 紧跟细节` : b.shotType,
      action: isSubShot ? `【微观特写】${b.action}，摄影机推近乐高塑料注塑合缝线与微震。` : b.action,
      screenDirection: b.screenDirection,
      damageState: b.damageState,
      audioCue: b.audioCue,
      radioVoice: b.radioVoice,
      subjects: match.assets.subjects,
      environment: match.assets.environment,
      camera: match.assets.camera,
      lighting: match.assets.lighting,
      colorGrade: match.assets.colorGrade
    });
  }

  return {
    matchedMovie: match.title,
    movieId: match.id,
    director: match.director,
    year: match.year,
    genre: match.genre,
    dramaticConflict: match.dramaticConflict,
    visualGrammar: match.visualGrammar,
    legoAdaptation: match.legoAdaptation,
    creatorTips: match.creatorTips,
    themeZh: `【${match.title} · 好莱坞视听转译】${match.shots[0].action.slice(0, 35)}…`,
    shots,
    assets: match.assets
  };
}
