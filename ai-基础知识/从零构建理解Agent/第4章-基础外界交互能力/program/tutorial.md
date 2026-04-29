# Tutorial 规划（第4章：基础外界交互能力）

你现在在目录：

`/data/home/lukemxjia/aritcles-hub/ai-基础知识/从零构建理解Agent/第4章-基础外界交互能力/program`

本章目标不是“再做一个新 Agent”，而是把现有 ReAct + Memory Agent 补齐**外界交互能力层**，让它能在受控边界内读取真实世界信息。

---

## 1. 总目标（Goal）

完成第4章后，Agent 至少具备以下能力：

1. 可查询真实时间（NowTime）
2. 可读取网页文本（HttpGet）
3. 可读取白名单目录文件（ReadFile）
4. 保持只读安全边界（路径限制、超时、长度限制）
5. 工具能力可测试、可回归

---

## 2. 约束（Non-goals）

本章先不做：

1. 任意写文件/执行 shell
2. 完整 Skill 体系重构（放到第5章）
3. 复杂多工具编排调度器

---

## 3. 里程碑拆解（Milestones）

### M1：打通基础外界工具（对应 `tutorial-01.md`）

目标：把时间/HTTP/文件读取工具注册到 ReAct 工具箱。

产出：

1. `src/react/env_tools.ts` 可注册 `NowTime/HttpGet/ReadFile`
2. `src/main.ts` 完成 env tools 注册
3. `test/env_tools.test.ts` 覆盖核心边界

验收：

1. `NowTime[Asia/Shanghai]` 返回可解析时间
2. `HttpGet` 非 http/https 输入会被拒绝
3. `ReadFile` 越权路径（如 `../`）会被拒绝

### M2：稳定性与错误恢复（对应 `tutorial02.md`）

目标：工具层从“能跑”升级到“可用”。

产出：

1. 统一错误返回格式（输入错误、网络错误、超时、权限错误）
2. Http 超时与截断策略参数化
3. CLI/ReAct 输出可区分“工具失败”和“模型推理失败”

验收：

1. 网络异常下主循环不崩溃
2. 错误信息可定位（至少包含工具名 + 原因）

### M3：与现有记忆链路协同（对应 `tutorial03.md`~`tutorial04.md`）

目标：外界信息进来后能沉淀为可召回记忆。

产出：

1. 外界读取内容可按规则写入 short/long memory
2. 召回链路可区分“历史记忆”与“刚刚抓取的信息”

验收：

1. 用户连续提问时，Agent 能复用上轮外界读取结果
2. 不出现无边界写入导致 memory 污染

### M4：可观测性与治理（对应 `tutorial05.md`）

目标：建立维护闭环，便于后续升级到第5章。

产出：

1. 关键工具调用日志（tool name / latency / success/fail）
2. 最小评测数据与脚本（关键任务是否可稳定命中）
3. Memory 治理规则（重要度/衰减/清理）

验收：

1. 可复现一次完整 query 的工具调用链
2. 多轮运行后长期记忆规模可控

### M5：为 Skill/ToolManager 重构预留接口（对应 `tutorial06.md`~`tutorial07.md`）

目标：不破坏第4章稳定性的前提下，为第5章铺路。

产出：

1. 工具注册签名保持统一
2. EnvTools 能被独立模块化加载
3. 测试覆盖关键回归场景

验收：

1. 在不改业务逻辑情况下可迁移到新 ToolManager

---

## 4. 建议学习顺序（从目标倒推）

1. 先做 `tutorial-01.md`：把外界能力真正接入 Agent
2. 再做 `tutorial02.md`：补稳定性和错误恢复
3. 然后做 `tutorial03.md`、`tutorial04.md`：打通与记忆协同
4. 再做 `tutorial05.md`：补观测、评测、治理
5. 最后做 `tutorial06.md`、`tutorial07.md`：模块化并对齐第5章接口

---

## 5. 每节统一模板（写教程时保持一致）

每个 `tutorialXX.md` 建议固定 6 段：

1. 这节要解决什么问题（1 句话）
2. 完成后的可见效果（用户能看到什么）
3. 代码改动点（具体文件）
4. 关键实现（最小必要代码）
5. 运行与测试命令
6. 验收清单（通过/失败标准）

---

## 6. 本章完成定义（Definition of Done）

满足以下条件即视为第4章完成：

1. ReAct 可稳定调用 `NowTime/HttpGet/ReadFile`
2. 工具具备最小安全边界（只读、白名单、超时、限长）
3. `npm test` 包含 env tools 与 react 主链路回归
4. 第5章改造前无需重写第4章业务代码

---

## 7. 下一步执行建议

如果你要“按目标立刻开工”，就从这条命令开始验证基线：

```bash
npm test -- env_tools.test.ts react_agent.test.ts
```

然后按照 M1 -> M2 -> M3 的顺序推进，不要跳步。
