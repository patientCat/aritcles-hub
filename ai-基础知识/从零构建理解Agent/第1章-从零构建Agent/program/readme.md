一个现代的智能体，其核心能力在于能将大语言模型的推理能力与外部世界联通。它能够自主地理解用户意图、拆解复杂任务，并通过调用代码解释器、搜索引擎、API等一系列“工具”，来获取信息、执行操作，最终达成目标

1. 大模型只具有推理能力。 无法和环境交互。
2. agent的目的就是提供工具能力和环境交互能力。 
即比如 计算机的2大核心能力， 计算和存储
存储（本地资源和网络资源）
计算

> 大模型本身具有的能力叫推理能力。 不是计算能力。 他可以算简单数学。 但是比如精确计算、大规模处理， 他算不准。 但是可以提供给他可靠工具来算。 而对于大模型来说做这个可靠工具的思路是他擅长的。 比如说 计算保险分红。 大模型可能给你算错。 但是agent可以帮你写一个python脚本。 来帮你计算。


ReAct (Reasoning and Acting)： 一种将“思考”和“行动”紧密结合的范式，让智能体边想边做，动态调整。
Plan-and-Solve： 一种“三思而后行”的范式，智能体首先生成一个完整的行动计划，然后严格执行。
Reflection： 一种赋予智能体“反思”能力的范式，通过自我批判和修正来优化结果。

这里应该是3种构建agent的范式。 

process 是nodejs提供的能力， 如何理解？

┌─────────────────────────────────────┐
│         Node.js 运行时              │
│  ┌───────────────────────────────┐  │
│  │  JavaScript 引擎   │  │
│  │  - 解析执行JS代码              │  │
│  │  - V8引擎（Chrome同款）        │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  Node.js API（服务器能力）     │  │
│  │  - process（进程管理）         │  │
│  │  - fs（文件系统）              │  │
│  │  - http（网络服务）            │  │
│  │  - path（路径处理）            │  │
│  │  - crypto（加密）              │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
              ↓
        操作系统

这确实很方便。


nodejs 记住const 和 let就好

```js
// 1. const - 常量（不能重新赋值）
const API_KEY = "sk-xxx";
API_KEY = "new-key";  // ❌ 错误：不能修改

// 2. let - 变量（可以重新赋值）
let count = 1;
count = 2;  // ✅ 允许修改

```

## async语法糖
```js
// 方式1：async
async function add(a, b) {
  return a + b;
}

// 方式2：手动返回 Promise
function add(a, b) {
  return Promise.resolve(a + b);
}
```


```js
nodejs 的流式输出特别方便
for await (const chunk of response)
```

```python
from openai import OpenAI

client = OpenAI()

# 流式输出
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "你好"}],
    stream=True
)

# Python 用 for 循环迭代
for chunk in stream:
    content = chunk.choices[0].delta.content
    if content:
        print(content, end="", flush=True)  # end="" 防止换行，flush=True 立即输出

print()  # 最后换行
```