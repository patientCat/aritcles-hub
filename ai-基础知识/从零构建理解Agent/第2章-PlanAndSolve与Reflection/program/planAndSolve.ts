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

type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

type TaskState = {
  id: number;
  task: string;
  status: TaskStatus;
  result: string;
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

class Planner {
  private readonly PLANNER_PROMPT_TEMPLATE = `你是一个顶级的 AI 规划专家。
你的任务是把用户问题拆成有序、独立、可执行的子任务。

问题: {question}

要求:
1. 每个步骤必须是单一可执行动作。
2. 必须按逻辑顺序排列。
3. 不要输出解释性文本。

请严格按以下格式输出（必须带 \`\`\`javascript 包裹）:
\`\`\`javascript
["步骤1", "步骤2", "步骤3"]
\`\`\``;

  constructor(private readonly llmAgent: LLMAgent) {}

  private buildPrompt(question: string): string {
    return this.PLANNER_PROMPT_TEMPLATE.replace("{question}", question);
  }

  private parsePlan(planText: string): string[] {
    const codeBlockMatch = planText.match(/```(?:javascript|js|json)?\s*([\s\S]*?)```/i);
    const source = (codeBlockMatch ? codeBlockMatch[1] : planText).trim();
    const arrayMatch = source.match(/\[[\s\S]*\]/);

    if (arrayMatch) {
      const candidates = [arrayMatch[0], arrayMatch[0].replace(/'/g, '"')];
      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item).trim()).filter(Boolean);
          }
        } catch {
          // ignore parse failure and try fallback
        }
      }
    }

    return source
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
      .filter(Boolean);
  }

  async plan(question: string): Promise<TaskState[]> {
    const plannerPrompt = this.buildPrompt(question);
    const plannerResponse = await this.llmAgent.think([{ role: "user", content: plannerPrompt }]);

    if (!plannerResponse) {
      return [];
    }

    const planItems = this.parsePlan(plannerResponse);
    const seen = new Set<string>();
    const tasks: TaskState[] = [];

    for (const item of planItems) {
      const taskText = item.trim();
      if (!taskText) {
        continue;
      }

      if (seen.has(taskText)) {
        tasks.push({
          id: tasks.length + 1,
          task: taskText,
          status: "skipped",
          result: "重复任务，已跳过",
        });
        continue;
      }

      seen.add(taskText);
      tasks.push({
        id: tasks.length + 1,
        task: taskText,
        status: "pending",
        result: "",
      });
    }

    return tasks;
  }
}

class Executor {
  private readonly EXECUTOR_PROMPT_TEMPLATE = `你是一个任务执行器，只负责执行当前子任务。

原始问题: {question}
当前子任务: {task}
可用工具:
{tools}

当前子任务历史:
{history}

规则:
1. 只能输出以下两种格式之一:
Thought: 你的思考
Action: 工具名[工具输入]

或

Thought: 你的思考
Finish: 当前子任务执行结果
2. 如果子任务已可结束，直接用 Finish 输出结果。
3. 不要重复执行已经完成的子任务。`;

  constructor(
    private readonly llmAgent: LLMAgent,
    private readonly toolBox: ToolBox,
    private readonly maxSteps: number = 5
  ) {}

  private buildPrompt(question: string, task: TaskState, history: string[]): string {
    return this.EXECUTOR_PROMPT_TEMPLATE.replace("{question}", question)
      .replace("{task}", task.task)
      .replace("{tools}", this.toolBox.getAvailableTools())
      .replace("{history}", history.join("\n") || "(暂无历史)");
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
    if (!match) {
      return { toolName: null, toolInput: "" };
    }

    return {
      toolName: match[1],
      toolInput: match[2].trim(),
    };
  }

  async execute(question: string, task: TaskState): Promise<void> {
    if (task.status === "completed" || task.status === "skipped") {
      return;
    }

    task.status = "running";
    const history: string[] = [];

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const prompt = this.buildPrompt(question, task, history);
      const responseText = await this.llmAgent.think([{ role: "user", content: prompt }]);

      if (!responseText) {
        history.push("Observation: LLM 未返回有效响应");
        continue;
      }

      console.log(`\n[Task ${task.id} | Step ${step}] 模型输出:\n${responseText}`);

      const { thought, action } = this.parseOutput(responseText);
      if (thought) {
        history.push(`Thought: ${thought}`);
      }

      if (!action) {
        history.push("Observation: 未解析到 Action，继续下一轮。\n");
        continue;
      }

      const { toolName, toolInput } = this.parseAction(action);
      if (!toolName) {
        history.push(`Observation: Action 格式错误 -> ${action}\n`);
        continue;
      }

      if (toolName === "Finish") {
        task.status = "completed";
        task.result = toolInput;
        return;
      }

      const tool = this.toolBox.getTool(toolName);
      if (!tool) {
        history.push(`Action: ${action}`);
        history.push(`Observation: 未找到工具 ${toolName}\n`);
        continue;
      }

      const observation = await tool(toolInput);
      history.push(`Action: ${action}`);
      history.push(`Observation: ${observation}\n`);
      console.log(`[Task ${task.id} | Step ${step}] 工具 ${toolName} 结果:\n${observation}`);
    }

    task.status = "failed";
    task.result = "超过最大执行步数，未完成该子任务";
  }
}

class PlanAndSolveAgent {
  private readonly FINAL_PROMPT_TEMPLATE = `你是最终答案整合器。

原始问题: {question}

任务执行状态:
{taskStates}

请基于已完成任务，直接给出最终答案。`;

  private readonly taskStates: TaskState[] = [];
  private readonly planner: Planner;
  private readonly executor: Executor;

  constructor(
    private readonly llmAgent: LLMAgent,
    private readonly toolBox: ToolBox,
    private readonly maxSteps: number = 5
  ) {
    this.planner = new Planner(this.llmAgent);
    this.executor = new Executor(this.llmAgent, this.toolBox, this.maxSteps);
  }

  private buildFinalPrompt(question: string): string {
    const taskStates = this.taskStates
      .map((task) => `- #${task.id} [${task.status}] ${task.task} => ${task.result || "无结果"}`)
      .join("\n");

    return this.FINAL_PROMPT_TEMPLATE.replace("{question}", question).replace(
      "{taskStates}",
      taskStates || "(无任务状态)"
    );
  }

  async run(question: string): Promise<string | null> {
    this.taskStates.length = 0;

    const plannedTasks = await this.planner.plan(question);
    if (plannedTasks.length === 0) {
      console.log("错误: Planner 未生成有效任务列表。");
      return null;
    }

    this.taskStates.push(...plannedTasks);

    for (const task of this.taskStates) {
      if (task.status !== "pending") {
        continue;
      }

      await this.executor.execute(question, task);
    }

    const finalPrompt = this.buildFinalPrompt(question);
    const finalAnswer = await this.llmAgent.think([{ role: "user", content: finalPrompt }]);
    if (finalAnswer) {
      return finalAnswer;
    }

    const completedSummary = this.taskStates
      .filter((task) => task.status === "completed")
      .map((task) => `- ${task.task}: ${task.result}`)
      .join("\n");

    return completedSummary || null;
  }
}

class ReActAgent {
  private REACT_PROMPT_TEMPLATE = `你是一个会调用工具的智能助手。
可用工具:
{tools}

请严格使用以下格式输出:
Thought: 你的思考
Action: 工具名[工具输入] 或 Finish[最终答案]

请开始回答:
Question: {question}
History: {history}`;
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
    return this.REACT_PROMPT_TEMPLATE.replace("{tools}", this.toolBox.getAvailableTools())
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

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY，请先配置 chapter2/.env");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });

  const llmAgent = new LLMAgent(client);
  const toolBox = new ToolBox();

  toolBox.registerTool("Search", "网页搜索，返回简要结果", search);

  const planAndSolveAgent = new PlanAndSolveAgent(llmAgent, toolBox, 5);
  const question =
    process.argv.slice(2).join(" ") ||
    "请查询并汇总中国西北五省（陕西、甘肃、青海、宁夏、新疆）省会/首府城市（西安、兰州、西宁、银川、乌鲁木齐）今天的天气，并分别给出气温范围、天气现象与出行建议。";

  const finalAnswer = await planAndSolveAgent.run(question);
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
