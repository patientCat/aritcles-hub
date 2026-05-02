# Tutorial-06：会话级计划管理器（PlanningState + Task 工具）

这一章目标：把“当前要做什么”从模型脑内拿出来，变成主循环可观察状态。

关键边界：

1. 只服务当前会话（`/new` 后重置）
2. 不做跨会话持久化
3. 用最小 `Task` 单工具管理计划
4. 增加 reminder 机制（每 3 轮检查一次）

---

## 1. 为什么要做 PlanningState

只有 `messages` 时，模型的执行意图是隐式的，不稳定也不可观测。  
加 `PlanningState` 后：

1. 计划结构可见（goal/items/status）
2. 每步状态可追踪（pending/in_progress/done/failed）
3. 主循环可主动提醒（reminder）

---

## 2. MVP 数据结构

```ts
type PlanStatus = "pending" | "in_progress" | "done" | "failed";

type PlanningItem = {
  id: string;
  title: string;
  status: PlanStatus;
  notes?: string;
  updatedAt: string;
};

type PlanningState = {
  id: string;
  goal: string;
  items: PlanningItem[];
  currentItemId?: string;
  updatedAt: string;
};
```

---

## 3. Task 单工具设计（会话内）

`Task` 一个工具，三种 action：

1. `create`
- 输入：`goal`, `items[]`
- 输出：计划快照

2. `list`
- 输入：无
- 输出：当前计划快照

3. `update`
- 输入：`itemId`, `status`, `notes?`
- 输出：更新后计划快照

状态约束（最小）：

1. 同一时刻仅允许一个 `in_progress`
2. `update` 后同步刷新 `currentItemId`

---

## 4. Reminder 机制（每 3 轮）

固定规则：

- `REMINDER_EVERY_TURNS = 3`
- 每轮请求 `turnCount += 1`
- 当 `turnCount % 3 === 0` 时执行 `checkReminder()`

提醒策略（MVP）：

1. 若存在 `in_progress`：提醒“优先推进或更新状态”
2. 否则若存在 `pending`：提醒“推进下一步任务”

提醒注入方式：

- 作为一段结构化文本拼到本轮输入上下文

---

## 5. 主循环职责升级

本章后主循环不只维护 `messages`，还维护：

1. `planningState`
2. `turnCount`
3. `reminder 注入`

并在 `/new` 时重置：

1. `session_id`
2. `planningState`
3. `turnCount`

---

## 6. 可观测性

`Task` 调用要写入 `business.ndjson`：

1. `tool.start`
2. `tool.success`
3. `tool.error`

并带：

- `session_id`
- `req_id`

---

## 7. 验收标准

1. 用户要求“先制定计划”时，Agent 能调用 `Task.create`
2. 执行中能调用 `Task.update` 推进状态
3. 每 3 轮会出现 reminder 提示（命中条件时）
4. `/new` 后计划状态清空

