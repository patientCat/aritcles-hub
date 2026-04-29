# Tutorial-01（SDK版）：用 OpenAI Agents SDK 快速接入外界交互能力

这一节我们不再手写 ReAct 循环，直接使用 `OpenAI Agents SDK` 的最小框架。

目标不变，只做第4章最核心的 3 个只读工具：

1. `NowTime`：读取当前时间
2. `HttpGet`：读取网页文本（只读 + 超时 + 截断）
3. `ReadFile`：读取白名单目录文件（只读）

---

## 1. 为什么这里切 SDK

你前面已经理解了 Agent/Tool 的核心概念。第4章重点是“外界交互能力边界”，不是再造轮子。

用 SDK 的好处：

1. 内置 agent loop，减少样板代码
2. 工具 schema/调用更规范
3. 后续接第5章（工具管理、skill）更顺滑

---

## 2. 先安装依赖

在当前 `program` 目录执行：

```bash
npm install @openai/agents zod dotenv
```

如果你要直接跑 TS 文件，建议再装：

```bash
npm install -D tsx
```

并在 `package.json` 增加：

```json
{
  "scripts": {
    "sdk": "tsx src/sdk_main.ts"
  }
}
```

---

## 3. 最小可运行代码：`src/sdk_main.ts`

```ts
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";

const READ_ROOTS = [path.resolve(process.cwd(), "data"), path.resolve(process.cwd(), "src")];
const HTTP_TIMEOUT_MS = 8000;
const HTTP_MAX_CHARS = 4000;
const FILE_MAX_CHARS = 6000;

const nowTimeTool = tool({
  name: "NowTime",
  description: "读取当前时间，输入 IANA 时区（如 Asia/Shanghai）",
  parameters: z.object({
    timezone: z.string().default("Asia/Shanghai"),
  }),
  async execute({ timezone }) {
    try {
      const formatter = new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      return `${timezone} ${formatter.format(new Date())}`;
    } catch {
      return `无效时区: ${timezone}`;
    }
  },
});

const httpGetTool = tool({
  name: "HttpGet",
  description: "HTTP GET 读取网页文本，仅允许 http/https",
  parameters: z.object({
    url: z.string().url(),
  }),
  async execute({ url }) {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return "仅允许 http/https";
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        headers: { "User-Agent": "agent-learning/0.1" },
      });
      if (!resp.ok) return `HTTP 错误: ${resp.status}`;

      const text = await resp.text();
      return cutText(text, HTTP_MAX_CHARS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `请求失败: ${msg}`;
    } finally {
      clearTimeout(timer);
    }
  },
});

const readFileTool = tool({
  name: "ReadFile",
  description: "读取本地文件（相对路径），仅允许白名单目录",
  parameters: z.object({
    relativePath: z.string().min(1),
  }),
  async execute({ relativePath }) {
    const abs = path.resolve(process.cwd(), relativePath);
    if (!isPathAllowed(abs, READ_ROOTS)) {
      return `路径不在允许范围内: ${relativePath}`;
    }

    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return "目标不是文件";
      const content = await fs.readFile(abs, "utf-8");
      return cutText(content, FILE_MAX_CHARS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `读取失败: ${msg}`;
    }
  },
});

const agent = new Agent({
  name: "EnvAgent",
  instructions:
    "你是一个只读环境助手。优先使用工具获取事实，不要编造。回答时简洁，并在末尾标注是否调用了工具。",
  model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  tools: [nowTimeTool, httpGetTool, readFileTool],
});

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY");
  }

  const userInput = process.argv.slice(2).join(" ").trim() || "现在上海几点？";
  const result = await run(agent, userInput);

  console.log("\n=== Agent Output ===");
  console.log(result.finalOutput);
}

void main();

function isPathAllowed(absPath: string, roots: string[]): boolean {
  return roots.some((root) => absPath === root || absPath.startsWith(root + path.sep));
}

function cutText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n... [truncated ${input.length - maxChars} chars]`;
}
```

---

## 4. 运行方式

先准备环境变量（示例）：

```bash
export OPENAI_API_KEY=your_key
export OPENAI_MODEL=gpt-5.4-mini
```

执行：

```bash
npm run sdk -- "读取 data/short_memory.json 并总结"
```

也可测试：

```bash
npm run sdk -- "现在 Asia/Shanghai 时间是什么？"
npm run sdk -- "读取 https://example.com 内容并给出一句总结"
```

---

## 5. 这一节的验收标准（和第4章目标对齐）

1. 时间问题会触发 `NowTime`
2. URL 问题会触发 `HttpGet`，且超时可控
3. 文件读取只允许 `data/`、`src/`，越权会被拒绝
4. 不需要手写 ReAct 主循环

---

## 6. 你接下来该做什么（Tutorial-02）

下一节建议直接做三件事：

1. 统一工具错误格式（便于排障和日志分析）
2. 增加工具调用日志（tool / latency / success）
3. 加最小测试（至少覆盖路径越权与 URL 协议限制）

