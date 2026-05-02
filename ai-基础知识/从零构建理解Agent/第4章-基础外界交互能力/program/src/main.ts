import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const HTTP_TIMEOUT_MS = 8000;
const HTTP_MAX_CHARS = 4000;
const FILE_MAX_CHARS = 6000;
const FIND_MAX_RESULTS = 20;
const WRITE_MAX_CHARS = 200_000;
const BASH_TIMEOUT_MS = 12_000;
const BASH_MAX_OUTPUT_CHARS = 8_000;
const ALLOWED_BASH_SUBCOMMANDS = new Set(["ls", "cat", "sed", "rg", "pwd", "date", "head", "tail", "wc"]);
const TRACE_FILE = path.resolve(process.cwd(), "data/traces.ndjson");
const BUSINESS_LOG_FILE = path.resolve(process.cwd(), "data/business.ndjson");
const MEM0_ENABLED = (process.env.MEM0_ENABLED || "0").trim() === "1";
const MEMORY_USER_ID = (process.env.MEM0_USER_ID || "default_user").trim();
const MEMORY_TOP_K = Number(process.env.MEM0_TOP_K || "5");
const MEM0_COLLECTION_NAME = (process.env.MEM0_COLLECTION_NAME || "agent_memories_512").trim();
const REMINDER_EVERY_TURNS = 3;
const LOG_RAW_RESPONSE_MAX_CHARS = 4000;

let activeSessionId = getSessionId();
let activeReqId = "";
let memory: Memory | null = null;
let turnCount = 0;
let planningState: PlanningState | null = null;
const execFileAsync = promisify(execFile);
let safeRoot = path.resolve(process.cwd());
let readRoots = [safeRoot];
let writeRoots = [safeRoot];

type PlanStatus = "pending" | "in_progress" | "done" | "failed";
type PlanningItem = {
  id: string;
  title: string;
  status: PlanStatus;
  notes?: string;
  updatedAt: string;
};
type PlanningState = {
  id: string;
  goal: string;
  items: PlanningItem[];
  currentItemId?: string;
  updatedAt: string;
};

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
    if (!isPathAllowed(abs, readRoots)) {
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

const findFileTool = tool({
  name: "FindFile",
  description: "在白名单目录内按文件名模糊搜索，返回相对路径候选列表（不读取文件内容）",
  parameters: z.object({
    fileName: z.string().min(1),
  }),
  async execute({ fileName }) {
    await logBusinessEvent("tool.start", { tool: "FindFile", fileName });
    const query = normalizeFileQuery(fileName);
    const matches: FileMatch[] = [];
    for (const root of readRoots) {
      await collectMatchingFiles(root, query, matches);
      if (matches.length >= FIND_MAX_RESULTS) {
        break;
      }
    }

    const result = matches
      .slice(0, FIND_MAX_RESULTS)
      .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
      .map((item) => item.relativePath);

    await logBusinessEvent("tool.success", { tool: "FindFile", fileName, hits: result.length });
    if (result.length === 0) {
      return `未找到匹配文件: ${fileName}`;
    }
    return result.join("\n");
  },
});

const createFileTool = tool({
  name: "CreateFile",
  description: "创建新文件并写入内容，仅允许白名单目录；若文件已存在会失败",
  parameters: z.object({
    relativePath: z.string().min(1),
    content: z.string(),
  }),
  async execute({ relativePath, content }) {
    await logBusinessEvent("tool.start", { tool: "CreateFile", relativePath, chars: content.length });
    if (content.length > WRITE_MAX_CHARS) {
      await logBusinessEvent("tool.error", { tool: "CreateFile", relativePath, error: "内容过大" });
      return `写入失败: 内容过大，超过 ${WRITE_MAX_CHARS} 字符`;
    }

    const abs = path.resolve(process.cwd(), relativePath);
    if (!isPathAllowed(abs, writeRoots)) {
      await logBusinessEvent("tool.error", { tool: "CreateFile", relativePath, error: "路径不在允许范围内" });
      return `路径不在允许范围内: ${relativePath}`;
    }

    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const handle = await fs.open(abs, "wx");
      try {
        await handle.writeFile(content, "utf-8");
      } finally {
        await handle.close();
      }
      await logBusinessEvent("tool.success", { tool: "CreateFile", relativePath, chars: content.length });
      return `创建成功: ${relativePath} (chars=${content.length})`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logBusinessEvent("tool.error", { tool: "CreateFile", relativePath, error: msg });
      return `创建失败: ${msg}`;
    }
  },
});

const editFileTool = tool({
  name: "EditFile",
  description: "编辑已有文件，仅允许白名单目录；支持 overwrite 或 append",
  parameters: z.object({
    relativePath: z.string().min(1),
    content: z.string(),
    mode: z.enum(["overwrite", "append"]).default("overwrite"),
  }),
  async execute({ relativePath, content, mode }) {
    await logBusinessEvent("tool.start", { tool: "EditFile", relativePath, mode, chars: content.length });
    if (content.length > WRITE_MAX_CHARS) {
      await logBusinessEvent("tool.error", { tool: "EditFile", relativePath, error: "内容过大" });
      return `写入失败: 内容过大，超过 ${WRITE_MAX_CHARS} 字符`;
    }

    const abs = path.resolve(process.cwd(), relativePath);
    if (!isPathAllowed(abs, writeRoots)) {
      await logBusinessEvent("tool.error", { tool: "EditFile", relativePath, error: "路径不在允许范围内" });
      return `路径不在允许范围内: ${relativePath}`;
    }

    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        await logBusinessEvent("tool.error", { tool: "EditFile", relativePath, error: "目标不是文件" });
        return "目标不是文件";
      }
      if (mode === "append") {
        await fs.appendFile(abs, content, "utf-8");
      } else {
        await fs.writeFile(abs, content, "utf-8");
      }
      await logBusinessEvent("tool.success", { tool: "EditFile", relativePath, mode, chars: content.length });
      return `编辑成功: ${relativePath} mode=${mode} (chars=${content.length})`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logBusinessEvent("tool.error", { tool: "EditFile", relativePath, error: msg });
      return `编辑失败: ${msg}`;
    }
  },
});

const deleteFileTool = tool({
  name: "DeleteFile",
  description: "删除文件，仅允许白名单目录。危险操作：仅在用户明确要求时使用",
  parameters: z.object({
    relativePath: z.string().min(1),
  }),
  async execute({ relativePath }) {
    await logBusinessEvent("tool.start", { tool: "DeleteFile", relativePath });
    const abs = path.resolve(process.cwd(), relativePath);
    if (!isPathAllowed(abs, writeRoots)) {
      await logBusinessEvent("tool.error", { tool: "DeleteFile", relativePath, error: "路径不在允许范围内" });
      return `路径不在允许范围内: ${relativePath}`;
    }
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        await logBusinessEvent("tool.error", { tool: "DeleteFile", relativePath, error: "目标不是文件" });
        return "目标不是文件";
      }
      await fs.unlink(abs);
      await logBusinessEvent("tool.success", { tool: "DeleteFile", relativePath });
      return `删除成功: ${relativePath}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logBusinessEvent("tool.error", { tool: "DeleteFile", relativePath, error: msg });
      return `删除失败: ${msg}`;
    }
  },
});

const bashExecTool = tool({
  name: "BashExec",
  description: "执行 bash 命令并返回 stdout/stderr（用于环境诊断与自动化操作）",
  parameters: z.object({
    command: z.string().min(1),
  }),
  async execute({ command }) {
    await logBusinessEvent("tool.start", { tool: "BashExec", command });
    const deniedReason = validateBashCommand(command);
    if (deniedReason) {
      await logBusinessEvent("tool.error", { tool: "BashExec", command, error: deniedReason });
      return `命令被拒绝: ${deniedReason}`;
    }
    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
        cwd: process.cwd(),
        timeout: BASH_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      const output = formatBashOutput(stdout ?? "", stderr ?? "");
      await logBusinessEvent("tool.success", {
        tool: "BashExec",
        command,
        output_chars: output.length,
      });
      return output;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const output = formatBashOutput(e.stdout ?? "", e.stderr ?? "");
      const msg = e.message ?? String(err);
      await logBusinessEvent("tool.error", { tool: "BashExec", command, error: msg });
      return `命令执行失败: ${msg}\n${output}`;
    }
  },
});

const taskTool = tool({
  name: "Task",
  description: "会话内任务管理工具，支持 create/list/update。仅服务当前会话，不做跨会话持久化。",
  parameters: z.object({
    action: z.enum(["create", "list", "update"]),
    goal: z.string().optional(),
    items: z.array(z.string()).optional(),
    itemId: z.string().optional(),
    status: z.enum(["pending", "in_progress", "done", "failed"]).optional(),
    notes: z.string().optional(),
  }),
  async execute({ action, goal, items, itemId, status, notes }) {
    await logBusinessEvent("tool.start", { tool: "Task", action, itemId, status });
    try {
      if (action === "create") {
        if (!goal || !items || items.length === 0) {
          return "创建失败: create 需要 goal 和非空 items";
        }
        planningState = {
          id: `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          goal,
          items: items.map((title, idx) => ({
            id: `item_${idx + 1}`,
            title,
            status: "pending",
            updatedAt: new Date().toISOString(),
          })),
          updatedAt: new Date().toISOString(),
        };
        await logBusinessEvent("tool.success", { tool: "Task", action, plan_id: planningState.id });
        return renderPlanningState(planningState);
      }

      if (action === "list") {
        if (!planningState) {
          return "当前会话暂无计划";
        }
        await logBusinessEvent("tool.success", { tool: "Task", action, plan_id: planningState.id });
        return renderPlanningState(planningState);
      }

      if (!planningState) {
        return "更新失败: 当前会话暂无计划";
      }
      if (!itemId || !status) {
        return "更新失败: update 需要 itemId 和 status";
      }

      const item = planningState.items.find((it) => it.id === itemId);
      if (!item) {
        return `更新失败: 未找到 itemId=${itemId}`;
      }

      if (status === "in_progress") {
        for (const it of planningState.items) {
          if (it.id !== itemId && it.status === "in_progress") {
            it.status = "pending";
            it.updatedAt = new Date().toISOString();
          }
        }
        planningState.currentItemId = itemId;
      } else if (planningState.currentItemId === itemId && (status === "done" || status === "failed")) {
        planningState.currentItemId = undefined;
      }

      item.status = status;
      if (notes) {
        item.notes = notes;
      }
      item.updatedAt = new Date().toISOString();
      planningState.updatedAt = new Date().toISOString();

      await logBusinessEvent("tool.success", { tool: "Task", action, plan_id: planningState.id, itemId, status });
      return renderPlanningState(planningState);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logBusinessEvent("tool.error", { tool: "Task", action, error: msg });
      return `Task 执行失败: ${msg}`;
    }
  },
});

const agent = new Agent({
  name: "EnvAgent",
  instructions:
    "你是一个环境助手。系统启动时会先执行 pwd 确定 safePath。你后续的文件与命令操作必须限制在 safePath 内，禁止越界访问。优先使用工具获取事实，不要编造。当读取文件失败（尤其路径不在范围）时，必须先调用 FindFile 查找候选路径；如果只有一个候选，自动用 ReadFile 重试；如果多个候选，列出候选并让用户确认。若用户明确要求保存内容，优先使用 CreateFile/EditFile；DeleteFile 仅在用户明确要求删除时使用。可以使用 BashExec 进行命令行排查与操作。需要管理任务时，使用 Task 工具(create/list/update)维护当前会话计划。回答时简洁，并在末尾标注是否调用了工具。",
  model: process.env.OPENAI_MODEL || "deepseek-chat",
  tools: [nowTimeTool, httpGetTool, readFileTool, findFileTool, createFileTool, editFileTool, deleteFileTool, bashExecTool, taskTool],
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
  turnCount += 1;
  await logBusinessEvent("request.start", { user_input: userInput });
  const memoryContext = await loadMemoryContext(userInput);
  const reminders = getPlanningReminders();
  const planningContext = planningState ? `当前会话计划：\n${renderPlanningState(planningState)}\n` : "";
  const reminderContext = reminders.length > 0 ? `提醒：\n${reminders.join("\n")}\n` : "";
  const memoryBlock = memoryContext
    ? `以下是和用户相关的历史记忆，请作为参考（可能不完整）：\n${memoryContext}\n`
    : "";
  const effectiveInput = `${planningContext}${reminderContext}${memoryBlock}\n用户本轮问题：${userInput}`.trim();

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
          turnCount = 0;
          planningState = null;
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
  await initSafeRoot();
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

function toSafeJson(value: unknown, maxChars: number): string {
  try {
    return cutText(JSON.stringify(value), maxChars);
  } catch {
    return cutText(String(value), maxChars);
  }
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
        collectionName: MEM0_COLLECTION_NAME,
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
    await logBusinessEvent("memory.search.start", {
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      top_k: MEMORY_TOP_K,
      query_chars: userInput.length,
    });
    await logBusinessEvent("memory.search", {
      status: "start",
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      top_k: MEMORY_TOP_K,
      query_chars: userInput.length,
    });
    const result = await memory.search(userInput, {
      topK: MEMORY_TOP_K,
      filters: { user_id: MEMORY_USER_ID },
    });
    const items = result.results ?? [];
    const rawResponse = toSafeJson(result, LOG_RAW_RESPONSE_MAX_CHARS);
    await logBusinessEvent("memory.search.success", {
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      top_k: MEMORY_TOP_K,
      query_chars: userInput.length,
      hits: items.length,
      raw_response: rawResponse,
    });
    await logBusinessEvent("memory.search", {
      status: "success",
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      top_k: MEMORY_TOP_K,
      query_chars: userInput.length,
      hits: items.length,
      raw_response: rawResponse,
    });
    if (items.length === 0) {
      return "";
    }
    return items
      .map((item, idx) => `${idx + 1}. ${item.memory}`)
      .join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : undefined;
    const errorStack = err instanceof Error ? cutText(err.stack || "", LOG_RAW_RESPONSE_MAX_CHARS) : undefined;
    const rawResponse = toSafeJson(err, LOG_RAW_RESPONSE_MAX_CHARS);
    await logBusinessEvent("memory.search.error", {
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      query_chars: userInput.length,
      error: message,
      error_name: errorName,
      error_stack: errorStack,
      raw_response: rawResponse,
    });
    await logBusinessEvent("memory.search", {
      status: "error",
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      query_chars: userInput.length,
      error: message,
      error_name: errorName,
      error_stack: errorStack,
      raw_response: rawResponse,
    });
    return "";
  }
}

async function saveConversationToMemory(userInput: string, assistantOutput: string): Promise<void> {
  if (!memory) {
    return;
  }

  try {
    await logBusinessEvent("memory.write", {
      status: "start",
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      user_chars: userInput.length,
      assistant_chars: assistantOutput.length,
      chars: userInput.length + assistantOutput.length,
    });
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
      status: "success",
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      user_chars: userInput.length,
      assistant_chars: assistantOutput.length,
      chars: userInput.length + assistantOutput.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logBusinessEvent("memory.write", {
      status: "error",
      user_id: MEMORY_USER_ID,
      session_id: activeSessionId,
      req_id: activeReqId,
      user_chars: userInput.length,
      assistant_chars: assistantOutput.length,
      chars: userInput.length + assistantOutput.length,
      error: message,
    });
  }
}

type FileQuery = {
  normalized: string;
  hasExt: boolean;
};

type FileMatch = {
  relativePath: string;
  score: number;
};

const COMMON_FILE_EXTS = [".md", ".json", ".txt"];

function normalizeFileQuery(input: string): FileQuery {
  const normalized = input.trim().toLowerCase();
  return {
    normalized,
    hasExt: path.extname(normalized).length > 0,
  };
}

function scoreFileNameMatch(fileName: string, query: FileQuery): number {
  const name = fileName.toLowerCase();
  const q = query.normalized;
  if (!q) {
    return 0;
  }
  if (name === q) {
    return 100;
  }
  if (!query.hasExt) {
    for (const ext of COMMON_FILE_EXTS) {
      if (name === `${q}${ext}`) {
        return 95;
      }
    }
    if (name.startsWith(`${q}.`)) {
      return 90;
    }
  }
  if (q.includes("*")) {
    const escaped = q.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const re = new RegExp(`^${escaped}$`, "i");
    if (re.test(name)) {
      return 85;
    }
  }
  if (name.includes(q)) {
    return 70;
  }
  return 0;
}

async function collectMatchingFiles(dir: string, query: FileQuery, out: FileMatch[]): Promise<void> {
  if (out.length >= FIND_MAX_RESULTS) {
    return;
  }

  let entries: Array<{ isDirectory: () => boolean; isFile: () => boolean; name: string }>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as Array<{
      isDirectory: () => boolean;
      isFile: () => boolean;
      name: string;
    }>;
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= FIND_MAX_RESULTS) {
      return;
    }
    const name = String(entry.name);
    const fullPath = path.join(dir, name);
    if (entry.isDirectory()) {
      await collectMatchingFiles(fullPath, query, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const score = scoreFileNameMatch(name, query);
    if (score > 0) {
      out.push({
        relativePath: path.relative(process.cwd(), fullPath),
        score,
      });
    }
  }
}

function formatBashOutput(stdout: string, stderr: string): string {
  const merged = [`stdout:\n${stdout || "(empty)"}`, `stderr:\n${stderr || "(empty)"}`].join("\n\n");
  return cutText(merged, BASH_MAX_OUTPUT_CHARS);
}

function renderPlanningState(plan: PlanningState): string {
  const lines = [
    `plan_id: ${plan.id}`,
    `goal: ${plan.goal}`,
    `current_item: ${plan.currentItemId || "(none)"}`,
  ];
  for (const item of plan.items) {
    lines.push(`- ${item.id} [${item.status}] ${item.title}${item.notes ? ` | notes: ${item.notes}` : ""}`);
  }
  return lines.join("\n");
}

function getPlanningReminders(): string[] {
  if (!planningState) {
    return [];
  }
  if (turnCount % REMINDER_EVERY_TURNS !== 0) {
    return [];
  }
  const reminders: string[] = [];
  const inProgress = planningState.items.find((it) => it.status === "in_progress");
  if (inProgress) {
    reminders.push(`你有进行中的任务 ${inProgress.id}，请优先推进或更新状态。`);
  } else {
    const nextPending = planningState.items.find((it) => it.status === "pending");
    if (nextPending) {
      reminders.push(`请推进下一步任务 ${nextPending.id}: ${nextPending.title}`);
    }
  }
  return reminders;
}

function validateBashCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return "空命令";
  }

  const firstToken = trimmed.split(/\s+/)[0];
  if (!ALLOWED_BASH_SUBCOMMANDS.has(firstToken)) {
    return `仅允许子命令: ${Array.from(ALLOWED_BASH_SUBCOMMANDS).join(", ")}`;
  }

  const unsafeAbsolutePath = trimmed
    .split(/\s+/)
    .filter((t) => t.startsWith("/"))
    .find((t) => !isPathAllowed(path.resolve(t), [safeRoot]));
  if (unsafeAbsolutePath) {
    return `检测到超出 safePath 的绝对路径: ${unsafeAbsolutePath}`;
  }

  return null;
}

async function initSafeRoot(): Promise<void> {
  try {
    const { stdout } = await execFileAsync("bash", ["-lc", "pwd"], {
      cwd: process.cwd(),
      timeout: 2000,
      maxBuffer: 64 * 1024,
      env: process.env,
    });
    const detected = stdout.trim();
    if (detected) {
      safeRoot = path.resolve(detected);
      readRoots = [safeRoot];
      writeRoots = [safeRoot];
    }
  } catch {
    safeRoot = path.resolve(process.cwd());
    readRoots = [safeRoot];
    writeRoots = [safeRoot];
  }
  await logBusinessEvent("safepath.init", { safe_root: safeRoot });
}
