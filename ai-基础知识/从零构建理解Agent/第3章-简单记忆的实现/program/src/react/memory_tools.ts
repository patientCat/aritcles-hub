import { MemoryModule } from "../memory/module";
import { ToolBox } from "./core";

export function registerMemoryTools(toolbox: ToolBox, memory: MemoryModule): void {
  toolbox.registerTool("MemoryRecall", "基于关键词检索记忆上下文", async (input: string) => {
    const items = memory.retrieveContext(input, 6, 4).slice(0, 6);
    if (items.length === 0) return "未命中记忆";
    return items
      .map((it, idx) => `${idx + 1}. [${it.role}] [imp:${it.importance}] ${it.content}`)
      .join("\n");
  });

  toolbox.registerTool("MemorySemantic", "基于语义向量检索记忆", async (input: string) => {
    const items = await memory.retrieveSemanticContext(input, 5);
    if (items.length === 0) return "未命中语义记忆";
    return items
      .map((it, idx) => `${idx + 1}. [${it.role}] [imp:${it.importance}] ${it.content}`)
      .join("\n");
  });

  toolbox.registerTool(
    "SaveMemory",
    "保存记忆，输入格式: role|importance|content",
    async (input: string) => {
      const parts = input.split("|");
      if (parts.length < 3) {
        return "格式错误，应为 role|importance|content";
      }

      const roleRaw = parts[0].trim();
      const role = roleRaw === "assistant" || roleRaw === "system" ? roleRaw : "user";
      const importance = Number(parts[1]);
      const content = parts.slice(2).join("|").trim();
      if (!content) return "content 不能为空";

      await memory.record(role, content, Number.isFinite(importance) ? importance : 3);
      return "已保存";
    }
  );
}

