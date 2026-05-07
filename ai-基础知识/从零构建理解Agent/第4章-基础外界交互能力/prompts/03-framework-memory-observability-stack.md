---
id: 03
type: framework
style: sketch-notes
palette: default
language: zh
aspect_ratio: "16:9"
output_file: 03-framework-memory-observability-stack.png
references: []
---

# 画面目标
展示记忆系统可观测性的三层架构，以及 session_id / req_id / trace_id 的定位关系。

## ZONES
1. 上层：业务日志层（memory.search / memory.add，命中数、错误信息）
2. 中层：Agent 执行层（openai/agents，工具调用轨迹）
3. 下层：Mem0 层（embedding + 向量库配置边界）

## LABELS（必须出现）
- 错误示例：Query dimension mismatch（Expected 512, got 510）
- session_id：会话上下文
- req_id：单次请求定位
- trace_id：跨工具链路复盘
- 先建可观测性，再做修复

## VISUAL STYLE
- 三层堆叠架构图
- 每层一个浅色背景块，层间有向下箭头与 ID 穿透线
- 技术感但不冷硬，便于公众号阅读

## COLORS
- 背景：暖白
- 三层块：浅蓝 / 浅紫 / 浅青
- 穿透线：深灰 + 强调色

## COMPOSITION
- 自上而下结构
- 右侧增加“排障路径”小注释
- 文本清晰，不要过小字号
