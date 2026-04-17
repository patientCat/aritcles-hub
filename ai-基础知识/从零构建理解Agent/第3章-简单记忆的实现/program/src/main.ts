import readline from "node:readline";
import { LayeredMemoryManager } from "./memory_manager";
import { loadState, saveState } from "./storage";
import { Role } from "./types";

function printHelp(): void {
  console.log("\n命令列表:");
  console.log("  /add <role> <importance> <content>");
  console.log("  /recent <n>");
  console.log("  /long <n>");
  console.log("  /search <keyword>");
  console.log("  /ctx <keyword>");
  console.log("  /sem <query>");
  console.log("  /top <n>");
  console.log("  /help");
  console.log("  /exit\n");
}

function printItems(
  items: Array<{ ts: string; role: string; importance: number; tier: string; content: string }>
): void {
  if (items.length === 0) {
    console.log("(空)");
    return;
  }

  items.forEach((it, idx) => {
    console.log(
      `${idx + 1}. [${it.ts}] [${it.role}] [${it.tier}] [imp:${it.importance}] ${it.content}`
    );
  });
}

async function main(): Promise<void> {
  const manager = new LayeredMemoryManager({
    shortMaxItems: 100,
    longMaxItems: 500,
    summaryEvery: 20,
  });

  const state = loadState();
  manager.load(state.shortTerm, state.longTerm);
  const loaded = manager.dump();
  console.log(`已加载 short=${loaded.shortTerm.length}, long=${loaded.longTerm.length}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "memory> ",
  });
  let isClosed = false;

  printHelp();
  rl.prompt();
  const safePrompt = (): void => {
    if (!isClosed) rl.prompt();
  };

  let lineQueue: Promise<void> = Promise.resolve();

  const handleLine = async (line: string): Promise<void> => {
    const input = line.trim();
    if (!input) {
      safePrompt();
      return;
    }

    try {
      if (input === "/exit") {
        rl.close();
        return;
      }

      if (input === "/help") {
        printHelp();
        safePrompt();
        return;
      }

      if (input.startsWith("/recent ")) {
        const n = Number(input.split(" ")[1] ?? "8");
        printItems(manager.recentShort(n));
        safePrompt();
        return;
      }

      if (input.startsWith("/long ")) {
        const n = Number(input.split(" ")[1] ?? "8");
        printItems(manager.recentLong(n));
        safePrompt();
        return;
      }

      if (input.startsWith("/search ")) {
        const keyword = input.slice(8).trim();
        printItems(manager.search(keyword));
        safePrompt();
        return;
      }

      if (input.startsWith("/ctx ")) {
        const keyword = input.slice(5).trim();
        printItems(manager.retrieveContext(keyword));
        safePrompt();
        return;
      }

      if (input.startsWith("/top ")) {
        const n = Number(input.split(" ")[1] ?? "5");
        printItems(manager.topImportant(n));
        safePrompt();
        return;
      }

      if (input.startsWith("/sem ")) {
        const query = input.slice(5).trim();
        printItems(await manager.retrieveSemanticContext(query, 5));
        safePrompt();
        return;
      }

      if (input.startsWith("/add ")) {
        const parts = input.split(" ");
        if (parts.length < 4) {
          console.log("用法: /add <role> <importance> <content>");
          safePrompt();
          return;
        }

        const role = parts[1] as Role;
        if (!["user", "assistant", "system"].includes(role)) {
          console.log("role 只能是 user | assistant | system");
          safePrompt();
          return;
        }

        const importance = Number(parts[2]);
        const content = parts.slice(3).join(" ");
        await manager.add(role, content, importance);
        saveState(manager.dump());
        console.log("已写入并保存");
        safePrompt();
        return;
      }

      console.log("未知命令，输入 /help 查看帮助");
      safePrompt();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      safePrompt();
    }
  };

  rl.on("line", (line: string) => {
    lineQueue = lineQueue
      .then(() => handleLine(line))
      .catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        safePrompt();
      });
  });

  rl.on("close", () => {
    isClosed = true;
    saveState(manager.dump());
    console.log("已保存，退出。");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
