# Scene Template — 场景（多镜头段落）模板

一个场景（Scene）= 多个连续镜头的集合，共享同一环境/灯光/色调。

```
Scene ID:    SC0x
Name:        （如：Carrier Launch Sequence）
Environment: ENV-004 （本场景固定）
Lighting:    LGT-001 （本场景固定）
Color:       CLR-001 （本场景固定）
Shots:       S00x → S00x → S00x
Continuity:  镜头间用动作接力衔接
```

## 场景规则

1. 同一场景内所有镜头必须共用同一 ENV + LGT + CLR。
2. 场景内部镜头用 Continuation 衔接；场景之间可以切换时间/地点。
3. 推荐每个场景 3–6 个镜头（即 24–48 秒），便于节奏控制。
