# 输出在约 9000 token 截断：Worker CPU 还是上游模型？

本文专门解释这个项目里一次聊天请求从发起到入库的完整链路，并回答：

1. 为什么你会看到“差不多 9000 token 就停”  
2. 这是不是 Cloudflare Worker CPU 限制  
3. 数据是不是“先全搬到内存/缓存，再一次性保存”

---

## 先说结论（TL;DR）

- 你看到的“约 9000 token 停止”，**更可能是上游模型/供应商的生成上限或 stop 条件**，不是这个仓库里的固定阈值。
- 当前代码里没有任何 “9000 token” 的硬编码。
- Worker CPU 不是“按传输字节持续烧 CPU”。流式时大部分时间在等上游网络分片，CPU 只在收到分片时做少量解析与转发。
- 这个项目的确会在后台保存时把整段 assistant 文本聚合在内存里（用于一次性落库），但其存储截断阈值远高于 9000 token。

---

## 一次请求的真实路径

### 1) 前端发送与流式显示

- 前端通过 `/chat/action` 发起请求。
- 收到 SSE 分片后，前端是逐片追加到 `fullContent` 并实时渲染的：
  - `app/hooks/useChat.ts:569` (`fullContent += parsed.content`)
  - `app/hooks/useChat.ts:582` 等多处 `updateMsg(...)`

这一步不是“等完整回答后再显示”，而是边到边显示。

### 2) Worker 侧转发模型流

- 路由入口：`app/routes/chat.action.ts`
- 关键点：`stream.tee()` 把流分成两支：
  - `responseStream` 直接回给前端
  - `saveStream` 后台用于落库
  - 代码：`app/routes/chat.action.ts:247`

返回头里明确是 SSE 且禁代理变形：
- `Content-Type: text/event-stream` (`app/routes/chat.action.ts:271`)
- `Cache-Control: ... no-transform` (`app/routes/chat.action.ts:272`)

### 3) 后台持久化（waitUntil）

- `persistChatResult(...)` 在后台执行（`waitUntil`），不会阻塞前端实时流。
- 它会消费 `saveStream`，把分片聚合成完整文本后再写数据库：
  - `collectSSEChatResult(...)`：`app/lib/services/chat-stream.server.ts:13`
  - 调用点：`app/lib/services/chat-persistence.server.ts:55`

---

## CPU、内存、网络在这个链路里的分工

### CPU 在做什么

- 解析 SSE 文本行
- JSON 反序列化
- 组装统一事件（delta/reasoning/usage）
- 写回响应流、最后写 D1

### CPU 不在做什么

- 不是“持续搬运整条大数据流”的主瓶颈（网络 I/O 才是主耗时）
- 不是“传输越长就线性占满 CPU 直到 9000 token”

### 真实数据流行为

- 前台分支：边收边发给浏览器（低延迟）
- 后台分支：边收边拼接字符串，最终一次 append 入库
- 所以它更像“双通道”：一个实时显示，一个后台归档

---

## 代码中的关键限制（与“9000 截断”相关）

### A. 输入/上下文限制（不是输出截断）

- 请求体最大 16MB：`app/lib/services/chat-action-guards.server.ts:28`
- Prompt 预算 12000（上下文裁剪）：`app/lib/services/chat-action-guards.server.ts:29`
- 最少保留上下文消息 6 条：`app/lib/services/chat-action-guards.server.ts:30`
- 前端 payload 字符预算：100000 字符：`app/hooks/useChat.ts:199`

这些限制会影响“带给模型的上下文”，但不是直接把模型输出硬切到 9000。

### B. 输出预算（会影响模型最多生成多少）

- Polo 默认输出预算：`20 * 1024`：`app/lib/llm/defaults.ts:1`
- 可调范围：`256 ~ 200 * 1024`：`app/lib/llm/defaults.ts:2-3`
- 会话层会再 clamp 一次：`app/lib/services/chat-session-state.shared.ts:138-142`
- 调用上游时写入 `max_tokens`：`app/lib/llm/llm-server.ts:778`

如果上游服务实际可用上限低于你传的 `max_tokens`，上游仍会先停。

### C. 持久化截断阈值（远高于 9000 token）

- assistant 正文最多 500,000 字符：`app/lib/services/chat-persistence.server.ts:18`
- reasoning 最多 200,000 字符：`app/lib/services/chat-persistence.server.ts:19`
- 超过会写 `meta.truncated`：`app/lib/services/chat-persistence.server.ts:98-106`

按常见 1 token ≈ 3~4 字符估算，500,000 字符大约是十万级 token，不是 9000。

---

## 为什么“约 9000 token 停止”更像上游原因

常见原因排序（结合本项目实现）：

1. 上游模型/供应商侧的真实 `max_tokens` 或策略上限低于你请求值  
2. 上游触发 stop condition（如 stop_reason/max_tokens/策略截断）  
3. 多轮工具调用触发本地保护（Polo 工具轮次上限 2，超出会报错）  
   - `app/lib/llm/llm-server.ts:844` (`Tool call limit exceeded.`)

如果是 Worker CPU 问题，通常表现是超时/异常中断，而不是每次都稳定在某个 token 区间。

---

## 你可以这样快速定位（强烈建议）

### 1) 看这条 assistant 消息有没有被本地存储截断

检查 `message.meta.truncated` 是否存在：
- 如果有：本地存储截断，属于 `500k/200k` 字符阈值
- 如果没有：大概率不是本地 DB 截断

### 2) 看 usage.completionTokens 是否总卡在某个固定值附近

如果经常接近同一阈值（例如 8k/9k/10k）且 `truncated` 为空，几乎就是上游停止。

### 3) 检查是否有工具轮次错误

看响应中是否出现 `"Tool call limit exceeded."`。若出现，需要放宽工具轮次策略或减少工具回合。

---

## 关于“CPU 一点一点搬数据到内存/缓存，再落库”这句话

更准确的说法是：

- 网络分片到达后，Worker 用少量 CPU 解析并转发；
- 同时后台分支会把文本累计到内存字符串（`fullContent`）；
- 当流结束后，再一次性 append 到 D1；
- 不是“CPU 像 memcpy 管道那样持续高占用搬运全部数据”。

---

## 如果你要把这件事做得更可观测（建议后续）

当前版本已经把上游停止原因落到 `message.meta.stopReason`。  
在这个基础上，还可以继续增强可观测细节，比如补充更细粒度字段，让你直接看到到底是：

- `max_tokens`
- `end_turn`
- `tool_use`
- 或供应商自定义原因

这会比猜测“是不是 CPU 限制”更可靠。

---

## 已落地：stop reason 埋点（本仓库）

本次已经把埋点接通，链路是：

1. `llm-server` 解析上游停止原因并发 `meta.stopReason` 事件  
2. 前端 `useChat` 在实时流里接收 `meta.stopReason`  
3. 后台 `persistChatResult` 通过 `saveStream` 收集并写入 DB  
4. UI `MessageBubble` 显示“结束原因”

关键位置（按链路）：

- 上游停止原因抽取与统一事件：
  - `app/lib/llm/llm-server.ts`  
  - 新增了对 OpenAI 风格 `finish_reason`、Anthropic/Polo 风格 `stop_reason`、xAI 响应结构的归一化
- 前端实时接收：
  - `app/hooks/useChat.ts`
- 后台持久化收集：
  - `app/lib/services/chat-stream.server.ts`
  - `app/lib/services/chat-persistence.server.ts`
- 类型与展示：
  - `app/lib/llm/types.ts`
  - `app/components/chat/MessageBubble.tsx`

这样你可以直接在每条 assistant 消息里看到 `stopReason`，不再只靠“体感长度”判断。

---

## 这是工程化思维吗？是，而且非常典型

你问得非常关键。  
“加原因埋点”本质上就是把“不可见的问题”转成“可观测的事实”，这是工程化的核心动作之一。

可以这样理解：

### 1) 从“猜原因”转为“看证据”

没有埋点时：
- 你只能说“好像 9000 token 被截断”
- 讨论会停留在猜测：CPU？网络？模型？数据库？

有埋点后：
- 你能看到 `stopReason=max_tokens` / `end_turn` / `tool_use` ...
- 争论会变成验证：哪类模型、哪类配置、哪类会话最常出现该原因

这就是工程化里最值钱的转变：**决策依据从感觉变成数据**。

### 2) 建立“可观测性闭环”

完整闭环通常是：

- 采集：把关键信号打出来（本次是 `stopReason`）
- 传递：信号跨层不丢失（上游 -> Worker -> 前端 -> DB）
- 展示：开发者和用户都能看到（UI + 数据库）
- 复盘：按样本聚类，确认真正瓶颈
- 改进：再调整阈值、模型、策略、重试逻辑

这不是“多写几行日志”，而是**让系统可诊断、可进化**。

### 3) 这类埋点为什么常见

因为在线系统的故障模式高度不确定，尤其是接第三方模型时：

- 供应商会升级模型行为
- 代理层会调整限流/超时
- 不同 provider 的结束语义不一致（`finish_reason` vs `stop_reason`）

如果没有统一埋点，你每次排查都得“临时抓包 + 读代码 + 重试”，成本很高。

### 4) 怎样判断埋点“值不值得做”

一个实用判断标准：

- 这个问题是否会重复出现？
- 出现时是否影响核心体验？
- 没有数据时是否很难复盘？
- 一次埋点能否长期复用？

“输出为何停止”这件事四条都满足，所以非常值得。

### 5) 你现在做的是“AI 协作开发”，更需要埋点

因为 AI 会加速开发，但也会放大系统复杂度：

- 迭代快，变化多
- 多 provider 行为差异大
- 结果好坏常常不是 deterministic

在这种环境里，埋点是“护栏”：
- 让你知道改动是否真的改善了系统
- 让你在问题发生时快速定位，而不是反复重试

### 6) 下一步建议（工程化增强）

如果你愿意继续升级：

1. 把 `stopReason` 做聚合统计（按 provider/model 维度）  
2. 记录上游原始 reason 与归一化 reason（双字段）  
3. 加一个“会话诊断面板”（最近 N 次请求的 stopReason、首 token 延迟、总 token）  
4. 对异常 reason（如 tool limit / provider timeout）做告警阈值

这些都属于“低成本高收益”的工程化实践。
