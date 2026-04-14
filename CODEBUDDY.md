# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## 仓库定位

这是一个文章与示例代码混合仓库，核心是 Agent 教学内容与配套实现：

- 文章主目录：`ai-基础知识/`、`ai-思考/`、`ai-tools/`
- Agent 代码示例：`ai-基础知识/从零构建理解Agent/01/program`、`ai-基础知识/从零构建理解Agent/02/program`
- Go 独立模块：`logfacade/`

## 发布约束（必须遵守）

1. 所有文章最终都会对外发布，**不允许出现内链**。
2. 所有文章结尾必须追加公众号推荐图（固定文案）：

```md
![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/%E5%85%AC%E8%80%83/%E5%85%AC%E4%BC%97%E5%8F%B7.jpg)
```

3. 修改 `ai-基础知识/从零构建理解Agent/02/program/planAndSolve.ts` 时，需确保最终文章产出也满足上述结尾要求。

## 常用开发命令

### Chapter 01 (ReAct)
目录：`ai-基础知识/从零构建理解Agent/01/program`

```bash
npm install
npm start          # tsx reActAgent.ts
npm run dev        # tsx watch reActAgent.ts
```

来源：`ai-基础知识/从零构建理解Agent/01/program/package.json`

### Chapter 02 (Plan-and-Solve + Reflection)
目录：`ai-基础知识/从零构建理解Agent/02/program`

```bash
npm install
npm start          # tsx reflection.ts
npm run dev        # tsx watch planAndSolve.ts
npx tsx planAndSolve.ts "你的问题"
npx tsx reflection.ts "你的文本"
```

来源：`ai-基础知识/从零构建理解Agent/02/program/package.json`

### LogFacade (Go)
目录：`logfacade`

```bash
go run ./cmd/main.go
go test -v ./...
go test -bench=. -benchmem
```

单测（单个用例）示例：

```bash
go test -v -run TestWriteToFile ./...
go test -v -run TestContextualLogging ./...
```

来源：`logfacade/README.md`、`logfacade/example_test.go`

## 测试 / Lint / Build 现状

- `01/program` 与 `02/program` 当前 `package.json` 未提供 `test` / `lint` / `build` 脚本。
- Node 侧当前主要是通过 `tsx` 直接运行示例脚本。
- `logfacade` 使用 `go test` 作为主要测试入口。

## 高层架构速览

### 1) Agent 教学代码（TypeScript）

#### ReAct 基线实现（Chapter 01）
- 文件：`ai-基础知识/从零构建理解Agent/01/program/reActAgent.ts`
- 关键角色：
  - `LLMAgent`：封装流式模型调用
  - `ToolBox`：注册/查找工具
  - `ReActAgent`：按 `Thought -> Action -> Observation -> Finish` 循环执行
- 工具注册点：`toolBox.registerTool("Search", ...)`

#### Plan-and-Solve 主流程（Chapter 02）
- 文件：`ai-基础知识/从零构建理解Agent/02/program/planAndSolve.ts`
- 三层结构：
  - `Planner`：把问题拆成子任务，并做解析兜底（JSON + 行文本）
  - `Executor`：逐个子任务执行 ReAct 循环
  - `PlanAndSolveAgent`：统一调度任务并汇总最终答案
- 关键价值：先规划再执行，避免单轮 ReAct 在复杂任务中的路径漂移。

#### Reflection 迭代优化（Chapter 02）
- 文件：`ai-基础知识/从零构建理解Agent/02/program/reflection.ts`
- 关键角色：
  - `LRUTextMemory`：维护近期记忆窗口
  - `ReflectionTranslatorAgent`：多轮“初稿 -> 反思 -> 优化提示词”
- 适用于高质量文本改写与翻译迭代。

#### 共享工具
- 文件：`ai-基础知识/从零构建理解Agent/02/program/utils/search.ts`
- 功能：SerpApi 搜索封装，优先 `answer_box`，其次 `knowledge_graph`，再回落到 `organic_results`。

### 2) LogFacade（Go）

- 目录：`logfacade/`
- 设计模式：Facade（门面）+ 接口隔离
- 关键文件：
  - `interface.go`：`Logger` 接口、`Field`、`Config`
  - `logger.go`：`New` / `NewWithSkipStack` 工厂入口
  - `global.go`：全局 logger 初始化与上下文获取
  - `zap_logger.go`：zap 具体实现
- 作用：业务代码依赖 `Logger` 接口，不直接依赖具体日志库。

## 环境变量

Node Agent 示例至少依赖以下变量：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`（可选，默认 `https://api.openai.com/v1`）
- `SERPAPI_API_KEY`（使用 Search 工具时必需）

参考模板：`ai-基础知识/从零构建理解Agent/02/program/.env.example`

## 文章输出相关参考

- 仓库 README 已给出公众号图片地址（根目录 `README.md`）。
- 微信排版可参考 README 中给出的 doocs/md 链接。