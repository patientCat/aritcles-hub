# Tutorial04: 语义检索与 LLM 摘要接入位点

本章目标：在 `tutorial03` 基础上，把“只靠关键词”升级为“关键词 + 语义检索”。

你将得到：

1. `/sem <query>` 语义召回命令
2. 本地向量近似实现（无需外部依赖）
3. 后续接入 LLM 摘要的清晰位置

---

## 1. 为什么需要语义检索

关键词检索只适合“字面相同”的情况。  
语义检索可以处理“意思接近但措辞不同”：

- 记忆：`我下周三有技术面试`
- 查询：`面试准备`

关键词可能命中不到，但语义可以关联到一起。

---

## 2. 新增文件

- `src/semantic_retriever.ts`

核心思路：

1. 把文本切词
2. 映射到固定长度向量（哈希桶）
3. 用余弦相似度算 query 与记忆的接近程度
4. 返回 topK

关键代码片段：

```ts
export function rankBySemantic(query: string, items: MemoryItem[], topK = 5) {
  const queryVec = textToVector(query.trim());
  const scored = items
    .map((item) => ({
      item,
      score: cosineSimilarity(queryVec, textToVector(item.content)),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(0, topK));
}
```

---

## 3. 在 MemoryManager 中接入

新增方法：

```ts
retrieveSemanticContext(query: string, topK = 5): MemoryItem[] {
  const all = [...this.longTerm, ...this.shortTerm];
  return rankBySemantic(query, all, topK).map((x) => x.item);
}
```

这样你就有两条召回链路：

- `/ctx`：关键词 + 最近 + 高重要度
- `/sem`：语义相似度 topK

---

## 4. CLI 增加命令

`src/main.ts` 已增加：

- `/sem <query>`

示例：

```text
/add user 5 我下周三有技术面试
/add user 3 我准备复习系统设计
/sem 面试准备
```

---

## 5. 运行验证

```bash
npm run dev
```

建议顺序：

1. 先写入 3-5 条相近但不完全同词的记忆
2. 用 `/search` 看关键词命中
3. 用 `/sem` 看语义命中
4. 对比两者差异

---

## 6. LLM 摘要接入位点

你现在的摘要器是规则版：`src/summarizer.ts`。  
下一步只需要把：

- `buildSummary(items)`  

替换成“调用 LLM 生成摘要”的实现即可。建议保留兜底：

1. LLM 失败 -> 退回规则摘要
2. 摘要文本长度设上限
3. 摘要写入 `role=system`, `tier=summary`

---

## 7. 你当前阶段的标准

1. 能解释 `/ctx` 和 `/sem` 的区别
2. 知道语义检索是“近似相关”不是“精准匹配”
3. 知道 LLM 摘要应该接在哪里，而不是重写整个系统

