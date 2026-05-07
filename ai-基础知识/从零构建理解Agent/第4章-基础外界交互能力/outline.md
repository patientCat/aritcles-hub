---
type: mixed (framework + flowchart)
density: balanced
style: sketch-notes
palette: default
image_count: 4
article: 从零构建理解Agent-04.md
---

## Illustration 1
**Position**: 章节「0. 这一章到底在做什么」后
**Purpose**: 一张总览图把“读/写/规划/观察”四类能力和目标关系讲清楚
**Visual Content**: Agent Core 在中间，四个能力模块围绕，外层是“安全边界 + 稳定交互 + 可观测闭环”
**Filename**: 01-framework-agent-interaction-capabilities.png

## Illustration 2
**Position**: 章节「2.2 补齐最小闭环：FindFile + ReadFile」后
**Purpose**: 解释 ReadFile 失败后的自恢复流程，突出“发现 + 执行”闭环
**Visual Content**: ReadFile失败→FindFile候选→唯一命中→重试ReadFile→成功读取 的流程图
**Filename**: 02-flowchart-readfile-self-recovery.png

## Illustration 3
**Position**: 章节「3.1 真正的收获：把记忆链路做成可观测系统」后
**Purpose**: 用分层架构展示可观测链路与 session_id/req_id/trace_id 的定位作用
**Visual Content**: 三层（业务日志层、Agent执行层、Mem0层）+ 三类ID穿透关系
**Filename**: 03-framework-memory-observability-stack.png

## Illustration 4
**Position**: 章节「7. 自我观察与自我修复」后
**Purpose**: 固化故障处理标准流程，便于读者直接照着排障
**Visual Content**: Observe→Diagnose→Repair→Verify 四阶段闭环，并标注输入与输出
**Filename**: 04-flowchart-self-repair-loop.png
