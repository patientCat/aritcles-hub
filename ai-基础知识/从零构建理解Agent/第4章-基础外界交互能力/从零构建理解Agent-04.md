# 从零构建理解Agent-04：基础外界交互能力

这章我想解决的，不是“让模型回答更好看”，而是一个更工程的问题：

> 让 Agent 在安全边界内，稳定地和真实环境交互。

一开始我只是想学会怎么搭 Agent，甚至想试着自己做一个 openclaw。写到后面我才真正感受到：

- toy 代码很适合讲原理
- 但一碰工程边界（权限、失败重试、可观测性），就会暴露得很快

所以这章我引入了一个很薄的框架 `openai/agents`，不是为了“套框架”，而是为了把外界交互能力一步步补齐。

---

## 0. 这一章到底在做什么

“增加外界交互能力”翻成人话，就是给 Agent 补四种能力：读、写、规划、观察。

1. 给 Agent 接入外界读取能力（时间、网页、文件）
2. 给 Agent 接入外界执行能力（写文件、命令行）
3. 给 Agent 接入会话内计划能力（Task + reminder）
4. 建立可观察、可排障、可修复的闭环（日志 + trace）

一句话概括：

- 从“只会说”，升级到“会做事，而且知道自己做了什么”。

---

## 1. 能力一：看时间（NowTime）

我习惯先做一个最小、低风险、可快速验证的能力，把主链路先跑通。

NowTime 就是这个角色。

原因很简单：

- LLM 的训练数据是历史快照，它天然不知道“现在几点”
- 时间读取是最小外界事实能力，风险低，回归成本也低

这个能力看起来小，但它验证了第一件关键事：

> Agent 可以向系统外部拿事实，而不是只靠参数内推理。

---

## 2. 能力二：读（网页 + 文件）

读能力是外界交互里最容易起步的部分。我把它拆成两类：

1. 看网页（SERPAPI / HTTP）
2. 看文件（`ReadFile`）

### 2.1 第一个大坑：人类默认上下文，Agent 没有

作为人类，我们天然知道目录结构。

比如我说“帮我看 `short_memory.json`”，我脑子里默认的是“当前项目目录里的那个文件”。

但 Agent 没这个默认上下文。它没有“眼睛”，也没有“当前目录感”。

所以会同时缺两样东西：

1. 不知道当前 `workdir`（上下文缺失）
2. 没有文件发现能力（只有硬读取）

只上 `ReadFile` 不够，它只能“读”，不能“找”。

### 2.2 补齐最小闭环：FindFile + ReadFile

真正可用的读能力，至少要是这个链路：

1. 先 `ReadFile`
2. 失败后 `FindFile` 找候选
3. 唯一命中后自动重试 `ReadFile`

关键点不在 prompt，而在系统能力：

- 不是“改提示词糊过去”
- 而是“补齐发现工具 + 执行工具的闭环”

核心代码（示意）：

```ts
const readFileTool = tool({
  name: "ReadFile",
  parameters: z.object({ relativePath: z.string().min(1) }),
  async execute({ relativePath }) {
    const abs = path.resolve(process.cwd(), relativePath);
    if (!isPathAllowed(abs, readRoots)) {
      return `路径不在允许范围内: ${relativePath}`;
    }
    const content = await fs.readFile(abs, "utf-8");
    return cutText(content, FILE_MAX_CHARS);
  },
});

const findFileTool = tool({
  name: "FindFile",
  parameters: z.object({ fileName: z.string().min(1) }),
  async execute({ fileName }) {
    const matches: string[] = [];
    for (const root of readRoots) {
      await collectMatchingFiles(root, fileName.toLowerCase(), matches);
    }
    return matches.map((abs) => path.relative(process.cwd(), abs)).join("\n");
  },
});
```

结论：

> 单个执行工具不具备自恢复能力；Agent 需要“发现 + 执行”的最小闭环。

### 2.3 从精确匹配升级为意图检索

用户输入经常是模糊意图，不是精确文件名。

比如“帮我找 memory 文件”，目标可能是 `memory.md`，也可能是 `short_memory.json`。

如果 `FindFile` 只做完全匹配，会出现两种典型假失败：

1. 明明有目标文件，却返回“没找到”
2. 后续 `ReadFile` 无法继续，链路被中断

所以我把 `FindFile` 从“精确匹配工具”升级成“意图检索工具”，至少支持：

1. 大小写不敏感
2. 子串匹配
3. 可选后缀补全（如 `.md`、`.json`、`.txt`）

示意：

```ts
function isFuzzyMatch(baseName: string, query: string): boolean {
  const a = baseName.toLowerCase();
  const b = query.toLowerCase().trim();
  return a === b || a.includes(b);
}
```

这一步的价值不是“多返回几个文件”，而是降低“输入不精确导致的假失败”。

---

## 3. 能力三：记忆（引入 Mem0）

这一步不是“多接一个库”，而是把记忆从本地临时能力，升级为独立层。

最小接入动作：

1. 回答前检索：`memory.search(...)`
2. 回答后写入：`memory.add(...)`

关键代码（示意）：

```ts
const result = await memory.search(userInput, {
  topK: MEMORY_TOP_K,
  filters: { user_id: MEMORY_USER_ID },
});

await memory.add(
  [
    { role: "user", content: userInput },
    { role: "assistant", content: assistantOutput },
  ],
  {
    userId: MEMORY_USER_ID,
    metadata: { session_id: activeSessionId, req_id: activeReqId },
  },
);
```

### 3.1 真正的收获：把记忆链路做成可观测系统

我在调试里遇到过一次典型错误：

> `Query dimension mismatch. Expected 512, got 510`

根因其实不复杂：embedding 维度配置不一致。

但如果没有可观测性，这类问题会非常难查。

所以我把链路拆成三层：

1. **业务层日志**：记录 `memory.search / memory.add` 的输入规模、命中数、错误
2. **Agent 执行层（openai/agents）**：保留工具调用与主循环轨迹
3. **记忆层（Mem0）**：明确 embedding 与向量库配置边界

并把标识符分层：

1. `session_id`：一次会话上下文
2. `req_id`：会话内单次请求
3. `trace_id`：一次执行链路（含工具调用）

这样排障时可以做到：

- 用 `session_id` 串整段上下文
- 用 `req_id` 锁定具体异常轮次
- 用 `trace_id` 复盘跨工具路径

这节真正沉淀的心法是：

> 不是“先把报错改没”，而是“先把可观测性建好，再修”。

---

## 4. 能力四：写（Create / Edit / Delete）

只读能力能“看”，但不能“交付”。

写能力和读能力最大的区别是：它会改变系统状态。

一旦进入修改路径，风险就会上来（误写、覆盖、删除、越权），所以顺序必须是：

1. 先权限与边界
2. 再易用性

按风险分级的工具：

1. `CreateFile`（低风险）
2. `EditFile`（中风险）
3. `DeleteFile`（高风险）

统一走沙箱校验：

```ts
const abs = path.resolve(process.cwd(), relativePath);
if (!isPathAllowed(abs, writeRoots)) {
  return `路径不在允许范围内: ${relativePath}`;
}
```

底线有三条：

1. 路径沙箱（仅允许 `safePath` 范围）
2. 操作分级（创建 < 编辑 < 删除）
3. 全量审计（`session_id`、`req_id`、tool 日志）

---

## 5. 能力五：BashExec（运维与诊断能力）

Bash 不属于基础写能力，它是运维/诊断增强能力。

能力越强，边界越要清楚。

最小控制面：

1. 子命令白名单
2. 执行超时
3. 输出截断
4. 全量日志

没有这四条，Bash 很容易成为不可控入口。

---

## 6. 主循环升级：不只维护 messages

走到这里，主循环维护的不再只有 `messages`，还包括 `planningState`。

系统层动作是：

1. 通过 `Task(create/list/update)` 维护当前会话计划
2. 每 3 轮提醒一次（`REMINDER_EVERY_TURNS = 3`）

这里要明确边界：

- 这不是长期任务系统
- 只服务当前会话
- 状态驻留内存，会话结束即结束

关键意义：

> 当计划从自然语言变成结构化状态，Agent 的路径漂移会明显下降。

也就是说，我们不再依赖“模型自己记住要做什么”，而是把“现在该做什么”外显成系统状态，再持续校正。

---

## 7. 自我观察与自我修复（本章最值钱的部分）

这一章真正拉开工程差距的，不是多了几个工具，而是闭环能力。

失败时我会按这个顺序处理：

1. **Observe**：看 `business.ndjson`
2. **Diagnose**：用 `session_id + req_id` 定位请求
3. **Repair**：修工具 / 策略 / 配置
4. **Verify**：同场景重放验证

这一步代表一个转变：

- 从“调模型输出”
- 到“做可诊断、可修复的系统”

---

## 总结

从这一章开始，我们开始主动摆脱 toy code，进入更工整、更健壮的工程实现。目标不是“再多一个工具”，而是把 Agent 做成一个可落地、可维护、可演进的系统。

这个阶段我先把它叫作：**babyclaw**。

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/%E5%85%AC%E8%80%83/%E5%85%AC%E4%BC%97%E5%8F%B7.jpg)
