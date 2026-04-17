# Tutorial: 从零实现一个最简单的 Agent Memory（TypeScript）

你现在在这个目录里：

`/data/home/lukemxjia/aritcles-hub/ai-基础知识/从零构建理解Agent/第3章-简单记忆的实现/program`

本教程默认你是零基础。目标只有一个：

实现一个“能记住对话历史，并按关键词回忆”的最小 Agent Memory（TS 版）。

---

## 1. 先理解：Memory 是什么？

在 Agent 里，Memory 可以先理解成 3 件事：

- `写入（write）`：把用户说过的话存起来
- `读取（read）`：需要时拿出来
- `检索（retrieve）`：按关键词找相关记忆

我们先不碰向量数据库，只做一个可运行的小版本。

---

## 2. 你将做出的效果

程序运行后可以：

1. 记录多条消息
2. 看最近 N 条消息
3. 用关键词搜索历史消息

---

## 3. 准备环境（Node.js + TypeScript）

先检查 Node.js：

```bash
node -v
npm -v
```

建议 Node.js `18+`。

---

## 4. 初始化项目（一步步复制）

在 `program` 目录里执行：

```bash
npm init -y
npm install -D typescript ts-node @types/node
npx tsc --init
```

然后把 `tsconfig.json` 的核心配置改成这样（保留这些键即可）：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  }
}
```

---

## 5. 新建文件结构

创建 `src/main.ts`：

```text
program/
├── src/
│   └── main.ts
├── package.json
├── tsconfig.json
└── tutorial.md
```

---

## 6. 复制这份完整代码（第一版）

把下面代码保存到 `src/main.ts`：

```ts
type Role = "user" | "assistant";

interface MemoryItem {
  role: Role;
  content: string;
  ts: Date;
}

class SimpleMemory {
  private items: MemoryItem[] = [];

  constructor(private maxItems: number = 100) {}

  add(role: Role, content: string): void {
    const item: MemoryItem = {
      role,
      content,
      ts: new Date(),
    };

    this.items.push(item);

    // 控制容量：超过上限就删除最早的一条
    if (this.items.length > this.maxItems) {
      this.items.shift();
    }
  }

  recent(n: number = 5): MemoryItem[] {
    return this.items.slice(-n);
  }

  search(keyword: string): MemoryItem[] {
    const q = keyword.trim().toLowerCase();
    if (!q) return [];
    return this.items.filter((it) => it.content.toLowerCase().includes(q));
  }
}

function printItems(items: MemoryItem[]): void {
  if (items.length === 0) {
    console.log("(空)");
    return;
  }

  items.forEach((it, i) => {
    const timeStr = it.ts.toLocaleTimeString("zh-CN", { hour12: false });
    console.log(`${i + 1}. [${timeStr}] ${it.role}: ${it.content}`);
  });
}

function demo(): void {
  const memory = new SimpleMemory(10);

  // 模拟写入
  memory.add("user", "我喜欢咖啡");
  memory.add("assistant", "记住了，你喜欢咖啡。");
  memory.add("user", "明天我要面试");
  memory.add("assistant", "祝你面试顺利。");
  memory.add("user", "我最近在学 TypeScript");

  console.log("=== 最近 3 条 ===");
  printItems(memory.recent(3));

  console.log("\n=== 搜索：'面试' ===");
  printItems(memory.search("面试"));
}

demo();
```

---

## 7. 运行程序

先在 `package.json` 里加 `scripts`：

```json
{
  "scripts": {
    "dev": "ts-node src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  }
}
```

开发运行：

```bash
npm run dev
```

你会看到“最近 3 条”和“搜索面试”的输出。

---

## 8. 每段代码在做什么（零基础解释）

### 8.1 `interface MemoryItem`

定义一条记忆的结构：

- `role`：是谁说的
- `content`：内容
- `ts`：时间

### 8.2 `add`

写入新记忆，并在超过上限时删除最旧数据（先进先出）。

### 8.3 `recent(n)`

返回最近 `n` 条，后面可以用来拼上下文给 LLM。

### 8.4 `search(keyword)`

做最基础关键词匹配（大小写不敏感）。

---

## 9. 建议的下一步（按顺序）

1. 改成“交互式输入”版本（命令行一直输入）
2. 支持命令：
   - `/recent 5`
   - `/search 面试`
3. 把记忆保存到 `memory.json`，重启后可恢复
4. 给每条记忆增加 `importance`（1-5）

---

## 10. 常见错误排查

- `npm: command not found`
  - Node.js 没装好
- `Cannot find module 'ts-node'`
  - 没执行 `npm install -D ts-node`
- `Property ... does not exist ...`
  - TS 严格模式报错，通常是类型定义不完整

---

## 11. 你下一句可以直接说

- `继续，帮我写 src/main.ts 并跑起来`

我会直接在这个目录里创建代码并带你一步步看结果。
