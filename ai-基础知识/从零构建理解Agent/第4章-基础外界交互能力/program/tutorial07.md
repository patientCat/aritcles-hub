# Tutorial07: 记忆模块化 + 引入 ReAct + 完整测试

本章目标：

1. 将记忆能力模块化（从 CLI 解耦）
2. 引入第 1 章风格的 ReAct Agent（Thought/Action/Finish）
3. 补齐可执行测试，确保改造可持续迭代

---

## 1. 新结构

```text
src/
├── memory/
│   └── module.ts
├── react/
│   ├── core.ts
│   ├── http_llm.ts
│   └── memory_tools.ts
├── main.ts
└── ...
test/
├── memory_module.test.ts
└── react_agent.test.ts
```

---

## 2. 模块化记忆

`src/memory/module.ts` 提供统一接口：

- `init()`
- `record(role, content, importance)`
- `retrieveContext(...)`
- `retrieveSemanticContext(...)`
- `flush()`

这样 `main.ts`、ReAct 工具层、测试都可以复用同一套 memory API。

---

## 3. 引入第 1 章 ReAct 模型

`src/react/core.ts` 复用了第 1 章核心机制：

1. 模型输出格式：`Thought + Action/Finish`
2. 工具执行循环：最多 `maxSteps`
3. `Finish[...]` 作为最终答案出口

`src/react/memory_tools.ts` 把记忆能力包装成工具：

- `MemoryRecall[input]`
- `MemorySemantic[input]`
- `SaveMemory[role|importance|content]`

---

## 4. 运行方式

### 4.1 记忆 CLI（原模式）

```bash
npm run dev
```

### 4.2 ReAct 模式

```bash
npm run react -- "请回忆我之前的面试准备重点并给建议"
```

环境变量要求：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

---

## 5. 完整测试

```bash
npm test
```

测试覆盖：

1. `memory_module.test.ts`
   - 记忆写入与召回
   - 本地 `vector_store.json` 写入

2. `react_agent.test.ts`
   - ReAct 调用记忆工具并 `Finish`
   - 超过步数未 `Finish` 返回 `null`

---

## 6. 当前状态结论

你现在已经拥有：

1. 可复用的 memory 模块层
2. 可插拔的 ReAct 推理层
3. 可执行的回归测试基础

这意味着后续你可以安全地继续升级：替换模型、替换向量库、替换工具策略，而不必每次重写主流程。

