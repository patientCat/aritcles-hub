# Tutorial-04：从只读到可执行（实现受限 WriteFile）

上一节你已经完成只读工具链：`FindFile + ReadFile`。  
这一节的关键目标是补齐“执行能力”：

1. 新增 `WriteFile` 工具（允许写入文件）
2. 保持安全边界（只允许白名单目录）
3. 与日志/trace 串联（`session_id`、`req_id`）

---

## 1. 为什么必须有 WriteFile

没有 `WriteFile`，Agent 即使能生成高质量内容，也只能“说出来”，不能真正落地到文件。

典型失败表现：

- 用户要求“写到 `data/Go_AlphaGo.md`”
- Agent 只能回复“无法创建文件，请手动保存”

这说明当前工具链缺的是“执行闭环”：

- `FindFile`：发现
- `ReadFile`：读取
- `WriteFile`：写入（本章补齐）

---

## 2. WriteFile 设计要求

参数建议：

1. `relativePath: string`：目标相对路径
2. `content: string`：写入内容
3. `mode: "overwrite" | "append"`：覆盖或追加（默认 `overwrite`）
4. `createDirs: boolean`：是否自动创建父目录（默认 `true`）

返回建议：

- 成功：`写入成功: <path> (chars=<n>)`
- 失败：统一错误格式，包含原因（越权、目录不存在、权限错误等）

---

## 3. 安全边界（必须）

1. 路径白名单
- 只允许写入 `data/`（建议先不要开放 `src/`）

2. 规范化路径
- `path.resolve(process.cwd(), relativePath)` 后再校验
- 防止 `../` 穿透

3. 文件大小限制
- 例如单次写入不超过 `200KB`

4. 可选扩展名限制
- 首版建议仅允许 `.md/.txt/.json`

---

## 4. Agent 策略（要写进 instructions）

必须显式约束：

1. 当用户明确要求“保存/写入文件”时，优先调用 `WriteFile`
2. 如果目标文件已存在且用户未说明，先提示将覆盖并请求确认（或默认 `overwrite`，但要告知）
3. 写入后回复路径与结果，不要只给正文

---

## 5. 可观测性要求

在 `business.ndjson` 增加事件：

1. `tool.start`：`WriteFile` 调用开始
2. `tool.success`：写入成功（记录 `path/chars/mode`）
3. `tool.error`：写入失败（记录 `path/error`）

并保持：

- `session_id`
- `req_id`

这样可以与 `traces.ndjson` 完整串联。

---

## 6. 验收标准

1. 输入“把文章写到 `data/Go_AlphaGo.md`”可自动落盘成功
2. 越权路径（如 `../secret.txt`）被拒绝
3. `append` 模式可追加，不破坏原内容
4. 日志中可看到完整写入链路（start/success/error）

