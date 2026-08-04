# Prompt Rules — 提示词统一规则

所有 Prompt 必须遵循下述规则，由组装器（`index.html`）自动执行。

## 硬性规则

1. **每个 Prompt 以统一 Style Block 开头**（STYLE-LWU）。
2. **每个 Prompt 以统一 Negative Block 结尾**（NEG-LWU）。
3. **不写泛称**：不写 `a soldier / a tank`，必须引用 `CHR-/VEH-/AIR-/SHP-` 资产。
4. **资产文字逐字复用**，不同义改写。
5. **一个镜头只一个核心动作**。
6. **英文输出**，约 100–150 词。
7. **正文不用时间/顺序词**（now/then/continues）。
8. **固定结尾句**：`Single continuous 8-second shot, 16:9 aspect ratio, 720p, 24fps, cohesive and self-contained.`

## 组装顺序（组装器内部逻辑）

```
Style
+ (Continuation 句，若勾选)
+ Scene: Environment
+ Subject: [角色/载具资产逐个展开]
+ Action: [一句话核心动作] + [Motion]
+ Camera
+ Lighting
+ Color
+ FX
+ mood
+ Audio
+ (Dialogue，若填)
+ 固定结尾句
+ Negative
```

## 标准 Prompt 示例（由组装器生成）

```
Ultra realistic LEGO stop motion, photorealistic LEGO plastic with real brick textures
and subtle mold seams, authentic LEGO minifigure and brick construction, cinematic
lighting, movie quality, shot on virtual 35mm anamorphic, shallow depth of field,
natural motion blur, 8K detail, 24fps cinematic motion, 16:9 aspect ratio, Google Flow
optimized, Veo optimized. Scene: aircraft carrier flight deck, gray non-skid deck with
white markings and catapults, parked aircraft, deck crew, island tower, open sea beyond
the edge. Subject: [AIR-001 F-15 Eagle] LEGO F-15 Eagle fighter jet, light gray bricks,
weathered panel lines, transparent cockpit canopy, same missile loadout, same decals,
same twin tail wings, consistent scale, high detail, same brick construction. Action:
The F-15 catapult-launches from the deck and climbs steeply — catapult launch. Camera:
low deck-level shot, steam and heat haze foreground, wide 28mm lens. Lighting: warm
golden sunlight, long shadows, orange highlights, blue sky. Color: high contrast, warm
highlights, cool shadows, Kodak film look, cinematic grading. FX: white smoke trail,
orange exhaust, heat blur. The overall mood is heroic and sweeping. Audio: roaring jet
engine and afterburner, ocean swell and carrier deck steam hiss. Single continuous
8-second shot, 16:9 aspect ratio, 720p, 24fps, cohesive and self-contained. Negative
prompt: no extra characters, no duplicated vehicles, no melting or warped LEGO bricks,
no broken anatomy, no unrealistic proportions, no blurry or smeared textures, no
floating objects, no incorrect military markings, no cartoon exaggeration, no on-screen
text, no subtitles, no captions, no watermark, no logos, maintain consistent LEGO brick
scale, maintain consistent lighting, maintain consistent character appearance.
```
