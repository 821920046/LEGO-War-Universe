# Consistency Rules — 一致性控制策略

长片能否成立，核心在于跨几百个镜头的一致性。本页汇总四大一致性策略。

## 1. 角色一致性（Character DNA + Reference + Asset）
- **DNA**：头盔 + 躯干印花 + 面部印花三要素固定。
- **Reference**：在 Flow 中尽量用同一参考帧/同一种子（如果可用）延续角色。
- **Asset**：描述文字来自 `assets.json`，逐字复用。

## 2. 载具一致性（编号 / 纹理 / 比例 / 磨损等级）
- 编号固定（VEH-/AIR-/SHP-）。
- 纹理与涂装：`same markings, same decals`。
- 比例：`consistent scale`。
- 磨损等级：统一 `weathered plastic`，不忽新忽旧。

## 3. 镜头连续性（动作接力 / 视线方向 / 轴线）
- 动作接力（见 `Continue_Rules.md`）。
- 视线方向：主体朝向在相邻镜头保持一致。
- 不跳轴：同一段落内主体从屏幕同一侧进出。

## 4. 光照连续性（时间 / 天气 / 色温）
- 同一段落固定 LGT + CLR。
- 时间/天气切换只在场景分界处发生。

## 一致性自查

每拍一个新镜头前，对照 `05_Tools/QA_Checklist.md` 过一遍。
