---
type: infographic
density: balanced
style: sketch-notes
palette: macaron
image_count: 4
---

## Illustration 1

**Position**: § 4「四个常见故障：先基础，再揭晓本质」
**Purpose**: 用可视化展示四个分页故障的递进关系，从最基础的"无 ORDER BY"到"社交 feed 漂移"，层层升级
**Visual Content**: 4 层递进卡片：故障1=无 ORDER BY（致命不确定性）、故障2=仅 created_at（同值重排）、故障3=offset 并发漂移（重复发券）、故障4=社交 feed 重复（体验→正确性）；用 Coral Red 标注故障3"财产损失"
**Type Application**: infographic — 4-zone 阶梯递进布局
**Filename**: 01-infographic-four-faults.png

---

## Illustration 2

**Position**: § 5「正确姿势：固定记录锚点（Cursor）」→ Cursor 回看 4 个故障
**Purpose**: 展示 Cursor 如何逐一解决 4 个故障，形成"问题→解法"的闭环
**Visual Content**: 左侧 4 个故障编号（对应图1的4层），右侧 Cursor 核心思想（"从锚点继续查"），中间箭头标注 Cursor 对每个故障的解法关键词：强制排序→补齐 tie-breaker→窗口连续→浏览一致
**Type Application**: infographic — 左4→右1 映射布局
**Filename**: 02-infographic-cursor-solves-faults.png

---

## Illustration 3

**Position**: § 5「Cursor 模式的可执行清单（落地版）」
**Purpose**: 可视化 Cursor Token 的数据结构与服务端校验流程
**Visual Content**: 中心：cursor token 结构图（created_at + id + filters_hash + exp → base64url + HMAC）；左侧：Request 入参字段；右侧：Response 出参字段；底部：服务端消费 cursor 拼 SQL 流程
**Type Application**: infographic — 层次结构布局，展示 Token 组成与请求/响应契约
**Filename**: 03-infographic-cursor-token-design.png

---

## Illustration 4

**Position**: § 8「关键场景指导手册」→ §9.5「API 设计评审时的四个必问」
**Purpose**: 可视化分页模式选择决策框架，让读者一眼掌握"什么场景用什么方案"
**Visual Content**: 4个问题卡片（连续稳定读取？高并发写入？允许跳页？重复/漏读后果？）→ 根据答案指向两种方案：Cursor（动态数据主链路）vs Offset（静态数据跳页，前提是排序稳定全序）；底部一句话总结"先定义场景，再选模型"
**Type Application**: infographic — 决策树/流程 radial 布局，4问题卡片→两种方案
**Filename**: 04-infographic-pagination-decision.png
