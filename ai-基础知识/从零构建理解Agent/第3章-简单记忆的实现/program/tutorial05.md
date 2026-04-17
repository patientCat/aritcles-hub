# Tutorial05: 让 Memory 进入可维护阶段（观测 + 评测 + 治理）

你现在已经具备：

1. 分层记忆（short/long/summary）
2. 关键词召回 + 语义召回
3. LLM 摘要（含回退）

这一章目标：把“能跑”升级为“可评估、可调优、可长期维护”。

---

## 1. 为什么要做 05

到 04 为止，系统已经可用，但你还不知道：

- 召回到底准不准？
- 摘要到底稳不稳？
- 哪些记忆污染了长期库？

05 的核心是建立三件事：

1. 可观测（看见系统行为）
2. 可评测（量化效果）
3. 可治理（控制记忆质量）

---

## 2. 新增目录建议

```text
program/
├── eval/
│   ├── dataset.jsonl
│   └── run_eval.ts
├── logs/
│   └── memory_events.jsonl
└── src/
    ├── metrics.ts
    ├── memory_policy.ts
    └── ...
```

---

## 3. 可观测：先打事件日志

你需要记录这些事件：

- `memory_add`
- `summary_generated`
- `retrieve_ctx`
- `retrieve_sem`

关键代码片段（示例）：

```ts
export function logEvent(event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload,
  });
  fs.appendFileSync("logs/memory_events.jsonl", `${line}\n`, "utf-8");
}
```

你至少要记录：

1. 输入 query
2. 返回条目数
3. topK id 和分数（语义检索）
4. 摘要长度、是否走 LLM 或 fallback

---

## 4. 可评测：定义最小指标

建议从 3 个指标开始：

1. `Recall@K`：正确记忆是否出现在前 K 条
2. `MRR`：正确记忆出现位置越靠前越好
3. `Summary Coverage`：摘要覆盖关键信息比例

评测数据格式（`eval/dataset.jsonl`）：

```json
{"query":"面试准备","must_hit":["面试","系统设计"],"forbid":[]}
{"query":"候选人目标","must_hit":["P7"],"forbid":["无关话题"]}
```

---

## 5. 可治理：给长期记忆加生命周期

长期记忆不是越多越好。建议加三条策略：

1. 时间衰减：超过 N 天自动降权
2. 访问强化：被召回就升一点权重
3. 污染清理：低权重且长期未命中的条目淘汰

关键代码片段（示例）：

```ts
export function decayImportance(item: MemoryItem, now = Date.now()): number {
  const ageDays = (now - Date.parse(item.ts)) / (1000 * 60 * 60 * 24);
  const decayed = item.importance - Math.floor(ageDays / 14);
  return Math.max(1, Math.min(5, decayed));
}
```

---

## 6. 召回链路升级建议

将 `/ctx` 升级为两阶段：

1. 粗召回：关键词 + 语义 topK（并集）
2. 精排：按 `importance + freshness + semantic_score` 重新排序

排序示例：

```ts
score = 0.45 * semantic + 0.35 * importance + 0.20 * freshness
```

---

## 7. 05 的完成标准

你完成这章时，至少满足：

1. 有日志文件，能追踪一次 query 的召回过程
2. 有评测脚本，能输出 Recall@K / MRR
3. 有记忆治理策略，长期库不会无限膨胀

---

## 8. 下一步（Tutorial06）

1. 引入真正的 embedding 模型（替代本地哈希向量）
2. 把 long-term 存到向量数据库（Qdrant/pgvector）
3. 做在线 A/B：比较旧召回策略和新策略效果

