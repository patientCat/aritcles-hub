import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryStorage, MemoryModule } from "../src/memory/module";

let oldCwd = "";
let tmpDir = "";

beforeEach(() => {
  oldCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-module-test-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(oldCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("MemoryModule should record and retrieve memory context", async () => {
  const module = new MemoryModule(new InMemoryStorage(), {
    shortMaxItems: 20,
    longMaxItems: 20,
    summaryEvery: 10,
  });
  module.init();

  await module.record("user", "我下周三有系统设计面试", 5);
  await module.record("assistant", "已记录面试时间", 3);
  await module.record("user", "我偏好中文交流", 4);

  const ctx = module.retrieveContext("面试");
  assert.ok(ctx.length > 0);
  assert.ok(ctx.some((x) => x.content.includes("面试")));

  const sem = await module.retrieveSemanticContext("系统设计准备", 3);
  assert.ok(sem.length > 0);
});

test("MemoryModule should create local vector_store.json", async () => {
  const module = new MemoryModule(new InMemoryStorage(), {
    shortMaxItems: 10,
    longMaxItems: 10,
    summaryEvery: 50,
  });
  module.init();
  await module.record("user", "向量索引写入测试", 5);

  const vectorPath = path.resolve(process.cwd(), "data", "vector_store.json");
  assert.equal(fs.existsSync(vectorPath), true);
  const arr = JSON.parse(fs.readFileSync(vectorPath, "utf-8"));
  assert.ok(Array.isArray(arr));
  assert.ok(arr.some((x: { content?: string }) => x.content === "向量索引写入测试"));
});

