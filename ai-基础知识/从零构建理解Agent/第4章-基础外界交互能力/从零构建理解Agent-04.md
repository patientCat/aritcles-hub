# 从零构建理解Agent-04：基础外界交互能力

这章我想解决的，不是“让模型回答更好看”，而是一个更工程的问题：

> 让 Agent 在安全边界内，稳定地和真实环境交互。

其实在最一开始的时候， 我只是想着去学习下这个Agent工具如何构建。 以我自己的能力，能否搭建一个openclaw。
在这个过程中，我的思路开是逐渐清晰， 我打算尝试去做一个openclaw出来。 当涉及到工程化的东西的时候， 就不是需要简单的之前的toy代码可以运行的了。 这类代码在讲解原理的时候， 很容易理解， 但是在很多的边界处理上，非常差。 所以我引入了一个比较基础的Agent框架———openai/agents

他是一个非常薄的框架。 非常适合从0开始搭建你自己的Agent的底层能力。 这期以搭建基础外界交互能力的方式来拉开这一章的序幕。 

---

## 0. 这一章到底在做什么

增加外界交互能力，说白了就是增加读，写，规划，观察能力。

1. 给 Agent 接入外界读取能力（时间、网页、文件）
2. 给 Agent 接入外界执行能力（写文件、命令行）
3. 给 Agent 接入会话内计划能力（Task + reminder）
4. 建立可观察、可排障、可修复的闭环（日志 + trace）

一句话：

- 从“只会说”升级到“会做事，而且知道自己做了什么”。

---

## 1. 能力一：看时间（NowTime）

为什么先做这个？
万事开头难，我一般做任何事情，都会先挑一个非常简单的事情，来做基础，给自己信心，然后开始扩展。 

另外：
- LLM训练数据是历史的，不知道你现在几点。
- 这是最小外界事实能力，风险低、验证简单。

---

## 2. 能力二：读（网页 + 文件）

读是比较一个简单的能力。 所以我的目标从这里开始。 
读能力有两个方向：

1. 看网页（前面实现过，SERPAPI/HTTP）
2. 看文件（`ReadFile`）

### 2.1 这里踩到第一个大坑

作为人类，我们有上下文，知道目录结构。比如我说：

- “帮我看 `short_memory.json`”

我脑子里默认的是“当前项目目录里的那个文件”。我的眼睛，我的大脑甚至不需要思考，就已经帮我注入了这个上下文，快到很多时候，我们都忘记了这个时间。

但 agent 并不知道。他没有所谓的“眼睛”，没有“目录结构”的概念。

问题有两个：

1. agent 不知道当前 `workdir`（默认上下文缺失）
2. agent 没有查找文件的能力（只有硬读取）

所以只上 `ReadFile` 不够。

### 2.2 补齐闭环：FindFile + ReadFile

当你要真正实现 Read 能力，还必须加一个能力：`FindFile`。提供给了Agent一个找的能力。 

最小闭环是：

1. 先 `ReadFile`
2. 失败后 `FindFile` 找候选
3. 唯一命中后自动重试 `ReadFile`

这一步非常关键：

- 不是改 prompt 糊过去
- 是补系统能力缺口

核心结论：

> 单执行工具不具备自恢复能力；Agent 需要“发现工具 + 执行工具”的最小闭环。

关键代码（示意）：

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

### 2.3 扩展：让 FindFile 支持模糊表达

虽然 `FindFile + ReadFile` 已经能跑通读取闭环，但这里还有一个很常见的问题：

- 用户表达往往不是精确指令，而是模糊意图。

比如用户说“帮我找 memory 文件”，他真正想要的通常是 `memory.md`（或者 `short_memory.json` 这类相关文件），而不是一个叫 `memory` 的精确文件名。

如果 `FindFile` 只做“完全等于 fileName”的匹配，Agent 很容易出现：

1. 明明有目标文件，却返回“没找到”
2. 后续 `ReadFile` 无法继续，链路中断

所以这里要把 `FindFile` 从“精确匹配工具”升级为“意图检索工具”，至少支持以下模糊策略：

1. 大小写不敏感（`memory` == `Memory`）
2. 子串匹配（`memory` 可命中 `memory.md`）
3. 可选后缀补全（优先尝试 `.md`、`.json`、`.txt`）

示意（伪代码）：

```ts
function isFuzzyMatch(baseName: string, query: string): boolean {
  const a = baseName.toLowerCase();
  const b = query.toLowerCase().trim();
  return a === b || a.includes(b);
}
```

这一步的关键收益不是“多返回几个文件”，而是让 Agent 能理解不完整表达，减少因为输入不精确导致的假失败。

---

## 3. 能力三：记忆（引入 Mem0）

这一步不是“多一个库”，而是架构升级：

- 把记忆从手写本地模块切换到独立记忆层

最小接入：

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

### 3.1 关键收获：把记忆链路做成“可观测系统”
这里举个例子：
在这个调试的过程中，我遇到了`dimension mismatch`的错误。 
> {"ts":"2026-05-02T08:30:48.107Z","event":"memory.write","session_id":"sess_moo30mea_r70ooh","req_id":"req_moo30pmh_l8w7dv","payload":{"status":"error","error":"Query dimension mismatch. Expected 512, got 510"}}

这个问题其实很简单，是因为embeding模型的dim没配置对。 但是我之前没接触过这里。 我完全不知道是什么原因， 这时候可观测性系统的建立就非常重要了。

核心不是“把报错改没”，而是“出问题时能快速定位在哪一层”。

我这里做的是三层串联：

1. **业务层日志**：记录 `memory.search / memory.add` 的输入规模、命中数、错误信息
2. **Agent 执行层（openai/agents）**：保留工具调用与主循环轨迹
3. **记忆层（Mem0）**：明确 embedding 与向量库配置边界

并且把标识符分层清楚：

1. `session_id`：一次会话的连续上下文
2. `req_id`：会话内单次请求
3. `trace_id`：一次 Agent 执行链路（含工具调用）

这样做的价值是：

- 同一个用户问题，可以从 `session_id` 串到整段上下文
- 某一轮异常，可以用 `req_id` 精确定位
- 跨工具调用的执行路径，可以靠 `trace_id` 复盘

所以这一节真正沉淀的工程心法是：

> 不是“先修一个报错”，而是“先建可观测性，再做修复”。

> 我的观念是：只要不打噪音日志， 比如step1, step2, 这种没有任何含义的日志。 对于外部调用，一定有出入口日志。 在存储已经非常便宜的时代，而且是ai时代，我很少见到因为日志打崩一个服务的case。 
---

## 4. 能力四：写（Create / Edit / Delete）

只读能力能“看”，不能“交付”。

写能力比读能力最大的差异是：它会改变系统状态。  
一旦涉及修改，就天然带来风险（误写、覆盖、删除、越权），所以要先做权限限制，再谈易用性。

### 4.1 文件执行工具

按风险分三类：

1. `CreateFile`
2. `EditFile`
3. `DeleteFile`

都要走统一沙箱逻辑：

```ts
const abs = path.resolve(process.cwd(), relativePath);
if (!isPathAllowed(abs, writeRoots)) {
  return `路径不在允许范围内: ${relativePath}`;
}
```

所以这里按风险分三类工具：

1. `CreateFile`（低风险，创建新文件）
2. `EditFile`（中风险，修改已有文件）
3. `DeleteFile`（高风险，删除文件）

并配套三条底线：

1. 路径沙箱（只允许 `safePath` 范围）
2. 操作分级（创建 < 编辑 < 删除）
3. 全量审计（`session_id`、`req_id`、tool日志）

---

## 5. 能力五：BashExec（运维与诊断能力）

Bash 能力不属于“基础写能力”，而是额外的运维/诊断能力。

Bash 很强，但风险也高，所以必须配：

1. 子命令白名单
2. 超时
3. 输出截断
4. 全量日志

否则很快就会变成不可控入口。

---

## 6. 主循环升级：不只维护 messages

到了这一步，主循环开始维护两份状态：

1. `messages`
2. `planningState`

并通过 `Task` 工具（create/list/update）维护当前会话计划。

同时加 reminder 机制：

- 每3轮检查一次（`REMINDER_EVERY_TURNS = 3`）

这里先把边界讲清楚：

- 能力6的目标不是做长期任务系统
- 它只服务当前这一次会话
- 数据是内存级状态，随会话结束而结束

关键意义：

> 当计划进入结构化状态，而不是散在自然语言里时，agent 的漂移会明显减少。

所以这一步的本质是：

- 不再只让模型“自己记着要做什么”
- 而是把“当前要做什么”外显成系统状态（`PlanningState`）
- 再通过 `Task(create/list/update)` 在每轮中持续校正执行方向

---

## 7. 自我观察与自我修复（第4章最值钱的部分）

这一章真正拉开工程差距的，不是工具数量，而是闭环能力。

当系统失败时，流程应该是：

1. Observe：看 `business.ndjson`
2. Diagnose：用 `session_id + req_id` 定位一次请求
3. Repair：改工具/策略/配置
4. Verify：同场景重放验证

这就是“从调模型”转向“做系统”。

---

## 总结

从这章开始， 我们尽量摆脱toy代码，开始构建较为工整的，健壮的工程设计，最终成功搭建我们自己的openclaw.

这里我们暂时命名为babyclaw
## 公众号

![公众号](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/%E5%85%AC%E8%80%83/%E5%85%AC%E4%BC%97%E5%8F%B7.jpg)
