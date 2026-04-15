# 唯物主义带你理解什么是Agent
## 导语
这个世界是唯物主义的世界。 只有少部分人具有高屋建瓴的能力。 对于绝大多数人来说， 他们无法想象他们没有见过， 触摸过的东西。所以对于很多东西来说， 很多人必须经历亲身的实践，感受，才能理解。 

我在和我的一个动手能力很差的朋友讲解什么是大模型，什么是Agent的时候。 他很难理解， 要么就是感觉懂了，但是我知道他还是一团混沌。 今天就从"真 * 唯物主义的视角" 带你理解大模型。 

这里涉及到一些工具的调用， 所以本篇适合有代码基础，但不多，动手能力差的人读。当然，我会适当解释。

## 什么是大模型
老实说，大模型在我的认知里，已经是类似动物园里的大象存在。 如果有人问我，大象是什么，我会告诉他大象长什么样， 或者画一个图给他。 但是大模型好像我画不出来。 那么继续按照我的思路， 如果我无法描述大象怎么办， 我会开车带他去看大象，摸大象。 那么对于大模型来说，也一样。

只不过今天的这个车是"curl" 命令。 是一个用来给服务器发送请求的工具。他就是我们用来感知互联网世界的双手。

### curl 发出的 HTTP 请求长这样

```http
POST https://api.deepseek.com/chat/completions HTTP/1.1
Host: api.deepseek.com
Content-Type: application/json
Authorization: Bearer ${DEEPSEEK_API_KEY}

{
  "model": "deepseek-chat",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false
}
```

这就是 curl 发出的原始 HTTP 请求。第一行是请求行（方法 + URL + 协议版本），接下来是请求头，空行之后是请求体（JSON 格式）。

你把这个和前端用 axios/fetch 发的请求对比，本质上是一模一样的——只是格式更原始，没有框架帮你封装。

动手实践的话，直接在终端跑这个命令就好：

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  -d '{
        "model": "deepseek-chat",
        "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Hello!"}
        ],
        "stream": false
      }'
```

> 原谅我的文字风格变啰嗦。。。
> https://api-docs.deepseek.com/zh-cn/

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/articles/20260326164240908.png)

在任意一个终端请求，就可以向大模型发送消息。现在我们知道，大模型是一个会和你说话的东西，而且他很有礼貌。

### 大模型和Agent的区别

很多人不理解大模型和Agent的区别。 

> 元宝： 大模型（如GPT-4、Llama等）是基于海量数据训练的大型神经网络，能进行文本生成、知识问答、翻译等通用任务，核心是模式识别与内容生成；而Agent（智能体）是能主动感知环境、规划目标、执行动作并持续学习的系统，大模型可作为其“大脑”，结合工具调用、记忆、规划等模块实现更复杂的任务。简单说：大模型是“聪明的工具”，Agent是“能主动用工具解决问题的人”。

这是元宝给的回答。 简单总结下来就是。
1. 大模型没有记忆。
2. 大模型没有工具。 


![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/articles/20260326164112593.png)
如何证明他没有记忆。 问他俩句，发现他没有记忆到我的名字。

大模型没有工具，这个可以交给大家自己来做测试一下。

## 什么是多模态？

> 元宝：多模态（Multimodal）是指AI系统能同时处理和融合多种类型的数据输入（如文本、图像、音频、视频、传感器数据等），并生成跨模态的输出或理解。

简单理解，就是除了文字以外，其它信息载体。

还是刚才的方法。 只不过这次模型换成了混元文生图。 

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/articles/Clipboard_Screenshot_1774515550.png)

这里有个前提， 就是要明白图片的数字本质是什么。

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/articles/20260326170128163.png)
这里通过在线的base64转码工具。 可以知道我们得到了一个图片。 


现在我们知道，奥，原来多模态就是模型明白了图片，音频等信息。 

## Agent + 模型
现在对于Agent， 你就明白了 Agent的本质就是一次封装。 他利用模型的聪明大脑。 自己提供了记忆和工具。 

注意，这里Agent 和模型并非一对一关系。 codebuddy就是一个agent。 这里是可以切换模型的。

### Agent-记忆

记忆很好理解，最简单的记忆就是直接写在一个memory.md，别嘲笑这种做法。 claude code，codebuddy等最先进的工具，往往即使采用这里最简单的做法。 

### Agent-工具

模型是怎样知道调用工具的呢？
这个前提是你给他了记忆。 他得知道自己可以调用工具。

这一步对于一些0代码基础的人来说，就比较复杂了。这是deepseek的一个示例 
> https://api-docs.deepseek.com/zh-cn/guides/tool_calls

提供了一个工具
```python
## OpenAI是一个Agent框架， 他可以帮你快速封装大模型，让你的Agent拥有记忆，工具能力。
from openai import OpenAI

def send_messages(messages):
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=messages,
        tools=tools
    )
    return response.choices[0].message

## 填入你的api key，理解为你的账号信息， 问你要钱的
client = OpenAI(
    api_key="<your api key>",
    base_url="https://api.deepseek.com",
)

## 提供工具
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather of a location, the user should supply a location first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city and state, e.g. San Francisco, CA",
                    }
                },
                "required": ["location"]
            },
        }
    },
]

messages = [{"role": "user", "content": "How's the weather in Hangzhou, Zhejiang?"}]
message = send_messages(messages)
print(f"User>\t {messages[0]['content']}")

tool = message.tool_calls[0]
messages.append(message)

## 注册工具，即告诉大模型他有这个工具了
messages.append({"role": "tool", "tool_call_id": tool.id, "content": "24℃"})
message = send_messages(messages)
print(f"Model>\t {message.content}")
```

## 结语

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/articles/agent_any_where.png)

到这里，你大概能模糊感觉大模型，或者Agent是个什么东西了。 其实到了后面，这些就会和我们日常生活的水，电一样。
人类在最开始无法看到电的时候。是如何理解什么是电呢？ 肯定不是所有人都懂。 不会有人和你说是因为导体在磁场中运动，切割磁感线，从而产生了电。 而是对生活中的电灯，电器，等接触，慢慢有了理解。如果你现在还是不明白什么是Agent，大概率就是你没有主动接触过这些。当Agent像电一样伴随你的生活时，你就明白了。

![](https://luke-1307356219.cos.ap-chongqing.myqcloud.com/%E5%85%AC%E8%80%83/%E5%85%AC%E4%BC%97%E5%8F%B7.jpg)