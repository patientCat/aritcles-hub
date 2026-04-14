# 从零构建理解Agent-02：Plan-and-Solve + Reflection

## 前言

上一期我们跑起来了最小可用 Agent，核心是 ReAct：

```text
Thought -> Action -> Observation -> ... -> Finish
```

从 Agent Engineering 的角度看，这套范式的效果很大程度上取决于底层模型能力和提示质量。但**模型能力是边界，我们能做的是工程化的控制手段**。

具体来说，ReAct 在复杂任务里会暴露两个需要工程介入的空白：

1. **任务很长时，中途缺乏全局路线锚点**：每步只管当下，不知道还剩多少、优先级是什么。
2. **单次输出质量不稳定时，缺乏自我校正闭环**：没有机制让模型主动诊断并改进。

所以这一期我们在 ReAct 之上叠加两层能力：

- **Plan-and-Solve**：先规划路线，再执行，减少路径漂移。
- **Reflection**：先产出，再复盘优化，提高输出质量。

---

## 1. Plan-and-Solve：先规划，再执行

### 1.1 核心思路

Plan-and-Solve 的出发点很简单：**把"一次性让模型搞定一切"改成"先让它告诉我们计划是什么"**。

这样做有两个好处：
- 模型在规划阶段就会把任务拆清楚，避免做到一半才发现漏了步骤。
- 有了计划作为锚点，执行阶段可以逐项检查进度，不容易跑偏。

### 1.2 关键代码

```ts
// PlanAndSolveAgent 主流程
async run(question: string): Promise<string | null> {
  // 1. 清空任务状态
  this.taskStates.length = 0;

  // 2. 先规划：把问题拆成子任务列表
  const plannedTasks = await this.planner.plan(question);
  if (plannedTasks.length === 0) return null;

  // 3. 填充任务状态
  this.taskStates.push(...plannedTasks);

  // 4. 逐任务执行（每个任务内部还是 ReAct）
  for (const task of this.taskStates) {
    if (task.status !== "pending") continue;
    await this.executor.execute(question, task);
  }

  // 5. 汇总最终答案
  const finalPrompt = this.buildFinalPrompt(question);
  return await this.llmAgent.think([{ role: "user", content: finalPrompt }]);
}
```

```ts
// Planner 规划器
async plan(question: string): Promise<Task[]> {
  // 1. 让模型输出计划
  const response = await this.llmAgent.think([
    { role: "user", content: `请将以下问题拆分成子任务列表，返回 JSON 数组：\n${question}` }
  ]);

  // 2. 优先解析代码块里的 JSON
  let tasks = this.parseJsonTasks(response);

  // 3. JSON 解析失败则走行文本兜底
  if (!tasks.length) {
    tasks = this.parseLineByLine(response);
  }

  // 4. 去重：避免重复执行相同任务
  return this.deduplicateTasks(tasks);
}
```

```ts
// Executor 执行器（内部还是 ReAct）
async execute(question: string, task: Task): Promise<void> {
  // 每个子任务走一轮 ReAct
  const result = await this.reActAgent.run(question, task.description);

  task.status = result ? "completed" : "failed";
  task.result = result ?? "执行失败";
}
```

### 1.3 关键设计讲解

**Planner 的双保险解析**

规划器输出的是 JSON，但模型生成的 JSON 有时不规范。所以这里做了两件事：

```ts
// 第一层：优先解析 ```json ... ``` 或 ```javascript ... ``` 包裹的数组
let tasks = this.parseJsonTasks(response);

// 第二层：失败了再走行文本逐行解析
if (!tasks.length) {
  tasks = this.parseLineByLine(response);
}
```

这样即使模型输出的 JSON 有格式问题（比如多了逗号、少了引号），也能有兜底，不会直接卡死。

**去重机制**

```ts
// 规划出来的子任务如果有重复，直接标记 skipped
return this.deduplicateTasks(tasks);
```

重复任务不会重新执行，但会保留在任务列表里，汇总时可以说明"因重复已跳过"。

**Executor 内部仍然是 ReAct**

这是容易被忽略的一点：Plan-and-Solve 不是"傻顺序执行"，每个子任务遇到不确定信息时，仍然可以调用工具、观察结果、再决定下一步。

也就是说：

```text
Plan（规划层）
  -> Task1 执行（ReAct）
  -> Task2 执行（ReAct）
  -> Task3 执行（ReAct）
汇总
```

宏观稳定 + 微观灵活，这是它和纯顺序执行的根本区别。

### 1.4 实践：多城市天气汇总

默认实现里 Plan-and-Solve 的示例问题：

> 查询并汇总中国西北五省省会/首府今天的天气，并给出气温范围、天气现象与出行建议。

执行流程：

```text
Plan 阶段：
  模型输出 -> [
    "查询西安天气",
    "查询兰州天气",
    "查询西宁天气",
    "查询银川天气",
    "查询乌鲁木齐天气",
    "汇总并生成出行建议"
  ]

Execute 阶段（每个子任务走 ReAct）：
  Task1: Thought -> Action: Search[西安天气] -> Observation -> Finish[西安晴，12~22℃]
  Task2: Thought -> Action: Search[兰州天气] -> Observation -> Finish[兰州多云，8~18℃]
  ...
```

相比纯 ReAct 一口气做完整任务，Plan-and-Solve 更不容易漏城市、漏字段。每个子任务结果都有记录，汇总时是"基于轨迹的归纳"，不是凭空捏造。

---

## 2. Reflection：先产出，再复盘优化

### 2.1 核心思路

Reflection 的出发点是：**单次生成质量不稳定，那就让模型先出一个版本，再主动诊断哪里可以改进，然后用改进后的 prompt 继续生成**。

不是"再想一遍"，而是：
1. 给出明确的评价维度（一致性、准确性、流畅性、文化适配）
2. 输出结构化的反思结果（JSON）
3. 下一轮直接用优化后的 prompt 继续迭代

### 2.2 关键代码

```ts
// ReflectionTranslatorAgent 主循环
for (let round = 1; round <= this.totalRounds; round += 1) {
  // 1. 用当前 prompt 生成初稿
  const initialPrompt = this.buildInitialPrompt(sourceText, activeInitialPrompt);
  const draftTranslation = await this.llmAgent.think([
    { role: "user", content: initialPrompt }
  ]);

  // 2. 如果不是最后一轮，做反思
  if (round < this.totalRounds) {
    // 让模型评估初稿，并给出优化建议
    const reflectionPrompt = this.buildReflectionPrompt(
      sourceText, draftTranslation, activeInitialPrompt
    );
    const reflectionOutput = await this.llmAgent.think([
      { role: "user", content: reflectionPrompt }
    ]);

    // 3. 解析反思结果，拿到优化后的 prompt
    const feedback = this.parseReflection(reflectionOutput);
    if (feedback.optimizedPrompt) {
      activeInitialPrompt = feedback.optimizedPrompt;
    }
  }
}
```

```ts
// 反思结果解析
parseReflection(output: string): ReflectionFeedback {
  // 解析 JSON 格式的反思结果
  // 包含：consistency, accuracy, fluency, cultural_adaptation 评分
  //       reflection（文字反思）
  //       optimizedPrompt（优化后的提示词）
  const parsed = JSON.parse(extractJsonBlock(output));
  return parsed;
}
```

### 2.3 关键设计讲解

**为什么 Reflection 比"多问一次模型"更有用**

普通的"再想想"是让模型自己判断，输出随意。Reflection 则给了：

```text
评价维度固定 -> 一致性、准确性、流畅性、文化适配
输出格式固定 -> JSON，可解析
下一行动固定 -> 用优化后的 prompt 继续生成
```

这就把"反思"从口号变成了可执行的闭环。

**优化 prompt 怎么用**

```ts
// 下一轮直接用优化后的 prompt
activeInitialPrompt = feedback.optimizedPrompt;
```

也就是说，第二轮的"初稿 prompt"其实已经是第一轮反思后的版本，第三轮又是第二轮反思后的版本。每轮都在前一轮的诊断结果上继续，而不是从零开始。

### 2.4 实践：古诗翻译多轮优化

默认实现里 Reflection Agent 对一段古诗文运行 3 轮：

```text
Round 1:
  初稿 -> 反思 -> 优化 prompt

Round 2:
  用 Round 1 优化后的 prompt 生成 -> 反思 -> 继续优化

Round 3:
  用 Round 2 优化后的 prompt 生成 -> 输出最终稿
```

你会看到每轮都打印：
- `[Draft Translation]` - 当前轮次的译文
- `[Reflection]` - 反思结果（含评分和优化建议）

一个真实运行片段：

```text
Round 1（初稿）
- 译文已较完整，语义基本忠实。
- Reflection 指出：文化意象解释还可加强，"歌以咏志"动作感可更强。

Round 2（优化后）
- 译文韵律和诗性明显提升，反思评分提升到高分区间。
- Reflection 继续给出可执行改进：强化 mythic/celestial 意象。

Round 3（再收敛）
- 最终稿形成：... How blessed I feel! I lift my voice and sing my will.
```

Reflection 的实际价值：
1. 不是"重写一遍"，而是**基于诊断点迭代**。
2. 每轮都有可解释评分 + 可执行建议。
3. 不引入复杂记忆系统，靠短期上下文就能显著提质。

---

## 3. 融会贯通：三层之间的内在联系

讲到这里，有必要把 Plan-and-Solve 和 Reflection 的关系拎清楚。

**Plan 和 Reflection 是一对互补的反思机制**

Plan 解决的是"任务执行前的规划质量"——如果规划本身就有疏漏，后面的执行再好也是徒劳。所以 Plan 也可以加 Reflection：

```text
问题 -> Plan（初版计划） -> Reflection（评估计划合理性） -> 优化后的 Plan -> 执行
```

Reflection 解决的是"答案生成后的质量"——初版答案不一定最优，需要诊断改进。

两者适用的阶段不同：**Plan 的反思发生在执行前，Reflection 的反思发生在产出后**。

**Plan 的子任务执行不是 one-shot，而是 ReAct**

容易被忽略的一个细节是：Executor 在执行每个子任务时，并不是简单调用一次工具就结束，而是走了完整的 ReAct 循环：

```text
Task1: Thought -> Action[Search] -> Observation -> Finish
```

这意味着即使在子任务内部，遇到不确定信息时也可以：
- 调用工具获取新数据
- 观察工具返回结果
- 根据结果决定下一步
- 最终才输出子任务结果

所以 Plan-and-Solve 不是"先 Plan 再傻执行"，而是：

```text
Plan（全局路线图）
  -> Task1 执行（ReAct，内部可动态调整）
  -> Task2 执行（ReAct，内部可动态调整）
  -> Task3 执行（ReAct，内部可动态调整）
汇总
```

**三层叠加的完整视图**

把这几期内容串起来，Agent 的能力演进是：

```text
基础：ReAct（Thought -> Action -> Observation -> Finish）
第一层增强：Plan-and-Solve（先规划路线，再逐任务 ReAct 执行）
第二层增强：Reflection（在规划前反思计划，在执行后反思结果）
```

Plan 和 Reflection 都可以独立叠加，也可以组合使用。核心是：**每一层都在补模型能力的边界，而不是替代**。

---

## 4. 从模式到实现：LangChain 的例子

### 4.1 Plan-and-Execute 的 LangChain 实现

[LangChain 官方示例](https://github.com/langchain-ai/langgraphjs/blob/main/examples/plan-and-execute/plan-and-execute.ipynb) 展示了一个清晰的 Plan-and-Execute 架构。

它的执行流程是：

```text
Planner（规划） -> Agent（执行/ReAct） -> Replanner（重规划） -> [循环直到完成]
```

关键点是**重规划器（Replanner）**——每执行完一步，不是直接跳到下一步，而是先检查"当前计划还剩什么"：

```typescript
// Replanner 的 prompt 关键部分
`For the given objective, come up with a simple step by step plan.
 You have currently done the follow steps: {pastSteps}
 Update your plan accordingly...`
```

这对应我们前面说的"Plan 可以加 Reflection"——在规划阶段也做反思，让计划能根据执行情况动态调整。

LangChain 的 Plan-and-Execute 示例展示了清晰的状态管理：

```typescript
const PlanExecuteState = Annotation.Root({
  input: Annotation({ reducer: (x, y) => y ?? x ?? "" }),
  plan: Annotation({ reducer: (x, y) => y ?? x ?? [] }),
  pastSteps: Annotation<[string, string][]>({
    reducer: (x, y) => x.concat(y),
  }),
});
```

### 4.2 Annotation：状态更新的语义谁说了算

Annotation 是 LangChain 的状态管理核心，它解决了一个问题：**每个状态字段的"更新语义"由字段自己定义，而不是由使用方决定**。

对比我们自己的实现：

```typescript
// 我们的实现里，taskStates 更新逻辑散在各处
this.taskStates.push(...plannedTasks);     // 这里是 push
task.status = result ? "completed" : "failed";  // 这里直接赋值
task.result = result ?? "执行失败";         // 也是直接赋值
```

三个地方对 `taskStates` 的更新方式都不一样：`push`、`直接赋值`、`??`。这就是**状态更新的语义分散在使用方**，每次更新都要想"这里该用 push 还是赋值"。

用 Annotation 的方式：

```typescript
pastSteps: Annotation<[string, string][]>({
  reducer: (x, y) => x.concat(y),  // 永远只做 concat，不接受其他语义
}),
input: Annotation({ reducer: (x, y) => y ?? x ?? "" }),  // 只接受有值覆盖
plan: Annotation({ reducer: (x, y) => y ?? x ?? [] }),   // 同上
```

`reducer: (x, y) => x.concat(y)` 的意思是：**这个字段永远只追加，不接受替换**。不管谁调用、什么时候调用，pastSteps 的更新逻辑都是"拼接"。

这样带来的好处：

**1. 状态更新语义集中在一处定义**

定义 state 的人同时定义了每个字段的更新方式，使用方不需要再思考"这里该 push 还是赋值"。

**2. 节点之间不会意外覆盖**

传统实现里，如果有两个节点同时更新 `taskStates`，很可能出现一个覆盖另一个的情况。Annotation 的 reducer 是固定的，永远只有一种合并方式。

**3. Trace 和调试变简单**

因为每个字段的 reducer 是确定的，LangChain 可以记录"某次更新走了哪个 reducer"，这让调试有据可查。

这就是工程化的体现：**不是写一个 for 循环、if 判断就叫工程化，而是把"数据怎么流动"的语义约束住，让使用方不可能写错**。

### 4.3 Reflection 的 LangChain 实现

[Reflection 的 LangChain 示例](https://github.com/langchain-ai/langgraphjs/blob/main/examples/reflection/reflection.ipynb) 用一个论文生成器来演示，核心是两个链：

```typescript
// 生成器链
const essayGenerationChain = ChatPromptTemplate.fromMessages([
  ["system", `你是一个 essay 助手...如果用户提供了批评，生成改进版本`],
  new MessagesPlaceholder("messages"),
]).pipe(llm);

// 反思链
const reflect = ChatPromptTemplate.fromMessages([
  ["system", `你是一个老师，给论文打分并提供详细改进建议`],
  new MessagesPlaceholder("messages"),
]).pipe(llm);
```

它的状态更简单：

```typescript
const State = Annotation.Root({
  messages: Annotation({ reducer: (x, y) => x.concat(y) })
});
```

这里有一个巧妙的**消息类型反转**设计：

```typescript
// 反思节点的输出需要转换为 HumanMessage
// 这样下一轮生成时，模型会把它理解为"用户的反馈"
const translated = messages.slice(1).map((msg) => 
  new clsMap[msg._getType()](msg.content.toString())
);
```

循环终止条件也很直接：

```typescript
if (messages.length > 6) {  // 3次生成 + 3次反思后结束
  return END;
}
```

### 4.4 这两个例子的共同启示

**1. 链（Chain）是可复用单元**

生成器、规划器、反思器都是独立的 `Chain`，可以单独调用，也可以组合。这比我们在代码里写一个 `run()` 方法更灵活。

**2. 循环用"节点 + 条件边"表达很直观**

LangChain 源码里：

```typescript
workflow.addConditionalEdges("generate", shouldContinue)
       .addEdge("reflect", "generate");
```

`generate` 节点执行完后判断 `shouldContinue`，决定是跳到 `reflect` 还是 `END`。这比在代码里写 `for` 循环更容易看清楚整个流程。

### 4.5 与 agent-patterns 文档的对应

回顾 Plan-and-Solve 和 Reflection 的原始文档：

- [Plan-and-Solve Pattern](https://agent-patterns.readthedocs.io/en/stable/patterns/plan-and-solve.html) 强调**规划阶段和执行阶段的分离**，以及**累积式推进**。
- [Reflection Pattern](https://agent-patterns.readthedocs.io/en/stable/patterns/reflection.html) 强调**生成-批判-改进的三阶段循环**，以及**双角色 LLM 配置**（生成用较高温度，批判用较低温度）。

LangChain 的价值在于：**它是一个让这些模式可执行、可组合、可调试的运行时框架**。

你可以用 LangChain 实现纯 Plan-and-Solve，也可以组合 Reflection，也可以加更多节点（比如验证节点、工具节点）。模式是"思想"，LangChain 是"实现工具"。

---

## 5. 小结

这一期做的事情可以一句话概括：

- **Plan-and-Solve** 解决"怎么把复杂任务拆清楚并稳步推进"。
- **Reflection** 解决"怎么让结果一轮比一轮更好"。

两者不是对立关系，也不是替代 ReAct：

```text
会调用工具（ReAct）
  -> 会规划执行（Plan-and-Solve）
  -> 会自我反思（Reflection）
```

从工程视角看，Agent 的能力是按闭环逐层叠加的。这就是从"能跑"走向"更稳、更好用"的过程。

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/%E5%85%AC%E8%80%83/%E5%85%AC%E4%BC%97%E5%8F%B7.jpg)
