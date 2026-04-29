# Tutorial06: 接入智谱 Embedding（替换本地哈希向量）

目标：把当前 `/sem` 的本地哈希向量检索，升级为真实 embedding 检索。

---

## 1. 环境变量

你已经在 `.env` 里有占位：

```env
ZHIPU_API_KEY=replace_with_your_zhipu_api_key
```

把它替换成你的真实 key 即可。

建议再补两项：

```env
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_EMBED_MODEL=embedding-3
```

---

## 2. 改造思路

当前：

- `src/semantic_retriever.ts` 用本地 `textToVector`

目标：

1. 调智谱 `/embeddings` 生成向量
2. 保存 `memory_id -> embedding`
3. 查询时对 `query embedding` 和历史向量做 cosine 排序

---

## 3. 关键代码位点

1. 新增 `src/embedding_client.ts`
2. 在 `memory_manager.ts` 里新增 embedding 写入/查询路径
3. `/sem` 保持命令不变（只替换底层实现）

---

## 4. 注意事项

1. 首次升级要做历史数据回填（backfill embeddings）
2. 维度要固定（建议 1024）
3. 要做失败回退（embedding 请求失败时，退回当前本地哈希检索）

---

## 5. 完成标准

1. `/sem 面试准备` 能命中语义相关条目
2. 日志能区分“真实 embedding 命中”与“fallback 命中”
3. 不因外部 API 波动导致整个系统不可用

