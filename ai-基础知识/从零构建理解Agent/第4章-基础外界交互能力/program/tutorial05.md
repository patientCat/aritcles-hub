# Tutorial-05：新增 Bash 命令工具（BashExec）

第4章前几节你已经有了文件与网络基础能力。  
这一节新增一个高通用工具：`BashExec`，让 Agent 能执行终端命令做环境排查和自动化操作。

---

## 1. 目标

1. 增加 `BashExec` 工具
2. 支持执行 `bash -lc "<command>"`
3. 返回 `stdout/stderr`
4. 增加超时、输出截断、日志记录

---

## 2. 最小实现点

在 `src/main.ts` 中：

1. 使用 `execFile` 执行命令
2. 固定 `cwd=process.cwd()`
3. 增加超时（例如 `12s`）
4. 限制输出大小（例如 `8000` 字符）

核心参数建议：

- `BASH_TIMEOUT_MS=12000`
- `BASH_MAX_OUTPUT_CHARS=8000`

---

## 3. 安全边界（必须明确）

`BashExec` 风险高于文件工具，建议在教程中明确：

1. 仅在用户明确要求时调用
2. 默认用于“诊断/查询”而不是破坏性操作
3. 对删除/覆盖类命令增加额外确认（下一章可加 HITL）
4. 完整记录命令与结果到 `business.ndjson`

---

## 4. Agent 指令策略

在 `instructions` 加入：

- 可以使用 `BashExec` 做命令行排查与自动化
- 先优先安全工具（`ReadFile/FindFile`），再考虑 `BashExec`
- 当命令失败时，返回失败原因与 stderr 摘要

---

## 5. 可观测性

`BashExec` 需要记录：

1. `tool.start`：命令内容
2. `tool.success`：输出字符数
3. `tool.error`：失败原因

并带上：

- `session_id`
- `req_id`

这样可以与 `traces.ndjson` 串联完整链路。

---

## 6. 验收标准

1. 用户请求“执行 `ls -la`”时，Agent 能调用 `BashExec` 并返回输出
2. 超时命令会被中断并返回错误
3. 过长输出会被截断
4. 日志里有完整 `start/success/error` 记录

---

## 7. 本章结论

`BashExec` 是“通用但高风险”的环境交互工具。  
它能显著提升 Agent 的排障与自动化能力，但必须配套：

- 超时
- 输出限制
- 审计日志
- 行为策略约束

