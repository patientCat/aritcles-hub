# 如何从零构建一个 Agent？

很多人第一次接触 Agent，会很容易产生一种错觉：

> 只要接上一个大模型，再写几句 Prompt，一个 Agent 就诞生了。

听起来很像，实际上差了一大截。

**LLM 更像大脑，Agent 才是那个真的能出去干活的家伙。**

如果把大模型比作一个很聪明、很能聊天、但没有手脚的实习生，那么 Agent 就是：

- 给它一双手：工具调用
- 给它一个脑内小本本：上下文记录
- 再给它一个工作流程：思考、行动、观察、再思考

这样它才不是“会说”，而是“会做”。

这篇文章不聊太远，也不一上来就堆多智能体、长期记忆、复杂调度这些大词。

我们只做一件事：**用最朴素的方式，搞清楚一个最小可用 Agent 到底是怎么搭起来的。**

如果你想看完整教程和原始资料，可以直接参考 [hello-agents GitHub 仓库](https://github.com/datawhalechina/hello-agents)。

## 1. Agent 到底比 LLM 多了什么？

从最基本的定义出发，Agent 的核心循环可以概括为：

```text
感知（Perception） -> 思考（Thought） -> 行动（Action） -> 观察（Observation）
```

这里有一句很重要的话：

> 大模型本身只具有推理能力，无法和环境交互。Agent 的目的就是提供工具能力和环境交互能力。

这句话可以翻译成人话：

- **LLM**：像一个会考试、会写作文的人
- **Agent**：像一个会考试、还会打开浏览器、查资料、跑脚本、调用 API 的人

### 先看一个最简单的例子

用户问：**“杭州今天适合穿短袖吗？”**

如果只有 LLM：
- 它可能一本正经地“猜”天气
- 但这个猜测，常常像没看天气预报就出门的人一样自信

如果是 Agent：
1. 先思考：这个问题需要实时信息
2. 调用搜索工具或天气 API
3. 读取结果
4. 再给出答案

这就从“脑补”升级成了“查证后回答”。

---

## 2. 一个最小可用 Agent，至少要有 4 个零件

很多人一上来就想做“能订机票、写周报、顺便安慰老板”的超级 Agent。

我建议先忍住。

先把最小闭环做出来，比一上来设计宇宙飞船靠谱得多。

一个能跑起来的 Agent，最少可以拆成这 4 部分：

| 组件 | 作用 | 通俗比喻 |
|---|---|---|
| LLM | 负责理解和推理 | 大脑 |
| Tools | 负责访问外部世界 | 手和脚 |
| Loop | 负责不断执行 Thought/Action/Observation | 工作流程 |
| Memory / Context | 负责记住刚刚发生过什么 | 小本本 |

可以先记一个简化公式：

```text
Agent = LLM + Tools + Control Loop + Context
```

在实际代码里，这个最小版本已经有了雏形。

---

## 3. 第一步：先让模型“会想”

在下面这段代码里，`LLMAgent` 负责封装模型调用：

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

这里做了两件事：

1. **把模型调用包成一个 `think()` 方法**
2. **使用流式输出 `stream: true`**

为什么流式输出值得保留？

- 用户不用干等到天荒地老
- 你可以边生成边展示
- 这和“LLM 流式输出与 SSE”这部分知识里讲的一样，本质上是模型逐 token 生成，天然适合增量返回

### 用人话理解一下

- 非流式：像餐厅憋半天，一次性端上满汉全席
- 流式：像面馆先把第一口面递过来，至少你已经开始吃了

---

## 4. 第二步：给 Agent 装上工具箱

只有模型没有工具，Agent 就像一个脑子很好、但被封印在会议室里的同学。

下面这段代码用 `ToolBox` 来管理工具：

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

而真正的搜索工具，大概可以写成这样：

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

然后在主程序里把工具注册进去：

```ts
toolBox.registerTool("Search", "网页搜索，返回简要结果", search);
```

### 这一步到底解决了什么问题

这相当于告诉模型：

> 你别瞎猜。需要查资料时，叫 `Search`。

### 一个简单例子

如果用户问：**“华为最新手机型号及主要卖点”**

Agent 不需要凭记忆硬答，而是可以：

1. `Thought`: 这个问题需要最新信息
2. `Action`: `Search[华为最新手机型号及主要卖点]`
3. `Observation`: 得到搜索结果
4. 再总结给用户

这就是从“玄学回答”变成“查完再说”。

---

## 5. 第三步：让 Agent 学会边想边做

真正让 Agent 活起来的，不是模型，也不是工具，而是**循环**。

这种实现采用的是 ReAct 范式：

```text
Thought -> Action -> Observation -> Thought -> ... -> Finish
```

核心循环大概是这样：

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

它背后的思路非常朴素：

1. 先让模型产出当前想法和动作
2. 如果动作是 `Finish[...]`，就结束
3. 如果动作是某个工具，就去执行
4. 把工具结果记进历史，再让模型继续想

### 为什么 ReAct 这么常见？

因为它非常像人类解决问题：

- 先想一步
- 动一下手
- 看看结果
- 再决定下一步

比如“查上海明天天气”：

```text
Thought: 我需要实时天气信息
Action: Search[上海明天天气]
Observation: 阴，18-24 度
Thought: 用户问的是穿衣建议，我还需要转成建议
Finish: 建议带一件薄外套，短袖可以穿，但晚上会有点凉
```

这个流程很像一个靠谱同事，而不是一个只会拍脑门的同事。

---

## 6. 第四步：教模型按格式输出，不要放飞自我

ReAct 之所以能跑起来，一个关键前提是：**模型输出必须可解析。**

Prompt 模板会明确要求模型这样输出：

```ts
const REACT_PROMPT_TEMPLATE = `你是一个会调用工具的智能助手。

可用工具:
{tools}

请严格使用以下格式输出:
Thought: 你的思考
Action: 工具名[工具输入] 或 Finish[最终答案]
`;
```

然后代码再用正则解析：

```ts
const thoughtMatch = text.match(/Thought:\s*(.*?)(?=\nAction:|\nFinish:|$)/s);
const actionMatch = text.match(/Action:\s*(.*?)$/s);
const finishMatch = text.match(/Finish:\s*(.*?)$/s);
```

### 为什么这一层很重要？

因为如果你只是说：

> “请你自主调用工具，想怎么来就怎么来。”

模型很可能就真的“想怎么来就怎么来”。

然后程序员就会得到一份惊喜盲盒：
- 有时返回自然语言
- 有时返回半截 JSON
- 有时突然诗朗诵

如果任务再复杂一些，可以进一步了解结构化输出（Structured Outputs）。

一句话总结：

- **Prompt 约束**：轻量、简单、适合最小原型
- **结构化输出**：更稳、更适合工程化

---

## 7. ReAct 不是唯一答案：常见的三种构建思路

把常见思路归纳一下，大致有三种：

### 7.1 ReAct：边想边做

参考：ReAct 范式

适合：
- 信息不完整
- 需要一边查一边调整
- 工具返回结果会影响下一步决策

例子：
- 搜索资料
- 调试报错
- 旅行规划

一句话理解：**边走边看路。**

---

### 7.2 Plan-and-Solve：先列计划，再执行

参考：Plan-and-Solve 范式

适合：
- 步骤清晰
- 依赖明确
- 中途变化不大

例子：
- 把一批 markdown 文件统一转格式
- 按固定流程处理数据
- 做一个多步骤脚本任务

一句话理解：**先写清单，再干活。**

一个极简例子：

```text
Plan:
1. 读取目录
2. 找出所有 .md 文件
3. 批量转换标题格式
4. 输出结果

Solve:
按顺序执行
```

---

### 7.3 Reflection：做完先复盘，再改

参考：Reflection 范式

适合：
- 一次输出不一定靠谱
- 需要高正确率
- 允许多轮优化

例子：
- 写代码后做一次自检
- 写报告后先检查遗漏
- 长答案生成后做质量评估

一句话理解：**先交作业，再自己挑刺。**

一个简单例子：

```text
第一次输出：写了一段总结
Evaluate：发现少了风险项
Revise：补充风险和边界条件
最终输出：更完整的版本
```

---

## 8. 写在最后

如果你把这篇文章一路看到这里，其实已经抓住了构建 Agent 最核心的东西：

```text
一个模型
+ 一个工具
+ 一个循环
+ 一点上下文
= 一个能干活的 Agent
```

很多时候，所谓“从零构建 Agent”，并不是先把系统做得多宏大，
而是先让它具备最基本的工作能力：

- 需要信息时，知道去查
- 拿到结果后，知道继续往下走
- 走到合适的时候，知道停下来给出答案

说白了，一个靠谱的 Agent，不一定要像科幻电影里那样无所不能。

它只要别全靠脑补，别一问三不知，别循环到天荒地老，就已经赢过不少“看起来很聪明”的系统了。

所以做第一个 Agent 时，真的不用急着上难度。

先把最小闭环跑通。

你会发现，Agent 这件事一旦拆开看，其实没那么玄，甚至还有点朴实可爱。