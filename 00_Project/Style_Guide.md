# Style Guide — 统一视觉风格规范

整部宇宙共用一套风格块（Style Block）。每个 Prompt 都以它开头，逐字不改。

## 主风格块（STYLE-LWU）

```
Ultra realistic LEGO stop motion,
photorealistic LEGO plastic with real brick textures and subtle mold seams,
authentic LEGO minifigure and brick construction,
cinematic lighting, movie quality, shot on virtual 35mm anamorphic,
shallow depth of field, natural motion blur,
8K detail, 24fps cinematic motion,
16:9 aspect ratio,
Google Flow optimized, Veo optimized
```

## 设计原则

1. **真实乐高质感**：强调 `photorealistic LEGO plastic`、`real brick textures`、`mold seams`（注塑缝），避免变成写实真人或黏土动画。
2. **电影感优先**：虚拟 35mm 变形宽银幕、浅景深、自然运动模糊，让 8 秒片段有「电影镜头」而非「玩具视频」的观感。
3. **停格动画气质**：`stop motion` 让画面带轻微机械质感，符合乐高定格片传统。
4. **统一比例与帧率**：16:9、24fps，全片一致。

## 风格一致性红线（写进 Negative）

- 不出现融化/变形的积木（no melting or warped LEGO bricks）
- 不出现卡通夸张（no cartoon exaggeration）
- 保持乐高积木比例一致（maintain consistent LEGO brick scale）

## 何时可微调

- 只允许通过 **Color Grade（`CLR-`）** 调整整片调性（如二战片用 `CLR-002 Saving Private Ryan`）。
- 不允许改动 Style Block 的乐高材质与镜头语言描述，否则会破坏跨镜头一致性。


## 铁律一：一切皆为积木

本宇宙不是“乐高风格的真实战场”，而是“一个真实存在的乐高场景模型被电影级镜头拍下来”。因此：

- 地形不是沙子，是**沙色颁点板与斜坡砖**；水不是液体，是**透明蓝色零件**；雪地是**白色平板**。
- 建筑必须看得出是一块块砖砂上去的，允许且鼓励露出颁点、内管与合缝。
- 烟雾、火焰、水花优先用**透明件与积木碎片**表现；爆炸时飞出的是**塑料零件**而不是碎石。
- 全场景保持 minifigure 比例，不允许真人比例的道具混入。

## 铁律二：年代不混搭

本项目包含 Modern（现代）、Gulf War、Cold War、WWII、Pacific 五个系列。**同一个镜头内不得混用不同系列的装备与制服**。

现代系列的视觉识别特征（写分镜时请刷满）：

- **人**：Ops-Core 类弹道盔 + 配重块 + IR 闪烁器；四目夜视仪；多地形迷彩；插板背心 + 弹匣袋；护膝、战术手套、通讯耳麦。
- **枪**：短管卡宾 + 全恰导轨 + 全息/红点镜 + 战术手电 + 消音器；而不是木护木托。
- **车**：格栅装甲/反应装甲块、遥控武器站、V 型防雷底盘、大直径防弹胎。
- **天**：隐身折面气动外形、内置弹舌、无人机（从 MQ-9 到巴掌大的 FPV）。
- **场**：玻璃幕墙与卷闸门的现代城区、HESCO 防爆墙、集装箱、卫星天线、屏幕墙指挥中心。
- **镜头语言**：FPV 穿越机追逐、热成像光学、夜视 POV、头盔镜头、卫星顶视——这五种是现代战争片的标志性视觉。


## 铁律一（V2.3 修订）：硬件是积木，环境是真实

旧版要求“一切皆为积木”，实际出片中会导致水、烟、火变成塑料块，质感平、气势弱。V2.3 改为：

**必须是积木（硬件）**
- 地面、山体、建筑、道路、树木、芦苇、碼头
- 坦克、飞机、舰艇、无人机、武器、装具、道具
- 人物（minifigure）与爆炸飞散的碎片

**必须是写实（环境与特效）**
- 天气：暴雨、风雪、浓雾、乌云、闪电、沙尘暴
- 水：深海、海浪、河流、湖面、积水、水花、泡沫、焦散光
- 战场：硝烟、火焰、火花、余烬、冲击波、热浪、蘑菇云

**交互细节（决定成片质感）**
- 雨天：塑料表面变湿亮、高光拉长、颗粒凹槽积水
- 雪天：雪落在颗粒顶面与车体棱线，形成白边
- 烟火：烟雾绕过模型而不是遮住，火光在周围积木上跳动
- 水下：深度衰减、光束、悬浮颗粒、气泡尾迹

**写提示词时的固定句式**
> LEGO brick-built … with photorealistic …
> （例：brick-built Abrams tank with photorealistic heavy rain and real mud spray）
