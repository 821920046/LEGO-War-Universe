# Negative Prompt — 统一负面约束

很多人遗漏但非常重要。整个项目统一加入，由组装器自动附在每个 Prompt 结尾。

> 数据源：`02_Assets/assets.json` → `negative`（ID: NEG-LWU）。

```
no extra characters,
no duplicated vehicles,
no melting or warped LEGO bricks,
no broken anatomy,
no unrealistic proportions,
no blurry or smeared textures,
no floating objects,
no incorrect military markings,
no cartoon exaggeration,
no on-screen text, no subtitles, no captions, no watermark, no logos,
maintain consistent LEGO brick scale,
maintain consistent lighting,
maintain consistent character appearance
```

## 说明

- `no extra characters` / `no duplicated vehicles`：防止模型凭空增加主体，是多主体镜头一致性的关键。
- `no melting/warped bricks` / `no cartoon exaggeration`：锁定乐高写实风格。
- `maintain consistent ...`：强化跨镜头一致性。
- `no subtitles/captions/watermark/logos`：保证画面干净无文字。
