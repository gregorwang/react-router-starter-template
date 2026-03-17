# 第三方套壳 AI 应用的长上下文管理深度研究：工程与算法视角（Claude / ChatGPT / Poe）

## 执行摘要

长上下文管理本质上不是“把更多 token 塞进模型”，而是一个**上下文虚拟内存（virtual context）**系统：把用户对话、工具输出、私有知识、偏好与任务状态，分层存储在“快/慢介质”里（短期窗口、摘要、向量库、结构化记忆、外部文档库），并在每次请求时用**检索 + 压缩 + 打包**选择性构建一个“工作集（working set）”发给模型。这一点与 MemGPT 提出的“像操作系统管理内存一样管理上下文”的观点高度一致。 citeturn9search1

在你点名的三类产品形态中：

Claude（应用侧）已公开：提供**可选的 Memory（项目隔离、可查看/可编辑的 memory summary、隐身对话不写入记忆）**。citeturn11view0 同时 Projects 提供每个项目独立的知识库，并在内容接近上下文上限时**“无感切换到 RAG 模式，把容量扩到最多 10×”**。citeturn11view1  
ChatGPT（应用侧）已公开：Memory 分成“Saved memories（显式/自动保存）”与“Reference chat history（从过往聊天提取有用信息）”，且会按**“最近性 + 讨论频率”**等因素做记忆优先级与自动管理；删除的记忆可能保留日志最多 30 天用于安全与调试。citeturn1view3  
Poe（平台/套壳侧）已公开：Prompt Bot 可挂“Knowledge base”，平台会为每条用户消息**自动检索知识库相关片段并用于回答**，支持多文件格式，知识库总体积可达 5GB 或 3000 万字符，并可开启“引用来源”。citeturn3view0turn5view1 这等价于“平台内建 RAG（至少是检索+拼接）”。

对“套壳应用如何把长对话做得又便宜又快”的工程关键点，官方还共同指向一个核心能力：**Prompt/Prefix Caching**。  
Anthropic（Claude API）明确：缓存存的是 **KV cache 表示与加密哈希**，不存原文；支持自动/显式断点；默认 TTL 5 分钟，可付费扩到 1 小时；并披露了 cache read/write 计费与 20-block 回看窗口等实现细节。citeturn2view0turn2view2  
OpenAI（API）明确：Prompt Caching 对 ≥1024 tokens 的提示自动启用，靠“前缀哈希路由 + 精确前缀匹配”命中，可把延迟最高降 80%、输入 token 成本最高降 90%；缓存通常 5–10 分钟不活动会被驱逐（低峰可能更久），还提供更长的 extended retention（最长可到 24 小时，取决于模型）。citeturn1view2turn14search7

针对你当前实现（每轮小模型摘要、下一轮把“所有摘要 + 上一轮回答”塞回请求体），短板在于：  
1）摘要会不断“堆叠”，token 仍线性增长；2）摘要漂移/遗漏会累积；3）无法按问题选择性召回细节；4）难以利用前缀缓存（前缀频繁变化）；5）对“长上下文中间信息不易被模型利用”的**lost-in-the-middle**现象没有优化。citeturn13search0turn1view2

建议的总体改造方向是：将“摘要堆叠”升级为**分层记忆 + 检索增强 + token 预算打包**，并在 Cloudflare Workers 上用 Durable Objects / D1 / Vectorize / Queues 形成可维护的流水线：Vectorize 可在 Workers 内直接 insert/query，并支持元数据索引与过滤；Queues 可将摘要/embedding/索引更新移到后台，避免阻塞主请求；AI Gateway 用于观测 token、成本与缓存命中并提供代理侧缓存/限流/重试/回退。citeturn16view0turn15view1turn12view2turn12view3

---

## 详细分析：长上下文管理策略的工程与算法拆解

### 问题分解：上下文管理的三个目标函数

在工程上，“长上下文管理”通常同时优化三件事：

**质量**：把“对当前问题最有用的信息”放进上下文；  
**成本**：控制输入 token（以及检索/摘要/embedding成本）；  
**延迟**：减少每轮构建上下文与模型推理的端到端时间。

在算法上，这等价于每轮对话都要做一个“上下文选择问题”：

- 候选集合：历史消息、用户上传文档片段、工具调用结果、长期记忆条目等  
- 约束：模型上下文长度（tokens），以及响应预留 tokens  
- 目标：最大化对当前问题的相关性与覆盖度，同时最小化冗余与漂移

这也是 MemGPT 所强调的“虚拟上下文管理”：把大上下文映射到小窗口工作集。citeturn9search1

### 主流策略总览与对比表

下表把你要求的策略逐项拆开，给出适用场景、复杂度（粗略到工程层面）、成本/延迟影响与典型坑位。表中“复杂度”以“每轮请求”的额外开销理解（不等同于严格算法复杂度）。

| 策略 | 核心做法 | 适用场景 | 典型优势 | 主要缺点/坑 | 复杂度与成本影响（相对） |
|---|---|---|---|---|---|
| 滑动窗口（Sliding Window） | 只保留最近 K 轮或最近 N tokens，把更早内容丢弃 | 闲聊、短任务、对强一致“最近状态”敏感（如调试） | 实现极易、极快；天然限制 token | 丢失早期约束/决策；遇到回溯问题会“失忆” | 低；类似 LangChain 的 ConversationBufferWindowMemory（只用最后 K 次交互）citeturn14search0 |
| 分段/Chunking | 把长文本/对话切片（按段落、标题、语义边界、token 上限）并分片存储 | 文档问答、知识库、长对话归档 | 是检索与索引的前提；便于并行处理 | chunk 太小→语义断裂；太大→召回噪声多；需要良好边界策略 | 中：一次性索引成本 + 每轮召回成本 |
| 向量检索 / 向量数据库 | 对 chunk 做 embedding 入库；每轮对 query embedding，TopK 相似度召回 | 私域知识、长会话记忆、跨会话偏好 | 可“按需取回细节”，避免把全量历史塞回 | 向量相似度不等于答案相关性；需过滤、重排、去重 | 中：embedding 成本 + 向量检索（通常 ANN）成本；向量检索算法与索引结构可参考向量检索综述/专著citeturn4search1turn4search14 |
| RAG（检索增强生成） | 检索（向量/关键词/混合）→ 拼接证据 → 让模型基于证据生成 | 专业问答、引用溯源、减少幻觉 | 能带出处、可增量更新知识 | 证据拼接顺序与冗余会显著影响效果；“证据在长上下文中间”会掉点 | 中到高；RAG 原始范式论文：Lewis 等（2020）citeturn9search0；长上下文位置偏置（lost in the middle）需重视citeturn13search0 |
| 层级摘要（Hierarchical Summarization） | 把早期对话压成“运行摘要”，保留最近原文；必要时再按主题分层摘要 | 长对话、多轮任务、项目协作 | token 近似常数；比纯滑窗更稳 | 摘要漂移/遗漏会积累；需要“可回溯原文”通道 | 中：需要摘要模型调用；LlamaIndex 的 ChatSummaryMemoryBuffer 典型做法是“超出 token_limit 的旧消息迭代摘要”citeturn14search1 |
| 差分摘要/增量摘要（Incremental / Diff Summarization） | 不“追加摘要列表”，而是对同一份 summary 做 patch 更新（并记录版本） | 你当前方案的最佳升级路径 | 避免摘要堆叠；更利于缓存前缀稳定 | 需要冲突合并与版本管理（尤其并发） | 中；LangChain 迁移文档也指出“每轮对全历史重复处理会导致延迟随对话增长”，应转向增量策略citeturn14search12 |
| 记忆库/长期记忆（Long-term Memory） | 把“用户偏好/事实/项目约束/进行中状态”抽取成结构化条目（可编辑/可删除） | 助手个性化、跨会话连续性 | 更接近“真正记忆”，可控且可解释 | 抽取错误会造成长期误导；隐私与合规风险更高 | 中：抽取与检索成本；ChatGPT/Claude 均已在产品层面强调“可控/可编辑”citeturn1view3turn11view0 |
| 上下文优先级/重要性评分 | 用启发式或小模型给每条信息打分：相关性×重要性×新鲜度×引用价值 | 所有长上下文系统的“调度器” | 把 token 花在刀刃上 | 评分体系需要校准；不同任务权重不同 | 中：可用轻量模型/规则；“最近性与频率”已出现在 ChatGPT 记忆自动管理描述中citeturn1view3 |
| Token 预算管理（Budgeting） | 明确分配：系统指令/工具schema/记忆摘要/检索证据/最近对话/用户输入/输出预留 | 必备（否则系统不可控） | 稳定成本与延迟；减少溢出 | 需要可靠 token 计数与裁剪策略 | 低到中；可用 tiktoken 计数思路（OpenAI Cookbook）citeturn14search10 |
| 增量提示构建（Prompt Stitching） | 把上下文视为多个块（blocks），可替换/可缓存；每轮只更新少量块 | 多轮对话、工具调用代理 | 与 Prompt Caching 完美契合 | 块边界设计不好会导致缓存失效或信息丢失 | 中；Anthropic/OpenAI 都强调“精确前缀匹配、静态内容前置”citeturn2view2turn1view2 |
| 去重与压缩（Dedup & Compression） | 语义去重（MMR/相似度阈值）；内容压缩（抽取要点/提示压缩器） | RAG 证据拼接、长对话记忆回填 | 降 token、降噪、缓解“lost in middle” | 过度压缩会丢证据细节；需要可回溯 | 中；LLMLingua/LongLLMLingua 提出长上下文提示压缩可同时降成本与延迟，并缓解位置偏置citeturn9search6turn9search2；MMR 用于减少冗余、保持相关性与多样性citeturn13search30 |
| 并行/异步摘要流水线 | 主请求先回答；摘要/embedding/索引更新放后台队列 | 有并发与成本要求的生产系统 | 降主链路延迟；提高吞吐 | “一致性/竞态”需要设计（版本号、幂等） | 中到高；Cloudflare Queues 明确用于 offload、buffer、batch，并支持重试与延迟citeturn12view2 |
| 隐私与安全 | 记忆可控、可删；敏感信息隔离；最小化日志；密钥管理 | 面向真实用户必备 | 降合规风险 | 会增加工程成本 | 中；ChatGPT 记忆可开关、并有删除与保留日志策略citeturn1view3；Claude 记忆可选、隐身对话不写入记忆citeturn11view0；Poe API 文档强调密钥不可暴露于客户端citeturn17view0 |
| 延迟与成本权衡（Caching/Proxy） | 利用 Prompt Caching、代理缓存、限流、重试、模型回退 | 高 QPS、多轮长提示、工具代理 | 直接省钱省时 | 需要稳定前缀与观测指标 | 中；OpenAI Prompt Caching：最高降 80% 延迟、90% 输入成本，并要求精确前缀匹配citeturn1view2；Cloudflare AI Gateway 提供代理层缓存/限流/重试/回退与 token/成本可观测citeturn12view3 |

### 关键算法点：为什么“放哪里”与“放多少”同样重要

1) **Lost in the Middle：长上下文位置偏置**  
研究发现，长上下文任务中，相关信息在输入开头或结尾时模型表现更好，而在中间时显著下降。citeturn13search0  
工程含义：你不仅要做 RAG，还要做**证据的排序与布局**（例如把最关键约束/证据放在更靠近开头或靠近末尾的高注意力区域），否则“召回了也未必用上”。

2) **Prompt Caching 与 KV cache：长上下文的“加速器”**  
KV cache 的作用是复用自回归生成中已计算的注意力 Key/Value，减少重复计算。citeturn11view4  
Anthropic 将其进一步产品化为 Prompt Caching：缓存 KV 表示与哈希，不存提示原文；并给出 TTL 与读写计费。citeturn2view0turn2view2  
OpenAI 的 Prompt Caching 通过“前缀哈希路由 + 精确前缀匹配”自动命中，强调把静态内容（系统提示、示例、工具定义）前置。citeturn1view2

3) **长上下文为什么贵**  
标准 self-attention 的时间/空间复杂度随序列长度呈二次增长，是长上下文成本/延迟的根源之一；FlashAttention 等工作正是围绕这一瓶颈做 IO-aware 优化。citeturn18search3turn18search5  
工程含义：即使模型宣称“支持超长上下文”，你仍应把“把 token 省下来”当作第一优先级（特别是面向真实用户与高并发）。

### 检索侧：混合检索、重排与索引更新

- **混合检索（Hybrid Search）**：向量检索擅长语义相近，关键词检索擅长专有名词/数字/代码符号。很多系统会二者结合，再用融合策略（如 RRF）合并排名。OpenAI 的 Retrieval 文档明确暴露了 hybrid_search 的权重参数（rrf_embedding_weight / rrf_text_weight），说明其内部采用了 RRF/类似 RRF 的融合思路。citeturn6view2turn13search1  
- **去冗余/多样性（MMR）**：在 TopK 召回后，用 MMR 兼顾相关性与新颖性，减少“召回一堆同义段落”。MMR 原始思路即用于减少冗余并保持查询相关。citeturn13search30  
- **索引更新与过期**：  
  - OpenAI Vector Store 允许对 vector_store 设置 expires_after，到期自动删除并停止计费；并提供属性过滤、文件 attributes 更新等机制。citeturn6view4turn6view2  
  - Cloudflare Vectorize 支持每条向量附带元数据（最多 10KiB），并能在查询时按元数据过滤；但需要在插入前先创建 metadata index。citeturn16view0 这使得“按会话/项目分桶、按时间范围过滤、按重要性筛选”在工程上可行。

---

## Claude / ChatGPT / Poe 的长上下文策略对比

### 信息来源优先级说明

下表每个条目都标注“来源优先级”，建议你按以下优先级理解可信度：  
**官方文档/帮助中心/官方公告 > 原始论文/系统卡 > 开源实现/知名工程框架文档 > 媒体报道/逆向分析/个人博客**。  
对于产品内部未公开的细节，我会明确标为“推测/低确信”。

### 产品级能力对齐：记忆、知识库、RAG、缓存

| 维度 | Claude（Anthropic 应用/产品） | ChatGPT（OpenAI 应用/产品） | Poe（Quora 平台/套壳） |
|---|---|---|---|
| 跨会话/长期记忆 | 已公开：Memory 可选；项目级隔离；可查看/编辑 memory summary；Incognito chat 不写入记忆。来源优先级：官方公告 citeturn11view0 | 已公开：区分 Saved memories 与 Reference chat history；会按最近性/频率等做自动管理；可删除；删除日志最多保留 30 天。来源优先级：官方帮助中心 citeturn1view3 | 官方未强调“平台级统一长期记忆”（更偏向“每个 bot 的配置/知识库 + 对话线程”）。若要长期记忆，通常由 bot 开发者在 Server Bot 自建存储实现。来源优先级：推断（基于平台定位）+ 官方提供 Server Bot 模式（间接证明可自建）citeturn3view1 |
| 项目/工作区隔离 | 已公开：Projects 是自包含 workspace，带独立 chat histories 与 knowledge bases。来源优先级：官方帮助中心 citeturn11view1 | ChatGPT 侧常见做法是“对话线程 + 自定义指令 + 记忆”；但“项目级知识库/RAG 自动扩容”是否存在取决于具体产品线（此处不做强断言）。来源优先级：缺少同级官方表述（不覆盖） | Poe 的“Bot”本身就是隔离单元（Prompt/Knowledge base/Server）。来源优先级：官方文档 citeturn3view0 |
| 知识库与 RAG | 已公开：Projects 中，付费计划在接近上下文限制时“自动启用 RAG”，容量最多扩到 10×。来源优先级：官方帮助中心 citeturn11view1 | 对开发者：OpenAI 提供 Retrieval API（向量库 + 语义检索 + 混合检索调参），文件入库会自动 chunk/embedding/index，并支持过期策略与计费说明。来源优先级：官方开发文档 citeturn6view0turn6view2 | 已公开：Prompt Bot 可挂 Knowledge base，平台会“检索相关部分并用于回复”，支持多格式；上限 5GB/3000 万字符；可开启引用来源。来源优先级：官方文档 + 中文官方页面 citeturn3view0turn5view1 |
| Prompt/Prefix Caching（长提示省钱省时） | Anthropic API 已公开：缓存 KV 表示与哈希，不存原文；cache_control 支持自动/显式断点；默认 5 分钟 TTL，可到 1 小时；并披露 cache read/write 计费与 20-block 回看窗口。来源优先级：官方开发文档 citeturn2view0turn2view2 | OpenAI API 已公开：≥1024 tokens 自动启用；精确前缀匹配；最高降 80% 延迟/90% 输入成本；缓存不跨组织共享。来源优先级：官方开发文档 citeturn1view2turn14search7 | Poe 是否提供“平台统一 prompt caching”无官方披露。但 Poe 提供 OpenAI 兼容与 Anthropic 兼容 API 网关，缓存可能发生在上游模型提供方（取决于你调用的具体模型与其缓存策略）。来源优先级：推断 + 官方 API 形态 citeturn17view0turn1view2turn2view2 |
| 成本/延迟观测与网关能力 | Claude/OpenAI 各自有用量与日志体系（此处不展开） | 同左 | 对你这种 Cloudflare Worker 架构，Cloudflare AI Gateway 可作为统一代理层：可观测 prompts、token usage、costs，并支持缓存、限流、重试与模型回退。来源优先级：官方产品说明 citeturn12view3 |

### 一个重要结论：三者共同的“工程范式”

把不同产品放在一起看，会发现它们高度一致地落在同一个范式上：

- **“长上下文能力”=（长窗口模型能力）+（RAG/知识库）+（记忆摘要/长期记忆）+（缓存/打包/预算）**
- 当 token 接近上限时，产品会倾向从“全量拼接”切换到“检索 + 证据拼接”模式（Claude Projects 已明确这样做）。citeturn11view1
- 当多轮对话导致重复前缀巨大时，产品会依赖“前缀缓存”（OpenAI/Anthropic 都把它作为官方建议）。citeturn1view2turn2view2

---

## 针对你的 Cloudflare Worker 系统：可执行的改造方案

### 你当前实现的结构与主要问题

你现在的做法可以概括为：

- 每轮：用小模型把本轮对话做摘要；
- 下一轮：把“所有摘要 + 上一轮回答”拼进请求体（上下文）。

这是“层级摘要”的最简形态，但会遇到四类典型问题：

**摘要堆叠导致 token 仍增长**：你不是“维护一份运行摘要”，而是“维护摘要列表”，长度仍会线性增加（只是增长系数变小）。LangChain 的迁移文档也提醒：对增长历史反复做全量处理会让延迟随对话增长。citeturn14search12  

**摘要漂移不可逆**：每轮摘要都可能引入遗漏/误写，且你丢掉了“可回溯的原文证据”，长期会偏离事实。  

**无法按问题召回细节**：用户突然回溯某个细节时，你的摘要可能不含该细节；而把“上一轮回答”塞回去也无法覆盖更早细节。  

**不利于缓存**：前缀内容不断变化，难以满足“精确前缀匹配”的缓存条件。OpenAI 与 Anthropic 都明确要求静态内容前置、前缀稳定才更易命中。citeturn1view2turn2view2

### 推荐的目标架构：分层记忆 + 检索 + 预算打包 + 异步流水线

下面给出一个面向 Cloudflare 的、可落地的参考架构。核心思想是把“对话上下文”拆成四个层次（快到慢）：

- **L0 最近窗口（raw turns）**：最近 K 轮原文（高保真）  
- **L1 运行摘要（running summary）**：一份不断被 patch 更新的摘要（常数长度）  
- **L2 结构化记忆（facts/tasks/preferences）**：抽取出来的“可编辑条目”  
- **L3 向量记忆（episodic memory）**：对话片段/文档 chunk embeddings，按需召回

并用 **Queues** 把 L1/L2/L3 的更新移到后台。

```mermaid
flowchart TD
  U[用户请求] --> W[Cloudflare Worker: API入口]
  W --> DO[Durable Object: 会话锁 & 状态聚合]
  
  DO -->|读取| D1[(D1: 消息/摘要/记忆元数据)]
  DO -->|向量检索| VZ[(Vectorize: episodic memory 向量库)]
  DO -->|可选大文本| R2[(R2: 原文/附件/长转录)]
  
  DO --> PB[Prompt Builder: 预算管理 & packing]
  PB --> GW[AI Gateway(可选): 代理缓存/限流/重试/回退]
  GW --> LLM[LLM Provider: OpenAI/Anthropic/…]
  LLM --> DO --> W --> U
  
  DO -->|投递后台任务| Q[Cloudflare Queues]
  Q --> BG[后台Worker: 摘要/抽取/embedding/索引更新]
  BG --> D1
  BG --> VZ
```

该架构的 Cloudflare 侧组件均是“官方支持的可组合件”：  
Queues 用于 offload、buffer、batch，并支持重试/延迟与死信队列等能力。citeturn12view2  
Vectorize 是 Cloudflare 的向量数据库，可在 Worker 内直接 insert/query，并支持元数据过滤（需要预先创建 metadata indexes）。citeturn15view0turn16view0  
AI Gateway 可提供 token/成本/错误可观测，以及代理层缓存、限流、重试和模型回退。citeturn12view3

### 核心数据结构建议：把“记忆”显式化

建议你至少维护三类“可解释”的状态对象（都带 version）：

1) **Running Summary（单份）**  
- 用于替代“摘要列表”  
- 字段：`summary_text`, `version`, `updated_at`, `source_turn_range`  
- 更新策略：差分更新（见下文）

2) **Structured Memory（结构化条目）**  
把长期有效的内容抽成条目，如：
- `UserPreference`：语言、格式偏好、禁忌、常用技术栈  
- `ProjectConstraint`：预算上限、性能指标、合规要求  
- `OpenLoop`：未解决问题、待办任务  
这些条目应支持“用户可纠正/删除”（参照 ChatGPT/Claude 强调的可控性）。citeturn1view3turn11view0

3) **Episodic Memory（向量化片段）**  
- 最小单元：一条用户消息、一次工具调用结果、或 K 轮对话的 chunk  
- 存储：`text`, `embedding`, `metadata`（会话ID、时间戳、角色、topic、importance 等）  
Vectorize 支持每条向量最多 10KiB metadata，并可对已建立索引的 metadata 字段做过滤。citeturn16view0

### 摘要策略升级：从“每轮摘要”到“层级 + 差分 + 可回溯”

#### 运行摘要（running summary）采用差分更新

每轮结束后，不要 append 新摘要，而是执行：

- 输入：旧 summary +（本轮 user/assistant 原文）+（本轮工具结果摘要）  
- 输出：新的 summary（长度受控）+ 变更说明（可选）+ version++

这几乎等价于 LlamaIndex 的“把超出 token_limit 的内容迭代摘要、让 history 保持在预算内”的思路，但你可以更进一步：只更新一份 summary，而不是维护多个历史摘要。citeturn14search1

#### 抽取式 vs 生成式：建议混合

- **抽取式（更稳）**：用规则/小模型抽出专有名词、数字、约束、结论句，适合做 `Structured Memory` 的候选。  
- **生成式（更压缩）**：用小模型把“过程性对话”压成项目进度摘要，写入 running summary。  
- **层级摘要**：当会话超长时，按 topic 做二级摘要（每个 topic 一份“子摘要”），只在 topic 活跃时回填到 prompt。

#### 关键原则：任何摘要都必须可回溯到原文

实践上：把原文持久化到 D1/R2，把摘要条目附上 `source_ids`（turn_id 列表）。这样摘要漂移可被诊断与修复（也利于用户“纠错记忆”）。

### 向量检索设计：Vectorize + 元数据分桶 + 重排去重

#### 入库单元与元数据

建议每次写入 episodic memory 时记录至少：

- `conv_id` / `project_id`（用于过滤）  
- `ts`（时间戳，支持时间衰减）  
- `role`（user/assistant/tool）  
- `turn_id`（可回溯）  
- `topic`（可选）  
- `importance`（0–1）  

Vectorize 允许对 metadata 做过滤，但过滤字段需要事先建 metadata index，且最多 10 个索引字段；因此字段要挑“最值钱的过滤维度”（通常是 conv_id、ts_bucket、importance_bucket、role）。citeturn16view0

#### 召回 + 重排（推荐的最小可行版本）

1) 计算 query embedding  
2) Vectorize `query(topK)` 并按 `conv_id` 过滤（不同会话隔离）  
3) 对 TopK 做轻量重排：  
   - MMR 去冗余（减少重复段落）citeturn13search30  
   - 时间衰减：更近的 chunk 得分加权  
4) 取最终 K’ 条做证据拼接

> 额外增强（可选）：混合检索（BM25/FTS + 向量）  
如果你用 D1（SQLite）做关键词检索，D1 官方产品页提到其基于 SQLite，并支持全文搜索触发器（FTS triggers）。citeturn8search7  
融合策略可采用 RRF（SIGIR’09）citeturn13search1；这也与 OpenAI Retrieval 文档“hybrid_search + rrf 权重调参”的公开接口一致。citeturn6view2

### 索引更新与过期策略：让成本可控

你未提供预算与并发量，因此我给出可配置策略组合（按“强约束优先”）：

- **按会话 TTL**：会话 N 天不活跃即标记过期，后台批量删除（或停止召回）。  
  - 如果你使用 OpenAI Vector Store，官方直接支持 expires_after（到期删除并停止收费）。citeturn6view4turn6view2  
  - 如果你用 Vectorize，可在 metadata 写入 `expires_at`，查询时过滤“未过期”，后台再做物理清理。
- **按重要性保留**：低 importance 条目更快过期；高 importance（用户偏好/硬约束）长期保留，但必须可编辑/可删除。  
- **去重合并**：对近似重复的 chunk 做合并（相似度阈值或 MMR），降低索引膨胀。citeturn13search30  
- **版本化 upsert**：Vectorize 明确：同 id 再 insert 不会更新，需要 `upsert` 才能更新向量值；因此对“同一条记忆条目被修订”的场景，应使用稳定 id + upsert。citeturn15view2

### Prompt 工程：prompt stitching + context packing + 缓存友好

#### Token 预算模板（可配置）

假设模型最大上下文 `CTX_MAX`，预留输出 `OUT_RESERVE`，则输入预算：

`IN_BUDGET = CTX_MAX - OUT_RESERVE`

建议把输入分成固定块（利于缓存）与动态块（每轮变化）：

- 固定块（尽量稳定前缀）：system 指令、工具 schema、格式规范、长期不变的“产品规则”  
- 半固定块：running summary（每次 patch 但长度固定）、结构化记忆（条目数固定）  
- 动态块：本轮用户输入、最近 K 轮 raw、检索证据

此外，依据 lost-in-the-middle 研究，把“最关键约束/证据”放在靠前或靠后区域，避免被埋在中间。citeturn13search0

#### 利用 Prompt Caching 的结构要求

- OpenAI：缓存命中要求精确前缀匹配（静态内容前置）；≥1024 tokens 自动启用；还可用 `prompt_cache_key` 提高同前缀请求的命中稳定性。citeturn1view2  
- Anthropic：通过 `cache_control` 标记断点；自动缓存会随对话增长向后移动；并存在“20-block lookback window”，提示你在合适位置放多个断点，避免前面改动导致缓存全失效。citeturn2view2

你的系统要吃到缓存红利，关键是把“会频繁变”的内容（用户输入、动态检索结果）放在尽量靠后的位置，让前缀尽可能稳定。citeturn1view2turn2view2

### 并行/异步摘要流水线：用 Queues 把“慢活”移走

Cloudflare Queues 明确适合：offload work from a request、Worker-to-Worker、buffer/batch，并支持 retries/delays。citeturn12view2  
因此你可以把以下工作放到后台：

- 小模型摘要（running summary patch）  
- 结构化记忆抽取（preferences/constraints/open loops）  
- embedding 计算与 Vectorize upsert  
- 去重/合并/过期清理（定期 job 或按阈值触发）

主链路只做：读取现有状态 + 检索 TopK + prompt packing + 调大模型生成。

### 成本/延迟估算：给你可套用的计算框架

你未给模型单价与并发，我提供“公式 + 可用的官方上限/计费点”。

#### 推理 token 成本（通用）

每轮成本近似：

`Cost ≈ (input_tokens × price_in + output_tokens × price_out)`

其中 input_tokens 由你的上下文管理策略决定。  
减少 input_tokens 的手段：摘要/压缩/检索与去重；减少“重复 input_tokens 计费与延迟”的手段：Prompt Caching。

#### Prompt Caching 的边际收益（官方给出上界）

- OpenAI：官方称 Prompt Caching 最高可降 **80% 延迟、90% 输入 token 成本**（前提：精确前缀匹配、长前缀、稳定请求流）。citeturn1view2  
- Anthropic：官方披露 cache read/write 定价（读约为基础价 10%，写约为基础价 25% 加成），并且默认 TTL 5 分钟，可扩展 TTL。citeturn2view2

这意味着：你越能把“长且稳定的前缀”固定下来（系统提示、工具、长期记忆块），越接近这些上界收益。citeturn1view2turn2view2

#### 向量库存储成本（以 OpenAI Vector Store 为例的可见计费点）

如果你选择直接用 OpenAI 的 Vector Store：官方写明按“解析 chunks + embeddings 的存储量”计费，**总量 1GB 内免费，超出 1GB 后 $0.10/GB/天**，并建议使用 expiration policies 控制成本。citeturn6view2turn6view4  
（你用 Cloudflare Vectorize 时则应参照其计费方式；此处给你一个“对标的成本口径”。）

---

### 示例关键代码片段（TypeScript/Node 风格，贴近 Workers）

下面代码是“关键逻辑骨架”，重点展示：token 预算、检索、prompt stitching、后台队列更新。你可以把存储层换成 KV/D1/R2，把 embedding 模型换成任意供应商。

```ts
// types.ts
export type Role = "system" | "user" | "assistant" | "tool";

export interface Turn {
  id: string;
  role: Exclude<Role, "system">;
  content: string;
  ts: number;
  importance?: number; // 0..1
}

export interface RunningSummary {
  text: string;
  version: number;
  updatedAt: number;
}

export interface MemoryItem {
  id: string;               // stable id for upsert
  kind: "preference" | "constraint" | "open_loop" | "fact";
  text: string;
  importance: number;       // 0..1
  updatedAt: number;
  sourceTurnIds: string[];
}

// env bindings (example)
export interface Env {
  DB: D1Database;
  VECTORIZE: Vectorize;      // Cloudflare Vectorize binding (env.VECTORIZE.query/insert/upsert) citeturn15view0turn15view1
  QUEUE: Queue;              // Cloudflare Queues binding citeturn12view2
  AI_GATEWAY_BASE?: string;  // optional proxy
}
```

```ts
// promptBuilder.ts
import { countTokens } from "./tokenCounter"; // wrap tiktoken-like logic

interface BuildInput {
  system: string;
  toolsSchema?: string; // optional
  summary: RunningSummary | null;
  memories: MemoryItem[];
  retrievedChunks: string[];
  recentTurns: Turn[];
  userMessage: string;
  ctxMax: number;
  outReserve: number;
}

export function buildPrompt(input: BuildInput): { messages: Array<{role: Role; content: string}> } {
  const budget = input.ctxMax - input.outReserve;

  // 1) 固定前缀（利于缓存）：system + tools + “回答格式规则”
  const blocks: Array<{role: Role; content: string; tag: string; priority: number}> = [];
  blocks.push({ role: "system", content: input.system, tag: "system", priority: 100 });

  if (input.toolsSchema) blocks.push({ role: "system", content: input.toolsSchema, tag: "tools", priority: 95 });

  // 2) 半固定：运行摘要 + 结构化记忆（控制条目数量与长度）
  if (input.summary?.text) {
    blocks.push({ role: "system", content: `【运行摘要】\n${input.summary.text}`, tag: "summary", priority: 80 });
  }

  if (input.memories.length) {
    const memText = input.memories
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 20) // 可配置
      .map(m => `- (${m.kind}, imp=${m.importance.toFixed(2)}) ${m.text}`)
      .join("\n");
    blocks.push({ role: "system", content: `【长期记忆】\n${memText}`, tag: "memories", priority: 75 });
  }

  // 3) 动态检索证据（注意去重、排序；关键证据尽量放靠前或靠后以缓解 lost-in-the-middle）
  if (input.retrievedChunks.length) {
    const uniq = Array.from(new Set(input.retrievedChunks)).slice(0, 8);
    blocks.push({ role: "system", content: `【检索证据】\n${uniq.map((c, i) => `(${i+1}) ${c}`).join("\n\n")}`, tag: "rag", priority: 70 });
  }

  // 4) 最近对话窗口（raw turns 高保真）
  const recentText = input.recentTurns
    .slice(-8) // 可配置 K
    .map(t => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");
  if (recentText) blocks.push({ role: "system", content: `【最近对话】\n${recentText}`, tag: "recent", priority: 60 });

  // 5) 用户输入放最后（动态区）
  blocks.push({ role: "user", content: input.userMessage, tag: "user", priority: 1000 });

  // 6) Token 预算裁剪：从低优先级块开始砍，直到满足 budget
  let messages = blocks.map(b => ({ role: b.role, content: b.content }));
  while (countTokens(messages) > budget) {
    // remove the lowest priority non-user block first
    const idx = blocks
      .map((b, i) => ({ i, p: b.priority, tag: b.tag, role: b.role }))
      .filter(x => !(x.role === "user")) // never remove user input
      .sort((a, b) => a.p - b.p)[0]?.i;

    if (idx === undefined) break;
    blocks.splice(idx, 1);
    messages = blocks.map(b => ({ role: b.role, content: b.content }));
  }

  return { messages };
}
```

```ts
// worker.ts (main request path)
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { convId, userMessage } = await req.json();

    // 1) 读取状态：summary + memories + recent turns
    const [summary, memories, recentTurns] = await Promise.all([
      loadSummary(env.DB, convId),
      loadMemories(env.DB, convId),
      loadRecentTurns(env.DB, convId, /*K=*/8),
    ]);

    // 2) 向量检索（query embedding 这里简化；实际应调用 embedding 服务）
    const queryVector = await embed(userMessage);
    const matches = await env.VECTORIZE.query(queryVector, {
      topK: 12,
      returnMetadata: "all",
    });

    const retrievedChunks = matches.matches
      .filter(m => m.metadata?.conv_id === convId) // 推荐用 metadata index + filter；此处示意 citeturn16view0
      .slice(0, 8)
      .map(m => String(m.metadata?.text ?? ""));

    // 3) Prompt packing（预算管理）
    const { messages } = buildPrompt({
      system: "你是一个严谨的中文助手。回答必须基于证据，必要时说明不确定。",
      summary,
      memories,
      retrievedChunks,
      recentTurns,
      userMessage,
      ctxMax: 128000,     // 可配置
      outReserve: 2048,   // 可配置
    });

    // 4) 调用大模型（建议走 AI Gateway 做观测/缓存/回退）citeturn12view3
    const answer = await callLLM(messages, env.AI_GATEWAY_BASE);

    // 5) 写入本轮 raw turn（确保可回溯）
    await saveTurn(env.DB, convId, { role: "user", content: userMessage });
    await saveTurn(env.DB, convId, { role: "assistant", content: answer });

    // 6) 把“摘要/抽取/embedding/索引更新”丢到队列后台做 citeturn12view2
    await env.QUEUE.send({ convId, userMessage, answer });

    return Response.json({ answer });
  },
};
```

---

## 分步改进计划与优先级

下面给你一个“按性价比排序”的落地路线。工期以“熟悉 Cloudflare Workers 的一名工程师”估算；你可按团队与代码现状调整。

| 优先级阶段 | 目标 | 具体工作项（摘要） | 预估工作量 | 主要风险 | 预期收益 |
|---|---|---|---|---|---|
| 立即可做 | 控制 token、减少无效拼接 | 引入 token 预算管理；改“摘要列表”为单份 running summary（差分更新）；保留最近 K 轮 raw；把用户输入放末尾、静态前缀前置以利缓存（OpenAI/Anthropic 都强调精确前缀匹配）citeturn1view2turn2view2 | 1–3 天 | 裁剪策略不当导致丢关键信息 | 成本立刻下降、溢出减少；为后续缓存与检索打基础 |
| 高优先级 | 从“摘要驱动”升级到“检索驱动” | 引入向量记忆：对 turns/chunks 做 embedding 入库；查询时 TopK 召回；加入去重（Set/MMR）citeturn13search30turn4search1 | 4–10 天 | 召回噪声大；embedding 成本上升 | 细节可回溯；长对话质量显著提升 |
| 高优先级 | 降主链路延迟、提高吞吐 | 用 Cloudflare Queues 把摘要/抽取/embedding/索引更新后台化（offload/batch/retry）citeturn12view2 | 3–7 天 | 并发竞态；幂等与版本管理缺失 | 主请求更快；系统更抗峰值 |
| 中优先级 | 可解释的长期记忆与安全边界 | 抽取结构化记忆条目（偏好/约束/待办），提供用户可编辑/可删除；引入“隐身/不入库”模式（对齐 Claude/ChatGPT 的用户预期）citeturn11view0turn1view3 | 1–2 周 | 错误记忆造成长期误导；隐私合规 | 个性化更稳；减少重复沟通；合规更清晰 |
| 中优先级 | 检索质量与可控成本 | 元数据分桶与过滤（Vectorize metadata index）；时间衰减与重要性加权；过期清理策略（TTL）citeturn16view0turn15view2 | 1–2 周 | 过滤字段选错导致召回受限 | 召回更准；索引膨胀可控 |
| 中后期 | 规模化运营与成本治理 | 接入 Cloudflare AI Gateway：观测 prompts/token/costs，代理缓存/限流/重试/回退；调优缓存命中率 citeturn12view3turn1view2 | 3–7 天 | 日志内容可能包含敏感信息（需脱敏/权限） | 成本、延迟、稳定性可持续优化 |

---

## 参考来源

### 官方文档与帮助中心（优先）

- Anthropic：Claude Memory（项目隔离、可编辑 memory summary、Incognito chat 等）citeturn11view0  
- Anthropic：Projects（独立 workspace/knowledge base；付费计划自动启用 RAG 并扩容最多 10×）citeturn11view1  
- Anthropic：Claude API Prompt Caching（KV cache/哈希、不存原文；cache_control；TTL；20-block lookback；读写计费）citeturn2view0turn2view2  
- OpenAI：ChatGPT Memory FAQ（saved memories / chat history；自动管理；删除与保留日志策略）citeturn1view3  
- OpenAI：Prompt Caching（≥1024 自动启用；精确前缀匹配；最高降 80% 延迟/90% 输入成本；不跨组织共享）citeturn1view2turn14search7  
- OpenAI：Retrieval API / Vector stores（自动 chunk/embedding/index；hybrid_search 调参；计费与过期策略）citeturn6view0turn6view2turn6view4  
- Poe：Prompt Bot Knowledge Base（自动检索相关内容；格式与容量；可开启引用来源）citeturn3view0turn5view1  
- Poe：API Overview（OpenAI 兼容接口；密钥安全建议）citeturn17view0  
- Cloudflare：Vectorize（Worker 内 insert/query；metadata indexes 与过滤；metadata 限制）citeturn15view0turn16view0turn15view1  
- Cloudflare：Queues（offload/buffer/batch、guaranteed delivery、重试/延迟等）citeturn12view2  
- Cloudflare：AI Gateway（提示与 token/成本可观测；缓存、限流、重试、模型回退）citeturn12view3  

### 原始论文与学术资料（原理与算法）

- RAG 原始论文：Lewis et al., 2020，Retrieval-Augmented Generation citeturn9search0  
- MemGPT：用“分层记忆/虚拟上下文”管理长对话与长文档 citeturn9search1  
- Lost in the Middle：长上下文位置偏置（开头/结尾更强，中间更弱）citeturn13search0  
- RRF：Reciprocal Rank Fusion（混合检索融合的经典方法）citeturn13search1  
- MMR：Maximal Marginal Relevance（减少冗余、保持相关与多样）citeturn13search30  
- LongLLMLingua：长上下文提示压缩，降低成本/延迟并缓解位置偏置 citeturn9search6turn9search2  
- KV cache 原理与作用（Transformers 文档）citeturn11view4  
- FlashAttention：说明长序列 attention 的二次成本瓶颈与 IO 优化方向 citeturn18search3  

### 工程框架与实践文档（可落地模式）

- LangChain：ConversationBufferWindowMemory（滑动窗口只保留最近 K 次交互）citeturn14search0turn14search4  
- LlamaIndex：ChatSummaryMemoryBuffer（按 token_limit 迭代摘要，控制成本与延迟）citeturn14search1turn14search9  
- OpenAI Cookbook：如何用 tiktoken 计数 tokens（预算管理基础）citeturn14search10turn14search14  

（注：部分中文“镜像文档/转载解读”可用于阅读便利，但权威性以官方与论文为准；本文在关键机制上均优先引用了官方或原始论文。）