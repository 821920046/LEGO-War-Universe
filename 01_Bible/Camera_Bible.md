# Camera Bible — 镜头语言库

镜头都有编号。Prompt 里写 `Camera: CAM-003` 即可（组装器会展开为完整描述）。

> 数据源：`02_Assets/assets.json` → `cameras[]`。

| ID | 名称 | 描述 |
|---|---|---|
| CAM-001 | Opening Drone | high-altitude drone shot, slow push-in, 24mm lens, very cinematic, stable smooth movement |
| CAM-002 | Ground Tracking | ground-level tracking shot, parallel movement alongside the subject, 50mm lens, dust in the foreground |
| CAM-003 | Jet Follow | chase camera behind the aircraft, long lens, fast tracking, natural motion blur |
| CAM-004 | Explosion Close-up | 85mm close-up, slight slow motion, debris flying past lens, explosion fills the frame |
| CAM-005 | POV Cockpit | first-person cockpit POV, canopy frame and HUD in view, subtle handheld shake |
| CAM-006 | Orbit Shot | slow 360 orbit around the subject, steady gimbal movement, 40mm lens |
| CAM-007 | Overhead Top-Down | straight overhead top-down shot, slow descent, map-like composition |
| CAM-008 | Low-Angle Hero | low-angle hero shot looking up at the subject, 35mm lens, imposing heroic framing |
| CAM-009 | Deck-Level Launch | low deck-level shot, steam and heat haze foreground, wide 28mm lens |
| CAM-010 | Handheld Combat | handheld shoulder camera, reactive shake, whip movement, embedded war-correspondent feel |

## 镜头语言规范

- **运镜与主体动作分开**：先 Camera 后 Action。
- **镜头匹配内容**：开场用 CAM-001；追车用 CAM-002；空战用 CAM-003/CAM-005；爆炸特写用 CAM-004；英雄亩像用 CAM-008；航母弹射用 CAM-009。
- **轴线/视线方向**：同一段落内主体运动方向保持一致（不要跳轴），见 `03_Flow/Consistency_Rules.md`。
