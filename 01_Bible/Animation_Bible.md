# Animation Bible — 动作库

Google Flow 最喜欢动作描述，且动作需要一致。不要重复写动作，而是从动作库调用。

> 数据源：`02_Assets/assets.json` → `motions{}`。组装器会根据所选主体自动列出可用动作。

## 坦克 Tank
`idle` · `start engine` · `accelerate` · `drive straight` · `turn left` · `turn right` · `stop` · `reverse` · `fire main cannon` · `reload` · `turret rotate` · `machine gun fire`

例（展开）：Tank slowly accelerates → suspension compresses → dust trails appear → turret rotates left → main gun fires → shell ejects → smoke exits barrel。

## 飞机 Aircraft
`taxi` · `catapult launch` · `takeoff` · `bank left` · `bank right` · `dive` · `missile launch` · `bomb drop` · `flare release` · `landing` · `afterburner ignites` · `landing gear retracts`

## 直升机 Helicopter
`hover` · `ascend` · `bank left` · `bank right` · `strafe` · `fire hellfire` · `rocket salvo` · `flare release` · `land`

## 军舰 Ship
`cruise` · `turn to port` · `turn to starboard` · `missile launch` · `radar rotate` · `launch aircraft` · `drop anchor`

## 火箭炮 MLRS
`launcher raises` · `rocket ignites` · `rocket salvo fires` · `smoke plume rises` · `recoil` · `reload`

## 人物 Soldier
`walk` · `run` · `crouch` · `aim` · `reload` · `fire` · `take cover` · `signal` · `observe` · `carry wounded`

## 动作规范

- **一个镜头只一个核心动作**，确保能在 8 秒内自然完成。
- **动作接力**：上一镜结束动作 = 下一镜起始动作（如 `missile launch` → 下镜 `missile in flight`）。
- 新增动作直接在 `assets.json` 的对应类别数组里追加。
