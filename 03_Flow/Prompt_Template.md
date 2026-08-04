# Prompt Template — Google Flow 专用模板

组装器使用的标准模板（空格位置均为可选段落，未选则自动省略）：

```
{STYLE}.
[Continues seamlessly from the previous shot, matching motion, lighting and framing.]
Scene: {ENVIRONMENT}.
Subject: {SUBJECT ASSETS}.
Action: {ONE-LINE ACTION} — {MOTION}.
Camera: {CAMERA}.
Lighting: {LIGHTING}.
Color: {COLOR GRADE}.
FX: {FX}.
The overall mood is {MOOD}.
Audio: {AUDIO}.
[A character says: "{DIALOGUE}".]
Single continuous 8-second shot, {ASPECT} aspect ratio, 720p, 24fps, cohesive and self-contained.
Negative prompt: {NEGATIVE}.
```

## 占位符来源

| 占位符 | 来源 |
|---|---|
| {STYLE} | `assets.json` → `styleBlock` |
| {ENVIRONMENT} | `environments[]` 选中项 |
| {SUBJECT ASSETS} | `characters[]` + `vehicles[]` 选中项（可多） |
| {MOTION} | `motions{}` 对应类别 |
| {CAMERA} | `cameras[]` 选中项 |
| {LIGHTING} | `lighting[]` 选中项 |
| {COLOR GRADE} | `colorGrades[]` 选中项 |
| {FX} | `fx[]` 选中项（可多） |
| {AUDIO} | `audio[]` 选中项（可多） |
| {NEGATIVE} | `assets.json` → `negative` |

## 使用方式

1. 打开根目录 `index.html`（组装器）。
2. 填写镜头主题 + 选择资产。
3. 点「生成 Flow 提示词」，复制任一版本。
4. 粘进 Google Flow，模型选 Veo 3，时长选 8s。
