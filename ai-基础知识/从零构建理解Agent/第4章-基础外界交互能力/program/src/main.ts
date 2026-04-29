import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import OpenAI from "openai";
import { Memory } from "mem0ai/oss";
import {
  Agent,
  BatchTraceProcessor,
  Runner,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTraceProcessors,
  setTracingDisabled,
  tool,
  type TracingExporter,
} from "@openai/agents";
import { z } from "zod";

const READ_ROOTS = [path.resolve(process.cwd(), "data"), path.resolve(process.cwd(), "src")];
const HTTP_TIMEOUT_MS = 8000;
const HTTP_MAX_CHARS = 4000;
const FILE_MAX_CHARS = 6000;
const TRACE_FILE = path.resolve(process.cwd(), "data/traces.ndjson");
const BUSINESS_LOG_FILE = path.resolve(process.cwd(), "data/business.ndjson");
const MEM0_ENABLED = (process.env.MEM0_ENABLED || "0").trim() === "1";
const MEMORY_USER_ID = (process.env.MEM0_USER_ID || "default_user").trim();
const MEMORY_TOP_K = Number(process.env.MEM0_TOP_K || "5");

let activeSessionId = getSessionId();
let activeReqId = "";
let memory: Memory | null = null;

class NdjsonTraceExporter implements TracingExporter {
  constructor(private readonly outputPath: string) {}

  async export(items: Array<{ toJSON: () => object | null }>): Promise<void> {
    await fs.mkdir(path.dirname(this.outputPath), { recursive: true });
    const lines = items
      .map((item) => item.toJSON())
      .filter((obj): obj is object => obj !== null)
      .map((obj) => JSON.stringify({ ts: new Date().toISOString(), ...obj }))
      .join("\n");

    if (lines.length > 0) {
      await fs.appendFile(this.outputPath, `${lines}\n`, "utf-8");
    }
  }
}

if (process.env.OPENAI_BASE_URL) {
  setOpenAIAPI("chat_completions");
  setDefaultOpenAIClient(
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    }),
  );
}

if (process.env.OPENAI_AGENTS_DISABLE_TRACING === "1") {
  setTracingDisabled(true);
} else {
  setTracingDisabled(false);
  setTraceProcessors([new BatchTraceProcessor(new NdjsonTraceExporter(TRACE_FILE))]);
}

const nowTimeTool = tool({
  name: "NowTime",
  description: "读取当前时间，输入 IANA 时区（如 Asia/Shanghai）",
  parameters: z.object({
    timezone: z.string().default("Asia/Shanghai"),
  }),
  async execute({ timezone }) {
    await logBusinessEvent("tool.start", { tool: "NowTime", timezone });
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
      const output = `${timezone} ${formatter.format(new Date())}`;
      await logBusinessEvent("tool.success", { tool: "NowTime", output });
      return output;
    } catch {
      await logBusinessEvent("tool.error", { tool: "NowTime", error: `无效时区: ${timezone}` });
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
    await logBusinessEvent("tool.start", { tool: "HttpGet", url });
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      await logBusinessEvent("tool.error", { tool: "HttpGet", error: "仅允许 http/https" });
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
        const error = `HTTP 错误: ${resp.status}`;
        await logBusinessEvent("tool.error", { tool: "HttpGet", error, status: resp.status });
        return error;
      }

      const text = await resp.text();
      const output = cutText(text, HTTP_MAX_CHARS);
      await logBusinessEvent("tool.success", { tool: "HttpGet", chars: output.length });
      return output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logBusinessEvent("tool.error", { tool: "HttpGet", error: msg });
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
    await logBusinessEvent("tool.start", { tool: "ReadFile", relativePath });
    const abs = path.resolve(process.cwd(), relativePath);
    if (!isPathAllowed(abs, READ_ROOTS)) {
      await logBusinessEvent("tool.error", { tool: "ReadFile", relativePath, error: "路径不在允许范围内" });
      return `路径不在允许范围内: ${relativePath}`;
    }

    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        await logBusinessEvent("tool.error", { tool: "ReadFile", relativePath, error: "目标不是文件" });
        return "目标不是文件";
      }
      const content = await fs.readFile(abs, "utf-8");
      const output = cutText(content, FILE_MAX_CHARS);
      await logBusinessEvent("tool.success", { tool: "ReadFile", relativePath, chars: output.length });
      return output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logBusinessEvent("tool.error", { tool: "ReadFile", relativePath, error: msg });
      return `读取失败: ${msg}`;
    }
  },
});

const agent = new Agent({
  name: "EnvAgent",
  instructions:
    "你是一个只读环境助手。优先使用工具获取事实，不要编造。回答时简洁，并在末尾标注是否调用了工具。",
  model: process.env.OPENAI_MODEL || "deepseek-chat",
  tools: [nowTimeTool, httpGetTool, readFileTool],
});

async function initMemory(): Promise<void> {
  if (!MEM0_ENABLED) {
    memory = null;
    await logBusinessEvent("memory.init", { status: "skipped", reason: "MEM0_ENABLED != 1" });
    return;
  }

  try {
    const mem0Config = buildMem0Config();
    if (!mem0Config) {
      memory = null;
      await logBusinessEvent("memory.init", {
        status: "skipped",
        reason: "missing MEM0_* config",
      });
      return;
    }
    memory = new Memory(mem0Config);
    await logBusinessEvent("memory.init", {
      status: "ok",
      mode: "configured",
      user_id: MEMORY_USER_ID,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    memory = null;
    await logBusinessEvent("memory.init", { status: "error", error: message });
  }
}

async function runSingleTurn(userInput: string): Promise<void> {
  activeReqId = getReqId();
  await logBusinessEvent("request.start", { user_input: userInput });
  const memoryContext = await loadMemoryContext(userInput);
  const effectiveInput = memoryContext
    ? `以下是和用户相关的历史记忆，请作为参考（可能不完整）：\n${memoryContext}\n\n用户本轮问题：${userInput}`
    : userInput;

  const runner = new Runner({
    groupId: activeSessionId,
    traceMetadata: {
      session_id: activeSessionId,
      req_id: activeReqId,
    },
  });

  const result = await runner.run(agent, effectiveInput);
  await saveConversationToMemory(userInput, String(result.finalOutput ?? ""));
  await logBusinessEvent("request.end", {
    output_preview: String(result.finalOutput ?? "").slice(0, 300),
  });

  console.log("\n=== Agent Output ===");
  console.log(result.finalOutput);
  console.log(`\n[trace] session_id=${activeSessionId} req_id=${activeReqId}`);
}

async function runLoop(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "sdk> ",
  });

  let isClosed = false;
  let queue: Promise<void> = Promise.resolve();

  const safePrompt = (): void => {
    if (!isClosed) {
      rl.prompt();
    }
  };

  console.log(`SDK Agent Loop 已启动。当前会话: ${activeSessionId}`);
  console.log("命令仅支持 /new（新会话）和 /exit（退出）。");
  rl.prompt();

  rl.on("line", (line: string) => {
    queue = queue
      .then(async () => {
        const input = line.trim();
        if (!input) {
          safePrompt();
          return;
        }
        if (input === "/exit") {
          rl.close();
          return;
        }
        if (input === "/new") {
          activeSessionId = getSessionId();
          console.log(`已新开会话: ${activeSessionId}`);
          safePrompt();
          return;
        }
        await runSingleTurn(input);
        safePrompt();
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        safePrompt();
      });
  });

  await new Promise<void>((resolve) => {
    rl.on("close", () => {
      isClosed = true;
      console.log("已退出。");
      resolve();
    });
  });
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY");
  }
  await initMemory();

  const oneShot = process.argv.slice(2).join(" ").trim();
  if (oneShot) {
    await runSingleTurn(oneShot);
    return;
  }
  await runLoop();
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

function getSessionId(): string {
  const fromEnv = (process.env.SESSION_ID || "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getReqId(): string {
  const fromEnv = (process.env.REQ_ID || "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function logBusinessEvent(event: string, payload: Record<string, unknown>): Promise<void> {
  const record = {
    ts: new Date().toISOString(),
    event,
    session_id: activeSessionId,
    req_id: activeReqId,
    payload,
  };
  await fs.mkdir(path.dirname(BUSINESS_LOG_FILE), { recursive: true });
  await fs.appendFile(BUSINESS_LOG_FILE, `${JSON.stringify(record)}\n`, "utf-8");
}

function buildMem0Config(): Record<string, unknown> | null {
  const llmModel = (process.env.MEM0_LLM_MODEL || process.env.OPENAI_MODEL || "").trim();
  const embeddingModel = (process.env.MEM0_EMBED_MODEL || "").trim();
  const llmApiKey = (process.env.MEM0_LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const llmBaseUrl = (process.env.MEM0_LLM_BASE_URL || process.env.OPENAI_BASE_URL || "").trim();
  const embedApiKey = (process.env.MEM0_EMBED_API_KEY || llmApiKey).trim();
  const embedBaseUrl = (process.env.MEM0_EMBED_BASE_URL || llmBaseUrl).trim();
  const embeddingDimsRaw = (process.env.MEM0_EMBED_DIMS || "").trim();
  const embeddingDims = embeddingDimsRaw ? Number(embeddingDimsRaw) : undefined;
  const vectorDimensionRaw = (process.env.MEM0_VECTOR_DIMENSION || "").trim();
  const vectorDimension = vectorDimensionRaw ? Number(vectorDimensionRaw) : embeddingDims;

  if (!llmModel || !embeddingModel || !llmApiKey || !embeddingDims || !vectorDimension) {
    return null;
  }

  const config: Record<string, unknown> = {
    llm: {
      provider: "openai",
      config: {
        apiKey: llmApiKey,
        model: llmModel,
        ...(llmBaseUrl ? { baseURL: llmBaseUrl } : {}),
      },
    },
    embedder: {
      provider: "openai",
      config: {
        apiKey: embedApiKey,
        model: embeddingModel,
        embeddingDims,
        ...(embedBaseUrl ? { baseURL: embedBaseUrl } : {}),
      },
    },
    vectorStore: {
      provider: "memory",
      config: {
        collectionName: "agent_memories",
        dimension: vectorDimension,
      },
    },
  };

  return config;
}

async function loadMemoryContext(userInput: string): Promise<string> {
  if (!memory) {
    return "";
  }

  try {
    const result = await memory.search(userInput, {
      topK: MEMORY_TOP_K,
      filters: { user_id: MEMORY_USER_ID },
    });
    const items = result.results ?? [];
    await logBusinessEvent("memory.search", {
      user_id: MEMORY_USER_ID,
      top_k: MEMORY_TOP_K,
      hits: items.length,
    });
    if (items.length === 0) {
      return "";
    }
    return items
      .map((item, idx) => `${idx + 1}. ${item.memory}`)
      .join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logBusinessEvent("memory.search", { status: "error", error: message });
    return "";
  }
}

async function saveConversationToMemory(userInput: string, assistantOutput: string): Promise<void> {
  if (!memory) {
    return;
  }

  try {
    await memory.add(
      [
        { role: "user", content: userInput },
        { role: "assistant", content: assistantOutput },
      ],
      {
        userId: MEMORY_USER_ID,
        metadata: {
          session_id: activeSessionId,
          req_id: activeReqId,
        },
      },
    );
    await logBusinessEvent("memory.write", {
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      chars: userInput.length + assistantOutput.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logBusinessEvent("memory.write", { status: "error", error: message });
  }
}
