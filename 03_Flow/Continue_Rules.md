# Continue Rules — 镜头衔接规范

针对 Flow 的 8 秒限制，用动作接力把多个镜头串成连续叙事。

## 核心原则：动作接力

上一镜头的**结束动作** = 下一镜头的**起始动作**。

例：
- S012：导弹刚离开发射架（`missile launch`）。
- S013：从导弹飞行开始（`missile in flight`），而不是重新开始一个全新事件。

## 在组装器中的做法

勾选「与上一镜头动作衔接（Continuation）」，组装器会在 Prompt 开头加入：

```
Continues seamlessly from the previous shot, matching motion, lighting and framing.
```

## 在 Flow 中的做法

- 优先使用 Flow 的 **Extend / Scene Builder**，以上一段末帧作为下一段起点，保证画面连续。
- 若重新生成，则在下一镜 Prompt 中保持同一 ENV/LGT/CLR 与主体资产，并描述衔接后的运动状态。

## 衔接清单

- [ ] 主体资产一致（同一 CHR/VEH）
- [ ] 环境/灯光/色调一致
- [ ] 运动方向一致（不跳轴）
- [ ] 速度/动能衔接自然
