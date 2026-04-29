import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { MemoryModule } from "./memory/module";
import { HttpCompatibleLLM } from "./react/http_llm";
import { ReActAgent, ToolBox } from "./react/core";
import { registerMemoryTools } from "./react/memory_tools";
import { registerEnvTools } from "./react/env_tools";
import { DialogueTurn, summarizeLongTermCandidates } from "./react/long_memory_summary";
import { scoreImportanceWithLLM } from "./react/importance_scorer";

type Runtime = {
  memory: MemoryModule;
  llm: HttpCompatibleLLM;
  agent: ReActAgent;
};

function createRuntime(): Runtime {
  loadEnvFromLocalFileIfMissing();

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  if (!apiKey || apiKey.includes("replace_with_your")) {
    throw new Error(
      "缺少有效 OPENAI_API_KEY。请设置环境变量，或在项目 .env 中填写真实值（不要保留 replace_with_your...）。"
    );
  }

  const memory = new MemoryModule(undefined, {
    shortMaxItems: 100,
    longMaxItems: 500,
    summaryEvery: 20,
  });
  memory.init();

  const llm = new HttpCompatibleLLM(apiKey, baseUrl, model);
  const toolbox = new ToolBox();
  registerMemoryTools(toolbox, memory);
  registerEnvTools(toolbox, {
    allowedReadRoots: [path.resolve(process.cwd(), "data"), path.resolve(process.cwd(), "src")],
    httpTimeoutMs: 8000,
    httpMaxChars: 4000,
    fileMaxChars: 6000,
  });

  return {
    memory,
    llm,
    agent: new ReActAgent(llm, toolbox, 5),
  };
}

function loadEnvFromLocalFileIfMissing(): void {
  if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes("replace_with_your")) {
    return;
  }

  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function runOnce(runtime: Runtime, question: string): Promise<string | null> {
  const shortContext = formatShortMemoryContext(runtime.memory.recentShort(8));
  const answer = await runtime.agent.run(question, shortContext);

  // 每轮都记录 user + assistant 到 short memory，imp 由 LLM 评分决定
  const userImp = await scoreImportanceWithLLM(runtime.llm, "user", question);
  const assistantText = answer ?? "(本轮未得到最终答案)";
  const assistantImp = await scoreImportanceWithLLM(runtime.llm, "assistant", assistantText);
  await runtime.memory.record("user", question, userImp);
  await runtime.memory.record("assistant", assistantText, assistantImp);

  if (answer) {
    console.log(`\n最终答案:\n${answer}\n`);
  } else {
    console.log("\n未在最大步数内得到最终答案。\n");
  }
  return answer;
}

function formatShortMemoryContext(
  items: Array<{ role: string; importance: number; content: string }>
): string {
  if (items.length === 0) return "(暂无)";
  return items
    .map((it, idx) => `${idx + 1}. [${it.role}] [imp:${it.importance}] ${it.content}`)
    .join("\n");
}

async function runCli(runtime: Runtime): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "react> ",
  });
  let isClosed = false;
  let queue: Promise<void> = Promise.resolve();

  const safePrompt = (): void => {
    if (!isClosed) rl.prompt();
  };
  const turns: DialogueTurn[] = [];

  console.log("ReAct CLI 已启动。输入问题开始，/help 查看帮助，/exit 退出。");
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

        if (input === "/help") {
          console.log("命令: /help, /exit");
          console.log("其他任意输入会作为 ReAct 问题执行。");
          safePrompt();
          return;
        }

        const answer = await runOnce(runtime, input);
        turns.push({
          user: input,
          assistant: answer ?? "",
        });
        if (turns.length % 5 === 0) {
          const recent5 = turns.slice(-5);
          const candidates = await summarizeLongTermCandidates(runtime.llm, recent5);
          if (candidates.length > 0) {
            console.log(`[SummaryStep] 提取到 ${candidates.length} 条长期记忆候选`);
          } else {
            console.log("[SummaryStep] 无需新增长期记忆");
          }
          for (const c of candidates) {
            await runtime.memory.record("system", `[summary-step] ${c.content}`, c.importance);
            const short = c.content.length > 120 ? `${c.content.slice(0, 120)}...` : c.content;
            console.log(`[SummaryStep] saved imp=${c.importance} content=${short}`);
          }
        }
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
      runtime.memory.flush();
      console.log("已保存，退出。");
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const runtime = createRuntime();
  const oneShotQuestion = process.argv.slice(2).join(" ").trim();
  if (oneShotQuestion) {
    await runOnce(runtime, oneShotQuestion);
    runtime.memory.flush();
    return;
  }

  await runCli(runtime);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
