import { ChatMessage, LLMClient } from "./core";

export type DialogueTurn = {
  user: string;
  assistant: string;
};

export type LongMemoryCandidate = {
  importance: number;
  content: string;
};

export async function summarizeLongTermCandidates(
  llm: LLMClient,
  turns: DialogueTurn[]
): Promise<LongMemoryCandidate[]> {
  if (turns.length === 0) return [];

  const transcript = turns
    .map(
      (t, i) =>
        `Round ${i + 1}\nUser: ${t.user}\nAssistant: ${t.assistant || "(无回答)"}`
    )
    .join("\n\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是长期记忆提取器。只提取值得长期保留的信息：用户偏好、长期目标、约束、重要日程、稳定事实。输出必须是 JSON 数组。",
    },
    {
      role: "user",
      content: [
        "请从以下最近对话中提取长期记忆候选。",
        "要求:",
        "1) 返回 JSON 数组，每项格式: {\"importance\":1-5,\"content\":\"...\"}",
        "2) 不要编造，不要输出数组外文本",
        "3) 临时闲聊不要纳入",
        "",
        transcript,
      ].join("\n"),
    },
  ];

  try {
    const raw = await llm.complete(messages);
    const parsed = safeParseJSONArray(raw);
    return parsed
      .map((x) => ({
        importance: clampImportance(Number((x as { importance?: unknown }).importance)),
        content: String((x as { content?: unknown }).content ?? "").trim(),
      }))
      .filter((x) => x.content.length > 0);
  } catch {
    return [];
  }
}

function safeParseJSONArray(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const v = JSON.parse(trimmed) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const v = JSON.parse(match[0]) as unknown;
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
}

function clampImportance(v: number): number {
  if (!Number.isFinite(v)) return 4;
  return Math.min(5, Math.max(1, Math.round(v)));
}

