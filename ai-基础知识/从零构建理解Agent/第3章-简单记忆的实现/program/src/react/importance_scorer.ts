import { ChatMessage, LLMClient } from "./core";

export async function scoreImportanceWithLLM(
  llm: LLMClient,
  role: "user" | "assistant" | "system",
  content: string
): Promise<number> {
  const text = content.trim();
  if (!text) return role === "assistant" ? 2 : 3;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是记忆重要度评分器。请只输出一个 1 到 5 的整数。5 表示高价值长期记忆（偏好、目标、约束、重要日程、稳定事实）。",
    },
    {
      role: "user",
      content: `role=${role}\ncontent=${text}\n请输出 1-5 分，不要输出其他内容。`,
    },
  ];

  try {
    const raw = await llm.complete(messages);
    const matched = raw.match(/[1-5]/);
    if (!matched) return fallbackImportance(role, text);
    return Number(matched[0]);
  } catch {
    return fallbackImportance(role, text);
  }
}

function fallbackImportance(role: "user" | "assistant" | "system", content: string): number {
  const t = content.toLowerCase();
  if (role === "system") return 5;
  if (
    /偏好|目标|计划|约束|提醒|面试|deadline|必须|不可以|时间|日期|喜欢|不喜欢/.test(t)
  ) {
    return 4;
  }
  if (role === "assistant") return 2;
  return 3;
}

