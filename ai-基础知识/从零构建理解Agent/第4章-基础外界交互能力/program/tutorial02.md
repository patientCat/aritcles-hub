# Tutorial-02：在 Agent 中引入 Mem0（LLM=DeepSeek，Embedding=Zhipu）

这一节只做一件事：把“记忆能力”从手写本地模块升级为独立记忆层（Mem0 OSS）。

目标：

1. 每轮回答前检索相关记忆（`search`）
2. 每轮回答后写入新记忆（`add`）
3. 记忆日志与 trace 串联（`session_id`、`req_id`）
4. 失败不阻断主流程（memory fail -> agent 仍可回答）

---

## 1. 为什么引入 Mem0

你已经有了 agent loop 和工具调用。下一步的核心不是“再写一套 memory 数据结构”，而是把记忆模块变成可替换组件：

- 检索和写入通过稳定 API 完成
- 后续可替换向量库/embedding/LLM 供应商
- 记忆可独立扩展，不和 ReAct/tool 逻辑耦合

---

## 2. 安装

在 `program` 目录执行：

```bash
npm install mem0ai
```

---

## 3. 配置（本项目推荐）

本教程按你当前环境：

- `Agent LLM`：DeepSeek
- `Mem0 LLM`：DeepSeek（用于记忆提炼）
- `Mem0 Embedding`：Zhipu（`embedding-3`）

`.env` 示例：

```bash
# 主 Agent
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat

# Zhipu
ZHIPU_API_KEY=...

# Mem0 开关
MEM0_ENABLED=1
MEM0_USER_ID=default_user
MEM0_TOP_K=5

# Mem0 LLM -> DeepSeek
MEM0_LLM_API_KEY=${OPENAI_API_KEY}
MEM0_LLM_BASE_URL=${OPENAI_BASE_URL}
MEM0_LLM_MODEL=${OPENAI_MODEL}

# Mem0 Embedding -> Zhipu
MEM0_EMBED_API_KEY=${ZHIPU_API_KEY}
MEM0_EMBED_BASE_URL=https://open.bigmodel.cn/api/paas/v4
MEM0_EMBED_MODEL=embedding-3
MEM0_EMBED_DIMS=2048
MEM0_VECTOR_DIMENSION=2048
```

注意：

- `MEM0_EMBED_DIMS` / `MEM0_VECTOR_DIMENSION` 必须显式填写并一致。
- 否则 Mem0 可能在自动探测维度时失败（常见 404）。

---

## 4. 代码接入点（`src/main.ts`）

### 4.1 初始化

- `import { Memory } from "mem0ai/oss"`
- 启动时 `initMemory()`
- `MEM0_ENABLED != 1` 时跳过（避免影响主流程）

### 4.2 回答前检索

在单轮处理前：

- `memory.search(userInput, { topK, filters: { user_id } })`
- 把结果拼成上下文前缀注入本轮输入

### 4.3 回答后写入

- `memory.add([{role:user}, {role:assistant}], { userId, metadata })`
- metadata 至少带：`session_id`、`req_id`

### 4.4 错误降级

`search/add/init` 全部 `try/catch`：

- 错误写入业务日志
- 不抛出到主流程（agent 继续回答）

---

## 5. 日志串联建议

你现在有两套日志：

1. Trace：`data/traces.ndjson`
2. 业务日志：`data/business.ndjson`

统一字段：

- `session_id`：会话维度
- `req_id`：请求维度
- （可选）`user_id`

这样可以实现：

- 用 `req_id` 精确定位“单次提问发生了什么”
- 用 `session_id` 追踪“整轮会话记忆演进”

---

## 6. 验收标准

1. `memory.init` 在日志中可见（`ok`/`skipped`）
2. 每轮请求可见 `memory.search` 事件
3. 每轮请求可见 `memory.write` 事件
4. Mem0 出错时，agent 仍返回答案
5. `session_id`、`req_id` 在 trace 和业务日志里一致

---

## 7. 常见故障

1. `Failed to auto-detect embedding dimension`
- 没有配置 `MEM0_EMBED_DIMS` / `MEM0_VECTOR_DIMENSION`

2. Embedding 404
- `MEM0_EMBED_BASE_URL` 或模型名不匹配供应商接口

3. LLM 请求正常但记忆空
- `MEM0_ENABLED` 未开启
- `MEM0_USER_ID` 不一致（写入和检索用的 user_id 不同）

