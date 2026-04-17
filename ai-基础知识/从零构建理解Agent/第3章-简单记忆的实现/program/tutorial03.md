# Tutorial03: 分层记忆与自动摘要（TypeScript）

你已经完成了 `tutorial01` 和 `tutorial02` 的核心概念。  
这一章把 memory 升级到更接近真实 Agent 的方案：

1. 短期记忆 `short-term`
2. 长期记忆 `long-term`
3. 自动摘要 `summary memory`

---

## 1. 设计目标

- 短期记忆：保存最近对话，默认只放内存（更快、更干净）
- 长期记忆：保存高价值事实，落库持久化
- 自动摘要：每积累一段短期对话，自动压缩成一条摘要存入长期

---

## 2. 文件说明

本章对应代码：

- `src/types.ts`：基础类型定义
- `src/memory_manager.ts`：分层记忆核心逻辑
- `src/summarizer.ts`：规则摘要器
- `src/storage.ts`：持久化读写
- `src/main.ts`：CLI 交互入口

持久化文件：

- `data/long_memory.json`

说明：

- 推荐实战策略：`short-term` 不落库，重启后可丢失
- `long-term` 落库，用于跨会话恢复
- 你当前代码里同时保存了 short/long，便于学习和调试；后续可按上面策略简化

---

## 3. 关键逻辑

### 3.1 写入规则

`add(role, content, importance)`：

- 所有记录先进入短期记忆
- 当 `importance >= 4` 或 `role=system`，同步写入长期记忆
- 每达到 `summaryEvery`（默认 20）条短期记录，自动生成一条摘要，写入长期记忆

关键代码片段（保留）：

```ts
add(role: Role, content: string, importance = 3): MemoryItem {
  const item: MemoryItem = {
    id: createId(),
    role,
    content: content.trim(),
    ts: new Date().toISOString(),
    importance: clampImportance(importance),
    tier: "short",
  };

  this.shortTerm.push(item);
  if (this.shortTerm.length > this.shortMaxItems) this.shortTerm.shift();

  if (item.importance >= 4 || role === "system") {
    this.addLongTerm({ ...item, tier: "long" });
  }

  if (this.shortTerm.length > 0 && this.shortTerm.length % this.summaryEvery === 0) {
    this.makeSummaryFromRecent();
  }

  return item;
}
```

### 3.2 召回规则

`retrieveContext(keyword)` 合并三路：

1. 关键词命中
2. 最近短期上下文
3. 长期高重要度记录

然后去重并按时间排序，作为给 LLM 的最终上下文。

关键代码片段（保留）：

```ts
retrieveContext(keyword: string, recentN = 6, importantN = 4): MemoryItem[] {
  const byKeyword = this.search(keyword);
  const byRecent = this.recentShort(recentN);
  const byImportant = this.topImportant(importantN);
  const map = new Map<string, MemoryItem>();

  [...byKeyword, ...byRecent, ...byImportant].forEach((it) => map.set(it.id, it));
  return [...map.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}
```

### 3.3 持久化边界（推荐）

推荐只持久化长期记忆：

```ts
// storage.ts (推荐策略)
export function saveLongTerm(items: MemoryItem[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LONG_PATH, JSON.stringify(items, null, 2), "utf-8");
}
```

这样做的好处：

- 重启后仍保留核心事实
- 不把短期噪声写进磁盘
- 维护成本更低

---

## 4. 运行方式

```bash
npm run dev
```

命令：

- `/add user 5 我下周三有系统设计面试`
- `/recent 5`
- `/long 5`
- `/top 5`
- `/search 面试`
- `/ctx 面试`
- `/exit`

---

## 5. 你现在应关注的工程点

1. `importance` 是否有明确业务规则（谁来打分）
2. `summaryEvery` 是否合适（太大太小都不理想）
3. 短期和长期容量上限是否合理
4. 摘要是否足够稳定（规则摘要 vs LLM 摘要）

---

## 6. 下一步（Tutorial04 建议）

1. 给摘要器接入 LLM（替代规则摘要）
2. 引入向量检索（语义召回，不只关键词）
3. 增加“记忆衰减”机制（按时间自动降权）
4. 增加单元测试（`memory_manager` 核心场景）
