import "dotenv/config";
import OpenAI from "openai";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ReflectionFeedback = {
  reflection: string;
  optimizedPrompt: string;
};

type RoundState = {
  round: number;
  initialPrompt: string;
  draftTranslation: string;
  reflection: string;
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

class LRUTextMemory {
  private readonly storage = new Map<string, string>();

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error("LRU 容量必须大于 0");
    }
  }

  set(key: string, value: string): void {
    if (this.storage.has(key)) {
      this.storage.delete(key);
    }

    this.storage.set(key, value);

    if (this.storage.size > this.capacity) {
      const oldestKey = this.storage.keys().next().value;
      if (oldestKey) {
        this.storage.delete(oldestKey);
      }
    }
  }

  get(key: string): string | undefined {
    const value = this.storage.get(key);
    if (value === undefined) {
      return undefined;
    }

    this.storage.delete(key);
    this.storage.set(key, value);
    return value;
  }

  snapshotRecent(limit = this.capacity): string {
    const entries = [...this.storage.entries()];
    const recent = entries.slice(-limit).reverse();

    if (recent.length === 0) {
      return "(暂无记忆)";
    }

    return recent
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
  }
}

class ReflectionTranslatorAgent {
  private readonly INITIAL_PROMPT_TEMPLATE = `把下面中文翻译成英文。
要求：忠实原意，语言自然。
只输出译文。

近期记忆：
{memory}

文本：
{source}`;

  private readonly REFLECTION_PROMPT_TEMPLATE = `你是一位翻译反思专家。
你会评估当前译文，并优化下一轮的“初始提示词”。

【原始中文】
{source}

【本轮译文】
{draft}

【当前初始提示词】
{initialPrompt}

【近期记忆（最近内容优先）】
{memory}

请基于以下指标打分（1-10）：
- consistency（一致性）：整首译文风格、语气、术语是否统一。
- accuracy（准确性）：是否忠实传达原文语义与逻辑关系。
- fluency（流畅性）：英文是否自然、可读、语法通顺。
- cultural_adaptation（文化适应性）：典故/意象是否便于英文读者理解且不过度失真。

请输出 JSON（必须可解析）：
{
  "scores": {
    "consistency": 0,
    "accuracy": 0,
    "fluency": 0,
    "cultural_adaptation": 0
  },
  "reflection": "先简要说明各指标表现，再给出可执行改进方向",
  "optimizedPrompt": "给下一轮使用的完整初始提示词"
}`;

  constructor(
    private readonly llmAgent: LLMAgent,
    private readonly memory: LRUTextMemory,
    private readonly totalRounds: number = 3
  ) {}

  private buildInitialPrompt(sourceText: string, activePrompt: string): string {
    return activePrompt
      .replace("{source}", sourceText)
      .replace("{memory}", this.memory.snapshotRecent());
  }

  private buildReflectionPrompt(
    sourceText: string,
    draftTranslation: string,
    currentInitialPrompt: string
  ): string {
    return this.REFLECTION_PROMPT_TEMPLATE.replace("{source}", sourceText)
      .replace("{draft}", draftTranslation)
      .replace("{initialPrompt}", currentInitialPrompt)
      .replace("{memory}", this.memory.snapshotRecent());
  }

  private parseReflection(output: string): ReflectionFeedback {
    const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = (codeBlockMatch ? codeBlockMatch[1] : output).trim();

    try {
      const parsed = JSON.parse(raw) as Partial<ReflectionFeedback>;
      return {
        reflection: String(parsed.reflection ?? "未提供反思").trim(),
        optimizedPrompt: String(parsed.optimizedPrompt ?? "").trim(),
      };
    } catch {
      const reflection = output.match(/reflection\s*[:：]\s*([\s\S]*?)(?=optimizedPrompt\s*[:：]|$)/i)?.[1];
      const optimizedPrompt = output.match(/optimizedPrompt\s*[:：]\s*([\s\S]*)$/i)?.[1];

      return {
        reflection: (reflection ?? "未提供反思").trim(),
        optimizedPrompt: (optimizedPrompt ?? "").trim(),
      };
    }
  }

  async run(sourceText: string): Promise<{ finalTranslation: string; rounds: RoundState[] }> {
    const rounds: RoundState[] = [];
    let activeInitialPrompt = this.INITIAL_PROMPT_TEMPLATE;
    let latestTranslation = "";

    for (let round = 1; round <= this.totalRounds; round += 1) {
      const initialPrompt = this.buildInitialPrompt(sourceText, activeInitialPrompt);
      const draftTranslation = await this.llmAgent.think([{ role: "user", content: initialPrompt }]);

      latestTranslation = draftTranslation;
      this.memory.set(`round${round}-draft`, draftTranslation || "(空输出)");

      let reflectionText = "最后一轮无需继续反思。";

      if (round < this.totalRounds) {
        const reflectionPrompt = this.buildReflectionPrompt(
          sourceText,
          draftTranslation,
          activeInitialPrompt
        );
        const reflectionOutput = await this.llmAgent.think([{ role: "user", content: reflectionPrompt }]);
        const feedback = this.parseReflection(reflectionOutput);

        reflectionText = feedback.reflection;
        this.memory.set(`round${round}-reflection`, feedback.reflection || "(无反思)");

        if (feedback.optimizedPrompt) {
          activeInitialPrompt = feedback.optimizedPrompt;
          this.memory.set(`round${round}-optimizedPrompt`, feedback.optimizedPrompt);
        }
      }

      rounds.push({
        round,
        initialPrompt,
        draftTranslation,
        reflection: reflectionText,
      });
    }

    return {
      finalTranslation: latestTranslation,
      rounds,
    };
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY，请先配置 .env");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });

  const poem =
    process.argv.slice(2).join(" ") ||
    `神龟虽寿，犹有竟时。腾蛇乘雾，终为土灰。老骥伏枥，志在千里。烈士暮年，壮心不已。盈缩之期，不但在天。养怡之福，可得永年。幸甚至哉，歌以咏志。`;

  const llmAgent = new LLMAgent(client);
  const memory = new LRUTextMemory(6);
  const reflectionAgent = new ReflectionTranslatorAgent(llmAgent, memory, 3);

  const result = await reflectionAgent.run(poem);

  for (const round of result.rounds) {
    console.log(`\n========== Round ${round.round} ==========`);
    console.log(`\n[Draft Translation]\n${round.draftTranslation}`);
    console.log(`\n[Reflection]\n${round.reflection}`);
  }

  console.log(`\n========== Final Translation ==========`);
  console.log(result.finalTranslation);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
