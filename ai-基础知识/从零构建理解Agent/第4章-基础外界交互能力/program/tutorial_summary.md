# 🧠 从零构建理解 Agent：项目设计全景解读

> 面向初学者的教学指南 · 基于 `第3章~第4章` 全部教程

---

## 一、这个项目在做什么？

想象你有一个**聪明的小助手**，它能：

1. 记住你说过的话（记忆）
2. 帮你查时间、读网页、找文件（外界交互）
3. 按优先级和计划有条理地做事（规划）

这个项目就是从零开始，用 TypeScript 一步步把这个"小助手"造出来。

整个代码在：

```
/data/home/lukemxjia/aritcles-hub/ai-基础知识/从零构建理解Agent/
├── 第3章-简单记忆的实现/   ← 教你怎么给 Agent 装"大脑"
└── 第4章-基础外界交互能力/  ← 教你怎么给 Agent 装"眼睛和手"
```

---

## 二、项目核心架构（一张图）

```
┌───────────────────────────────────────────┐
│              用户输入 (User Input)            │
└────────────────┬──────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────┐
│       主循环 (ReAct Loop)                  │
│  ● 思考 (Think) → 行动 (Act) → 观察 (Observe)│
└────┬────────────┬────────────┬────────────┘
     │            │            │
     ▼            ▼            ▼
┌─────────┐ ┌──────────┐ ┌──────────┐
│ 记忆模块 │ │ 工具模块 │ │ 计划模块 │
│ Memory  │ │ Tool     │ │ Planning │
└─────────┘ └──────────┘ └──────────┘
```

**三部分各司其职：**

| 模块 | 像人类的什么 | 负责什么 |
|------|-------------|---------|
| **记忆 (Memory)** | 大脑海马体 | 记住对话、按关键词回忆 |
| **工具 (Tool)** | 眼睛和手 | 查时间、读网页、读写文件、执行命令 |
| **计划 (Planning)** | 前额叶 | 制定步骤、追踪进度、提醒推进 |

---

## 三、第3章：先给 Agent 装个"记忆大脑"

### 3.1 最小记忆系统

我们从最简单的版本开始——**不用数据库，只用数组**。

```ts
interface MemoryItem {
  role: "user" | "assistant";   // 谁说的
  content: string;               // 说了什么
  ts: Date;                      // 什么时候说的
}
```

核心就是三个操作：

```ts
class SimpleMemory {
  private items: MemoryItem[] = [];

  // ✍️ 写入：存一条新记忆
  add(role: Role, content: string): void {
    this.items.push({ role, content, ts: new Date() });
    // 超过上限时删除最老的
    if (this.items.length > this.maxItems) this.items.shift();
  }

  // 📖 读取：最近 n 条
  recent(n: number = 5): MemoryItem[] {
    return this.items.slice(-n);
  }

  // 🔍 检索：按关键词搜索
  search(keyword: string): MemoryItem[] {
    return this.items.filter(it =>
      it.content.toLowerCase().includes(keyword.toLowerCase())
    );
  }
}
```

> **对初学者的解释**：`push` 就是往"记事本"末尾加一页，`shift` 是撕掉最旧的那页，`slice(-n)` 是只看最后 n 页。

### 3.2 升级：引入 Mem0 专业记忆层

手写版本能跑，但要用于真实场景，我们需要一个**专业的记忆系统**（Mem0）：

```
// 回答前：从记忆中搜索相关内容
const memories = await memory.search(userInput, { topK: 5 });

// 回答后：把本轮对话写入记忆
await memory.add(
  [{ role: "user", content: "..." }, { role: "assistant", content: "..." }],
  { userId: "default_user", session_id, req_id }
);
```

关键设计原则：**记忆失败不能阻断主流程**。

```ts
try {
  const result = await memory.search(...);
  // 正常使用 result
} catch (err) {
  // ❌ 记忆出错 → 记录日志，但不抛异常
  logger.error("memory.search failed", err);
  // Agent 继续回答，只是没有历史记忆
}
```

---

## 四、第4章：给 Agent 装"眼睛和手"

### 4.1 工具 1：查时间（NowTime）

最简单的工具——让 Agent 知道现在是几点：

```ts
// 输入：时区（如 "Asia/Shanghai"）
// 输出：当前时间字符串
NowTime["Asia/Shanghai"] → "2025-01-15T14:30:00+08:00"
```

### 4.2 工具 2：读网页（HttpGet）

让 Agent 能上网查资料：

```ts
// 安全规则：只允许 http/https 协议
HttpGet("https://example.com")  // ✅ 允许
HttpGet("file:///etc/passwd")    // ❌ 拒绝（非 http/https）
```

### 4.3 工具 3：读文件（ReadFile）—— 附"智能找文件"机制

这是**最具教学价值的设计**。如果用户只说"读 short_memory.json"，但不知道完整路径怎么办？

**工业级解法**——两阶段工具策略：

```
第一步：FindFile（只找，不读）
  └─ 在白名单目录里搜文件名
第二步：ReadFile（只读，仅限授权路径）
  └─ 读取找到的文件内容
```

```ts
// 用户说：读 short_memory.json

// 尝试1：直接读取
ReadFile("short_memory.json") → ❌ 路径不在白名单

// 自动触发：FindFile 搜索候选
FindFile("short_memory.json")
  → 找到唯一候选: "data/short_memory.json"

// 自动重试：用完整路径读
ReadFile("data/short_memory.json") → ✅ 读取成功
```

> **为什么不直接给 shell？** 安全第一。`FindFile + ReadFile` 组合既能找到文件，又保证 Agent 只读白名单内的内容。

### 4.4 工具 4：写文件（WriteFile）

补齐"执行闭环"——Agent 不仅能读，还能写：

```ts
WriteFile({
  relativePath: "data/Go_AlphaGo.md",  // 写到哪里
  content: "## Go 与 AlphaGo 的关系...",  // 写什么
  mode: "overwrite",  // 覆盖还是追加
  createDirs: true    // 自动创建父目录
})
```

**安全边界**（必须遵守）：

| 规则 | 说明 |
|------|------|
| 🟢 白名单 | 只能写入 `data/` 目录 |
| 🔴 禁止穿透 | `../` 会被拒绝 |
| 📏 大小限制 | 单次写入不超过 200KB |
| 📄 扩展名限制 | 仅允许 `.md` `.txt` `.json` |

### 4.5 工具 5：执行命令（BashExec）

通用但高风险的工具：

```ts
BashExec("ls -la")          // ✅ 查看文件列表（安全）
BashExec("rm -rf /")        // ❌ 危险操作，应被约束
```

安全措施：
- ⏱ **超时**：12 秒后强制终止
- ✂️ **截断**：输出超过 8000 字符会自动截断
- 📝 **审计**：每条命令和结果完整记入日志

---

## 五、第4章补充：会话计划管理器（PlanningState）

最后一块拼图——让 Agent 学会"做计划"。

### 5.1 为什么需要计划？

没有计划时，Agent 只能"想起什么做什么"。有了计划，它能：

1. 先把大目标拆成小步骤（`Task.create`）
2. 一步步推进并更新状态（`Task.update`）
3. 定期检查进度（reminder）

### 5.2 计划的数据结构

```ts
type PlanningItem = {
  id: string;
  title: string;          // 任务标题，如"实现 ReadFile"
  status: "pending" | "in_progress" | "done" | "failed";
  notes?: string;         // 备注
};

type PlanningState = {
  goal: string;           // 总目标
  items: PlanningItem[];  // 步骤列表
  currentItemId?: string; // 当前正在做的
};
```

### 5.3 一个工具，三种操作

`Task` 工具统一管理计划：

```ts
// 📋 创建计划
Task.create({ goal: "完成第4章开发", items: ["实现ReadFile", "实现WriteFile"] })

// 🔍 查看计划
Task.list()

// 🔄 更新进度
Task.update({ itemId: "item_1", status: "done" })
```

### 5.4 自动提醒机制

每 3 轮对话自动检查一次：

```
🤖 系统提醒：
  - 你还有任务 "实现WriteFile" 状态是 pending
  - 需要推进或更新状态吗？
```

---

## 六、贯穿全文的设计哲学

### 原则 1：安全边界不放松

所有工具都有白名单、超时、大小限制。**安全是功能的前提**。

### 原则 2：失败不崩溃

每个工具调用都要 `try/catch`，Agent 即使某个工具失败，也能继续回答。

```ts
try {
  const result = await tool.call(input);
} catch (err) {
  // 记录错误，返回友好提示，不抛给主循环
  return { error: `${tool.name} 调用失败: ${err.message}` };
}
```

### 原则 3：一切可观测

每条操作都记录日志（`business.ndjson`），带 `session_id` 和 `req_id`：

```
tool.start   → 谁调用了什么工具
tool.success → 工具成功，返回了什么
tool.error   → 工具失败，原因是什么
```

---

## 七、学习路线（建议从哪开始）

如果你是初学者，按这个顺序读代码：

```
第3章/SimpleMemory.ts          → 理解记忆的本质
第3章/Mem0 集成                → 理解专业记忆层
第4章/NowTime + HttpGet        → 理解工具注册
第4章/FindFile + ReadFile      → 理解"发现+执行"模式
第4章/WriteFile                → 理解安全写入
第4章/BashExec                 → 理解高风险工具管控
第4章/PlanningState + Task     → 理解计划管理
```

---

## 八、总结：这个项目教了你什么？

1. **记忆不是存文本**，而是分写入、读取、检索三个能力
2. **工具不是越多越好**，而是要有安全边界和自动恢复策略
3. **计划不是写死的**，而是可观测、可推进、可提醒的
4. **失败不可怕**，关键是不崩溃、可排障

> 🎯 一句话记住：**从零构建 Agent = 记忆（记住）+ 工具（执行）+ 计划（组织），三者缺一不可。**

---

*本文基于项目 `第3章-简单记忆的实现` 和 `第4章-基础外界交互能力` 的全部 7 个教程文件总结而成。*
