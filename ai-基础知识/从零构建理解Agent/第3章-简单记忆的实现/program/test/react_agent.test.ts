import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryStorage, MemoryModule } from "../src/memory/module";
import { ChatMessage, LLMClient, ReActAgent, ToolBox } from "../src/react/core";
import { registerMemoryTools } from "../src/react/memory_tools";

class FakeLLM implements LLMClient {
  private index = 0;

  constructor(private readonly outputs: string[]) {}

  async complete(
    _messages: ChatMessage[],
    _options?: {
      onToken?: (token: string) => void;
    }
  ): Promise<string> {
    const val = this.outputs[this.index] ?? this.outputs[this.outputs.length - 1] ?? "";
    this.index += 1;
    return val;
  }
}

let oldCwd = "";
let tmpDir = "";

beforeEach(() => {
  oldCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "react-agent-test-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(oldCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("ReActAgent should call memory tools and finish", async () => {
  const memory = new MemoryModule(new InMemoryStorage(), {
    shortMaxItems: 20,
    longMaxItems: 20,
    summaryEvery: 20,
  });
  memory.init();

  const toolbox = new ToolBox();
  registerMemoryTools(toolbox, memory);

  const llm = new FakeLLM([
    "Thought: 先保存偏好\nAction: SaveMemory[user|5|用户偏好中文交流]",
    "Thought: 回忆一下\nAction: MemoryRecall[偏好]",
    "Thought: 信息足够\nFinish: 已完成记忆读取",
  ]);
  const agent = new ReActAgent(llm, toolbox, 5);

  const answer = await agent.run("记住我的偏好");
  assert.equal(answer, "已完成记忆读取");

  const recalled = memory.search("偏好");
  assert.ok(recalled.length > 0);
});

test("ReActAgent should return null when no finish within max steps", async () => {
  const memory = new MemoryModule(new InMemoryStorage());
  memory.init();

  const toolbox = new ToolBox();
  registerMemoryTools(toolbox, memory);

  const llm = new FakeLLM([
    "Thought: 先试试\nAction: UnknownTool[abc]",
    "Thought: 再试试\nAction: UnknownTool[def]",
  ]);
  const agent = new ReActAgent(llm, toolbox, 2);
  const answer = await agent.run("测试");

  assert.equal(answer, null);
});
