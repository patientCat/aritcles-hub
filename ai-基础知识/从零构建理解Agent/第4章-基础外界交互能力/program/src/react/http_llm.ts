import { ChatMessage, LLMClient } from "./core";

export class HttpCompatibleLLM implements LLMClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  async complete(
    messages: ChatMessage[],
    options?: {
      onToken?: (token: string) => void;
    }
  ): Promise<string> {
    const resp = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        stream: true,
        messages,
      }),
    });

    if (!resp.ok) {
      throw new Error(`llm request failed: ${resp.status}`);
    }

    const body = resp.body;
    if (!body) {
      const json = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const fallback = json.choices?.[0]?.message?.content?.trim() ?? "";
      if (fallback && options?.onToken) options.onToken(fallback);
      return fallback;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let lineEnd = buffer.indexOf("\n");
      while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        lineEnd = buffer.indexOf("\n");

        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const token = chunk.choices?.[0]?.delta?.content ?? "";
          if (!token) continue;
          fullContent += token;
          options?.onToken?.(token);
        } catch {
          // ignore malformed chunks
        }
      }
    }

    return fullContent.trim();
  }
}
