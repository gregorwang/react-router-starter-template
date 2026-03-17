# 长上下文记忆系统重构 — 实施总结报告

> **项目**: react-router-starter-template (Cloudflare Workers 全栈)
> **完成时间**: 2026-03-17
> **测试状态**: 13 文件 / 48 测试 — 全部通过 ✅

---

## 一、重构目标

原有系统采用**简单全量摘要**方式处理长对话上下文，存在以下核心问题：

1. **Token 浪费** — 硬编码 12000 token 上限，无法按模型动态调整
2. **摘要退化** — 每次全量重写导致信息逐轮丢失（"Summary Drift"）
3. **检索能力为零** — 无法回忆跨对话的历史知识
4. **上下文排列无序** — 关键信息可能被淹没在中间（"Lost in the Middle"问题）
5. **后台任务单一** — Queue 仅支持摘要，无法扩展

本次重构的目标是构建**四层记忆模型**（L1-L4），全面解决上述问题。

---

## 二、架构设计

```
┌──────────────────────────────────────────────────────┐
│                    Prompt Builder                     │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐  │
│  │系统   │ │L2    │ │L1    │ │L3    │ │最近对话轮│  │
│  │指令   │ │结构化│ │滚动  │ │向量  │ │          │  │
│  │       │ │记忆  │ │摘要  │ │检索  │ │          │  │
│  │P=100  │ │P=90  │ │P=80  │ │P=70  │ │P=60/100  │  │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘  │
│            ↑ Token 预算动态分配 ↑                      │
└──────────────────────────────────────────────────────┘
         │                    │                │
   ┌─────┴─────┐     ┌──────┴──────┐   ┌────┴────┐
   │  D1 DB    │     │  Vectorize  │   │ Workers │
   │memory_items│    │  chat-memory │   │   AI    │
   │summary_ver│     │  (768d cos) │   │ bge-base│
   └───────────┘     └─────────────┘   └─────────┘
```

### 四层记忆模型

| 层级 | 名称 | 存储 | 注入优先级 | 说明 |
|------|------|------|-----------|------|
| **L1** | 滚动摘要 | D1 conversations.summary | P=80 | 差分更新 + 版本追踪，解决 Summary Drift |
| **L2** | 结构化记忆 | D1 memory_items | P=90 | 偏好/约束/事实/决定，用户可编辑 |
| **L3** | 向量检索 | Cloudflare Vectorize | P=70 | 跨对话语义检索，Workers AI 生成 embedding |
| **L4** | 最近对话轮 | 内存（请求级） | P=60/100 | 最新用户输入 P=100 永不裁剪 |

---

## 三、实施阶段详情

### P1: Prompt Builder 重写 + Token 预算管理

**核心变更**：用优先级块模型替换原有的线性拼接逻辑。

| 新增文件 | 用途 |
|---------|------|
| `app/lib/chat/prompt-builder.ts` | 核心引擎：按优先级排序 → token 估算 → 低优先级优先裁剪 |
| `app/lib/chat/model-context-limits.ts` | 覆盖所有配置模型的上下文窗口映射（替代硬编码 12000） |
| `app/lib/chat/system-prompts.ts` | 稳定系统指令前缀（利于 Prompt Caching） |
| `app/lib/chat/prompt-builder.test.ts` | 14 个测试用例 |

**设计要点**：
- `buildRequestMessages` 保持向后兼容 — 不传 `model` 参数时走旧路径
- 用户当前输入（P=100）**永不被裁剪**
- 消息块排列顺序：system → structured_memory → running_summary → retrieved_context → recent_turns → user_input
- Token 估算使用快速的字符数 ÷ 3.5 近似

---

### P2: 摘要差分更新 + 版本追踪

**核心变更**：摘要从"每次全量重写"改为"基于旧摘要的增量更新"。

| 新增文件 | 用途 |
|---------|------|
| `app/lib/db/migrations/0004_summary_versioning.sql` | `summary_versions` 表 + `summary_version` 列 |
| `app/lib/db/summary-versions.server.ts` | 版本 CRUD：save / get / list |

**关键重构**：
- `summary.server.ts`：返回类型从 `string` 改为 `SummaryResult`（含 `summary` + `changeDescription`）
- 有 `baseSummary` 时使用差分 prompt + JSON 输出；无基础摘要时使用全量 prompt
- JSON 解析失败时自动 fallback 为纯文本，确保兼容旧模型
- `chat-summary-queue.server.ts`：每次摘要更新自动写入版本历史

---

### P4: Queue 多类型任务化

**核心变更**：queue 从仅处理 `chat_summary` 扩展为基于 `type` 字段的判别联合分发。

| 新增文件 | 用途 |
|---------|------|
| `app/lib/services/chat-queue-types.ts` | `ChatQueueJob` 判别联合 + 类型守卫 + 工厂函数 |

**已注册任务类型**：

| type | 处理器 | 状态 |
|------|--------|------|
| `chat_summary` | `processChatSummaryQueueJob` | ✅ 已实现 |
| `chat_embedding` | `processEmbeddingJob` | ✅ 已实现 |
| `chat_memory_extraction` | — | 🔲 占位（TODO） |

**向后兼容**：旧格式的 payload 通过 `isChatSummaryQueueJob` fallback 路径仍可处理。

---

### P3: Vectorize 集成 + Embedding 入库

**核心变更**：引入 Cloudflare Vectorize 实现跨对话语义检索。

| 新增文件 | 用途 |
|---------|------|
| `app/lib/memory/episodic-memory.server.ts` | embedding 生成 + Vectorize upsert / query / delete |

**完整数据流**：

```
用户发送消息
  → LLM 返回响应
  → chat-persistence.server.ts 保存消息
  → 同时入队两个任务:
      ├── chat_summary → 更新摘要
      └── chat_embedding → 生成 embedding → 写入 Vectorize

下次用户发送消息时:
  → chat.action.ts 以用户消息为 query 做向量检索
  → 返回 top-5 语义相似片段
  → 以 retrieved_context (P=70) 注入 Prompt Builder
```

**安全隔离**：Vectorize 查询始终以 `userId` 作为 metadata filter，防止跨用户数据泄漏。

**优雅降级**：`VECTORIZE` 或 `AI` binding 不可用时自动跳过，不影响核心聊天。

---

### P5: 结构化记忆 + 用户编辑 API

**核心变更**：用户可以手动管理持久化的长期记忆项。

| 新增文件 | 用途 |
|---------|------|
| `app/lib/db/migrations/0005_structured_memory.sql` | `memory_items` 表 |
| `app/lib/db/memory-items.server.ts` | CRUD + `formatMemoryItemsForPrompt` |
| `app/routes/memory.ts` | REST API（POST/PUT/DELETE） |

**记忆分类**：

| 类别 | 标签 | 示例 |
|------|------|------|
| preference | 偏好 | "回答始终用中文" |
| constraint | 约束 | "不要使用 TailwindCSS" |
| fact | 事实 | "项目部署在 Cloudflare Workers 上" |
| decision | 决定 | "选用 D1 作为主数据库" |
| todo | 待办 | "完成 P6 检索优化" |
| custom | 备注 | 自由格式 |

**注入格式**：以 `【长期记忆】` 块注入 prompt，每条格式为 `[标签] 内容`，按重要性排序，最多 30 条。

---

## 四、修改文件汇总

### 新增文件（12 个）

```
app/lib/chat/prompt-builder.ts           # P1 核心
app/lib/chat/model-context-limits.ts      # P1
app/lib/chat/system-prompts.ts            # P1
app/lib/chat/prompt-builder.test.ts       # P1 测试
app/lib/db/migrations/0004_*.sql          # P2 迁移
app/lib/db/summary-versions.server.ts     # P2
app/lib/services/chat-queue-types.ts      # P4
app/lib/memory/episodic-memory.server.ts  # P3
app/lib/db/migrations/0005_*.sql          # P5 迁移
app/lib/db/memory-items.server.ts         # P5
app/routes/memory.ts                      # P5 API
```

### 修改文件（8 个）

```
app/lib/services/chat-conversation.server.ts  # P1: V2 Prompt Builder 路径
app/routes/chat.action.ts                     # P1+P3+P5: model参数 + L2/L3检索
app/lib/llm/summary.server.ts                 # P2: SummaryResult + 差分prompt
app/lib/services/chat-summary-queue.server.ts # P2: 版本追踪
app/routes/conversations.compact.ts           # P2: SummaryResult 适配
app/lib/services/chat-persistence.server.ts   # P3: embedding job 入队
workers/app.ts                                # P4: 多类型queue路由 + embedding处理
app/env.d.ts                                  # P3: VECTORIZE + EMBEDDING_MODEL
wrangler.json                                 # P3: vectorize binding
```

---

## 五、测试情况

```
 Test Files  13 passed (13)
      Tests  48 passed (48)
   Duration  ~1s
```

所有已有测试零回归。新增 `prompt-builder.test.ts` 覆盖核心逻辑。

---

## 六、部署指南

### 前置条件

```bash
# 1. 创建 Vectorize 索引（仅首次）
wrangler vectorize create chat-memory --dimensions 768 --metric cosine

# 2. 运行 D1 迁移
wrangler d1 execute <数据库名> --file=app/lib/db/migrations/0004_summary_versioning.sql
wrangler d1 execute <数据库名> --file=app/lib/db/migrations/0005_structured_memory.sql
```

### 可选环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `EMBEDDING_MODEL` | 自定义 embedding 模型 | `@cf/baai/bge-base-en-v1.5` |

### 部署

```bash
wrangler deploy
```

### 降级说明

| 缺失的 binding | 影响 | 核心聊天 |
|---------------|------|---------|
| `VECTORIZE` 未配置 | L3 向量检索跳过 | ✅ 正常 |
| `AI` 未配置 | embedding 生成 + 向量检索跳过 | ✅ 正常 |
| 迁移未执行 | L2 结构化记忆 + 版本追踪报错（被 catch） | ✅ 正常 |

---

## 七、后续规划

| 优先级 | 方向 | 说明 |
|--------|------|------|
| P6 | Hybrid Search + Re-ranking | 混合向量 + 关键词检索，提高召回精度 |
| P7 | AI Gateway | 统一 LLM 请求管理、缓存、限流、可观测性 |
| P8 | 记忆清理策略 | 自动归档过期记忆、控制向量索引大小 |
| P9 | `chat_memory_extraction` | 自动从对话中抽取结构化记忆（当前为 TODO 占位） |
