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
      if (!resp.ok) {
        return `HTTP 错误: ${resp.status}`;
      }

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
      if (!stat.isFile()) {
        return "目标不是文件";
      }
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
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, maxChars)}\n... [truncated ${input.length - maxChars} chars]`;
}
