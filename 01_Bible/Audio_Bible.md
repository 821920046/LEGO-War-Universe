# Audio Bible — 声音库

Google Flow（Veo 3）支持原生音频生成。声音统一编号，镜头直接调用。

> 数据源：`02_Assets/assets.json` → `audio[]`。

| ID | 名称 | 描述 |
|---|---|---|
| AUD-001 | Tank Engine | deep diesel tank engine rumble and clanking tracks |
| AUD-002 | Jet Engine | roaring jet engine and afterburner |
| AUD-003 | Helicopter Rotor | heavy rhythmic helicopter rotor thump |
| AUD-004 | Missile Launch | sharp missile launch whoosh with ignition roar |
| AUD-005 | Explosion | powerful explosion boom with debris patter |
| AUD-006 | Desert Wind | low desert wind and drifting sand |
| AUD-007 | Radio Chatter | crackling military radio chatter |
| AUD-008 | Footsteps | boots crunching on sand and gravel |
| AUD-009 | Metal Clanking | metallic clanking of equipment and hatches |
| AUD-010 | Ocean & Deck | ocean swell, wind, and carrier deck steam hiss |
| AUD-011 | Orchestral Score | swelling epic orchestral military score |
| AUD-012 | Tense Drone | tense low droning suspense score |

## 音频规范

- 每个镜头建议 1–3 层音频：主体音效（如 AUD-002）+ 环境音（如 AUD-006）+ 可选配乐（AUD-011/012）。
- **对白**放引号内且足够短（适应 8 秒），一个镜头最多一句。
- 同一段落配乐保持一致，避免镜头间音乐风格跳变。
