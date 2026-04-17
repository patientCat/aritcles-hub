import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatMessage, LLMClient } from "../src/react/core";
import { summarizeLongTermCandidates } from "../src/react/long_memory_summary";

class FakeLLM implements LLMClient {
  constructor(private readonly output: string) {}

  async complete(
    _messages: ChatMessage[],
    _options?: {
      onToken?: (token: string) => void;
    }
  ): Promise<string> {
    return this.output;
  }
}

test("summarizeLongTermCandidates should parse JSON candidates", async () => {
  const llm = new FakeLLM(
    JSON.stringify([
      { importance: 5, content: "用户偏好中文交流" },
      { importance: 4, content: "用户目标是P7 offer" },
    ])
  );

  const results = await summarizeLongTermCandidates(llm, [
    { user: "我偏好中文交流", assistant: "收到" },
    { user: "我目标是P7", assistant: "记住了" },
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[0].importance, 5);
  assert.equal(results[0].content, "用户偏好中文交流");
});

