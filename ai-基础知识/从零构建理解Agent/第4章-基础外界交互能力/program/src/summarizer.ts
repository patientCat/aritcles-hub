import { MemoryItem } from "./types";

export async function buildSummary(items: MemoryItem[]): Promise<string> {
  const ruleSummary = buildRuleSummary(items);
  if (items.length === 0) return ruleSummary;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return ruleSummary;

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const baseUrl =
    process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "") || "https://api.openai.com/v1";

  const lines = items
    .map((it) => `[${it.role}][imp:${it.importance}] ${it.content}`)
    .join("\n");

  const prompt = [
    "请将以下对话压缩为中文短摘要，要求:",
    "1) 只保留对后续任务有用的信息",
    "2) 不要编造",
    "3) 控制在80字以内",
    "",
    lines,
  ].join("\n");

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "你是严谨的记忆摘要器，只输出摘要正文，不输出解释。",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!resp.ok) return ruleSummary;
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return ruleSummary;
    return content.slice(0, 120);
  } catch {
    return ruleSummary;
  }
}

function buildRuleSummary(items: MemoryItem[]): string {
  if (items.length === 0) return "近期暂无可摘要内容。";

  const recentUser = items
    .filter((it) => it.role === "user")
    .slice(-3)
    .map((it) => it.content);

  const recentAssistant = items
    .filter((it) => it.role === "assistant")
    .slice(-2)
    .map((it) => it.content);

  const userPart =
    recentUser.length > 0 ? `用户近期关注：${recentUser.join("；")}。` : "";
  const assistantPart =
    recentAssistant.length > 0
      ? `助手近期回应：${recentAssistant.join("；")}。`
      : "";

  return `${userPart}${assistantPart}`.trim();
}
