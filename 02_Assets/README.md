# 02_Assets — 资产库（唯一真相来源）

本目录是整个 LEGO War Universe 的**机器可读资产数据库**。Prompt Composer（根目录 `index.html`）运行时优先通过 `fetch` 加载 `assets.json`，因此**只要改这一个文件，全站站点即时更新**（本地直接双击 HTML 时因浏览器安全限制会回退到内嵌副本）。

## 文件

| 文件 | 说明 |
|---|---|
| `assets.json` | 资产主库，schemaVersion 3.0 |
| `assets.schema.json` | JSON Schema（Draft-07），用于校验结构 |
| `validate.py` | 校验脚本：`python3 validate.py` |

## 校验

```bash
cd 02_Assets
python3 validate.py            # 结构检查（无依赖）
pip install jsonschema         # 可选：启用完整 Schema 校验
```
检查项：ID 全局唯一、ID 命名规范 `PREFIX-NNN`、`lines` 非空、`defaultColorGrade` 指向真实色彩、载具 `class` 合法、`variants` 引用存在。

## 数据结构要点（v3.0 新增）

- **系列 `series`**：`Gulf War` / `WWII` / `Pacific` / `Cold War` / `Iraq War`。组装器可按系列筛选。
- **阵营 `faction`** 与 **`unit`**（角色）：支持一键切换敌我、按兵种组织。
- **损耗变体 `variants`**：载具 `clean / weathered / damaged / destroyed`；角色 `standard / battle-worn`。预设文案在 `variantPresets` / `characterVariantPresets`。
- **参考图 `referenceImage`**：预留字段。填写后配合 Flow 的 Ingredients / 参考图功能，大幅提升一致性。组装器会在生成结果下方给出“建议上传参考图的英雄资产”提示。
- **版本 `version` + `changelog`**：每个资产可独立追踪修改（配合 Git）。
- **节奏模板 `rhythmTemplates`**：`trailer` / `documentary` / `epic`，驱动时间轴自动分配镜头节奏。

## 扩展新系列

只需在对应数组里新增对象，按编号段位分配 ID（见 `05_Tools/Naming_Rules.md`），无需改任何规范或组装器代码。例：二战陆军 `-1xx`、太平洋 `-2xx`、冷战 `-3xx`。


## Modern 系列资产清单（V2.2）

| ID | 名称 | 类别 |
|---|---|---|
| `CHR-401` | Special Forces Operator | character |
| `CHR-402` | UAS Drone Operator | character |
| `CHR-403` | JTAC Forward Air Controller | character |
| `CHR-404` | Combat Medic | character |
| `CHR-405` | Sniper Team Marksman | character |
| `CHR-406` | Female Recon Operator | character |
| `CHR-407` | PMC Contractor | character |
| `CHR-408` | EOD Technician | character |
| `CHR-409` | Infantry Squad Leader | character |
| `CHR-410` | CBRN Specialist | character |
| `CHR-411` | Electronic Warfare Specialist | character |
| `CHR-412` | MANPADS Gunner | character |
| `VEH-401` | M1A2 SEPv3 Abrams | vehicle |
| `VEH-402` | Stryker ICV | vehicle |
| `VEH-403` | JLTV Tactical Vehicle | vehicle |
| `VEH-404` | Cougar MRAP | vehicle |
| `VEH-405` | M142 HIMARS | vehicle |
| `VEH-406` | Leopard 2A7 | vehicle |
| `VEH-407` | T-90M Main Battle Tank | vehicle |
| `VEH-408` | M2A4 Bradley IFV | vehicle |
| `VEH-409` | Robotic Combat Vehicle (UGV) | vehicle |
| `VEH-410` | Bushmaster Protected Vehicle | vehicle |
| `AIR-401` | F-35A Lightning II | vehicle |
| `AIR-402` | F-22 Raptor | vehicle |
| `AIR-403` | MQ-9 Reaper UAV | vehicle |
| `AIR-404` | Bayraktar TB2 UAV | vehicle |
| `AIR-405` | V-22 Osprey | vehicle |
| `AIR-406` | CH-47F Chinook | vehicle |
| `AIR-407` | AH-64E Apache Guardian | vehicle |
| `AIR-408` | UH-60M Black Hawk | vehicle |
| `AIR-409` | FPV Attack Drone | vehicle |
| `AIR-410` | Su-57 Felon | vehicle |
| `AIR-411` | Recon Quadcopter | vehicle |
| `SHP-401` | Zumwalt-class Destroyer | vehicle |
| `SHP-402` | Virginia-class Submarine | vehicle |
| `SHP-403` | Littoral Combat Ship | vehicle |
| `ENV-401` | Modern Urban Combat Street | environment |
| `ENV-402` | War-torn Modern City Block | environment |
| `ENV-403` | Forward Operating Base | environment |
| `ENV-404` | Drone Operations Center | environment |
| `ENV-405` | Modern Airbase Flight Line | environment |
| `ENV-406` | Metro Station Interior | environment |
| `ENV-407` | Industrial Port | environment |
| `ENV-408` | Mountain Observation Outpost | environment |
| `ENV-409` | Desert Highway Convoy Route | environment |
| `ENV-410` | Apartment Interior CQB | environment |
| `ENV-411` | Border Checkpoint | environment |
| `ENV-412` | Snowy Eastern European Field | environment |


## V2.3 天气 / 水域 / 写实特效资产

| ID | 名称 |
| --- | --- |
| FX-501 | Heavy Rain |
| FX-502 | Snowfall and Blizzard |
| FX-503 | Dense Fog |
| FX-504 | Thunderstorm Lightning |
| FX-505 | Sandstorm |
| FX-506 | Mushroom Cloud |
| FX-507 | Battlefield Gun Smoke |
| FX-508 | Spark Shower |
| FX-509 | Water Splash and Wake |
| FX-510 | Deep Sea Underwater |
| FX-511 | Mud and Wet Ground Spray |
| FX-512 | Burning Wreck Fire |
| ENV-501 | Stormy Ocean Surface |
| ENV-502 | Deep Sea Underwater |
| ENV-503 | River Crossing |
| ENV-504 | Lake Shore at Dawn |
| ENV-505 | Rainy Night City Street |
| ENV-506 | Foggy Pine Forest |
| ENV-507 | Flooded Marshland |
| ENV-508 | Blizzard Mountain Pass |
| AUD-501 | Heavy Rain Ambience |
| AUD-502 | Thunder |
| AUD-503 | Blizzard Wind |
| AUD-504 | Ocean and River Water |
