# mistakes.md

这份文档记录本项目迭代中出现过的错误，以及对应处理手段。  
目标：下次遇到同类问题时可以快速定位。

## 1) `npx tsc --init` 报错 “This is not the tsc command...”

- 现象：
  - `npx tsc --init` 失败，提示先安装 `typescript`
- 原因：
  - 项目未安装本地 `typescript`，`npx` 可能命中错误包
- 处理：
  - `npm install -D typescript ts-node @types/node`
  - 再执行 `npx tsc --init`
- 预防：
  - 任何 TS 项目先安装本地 `typescript` 再用 `npx`

## 2) `ts-node: command not found`

- 现象：
  - 直接执行 `ts-node src/main.ts` 报命令不存在
- 原因：
  - `ts-node` 只安装在项目本地 `node_modules/.bin`
- 处理：
  - `npx ts-node src/main.ts` 或 `npm run dev`
- 预防：
  - 优先通过 `npm scripts` 运行

## 3) TypeScript 编译报 Node 类型缺失

- 现象：
  - `Cannot find name 'process'`、`Cannot find name 'node:fs'` 等
- 原因：
  - `tsconfig.json` 未声明 Node 类型
- 处理：
  - `types: ["node"]`
  - 确保 `@types/node` 已安装
- 预防：
  - Node 项目模板固定包含 `types: ["node"]`

## 4) TS 6 报 `moduleResolution=node10` 弃用告警

- 现象：
  - `Option 'moduleResolution=node10' is deprecated`
- 原因：
  - TS 6 行为变化引发兼容提示
- 处理：
  - 在 `tsconfig` 加 `ignoreDeprecations: "6.0"`（当前阶段临时）
- 预防：
  - 升级时审查 tsconfig 兼容项

## 5) 摘要内容出现 `[object Promise]`

- 现象：
  - `long_memory.json` 的 summary 变成 `[summary] [object Promise]`
- 原因：
  - `buildSummary` 改成 async 后，调用链未 `await`
- 处理：
  - `LayeredMemoryManager.add` 改为 async
  - `makeSummaryFromRecent` 改为 async 并 `await buildSummary(...)`
  - 调用方 `/add` 改为 `await`
- 预防：
  - 涉及 async 改造时，沿调用链逐层检查返回类型

## 6) 批量管道输入时 `readline was closed`

- 现象：
  - 压测时出现 `ERR_USE_AFTER_CLOSE`
- 原因：
  - `readline` 事件并发处理，关闭后仍尝试 `prompt()`
- 处理：
  - 行输入串行化（Promise queue）
  - 增加 `isClosed` 标志，`safePrompt()` 防止关闭后调用
- 预防：
  - CLI 处理异步逻辑时默认做串行队列

## 7) 测试里 `vector_store.json` 不生成（偶发）

- 现象：
  - 单测断言文件不存在
- 原因：
  - `VECTOR_STORE_PATH` 在模块加载时固定了旧 cwd
- 处理：
  - 改成运行时动态计算路径 `getVectorStorePath()`
- 预防：
  - 依赖 cwd 的路径不要做顶层常量缓存

## 8) `.env` 安全风险（真实 key 进入本地文件/聊天）

- 现象：
  - 出现真实密钥文本
- 原因：
  - 调试期间直接写入 `.env` 或明文传递
- 处理：
  - `.gitignore` 忽略 `.env`
  - `.env` 改占位值
  - 程序支持 `export/source` 注入环境变量
  - 检查远端分支和历史是否泄漏
- 预防：
  - 生产密钥只走环境变量/密钥管理
  - 如疑似泄漏立即轮换 key

## 9) 缺少 `OPENAI_API_KEY` 导致启动失败

- 现象：
  - 启动时报 `缺少 OPENAI_API_KEY`
- 原因：
  - 新终端未注入环境变量
- 处理：
  - `set -a; source .env; set +a`
  - 同时增加本地 `.env` 兜底读取（仅本地）
- 预防：
  - 写启动脚本或 shell profile 自动注入

## 10) 设计错误：每轮强制 Memory 决策干扰主循环

- 现象：
  - 模型每步都输出 `Memory:`，格式负担高，影响 ReAct 稳定性
- 原因：
  - 把记忆沉淀职责耦合到每一步推理
- 处理：
  - 回退该设计
  - 改成每 5 轮执行一次 summary step，专门提取长期记忆
- 预防：
  - 推理链路与记忆治理链路分层处理

## 11) 设计缺口：short memory 未自动读写

- 现象：
  - 早期只在工具调用时触发记忆检索
- 原因：
  - 未在每轮对话前后自动注入/记录 short memory
- 处理：
  - 每轮前注入 `recentShort(8)` 到 prompt
  - 每轮后自动记录 `user + assistant`
- 预防：
  - 明确区分“自动上下文注入”与“工具式检索”

## 12) 网络依赖问题：`npm install` EAI_AGAIN

- 现象：
  - `npm` DNS 解析失败
- 原因：
  - 临时网络或沙箱限制
- 处理：
  - 以提权方式重试（允许网络）
- 预防：
  - 关键安装步骤预留重试与离线策略

## 13) 设计缺口：`imp` 固定分导致记忆质量不稳定

- 现象：
  - `user=4 / assistant=3` 的固定分无法反映真实重要性
- 原因：
  - 重要度评分与语义内容脱钩
- 处理：
  - 引入 LLM 评分器 `scoreImportanceWithLLM`
  - 每轮记录 `user/assistant` 前先评分
  - LLM 异常时回退到规则评分，保证稳定
- 预防：
  - 关键策略参数（如 `imp`）优先使用模型判断 + 规则兜底

---

## 快速排查顺序（建议）

1. 先看环境变量（模型 key/base_url/model）
2. 再看 TypeScript 编译是否通过（`npx tsc --noEmit`）
3. 再看最小用例（单轮 ReAct）
4. 再看 summary step 与 vector store 文件变化
5. 最后跑全量测试（`npm test`）
