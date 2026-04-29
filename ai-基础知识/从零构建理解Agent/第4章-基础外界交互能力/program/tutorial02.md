# Tutorial02: Agent Memory 进阶实战（TypeScript）

你已经完成了基础版（`tutorial01.md`）。

这一版目标是把 memory 升级为“可用于真实 Agent”的形态：

1. 交互式 CLI（持续输入）
2. 本地持久化（重启不丢）
3. 记忆重要度评分（importance）
4. 组合检索（关键词 + 最近 + 重要度）
5. 基础测试

---

## 1. 最终结构

```text
program/
├── src/
│   ├── types.ts
│   ├── memory.ts
│   ├── storage.ts
│   ├── cli.ts
│   └── main.ts
├── data/
│   └── memory.json
├── package.json
├── tsconfig.json
└── tutorial02.md
```

---

## 2. 先加运行脚本

编辑 `package.json` 的 `scripts`：

```json
{
  "scripts": {
    "dev": "ts-node src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
    "test": "node --test dist/**/*.test.js"
  }
}
```

---

## 3. 定义类型：`src/types.ts`

```ts
export type Role = "user" | "assistant" | "system";

export interface MemoryItem {
  id: string;
  role: Role;
  content: string;
  ts: string; // ISO string，便于持久化
  importance: number; // 1-5
}
```

---

## 4. 核心内存模块：`src/memory.ts`

```ts
import { MemoryItem, Role } from "./types";

export class Memory {
  private items: MemoryItem[] = [];

  constructor(private maxItems: number = 200) {}

  load(items: MemoryItem[]): void {
    this.items = [...items].slice(-this.maxItems);
  }

  dump(): MemoryItem[] {
    return [...this.items];
  }

  add(role: Role, content: string, importance: number = 3): MemoryItem {
    const item: MemoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      ts: new Date().toISOString(),
      importance: clampImportance(importance),
    };

    this.items.push(item);
    if (this.items.length > this.maxItems) this.items.shift();
    return item;
  }

  recent(n: number = 10): MemoryItem[] {
    return this.items.slice(-Math.max(0, n));
  }

  search(keyword: string): MemoryItem[] {
    const q = keyword.trim().toLowerCase();
    if (!q) return [];
    return this.items.filter((it) => it.content.toLowerCase().includes(q));
  }

  topImportant(n: number = 5): MemoryItem[] {
    return [...this.items]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, Math.max(0, n));
  }

  retrieveContext(keyword: string, recentN: number = 5, importantN: number = 3): MemoryItem[] {
    const byKeyword = this.search(keyword);
    const byRecent = this.recent(recentN);
    const byImportant = this.topImportant(importantN);

    // 去重：同一条记忆只保留一份
    const map = new Map<string, MemoryItem>();
    [...byKeyword, ...byRecent, ...byImportant].forEach((it) => map.set(it.id, it));

    // 最终按时间排序，便于喂给 LLM
    return [...map.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  }
}

function clampImportance(v: number): number {
  if (Number.isNaN(v)) return 3;
  return Math.min(5, Math.max(1, Math.round(v)));
}
```

---

## 5. 持久化：`src/storage.ts`

```ts
import fs from "node:fs";
import path from "node:path";
import { MemoryItem } from "./types";

const DATA_DIR = path.resolve(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "memory.json");

export function loadMemory(): MemoryItem[] {
  try {
    if (!fs.existsSync(FILE_PATH)) return [];
    const raw = fs.readFileSync(FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MemoryItem[]) : [];
  } catch {
    return [];
  }
}

export function saveMemory(items: MemoryItem[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(items, null, 2), "utf-8");
}
```

---

## 6. 交互命令：`src/cli.ts`

```ts
import readline from "node:readline";
import { Memory } from "./memory";

function printHelp(): void {
  console.log("\n可用命令:");
  console.log("  /add <role> <importance> <content>");
  console.log("  /recent <n>");
  console.log("  /search <keyword>");
  console.log("  /ctx <keyword>");
  console.log("  /top <n>");
  console.log("  /help");
  console.log("  /exit\n");
}

function printItems(items: Array<{ ts: string; role: string; importance: number; content: string }>): void {
  if (items.length === 0) {
    console.log("(空)");
    return;
  }
  items.forEach((it, i) => {
    console.log(`${i + 1}. [${it.ts}] [${it.role}] [imp:${it.importance}] ${it.content}`);
  });
}

export function startCli(memory: Memory, onChange: () => void): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "memory> ",
  });

  printHelp();
  rl.prompt();

  return new Promise((resolve) => {
    rl.on("line", (line) => {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        return;
      }

      if (input === "/exit") {
        rl.close();
        return;
      }

      if (input === "/help") {
        printHelp();
        rl.prompt();
        return;
      }

      if (input.startsWith("/recent ")) {
        const n = Number(input.split(" ")[1] ?? "10");
        printItems(memory.recent(n));
        rl.prompt();
        return;
      }

      if (input.startsWith("/search ")) {
        const keyword = input.slice(8).trim();
        printItems(memory.search(keyword));
        rl.prompt();
        return;
      }

      if (input.startsWith("/ctx ")) {
        const keyword = input.slice(5).trim();
        printItems(memory.retrieveContext(keyword));
        rl.prompt();
        return;
      }

      if (input.startsWith("/top ")) {
        const n = Number(input.split(" ")[1] ?? "5");
        printItems(memory.topImportant(n));
        rl.prompt();
        return;
      }

      if (input.startsWith("/add ")) {
        const parts = input.split(" ");
        if (parts.length < 4) {
          console.log("用法: /add <role> <importance> <content>");
          rl.prompt();
          return;
        }

        const role = parts[1] as "user" | "assistant" | "system";
        const importance = Number(parts[2]);
        const content = parts.slice(3).join(" ");
        memory.add(role, content, importance);
        onChange();
        console.log("已添加");
        rl.prompt();
        return;
      }

      console.log("未知命令，输入 /help 查看帮助");
      rl.prompt();
    });

    rl.on("close", () => resolve());
  });
}
```

---

## 7. 主程序：`src/main.ts`

```ts
import { Memory } from "./memory";
import { startCli } from "./cli";
import { loadMemory, saveMemory } from "./storage";

async function main(): Promise<void> {
  const memory = new Memory(200);
  memory.load(loadMemory());

  console.log(`已加载 ${memory.dump().length} 条记忆`);

  await startCli(memory, () => {
    saveMemory(memory.dump());
  });

  saveMemory(memory.dump());
  console.log("记忆已保存，退出");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

---

## 8. 运行与验证

```bash
npm run dev
```

然后可测试：

```text
/add user 5 我下周三有技术面试
/add assistant 4 已记住
/search 面试
/top 3
/ctx 面试
/recent 5
/exit
```

退出后会生成：

- `data/memory.json`

再次 `npm run dev`，应看到已加载记忆数量大于 0。

---

## 9. 进阶标准（你达到就算过关）

1. 重启程序后历史仍在
2. 能通过 `/ctx` 拿到“最近 + 关键词 + 重要度”的组合上下文
3. 能手动观察到高重要度记忆优先被召回

---

## 10. 下一步升级路线

1. 短期记忆/长期记忆分层（short-term / long-term）
2. 自动摘要（每 20 条消息生成 summary memory）
3. 向量检索（Embeddings + cosine similarity）
4. 工具调用日志也写入 memory（不仅仅是聊天内容）

如果你下一句说：

- `继续，帮我把 tutorial02 的代码直接落地到 src/`

我会直接创建这些文件并跑通。
