# Production Pipeline — 资产管线

电影公司（Pixar、ILM、Weta）不会直接写 Prompt，而是层层构建资产，Prompt 永远是最后一步。

```
世界观 (World)
     ↓
角色资产 (Character)
     ↓
道具资产 (Props)
     ↓
车辆资产 (Vehicle)
     ↓
场景资产 (Environment)
     ↓
镜头资产 (Camera)
     ↓
动作资产 (Animation / Motion)
     ↓
灯光 / 色彩 (Lighting / Color)
     ↓
Prompt（自动组装）
```

## 资产分层（Asset Layers）

### 第一层：Hero Assets（英雄资产）
电影里反复出现的核心对象，一旦确定永不改变。海湾战争的英雄资产：

| 编号(V2.0) | 旧编号 | 名称 |
|---|---|---|
| CHR-001 | A001 | Coalition Soldier |
| VEH-001 | A002 | M1A1 Abrams |
| VEH-002 | A003 | Bradley IFV |
| AIR-004 | A004 | Apache |
| AIR-005 | A005 | Black Hawk |
| AIR-001 | A006 | F-15 Eagle |
| AIR-002 | A007 | F-16 Falcon |
| AIR-003 | A008 | A-10 Warthog |
| AIR-006 | A009 | B-52 Bomber |
| VEH-004 | A010 | Patriot Missile |
| VEH-003 | A011 | M270 MLRS |
| SHP-001 | A012 | Nimitz Carrier |
| SHP-002 | A013 | Ticonderoga Cruiser |
| SHP-003 | A014 | Arleigh Burke Destroyer |
| WPN-001 | A015 | Tomahawk Missile |

### 第二层：Supporting Assets（辅助资产）
所有战争片都能复用：沙袋、油桶、帐篷、雷达、路障、卡车、弹药箱、补给车、通信天线、医疗帐篷、沙漠植物、碎石、沙丘。见 `PRP-001` … `PRP-010`。

### 第三层：FX Assets（特效资产）
不要每次写 “explosion”，而是调用编号：`FX-001` 小型爆炸、`FX-002` 坦克爆炸、`FX-003` 火箭爆炸、`FX-004` 导弹尾迹、`FX-005` 枪口火光、`FX-006` 尘云、`FX-007` 海面浪花、`FX-008` 曳光弹。

### 第四层：Motion Library（动作库）
动作一致是 Flow 的最大特点，动作不要重复写。按类别调用：`tank / aircraft / helicopter / ship / mlrs / soldier`，见 `Animation_Bible.md`。

### 第五层：Camera Package（镜头包）
镜头有编号（`CAM-001` … `CAM-010`），见 `Camera_Bible.md`。

### 第六层：Lighting Package（灯光包）
`LGT-001` … `LGT-008`，见 `Lighting_Bible.md`。

### 第七层：Color Package（色彩包）
`CLR-001` … `CLR-005`，见 `Lighting_Bible.md`。Flow 对色彩非常敏感，统一色彩包保证全片调性一致。

### 第八层：Shot Number（镜头编号）
`S001 / S002 / S003…`，重拍只影响单个镜头。见 `05_Tools/Shot_Manager.md`。

### 第九层：Timeline（时间轴）
每个 S 编号占 8 秒，顺序拼接成整片。见 `05_Tools/Timeline_System.md`。

### 第十层：Prompt Assembler（提示词组装器）
Prompt 不是人工写，而是由上述资产自动拼接：

```
Style + Character + Vehicle + Environment + Camera + Lighting + Color + Motion + FX + Audio + Negative → Flow Prompt
```

组装器实现见根目录 `index.html`，说明见 `05_Tools/Prompt_Composer.md`。
