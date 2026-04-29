import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolBox } from "../src/react/core";
import { registerEnvTools } from "../src/react/env_tools";

test("NowTime should return formatted time", async () => {
  const toolbox = new ToolBox();
  registerEnvTools(toolbox);

  const fn = toolbox.getTool("NowTime");
  assert.ok(fn);
  const output = await fn!("Asia/Shanghai");
  assert.match(output, /Asia\/Shanghai/);
});

test("ReadFile should respect allowed root", async () => {
  const oldCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "env-tools-"));
  process.chdir(tmp);

  const allowDir = path.join(tmp, "allowed");
  const blockDir = path.join(tmp, "blocked");
  fs.mkdirSync(allowDir, { recursive: true });
  fs.mkdirSync(blockDir, { recursive: true });

  fs.writeFileSync(path.join(allowDir, "a.txt"), "hello", "utf-8");
  fs.writeFileSync(path.join(blockDir, "b.txt"), "secret", "utf-8");

  try {
    const toolbox = new ToolBox();
    registerEnvTools(toolbox, { allowedReadRoots: [allowDir] });
    const readFile = toolbox.getTool("ReadFile");
    assert.ok(readFile);

    const ok = await readFile!("allowed/a.txt");
    assert.equal(ok, "hello");

    const blocked = await readFile!("blocked/b.txt");
    assert.match(blocked, /路径不在允许范围内/);
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

