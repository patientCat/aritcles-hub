# 从零构建理解Agent-03-实现一个记忆模块

在第0章谈到Agent和大模型的区别时，记忆模块被一笔带过了。原因是记忆涉及一些稍微高级的计算机知识。现在，经过前两章的铺垫，是时候直面这个问题了。

但这一次，我们换个方式——**不直接告诉你答案，而是通过一系列问题引导你自己推导出设计**。每个问题的答案会引出下一个问题，最终你会看到一个完整记忆模块的成型过程。

---

## 问题0：Agent为什么需要记忆？

这个问题看似简单，但答案决定了整个设计的方向。

**思考一下：**
- 如果你和Agent每次对话都要重新介绍自己，你会疯掉吗？
- 如果Agent不能记住你三天前提到的"下周三有面试"，它还算智能吗？
- 电影《初恋50次》的男主每天都要让女主重新爱上他——这是浪漫，但在工程上是灾难

**答案：** Agent需要记忆，因为**状态**是智能的基础。没有状态，Agent只是一个无状态的函数调用。

但这引出了下一个问题：记忆应该如何存储？

---

## 问题1：一条记忆应该包含什么信息？

假设你要设计一个数据结构来存储"用户说过的话"，最少需要哪些字段？

**选项A：** 只需要内容
```typescript
interface MemoryItem {
  content: string;
}
```

**选项B：** 内容 + 时间
```typescript
interface MemoryItem {
  content: string;
  ts: Date;
}
```

**选项C：** 内容 + 时间 + 谁说的
```typescript
type Role = "user" | "assistant" | "system";

interface MemoryItem {
  role: Role;
  content: string;
  ts: Date;
}
```

**选项D：** 再加一个唯一ID
```typescript
interface MemoryItem {
  id: string;
  role: Role;
  content: string;
  ts: Date;
}
```

**思考一下：**
- 没有时间戳，你怎么知道哪条记忆更新？
- 没有role，你怎么区分"用户问的问题"和"助手的回答"？
- 没有ID，如果两条内容完全一样的记忆，你怎么区分它们？

**答案：选D。** 一条完整的记忆至少需要这四个字段。这在`src/types.ts`中有明确定义：

```typescript
export type Role = "user" | "assistant" | "system";
export type MemoryTier = "short" | "long" | "summary";

export interface MemoryItem {
  id: string;
  role: Role;
  content: string;
  ts: string;
  importance: number;
  tier: MemoryTier;
}
```

注意到我们还加了`importance`和`tier`——这两个字段会在后面解释为什么要加。

---

## 问题2：记忆无限增长怎么办？

假设用户和Agent聊了1000轮，如果你把所有记忆都加载进内存，会发生什么？

**思考一下：**
- 内存会被耗尽吗？
- 把这些记忆都塞进LLM的prompt，成本会有多高？
- 早期的记忆真的还有价值吗？

**答案：** 必须对记忆数量做限制。工程上最简单的策略是**先进先出（FIFO）**——超过上限时，删除最早的记忆。

FIFO也很符合我们的直觉。 我们很容易忘记前几天吃了什么饭。

```typescript
class SimpleMemory {
  private items: MemoryItem[] = [];
  constructor(private maxItems: number = 100) {}

  add(role: Role, content: string): void {
    const item: MemoryItem = { /* ... */ };
    this.items.push(item);
    // 控制容量：超过上限就删除最早的一条
    if (this.items.length > this.maxItems) {
      this.items.shift();
    }
  }
}
```

但这引出了一个新问题：如果第1条记忆是"我叫张三"，第100条是"帮我订机票"，当第101条进来时，"我叫张三"被删掉了。下次用户问"我叫什么"，Agent回答不上来——这合理吗？

---

## 问题3：有些记忆比其他记忆更重要，怎么办？

假设有两条记忆：
1. "我叫张三"（用户身份，永远重要）
2. "今天天气不错"（闲聊，一周后无价值）

用FIFO删除最早的记忆，会把两条一视同仁地处理。这显然不合理。

**思考一下：**
- 你能想到什么策略来区分记忆的重要性吗？
- 谁来决定一条记忆的importance分数？
- 如果所有记忆都是5分，这个机制还有意义吗？

**答案：给每条记忆打重要性分数（1-5分）。** 高重要性的记忆进入长期保存队列，低重要性的记忆可以被优先淘汰。

```typescript
add(role: Role, content: string, importance: number = 3): MemoryItem {
  const item: MemoryItem = {
    // ...
    importance: clampImportance(importance),
  };
  // 所有记录先进入短期记忆
  this.shortTerm.push(item);

  // 高重要性或system消息，同步写入长期记忆
  if (item.importance >= 4 || role === "system") {
    this.addLongTerm({ ...item, tier: "long" });
  }
}
```

现在出现了两个新概念：**短期记忆**和**长期记忆**。为什么会需要分层？

---

## 问题4：为什么需要分层记忆（短期vs长期）？

假设你只用一个数组存所有记忆，高重要性的不删除，低重要性的删除。这会有什么问题？

**场景分析：**
- 用户和Agent聊了50轮技术面试准备
- 其中第3轮用户说"我叫李四"（重要性5，长期保存）
- 其余45轮都是技术讨论（重要性3，短期即可）

**如果只有一个数组：**
- 要么45轮技术讨论占满空间，导致"我叫李四"被淘汰
- 要么为了保留"我叫李四"，必须扩大容量，导致噪声增多

**思考一下：** 人的记忆是如何工作的？你会把昨晚吃了什么和银行卡密码存在同一个"存储层"吗？

**答案：分层存储。**

| 层级 | 特点 | 用途 |
|------|------|------|
| 短期记忆 | 内存中、容量小、重启丢失 | 当前对话上下文 |
| 长期记忆 | 持久化、容量大、跨会话保留 | 重要事实、用户偏好 |
| 摘要记忆 | 由短期压缩生成、高重要性 | 对话主题总结 |

```typescript
class LayeredMemoryManager {
  private shortTerm: MemoryItem[] = [];
  private longTerm: MemoryItem[] = [];

  async add(role: Role, content: string, importance = 3): Promise<MemoryItem> {
    // 所有记录先进入短期记忆
    this.shortTerm.push(item);
    if (this.shortTerm.length > this.shortMaxItems) this.shortTerm.shift();

    // 高重要性或system消息，同步写入长期记忆
    if (item.importance >= 4 || role === "system") {
      this.addLongTerm({ ...item, tier: "long" });
    }
  }
}
```

现在短期记忆有容量限制，但如果用户连续聊了100轮，前80轮难道就完全没有价值了吗？

---

## 问题5：短期记忆太多，如何压缩？

假设`shortMaxItems = 20`，但用户已经聊了100轮。第1-80轮的记忆已经被挤出短期记忆了，它们真的应该被完全丢弃吗？

**思考一下：**
- 这100轮可能围绕同一个主题（比如"面试准备"）
- 完全丢弃会丢失上下文连续性
- 但保留全部100轮又太冗余

**答案：自动摘要。** 每积累N条短期记录，自动压缩成一条摘要，存入长期记忆。

```typescript
if (this.shortTerm.length > 0 && this.shortTerm.length % this.summaryEvery === 0) {
  await this.makeSummaryFromRecent();
}

private async makeSummaryFromRecent(): Promise<void> {
  const chunk = this.shortTerm.slice(-this.summaryEvery);
  const content = await buildSummary(chunk);
  const summaryItem: MemoryItem = {
    role: "system",
    content: `[summary] ${content}`,
    importance: 5,
    tier: "summary",
  };
  this.addLongTerm(summaryItem);
}
```

摘要可以用规则实现（如提取最近3条用户消息+2条助手消息），也可以调用LLM生成更智能的摘要。

现在系统可以：
1. 写入记忆（区分重要性）
2. 分层存储（短期/长期/摘要）
3. 自动压缩（定期摘要）

但怎么**读取**记忆呢？

---

## 问题6：用户问"面试准备得怎么样了"，系统该返回哪些记忆？

这是一个召回问题。假设记忆库中有：
1. "我叫张三"（高重要性）
2. "明天有技术面试"（高重要性）
3. "我准备了系统设计"（中等重要性）
4. "今天吃了面条"（低重要性）
5. 最近的10轮闲聊

**思考一下：**
- 只返回包含"面试"关键词的记忆？
- 只返回最近5条？
- 只返回高重要性的？
- 还是某种组合？

**答案：多路召回 + 融合。**

```typescript
retrieveContext(keyword: string, recentN = 6, importantN = 4): MemoryItem[] {
  const byKeyword = this.search(keyword);      // 关键词命中
  const byRecent = this.recentShort(recentN);  // 最近短期上下文
  const byImportant = this.topImportant(importantN); // 高重要度记录

  // 去重：同一条记忆只保留一份
  const map = new Map<string, MemoryItem>();
  [...byKeyword, ...byRecent, ...byImportant].forEach((it) => map.set(it.id, it));

  // 最终按时间排序，便于喂给LLM
  return [...map.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}
```

这样设计的好处是：
- 关键词确保字面匹配
- 最近记录保证上下文连贯
- 高重要性记录确保关键事实不丢失

但这个方案有个缺陷：如果记忆内容是"我下周三有技术面试"，用户问"面试准备得怎么样了"，关键词搜索能匹配到吗？

---

## 问题7：关键词搜不到，但语义相关的记忆，如何召回？

**场景：**
- 记忆：`我下周三有技术面试`
- 查询：`面试准备得怎么样了`

关键词搜索要求"面试"这个词同时出现在记忆和查询中，这没问题。但如果：
- 记忆：`我在准备系统设计的面试`
- 查询：`技术面试`

"技术"和"系统设计"字面不匹配，但语义相关。

**思考一下：**
- 如何让系统理解"技术面试"和"系统设计面试"是相关的？
- 需要引入什么技术？

**答案：语义检索（向量相似度）。**

核心思想：
1. 把文本转换成向量（Embedding）
2. 计算查询向量与记忆向量的相似度
3. 返回最相似的topK条

文字向量化是个我觉得特别有意思的事情。感兴趣的同学可以看这个视频
https://www.bilibili.com/video/BV1Dz9WBHEgs/?spm_id_from=333.337.search-card.all.click&vd_source=842b1225f5d953c8df3fd60918cd05ff

```typescript
async retrieveSemanticContext(query: string, topK = 5): Promise<MemoryItem[]> {
  const all = [...this.longTerm, ...this.shortTerm];
  return (await rankBySemantic(query, all, topK)).map((x) => x.item);
}

// 在semantic_retriever.ts中
export async function rankBySemantic(
  query: string,
  items: MemoryItem[],
  topK = 5
): Promise<Array<{ item: MemoryItem; score: number }>> {
  const queryEmbedding = await embedTexts([query]);
  const queryVec = queryEmbedding.vectors[0];

  const scored = items
    .map((item) => ({
      item,
      score: cosineSimilarity(queryVec, item.vector),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}
```

Embedding可以通过调用外部API（如智谱、OpenAI）获取，也可以用本地哈希向量做fallback。

现在系统有两种召回方式：
1. `/ctx`：关键词 + 最近 + 高重要性
2. `/sem`：语义相似度

但有个工程问题：如果记忆系统上线后召回效果不好，你怎么知道？怎么优化？

---

## 问题8：如何判断记忆系统的好坏？

假设你上线了记忆系统，用户反馈"Agent记不住我说的话"。你如何定位问题？

**可能的原因：**
- 记忆根本没写进去？
- 写进去了但检索没召回？
- 召回了但LLM没用？
- 摘要质量太差导致信息丢失？

**思考一下：** 没有观测和评测，优化就是盲人摸象。

**答案：建立可观测、可评测、可治理的体系。**

### 8.1 可观测：事件日志

```typescript
export function logEvent(event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload,
  });
  fs.appendFileSync("logs/memory_events.jsonl", `${line}\n`, "utf-8");
}

// 使用
logEvent("memory_add", { id: item.id, role, importance });
logEvent("retrieve_ctx", { keyword, resultCount: results.length });
```

### 8.2 可评测：定义指标

```typescript
// Recall@K: 正确记忆是否出现在前K条
// MRR: 正确记忆出现位置越靠前越好
// Summary Coverage: 摘要覆盖关键信息比例
```

### 8.3 可治理：记忆生命周期

```typescript
// 时间衰减：超过N天自动降权
export function decayImportance(item: MemoryItem, now = Date.now()): number {
  const ageDays = (now - Date.parse(item.ts)) / (1000 * 60 * 60 * 24);
  const decayed = item.importance - Math.floor(ageDays / 14);
  return Math.max(1, Math.min(5, decayed));
}
```

现在记忆系统可以自我诊断和优化了。但还有一个架构问题：如何把这个memory模块集成到Agent中？

---

## 问题9：Memory如何与ReAct Agent集成？

回顾第1章的ReAct Agent，它的核心循环是：
1. 模型输出 Thought + Action
2. 执行 Action 得到 Observation
3. 重复直到 Finish

**思考一下：**
- Memory应该作为工具让Agent主动调用？
- 还是每次自动注入到prompt中？
- 谁来决定哪些记忆需要被召回？

**答案：两种方式结合。**

1. **自动注入**：每次调用模型前，自动把`recentShort`塞进prompt，保证基础上下文
2. **工具触发**：提供记忆工具，让Agent主动决定何时深入检索

```typescript
// memory_tools.ts
export const MemoryTools = {
  MemoryRecall: async (input: string) => {
    return memoryManager.retrieveContext(input);
  },
  MemorySemantic: async (input: string) => {
    return memoryManager.retrieveSemanticContext(input);
  },
  SaveMemory: async (role: string, importance: number, content: string) => {
    return memoryManager.add(role as Role, content, importance);
  },
};

// 在ReAct循环中
const tools = {
  ...MemoryTools,
  // ...其他工具
};
```

这样Agent既拥有基础上下文（自动注入），又能在需要时主动"回忆"（工具触发）。

---

## 问题10：如何让记忆系统可复用、可测试？

现在的代码都写在`main.ts`里，如果另一个项目想用你的memory模块，怎么办？

**思考一下：**
- 如何设计模块边界？
- 如何确保改动不会破坏现有功能？
- 如何让别人容易集成？

**答案：模块化 + 测试。**

```typescript
// memory/module.ts - 统一接口
export const MemoryModule = {
  init(options?: MemoryOptions) { /* ... */ },
  record(role: Role, content: string, importance?: number) { /* ... */ },
  retrieveContext(keyword: string, recentN?: number, importantN?: number) { /* ... */ },
  retrieveSemanticContext(query: string, topK?: number) { /* ... */ },
  flush() { /* ... */ },
};

// test/memory_module.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";

describe("MemoryModule", () => {
  it("should record and retrieve memory", async () => {
    MemoryModule.init({ shortMaxItems: 10 });
    await MemoryModule.record("user", "我喜欢咖啡", 5);
    const results = MemoryModule.retrieveContext("咖啡");
    assert.equal(results.length, 1);
  });
});
```

---

## 最终架构回顾

经过这10个问题的推导，Memory模块的完整架构如下：

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/articles/03%E7%AB%A0-%E6%95%B4%E4%BD%93%E6%B5%81%E7%A8%8B.png)
---

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/%E5%85%AC%E8%80%83/%E5%85%AC%E4%BC%97%E5%8F%B7.jpg)
