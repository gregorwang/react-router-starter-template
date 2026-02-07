# 技术架构评审（2026-02-06）

## 高优先级问题（P0）

### 1) 请求体大小限制可被绕过
- 现象：当前仅依赖 `Content-Length` 进行体积校验，缺失该 header 时仍会执行 JSON 解析。
- 风险：可被大体积请求放大内存占用，导致 Worker 压力与潜在拒绝服务。
- 位置：`app/routes/chat.action.ts:77`
- 建议：
1. 封装统一的“带字节上限 JSON 解析器”（无 `Content-Length` 也生效）。
2. 对输入增加硬上限（例如 1MB）并返回 413。

### 2) 运行时初始化耦合迁移/修复逻辑
- 现象：数据库初始化流程中包含建表、迁移、索引、历史数据修复、管理员引导。
- 风险：冷启动变慢、并发初始化竞态、环境漂移、回滚困难。
- 位置：`workers/app.ts:17`、`app/lib/db/conversations.server.ts:678`
- 建议：
1. 迁移下沉到离线流程（`wrangler d1 migrations`）。
2. 运行时只做 schema 版本检查和健康探针。
3. 管理员引导与数据修复拆为独立管理任务。

### 3) 附件媒体路由与存储 key 规则不一致
- 现象：写入 key 采用 `att_` 前缀，但读取校验限制为 `img_` 前缀。
- 风险：上传成功但读取失败，造成功能断链和用户数据不可见。
- 位置：`app/routes/chat.action.ts:652`、`app/routes/media.$key.tsx:12`
- 建议：
1. 统一 key 前缀策略。
2. 以资源元数据做授权校验（userId/conversationId），而非仅靠字符串前缀。

## 中优先级问题（P1）

### 4) 初始化 Promise 失败后会长期“污染”
- 现象：`dbInitPromise` 首次失败后，后续请求持续 await 失败结果。
- 风险：单次异常扩大为长期不可用。
- 位置：`workers/app.ts:17`
- 建议：失败后清空 Promise，并做退避重试与告警。

### 5) `chat.action` 职责过重
- 现象：单个 action 同时承担鉴权、限流、LLM 调用、媒体写入、会话持久化、缓存失效。
- 风险：变更成本高，测试难，回归风险大。
- 位置：`app/routes/chat.action.ts:71`
- 建议：拆分为 `ChatService + Repository + Adapter`，路由层仅做校验与编排。

### 6) 脏数据缺少容错解析
- 现象：多处直接 `JSON.parse` DB 字段。
- 风险：单条坏数据触发 500。
- 位置：`app/lib/db/conversations.server.ts:209`、`app/lib/db/share-links.server.ts:100`
- 建议：统一 `safeJsonParse`，解析失败降级并记录告警。

### 7) 对话保存采用“先删后插”
- 现象：消息保存先删除整会话消息再批量重插。
- 风险：长对话性能差、写放大明显、并发覆盖风险增加。
- 位置：`app/lib/db/conversations.server.ts:456`
- 建议：改为 append/upsert 或差量写入。

### 8) 在线统计查询偏重
- 现象：会话页加载时存在聚合与 `json_extract` 查询。
- 风险：数据增长后响应波动明显。
- 位置：`app/lib/db/conversations.server.ts:228`、`app/routes/conversations.tsx:33`
- 建议：增加 KV 缓存或预聚合表。

## 低优先级问题（P2）
- 请求参数解析与字段校验在多个 action 重复实现  
位置：`app/routes/projects.create.ts:11`、`app/routes/conversations.archive.ts:16`
- 归档数据缺少大小/条数约束  
位置：`app/routes/conversations.archive.ts:34`
- 初始化模块包含业务修复逻辑，职责不纯  
位置：`app/lib/db/conversations.server.ts:801`

## 结构调整建议（目标状态）
1. `routes/*` 仅做协议层逻辑（鉴权、参数、响应码）。  
2. `services/*` 负责业务编排（会话、分享、归档）。  
3. `repositories/*` 负责 D1 读写与映射。  
4. `adapters/*` 负责 R2/KV/AI/DO 外部依赖。  
5. 引入统一 `validation + error mapping + telemetry`。  
