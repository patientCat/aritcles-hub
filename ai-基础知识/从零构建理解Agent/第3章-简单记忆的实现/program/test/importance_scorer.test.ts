import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatMessage, LLMClient } from "../src/react/core";
import { scoreImportanceWithLLM } from "../src/react/importance_scorer";

class FakeLLM implements LLMClient {
  constructor(private readonly output: string, private readonly throwErr = false) {}

  async complete(
    _messages: ChatMessage[],
    _options?: {
      onToken?: (token: string) => void;
    }
  ): Promise<string> {
    if (this.throwErr) throw new Error("llm error");
    return this.output;
  }
}

test("scoreImportanceWithLLM should parse numeric score", async () => {
  const llm = new FakeLLM("4");
  const score = await scoreImportanceWithLLM(llm, "user", "我下周有面试");
  assert.equal(score, 4);
});

test("scoreImportanceWithLLM should fallback when llm output invalid", async () => {
  const llm = new FakeLLM("not-a-number");
  const score = await scoreImportanceWithLLM(llm, "user", "我的长期目标是P7");
  assert.equal(score, 4);
});

