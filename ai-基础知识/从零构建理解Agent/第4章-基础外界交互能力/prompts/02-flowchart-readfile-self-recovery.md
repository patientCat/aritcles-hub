---
id: 02
type: flowchart
style: sketch-notes
palette: default
language: zh
aspect_ratio: "16:9"
output_file: 02-flowchart-readfile-self-recovery.png
references: []
---

# 画面目标
展示文件读取的最小自恢复闭环，强调不是改 prompt，而是补系统能力。

## FLOW
开始 → `ReadFile(relativePath)` → [失败] → `FindFile(fileName)` → [唯一命中?]
- 否：返回候选列表并提示用户
- 是：自动重试 `ReadFile` → 成功返回内容

## LABELS（必须出现）
- 默认上下文缺失（workdir 不明确）
- 只有硬读取会失败
- 发现工具 + 执行工具 = 最小闭环
- 不是改 prompt 糊过去

## VISUAL STYLE
- 手绘流程图，节点圆角矩形
- 关键分支（唯一命中？）用明显菱形
- 成功路径用柔和绿色，失败路径用柔和橙红

## COLORS
- 背景：奶油白
- 主线：深灰
- 成功：浅绿
- 失败/警示：浅橙红

## COMPOSITION
- 从左到右流程
- 分支清楚、箭头方向单一
- 中文标签短句、工程术语准确
