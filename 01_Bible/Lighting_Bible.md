# Lighting & Color Bible — 灯光与色彩规范

Flow 对光线与色彩非常敏感。全片统一灯光包与色彩包，保证镜头间不跳色。

> 数据源：`02_Assets/assets.json` → `lighting[]` 与 `colorGrades[]`。

## 灯光包 Lighting Package

| ID | 名称 | 描述 |
|---|---|---|
| LGT-001 | Golden Hour | warm golden sunlight, long shadows, orange highlights, blue sky |
| LGT-002 | Desert Noon | harsh overhead sunlight, strong contrast, heat haze, bright sand |
| LGT-003 | Night Combat | cool moonlight, explosion lighting flashes, streaking tracer rounds, drifting smoke |
| LGT-004 | Storm Lighting | overcast stormy sky, diffuse cold light, occasional lightning flash |
| LGT-005 | Explosion Lighting | strong orange flash from explosions, flickering firelight, deep contrasting shadows |
| LGT-006 | Emergency Red | red emergency lighting, pulsing alarm glow, deep shadows |
| LGT-007 | Command Center Blue | cool blue command-center lighting, glowing screens, low ambient fill |
| LGT-008 | Dawn Haze | soft pre-dawn blue light, low fog and haze, gentle cool ambience |

## 色彩包 Color Package

| ID | 名称 | 描述 |
|---|---|---|
| CLR-001 | Hollywood Blockbuster（默认） | high contrast, warm highlights, cool shadows, Kodak film look, cinematic grading |
| CLR-002 | Saving Private Ryan | desaturated bleach-bypass, muted greens and tans, gritty documentary look |
| CLR-003 | Top Gun Maverick | clean vivid, deep blue skies, warm skin tones, crisp modern blockbuster |
| CLR-004 | Black Hawk Down | warm dusty, golden-tan cast, crushed shadows, harsh gritty realism |
| CLR-005 | Band of Brothers | cool overcast, muted palette, soft contrast, classic war-drama look |

## 光照连续性规范

- **时间/天气/色温三锁定**：同一段落内必须用同一 LGT + 同一 CLR。
- **默认色彩包**：全宇宙默认 `CLR-001`；二战系列建议 `CLR-002/CLR-005`；现代海空战建议 `CLR-003`。
- 镜头切换时若必须换光（如白天→夜战），应在 Timeline 上作为明确的段落分界，而非相邻镜头突变。
