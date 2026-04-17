export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ToolFn = (input: string) => Promise<string>;

export interface LLMClient {
  complete(
    messages: ChatMessage[],
    options?: {
      onToken?: (token: string) => void;
    }
  ): Promise<string>;
}

type ParseOutputResult = {
  thought: string | null;
  action: string | null;
};

export class ToolBox {
  private readonly tools = new Map<string, { description: string; fn: ToolFn }>();

  registerTool(name: string, description: string, fn: ToolFn): void {
    this.tools.set(name, { description, fn });
  }

  getTool(name: string): ToolFn | undefined {
    return this.tools.get(name)?.fn;
  }

  listToolsPrompt(): string {
    return [...this.tools.entries()]
      .map(([name, meta]) => `- ${name}: ${meta.description}`)
      .join("\n");
  }
}

export class ReActAgent {
  private readonly history: string[] = [];

  constructor(
    private readonly llm: LLMClient,
    private readonly toolbox: ToolBox,
    private readonly maxSteps = 5
  ) {}

  async run(question: string, shortMemoryContext = ""): Promise<string | null> {
    this.history.length = 0;

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const prompt = this.buildPrompt(question, shortMemoryContext);
      let startedStreaming = false;
      const responseText = await this.llm.complete([{ role: "user", content: prompt }], {
        onToken: (token) => {
          if (!startedStreaming) {
            process.stdout.write(`\n[Step ${step}] 模型输出:\n`);
            startedStreaming = true;
          }
          process.stdout.write(token);
        },
      });
      if (startedStreaming) process.stdout.write("\n");
      const { thought, action } = this.parseOutput(responseText);

      if (thought) this.history.push(`Thought: ${thought}`);
      if (!action) {
        this.history.push("Observation: 未解析到 Action，继续下一轮。\n");
        continue;
      }

      const { toolName, toolInput } = this.parseAction(action);
      if (!toolName) {
        this.history.push(`Observation: Action 格式错误 -> ${action}\n`);
        continue;
      }

      if (toolName === "Finish") return toolInput;

      const tool = this.toolbox.getTool(toolName);
      if (!tool) {
        this.history.push(`Action: ${action}`);
        this.history.push(`Observation: 未找到工具 ${toolName}\n`);
        continue;
      }

      const observation = await tool(toolInput);
      this.history.push(`Action: ${action}`);
      this.history.push(`Observation: ${observation}\n`);
    }

    return null;
  }

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
    if (!match) return { toolName: null, toolInput: "" };
    return { toolName: match[1], toolInput: match[2].trim() };
  }

  private buildPrompt(question: string, shortMemoryContext: string): string {
    return REACT_PROMPT_TEMPLATE.replace("{tools}", this.toolbox.listToolsPrompt())
      .replace("{question}", question)
      .replace("{short_memory}", shortMemoryContext || "(暂无)")
      .replace("{history}", this.history.join("\n"));
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
ShortMemory: {short_memory}
History: {history}`;
