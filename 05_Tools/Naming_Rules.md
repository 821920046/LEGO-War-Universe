# Naming Rules — 命名规范

统一的 ID 体系是资产可复用、可扩展的基础。

## 前缀表

| 前缀 | 含义 | 示例 |
|---|---|---|
| STYLE- | 风格块 | STYLE-LWU |
| NEG- | 负面约束 | NEG-LWU |
| CHR- | 角色 Character | CHR-001 |
| VEH- | 地面载具 Vehicle | VEH-001 |
| AIR- | 空中载具 Aircraft | AIR-001 |
| SHP- | 舶船 Ship | SHP-001 |
| WPN- | 武器/弹药 Weapon | WPN-001 |
| PRP- | 道具 Prop | PRP-001 |
| FX- | 特效 | FX-001 |
| ENV- | 环境 Environment | ENV-001 |
| CAM- | 镜头 Camera | CAM-001 |
| LGT- | 灯光 Lighting | LGT-001 |
| CLR- | 色彩 Color | CLR-001 |
| AUD- | 音频 Audio | AUD-001 |
| S | 镜头编号 Shot | S001 |
| SC | 场景编号 Scene | SC01 |

## 与旧编号（你最初的设计）的映射

你最初用的 A001–A015 / FX00x / CAM00x / L00x 均保留为 `legacyId`，在 `assets.json` 里可查。

| 旧 | 新 | 旧 | 新 |
|---|---|---|---|
| A001 | CHR-001 | A009 | AIR-006 |
| A002 | VEH-001 | A010 | VEH-004 |
| A003 | VEH-002 | A011 | VEH-003 |
| A004 | AIR-004 | A012 | SHP-001 |
| A005 | AIR-005 | A013 | SHP-002 |
| A006 | AIR-001 | A014 | SHP-003 |
| A007 | AIR-002 | A015 | WPN-001 |
| A008 | AIR-003 | | |
| FX001–004 | FX-001–004 | CAM001–006 | CAM-001–006（含义对齐） |
| L001 | LGT-001 | L002 | LGT-002 |
| L003 | LGT-003 | | |

## 扩展规则

- 同类新资产递增编号（CHR-007、VEH-006…）。
- 可按系列分段（如二战环境 ENV-101+、太平洋 ENV-201+），便于管理。
