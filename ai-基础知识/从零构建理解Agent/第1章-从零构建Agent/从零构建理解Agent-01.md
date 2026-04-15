# 从零构建一个 Agent

## 前言

我的学习方式一直偏向实践：先动手做，在犯错和反馈里迭代，知识才真正是自己的。

这次用 TypeScript 来学 Agent，一来 Python 已经很熟了，顺带过一门新语言；二来 CLI 工具在日常开发里越来越重要，正好借这个机会把 TypeScript 系统走一遍。

不管学什么，最小 MVP 都是最快的路。Hello World 之所以影响了每一个学计算机的人，就在于它只做一件事——先跑起来，别的后说。

很多人第一次接触 Agent，会有个直觉：

> 只要接上大模型，再写几句 Prompt，Agent 就有了。

听起来没错，但实际差了一大截。

**LLM 更像大脑，Agent 才是那个真能出去干活的人。**

如果把大模型比作一个聪明但没有手脚的实习生，那 Agent 就是在此基础上：

- 给它一双手：工具调用
- 给它一个小本本：上下文记录
- 再给它一套干活流程：思考、行动、观察、再思考

这样才不只是"会说"，而是"会做"。

这篇文章不聊太远，不堆多智能体、长期记忆、复杂调度这些词。就做一件事：**用最朴素的方式，把一个最小可用 Agent 拆清楚。**

完整教程和原始代码可以参考 [hello-agents GitHub 仓库](https://github.com/datawhalechina/hello-agents)。

## 1. Agent 到底比 LLM 多了什么？

从定义出发，Agent 的核心循环是：

```text
感知（Perception） -> 思考（Thought） -> 行动（Action） -> 观察（Observation）
```

> 大模型本身只具有推理能力，无法和环境交互。Agent 的目的就是提供工具能力和环境交互能力。

换个说法：

- **LLM**：只会推理，查不了外部信息；信息不全时可能一本正经地"胡说"
- **Agent**：推理之外还能调用工具，先查证再回答

举个例子，用户问：**"杭州今天适合穿短袖吗？"**

只有 LLM，它可能直接猜一个天气——像没看预报就出门的人，说得挺自信。

换成 Agent：
1. 判断：这个问题需要实时信息
2. 调用天气 API 或搜索工具
3. 读取结果
4. 给出答案

从"猜"变成"查完再说"。

---

## 2. 一个最小可用 Agent，至少要有 4 个零件

很多人一上来就想做"能订机票、写周报、顺便安慰老板"的超级 Agent。先忍住，最小闭环比宇宙飞船更能教会你东西。

一个能跑起来的 Agent，最少拆成这 4 部分：

| 组件 | 作用 | 通俗比喻 |
|---|---|---|
| LLM | 负责理解和推理 | 大脑 |
| Tools | 负责访问外部世界 | 手和脚 |
| Loop | 负责不断执行 Thought/Action/Observation | 工作流程 |
| Memory / Context | 负责记住刚刚发生过什么 | 小本本 |

记住这个公式就够了：

```text
Agent = LLM + Tools + Control Loop + Context
```

---

## 3. 第一步：先让模型"会想"

`LLMAgent` 负责封装模型调用：

```ts
class LLMAgent {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string = "deepseek-chat"
  ) {}

  async think(messages: Message[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
    });

    let fullContent = "";
    for await (const chunk of response) {
      fullContent += chunk.choices[0]?.delta?.content ?? "";
    }

    return fullContent.trim();
  }
}
```

两个值得注意的地方：

1. **把模型调用包成一个 `think()` 方法**，调用逻辑统一在一处
2. **流式输出 `stream: true`**，用户不用干等，边生成边看

非流式像餐厅憋半天端出满汉全席，流式像面馆先把第一口面递过来——至少你已经开始吃了。

---

## 4. 第二步：给 Agent 装上工具箱

只有模型没有工具，Agent 就像一个脑子不错但被锁在会议室里的人，聪明也使不上劲。

`ToolBox` 负责工具的注册和查找：

```ts
class ToolBox {
  private readonly tools = new Map<string, { description: string; fn: ToolFn }>();

  registerTool(name: string, description: string, fn: ToolFn): void {
    this.tools.set(name, { description, fn });
  }

  getTool(name: string): ToolFn | undefined {
    return this.tools.get(name)?.fn;
  }
}
```

搜索工具大概长这样：

```ts
export async function search(query: string): Promise<string> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return "错误: SERPAPI_API_KEY 未在 .env 文件中配置。";
  }

  const results = (await getJson({
    engine: "google",
    q: query,
    gl: "cn",
    hl: "zh-cn",
  })) as SerpApiResult;

  if (results.answer_box?.answer) {
    return results.answer_box.answer;
  }

  return `对不起，没有找到关于 "${query}" 的信息。`;
}
```

然后在主程序里注册进去：

```ts
toolBox.registerTool("Search", "网页搜索，返回简要结果", search);
```

有了这一层，模型就有了明确的手段：需要查资料，叫 `Search`，别瞎猜。

以"华为最新手机型号及主要卖点"为例，Agent 的流程是：

1. `Thought`: 这个问题需要最新信息
2. `Action`: `Search[华为最新手机型号及主要卖点]`
3. `Observation`: 得到搜索结果
4. 整理后回答用户

---

## 5. 第三步：让 Agent 学会边想边做

真正让 Agent 活起来的，不是模型，也不是工具，而是**循环**。

用的是 ReAct 范式：

```text
Thought -> Action -> Observation -> Thought -> ... -> Finish
```

核心循环：

```ts
for (let step = 1; step <= this.maxSteps; step += 1) {
  const prompt = this.buildPrompt(question);
  const responseText = await this.llmAgent.think([{ role: "user", content: prompt }]);

  const { thought, action } = this.parseOutput(responseText);
  const { toolName, toolInput } = this.parseAction(action);

  if (toolName === "Finish") {
    return toolInput;
  }

  const tool = this.toolBox.getTool(toolName);
  const observation = await tool(toolInput);
  this.history.push(`Action: ${action}`);
  this.history.push(`Observation: ${observation}\n`);
}
```

逻辑很直白：让模型给出当前想法和动作，动作是 `Finish[...]` 就结束，否则执行对应工具、把结果记入历史，再进入下一轮。

ReAct 很像人解决问题的方式——先想一步，动一下手，看看结果，再决定怎么走。

以"查上海明天天气"为例：

```text
Thought: 我需要实时天气信息
Action: Search[上海明天天气]
Observation: 阴，18-24 度
Thought: 用户问的是穿衣建议，还要转成建议
Finish: 建议带一件薄外套，短袖可以穿，但晚上会有点凉
```

---

## 6. 第四步：教模型按格式输出，别放飞自我

ReAct 能跑起来，有个前提：**模型输出必须可解析。**

用 Prompt 明确约束输出格式：

```ts
const REACT_PROMPT_TEMPLATE = `你是一个会调用工具的智能助手。

可用工具:
{tools}

请严格使用以下格式输出:
Thought: 你的思考
Action: 工具名[工具输入] 或 Finish[最终答案]
`;
```

然后用正则解析输出：

```ts
const thoughtMatch = text.match(/Thought:\s*(.*?)(?=\nAction:|\nFinish:|$)/s);
const actionMatch = text.match(/Action:\s*(.*?)$/s);
const finishMatch = text.match(/Finish:\s*(.*?)$/s);
```

这个实现确实比较粗暴，还没用 schema 约束输出结构。但 MVP 阶段这样反而合适——先用最小成本跑通闭环，后续再升级到结构化输出。

如果不加格式约束，直接让模型"想怎么来就怎么来"，拿到的输出可能是自然语言段落、半截 JSON，或者和约定格式完全不搭的东西，根本没法稳定解析。

简单说：

- **Prompt 约束**：轻量、适合最小原型
- **结构化输出**：更稳、适合工程化落地

---

## 7. ReAct 不是唯一答案：常见的三种构建思路

整理一下，常见的 Agent 构建思路大概有三种：

### 7.1 ReAct：边想边做

适合信息不完整、需要一边查一边调整、工具结果会影响下一步决策的场景。比如搜索资料、调试报错、旅行规划这类任务。

### 7.2 Plan-and-Solve：先列计划，再执行

适合步骤清晰、依赖明确、中途变化不大的场景。比如批量处理文件、按固定流程跑数据、执行多步骤脚本。

```text
Plan:
1. 读取目录
2. 找出所有 .md 文件
3. 批量转换标题格式
4. 输出结果

Solve:
按顺序执行
```

### 7.3 Reflection：做完先复盘，再改

适合一次输出不一定靠谱、需要高正确率、允许多轮优化的场景。比如写完代码做自检、生成长答案后做质量评估。

```text
第一次输出：写了一段总结
Evaluate：发现少了风险项
Revise：补充风险和边界条件
最终输出：更完整的版本
```

---

## 8. 写在最后

如果你把这篇文章看到这里，其实已经抓住了构建 Agent 最核心的东西：

```text
一个模型
+ 一个工具
+ 一个循环
+ 一点上下文
= 一个能干活的 Agent
```

所谓"从零构建 Agent"，不是先把系统做得多宏大，而是先让它具备最基本的工作能力：需要信息时知道去查，拿到结果后知道继续往下走，走到合适的时候知道停下来给答案。

一个靠谱的 Agent，不需要像科幻电影里那样无所不能。只要别全靠脑补，别一问三不知，别循环到天荒地老，就已经比很多"看起来很聪明"的系统强了。

做第一个 Agent 时，真的不用急着上难度。先把最小闭环跑通，你会发现这件事拆开看，没那么玄，甚至还挺有意思。

---

## 附录 A：TypeScript Promise 快速上手（含 Java / Go 对比）

### A.1 Promise 是什么？

Promise 可以理解成"未来才会拿到的结果"，有 3 种状态：

- `pending`：进行中
- `fulfilled`：已成功
- `rejected`：已失败

在 Agent 场景里，模型调用、工具调用、网络请求基本都属于 Promise。

### A.2 和 Java Future、Go `go func` 的直观对比

| 语言 | 常见写法 | 核心点 |
|---|---|---|
| TypeScript | `Promise` / `async-await` | 先拿到 Promise，再在合适时机等待结果 |
| Java | `Future` / `CompletableFuture` / `Mono` | `Future#get()` 会阻塞；`CompletableFuture`/`Mono` 更偏链式异步 |
| Go | `go func` + `channel` | goroutine 先并发执行，通过 channel/WaitGroup 收敛结果 |

### A.3 使用 `await`（代码更像同步）

```ts
async function getUserName(id: number): Promise<string> {
  const res = await fetch(`/api/users/${id}`);
  const user = await res.json();
  return user.name;
}

const name = await getUserName(1);
console.log(name);
```

对比：

```java
Future<User> f = pool.submit(() -> loadUser(1));
User u = f.get(); // 等待结果（阻塞当前线程）
System.out.println(u.getName());
```

```go
ch := make(chan User)
go func() { ch <- loadUser(1) }()
u := <-ch // 等待结果
fmt.Println(u.Name)
```

### A.4 不使用 `await`（直接操作 Promise）

```ts
function getUserName(id: number): Promise<string> {
  return fetch(`/api/users/${id}`)
    .then((res) => res.json())
    .then((user) => user.name);
}

getUserName(1)
  .then((name) => console.log(name))
  .catch((err) => console.error(err));

console.log("请求已发出，先执行这里");
```

对比：

```java
CompletableFuture.supplyAsync(() -> loadUser(1))
    .thenAccept(u -> System.out.println(u.getName()));
System.out.println("任务已提交，先执行这里");
```

```go
go func() {
  u := loadUser(1)
  fmt.Println(u.Name)
}()
fmt.Println("goroutine 已启动，先执行这里")
```

### A.5 你说的这种场景：先不 `await`，中间做事，最后一起等

```ts
async function buildDashboard(userId: number) {
  // 1) 先发起两个异步任务（此时不 await）
  const profilePromise = fetchUserProfile(userId);
  const statsPromise = fetchUserStats(userId);

  // 2) 中间先做 xxx 功能（例如：先渲染骨架屏/记录埋点）
  renderSkeleton();
  track("dashboard_open");

  // 3) 需要结果时，再同时等待两个任务
  const [profile, stats] = await Promise.all([profilePromise, statsPromise]);

  // 4) 用结果继续后续逻辑
  renderDashboard(profile, stats);
}
```

这个写法的重点是：**异步请求尽早发起，等待尽量后置，并用 `Promise.all` 一次收敛多个结果**。

说白了：只有当你确实需要 `result` 时才 `await`。这和 Java `Future#get()`、Reactor `Mono` 在消费结果时的思路很像；本质都是"异步先启动，在需要结果时再收敛"。

---

## 关注我

如果你也在用"实践 -> 犯错 -> 反馈"的方式学习 Agent 和 TypeScript，欢迎关注我的微信公众号，后续会持续分享从零构建 Agent 的代码拆解、TypeScript + CLI 的实战案例，以及从最小 MVP 到可用系统的迭代过程。

![公众号](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/%E5%85%AC%E8%80%83/%E5%85%AC%E4%BC%97%E5%8F%B7.jpg)
