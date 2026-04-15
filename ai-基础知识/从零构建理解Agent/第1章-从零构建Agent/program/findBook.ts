import "dotenv/config";
import OpenAI from "openai";
import { search } from "./utils/search.ts";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ToolFn = (input: string) => Promise<string>;

type ParseOutputResult = {
  thought: string | null;
  action: string | null;
};

class LLMAgent {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string = "deepseek-chat"
  ) {}

  async think(messages: Message[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
    });

    let fullContent = "";
    for await (const chunk of response) {
      fullContent += chunk.choices[0]?.delta?.content ?? "";
    }

    return fullContent.trim();
  }
}

class ToolBox {
  private readonly tools = new Map<string, { description: string; fn: ToolFn }>();

  registerTool(name: string, description: string, fn: ToolFn): void {
    this.tools.set(name, { description, fn });
  }

  getTool(name: string): ToolFn | undefined {
    return this.tools.get(name)?.fn;
  }

  getAvailableTools(): string {
    return [...this.tools.entries()]
      .map(([name, meta]) => `- ${name}: ${meta.description}`)
      .join("\n");
  }
}

class ReActAgent {
  private readonly history: string[] = [];

  constructor(
    private readonly llmAgent: LLMAgent,
    private readonly toolBox: ToolBox,
    private readonly maxSteps: number = 5
  ) {}

  private parseOutput(text: string): ParseOutputResult {
    const thoughtMatch = text.match(/Thought:\s*(.*?)(?=\nAction:|\nFinish:|$)/s);
    const actionMatch = text.match(/Action:\s*(.*?)$/s);
    const finishMatch = text.match(/Finish:\s*(.*?)$/s);

    if (finishMatch) {
      return {
        thought: thoughtMatch ? thoughtMatch[1].trim() : null,
        action: `Finish[${finishMatch[1].trim()}]`,
      };
    }

    return {
      thought: thoughtMatch ? thoughtMatch[1].trim() : null,
      action: actionMatch ? actionMatch[1].trim() : null,
    };
  }

  private parseAction(actionText: string): { toolName: string | null; toolInput: string } {
    const match = actionText.match(/^(\w+)\[(.*)\]$/s);
    if (!match) {
      return { toolName: null, toolInput: "" };
    }

    return {
      toolName: match[1],
      toolInput: match[2].trim(),
    };
  }

  private buildPrompt(question: string): string {
    return REACT_PROMPT_TEMPLATE.replace("{tools}", this.toolBox.getAvailableTools())
      .replace("{question}", question)
      .replace("{history}", this.history.join("\n"));
  }

  async run(question: string): Promise<string | null> {
    this.history.length = 0;

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const prompt = this.buildPrompt(question);
      const responseText = await this.llmAgent.think([{ role: "user", content: prompt }]);

      if (!responseText) {
        console.log("错误: LLM 未返回有效响应。");
        return null;
      }

      console.log(`\n[Step ${step}] 模型输出:\n${responseText}`);

      const { thought, action } = this.parseOutput(responseText);
      if (thought) {
        this.history.push(`Thought: ${thought}`);
      }

      if (!action) {
        this.history.push("Observation: 未解析到 Action，继续下一轮。\n");
        continue;
      }

      const { toolName, toolInput } = this.parseAction(action);
      if (!toolName) {
        this.history.push(`Observation: Action 格式错误 -> ${action}\n`);
        continue;
      }

      if (toolName === "Finish") {
        return toolInput;
      }

      const tool = this.toolBox.getTool(toolName);
      if (!tool) {
        this.history.push(`Action: ${action}`);
        this.history.push(`Observation: 未找到工具 ${toolName}\n`);
        continue;
      }

      const observation = await tool(toolInput);
      this.history.push(`Action: ${action}`);
      this.history.push(`Observation: ${observation}\n`);
      console.log(`[Step ${step}] 工具 ${toolName} 结果:\n${observation}`);
    }

    return null;
  }
}

const REACT_PROMPT_TEMPLATE = `你是一个会调用工具的智能助手。

可用工具:
{tools}

请严格使用以下格式输出:
Thought: 你的思考
Action: 工具名[工具输入] 或 Finish[最终答案]

请开始回答:
Question: {question}
History: {history}`;

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY，请先配置 chapter1/.env");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });

  const llmAgent = new LLMAgent(client);
  const toolBox = new ToolBox();

  toolBox.registerTool("Search", "网页搜索，返回简要结果", search);

  const reactAgent = new ReActAgent(llmAgent, toolBox, 5);
  const question = process.argv.slice(2).join(" ") || "寻找《哥达纲领批判》这本书的下载链接";

  const finalAnswer = await reactAgent.run(question);
  if (finalAnswer) {
    console.log(`\n最终答案:\n${finalAnswer}`);
    return;
  }

  console.log("\n未在最大步数内得到最终答案。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
