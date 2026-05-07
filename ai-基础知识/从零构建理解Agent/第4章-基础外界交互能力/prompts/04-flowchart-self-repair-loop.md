---
id: 04
type: flowchart
style: sketch-notes
palette: default
language: zh
aspect_ratio: "16:9"
output_file: 04-flowchart-self-repair-loop.png
references: []
---

# 画面目标
把本章“自我观察与自我修复”固化为可执行闭环，读者可直接按图排障。

## FLOW
Observe → Diagnose → Repair → Verify →（若未通过）回到 Observe

## 每步说明
- Observe：查看 business.ndjson 与工具日志
- Diagnose：用 session_id + req_id 锁定异常请求
- Repair：调整工具 / 策略 / 配置
- Verify：同场景重放验证

## LABELS（必须出现）
- 从“调模型输出”到“做系统”
- 可诊断、可修复、可复盘
- 闭环而非一次性修补

## VISUAL STYLE
- 环形或方形闭环流程图
- 四步节点等权重，中心写“工程闭环”
- 教程友好、结构明确

## COLORS
- 背景：奶油白
- 节点：低饱和蓝/绿/橙/紫
- 箭头：深灰

## COMPOSITION
- 闭环明显，返工路径清晰
- 保证中文文字完整可读
