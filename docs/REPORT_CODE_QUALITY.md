# 代码规范与可维护性评审

## 结构与分层
- 目录结构整体清晰（`app/routes`、`app/components`、`app/lib`），便于理解。
- 但同时存在 **旧实现残留** 与 **重复逻辑**，会显著增加维护成本。

## 主要问题（按影响度）
### P1 — 可维护性/一致性
- **缩进与格式不一致**：项目约定使用 Tab + 双引号，但 `app/routes/chat.action.ts`、`app/routes/conversations.delete.ts` 等文件混用了空格缩进。
- **重复逻辑**：token 估算在 `useChat`、`chat.action`、`summary.server` 多处实现，建议集中到一个 util。
- **命名冲突**：`useChat` 同时存在于 hook 与 context，调用时需要 alias；建议改名（如 `useChatContext`）。
- **SSE 解析可能丢数据**：服务端在 `chat.action` 中直接 `split(\"\\n\")` 且未维护缓冲区，跨 chunk 的 JSON 行可能被丢弃（客户端有缓冲实现）。建议统一 SSE 解析逻辑。`app/routes/chat.action.ts`。

### P2 — 冗余/死代码
- **未使用的本地存储实现**：`app/lib/storage/conversation-store.ts`、`app/hooks/useConversations.ts`、`app/components/layout/ChatLayout.tsx` 已被 D1 架构替代，建议移除或明确弃用。
- **客户端 LLM Provider 残留**：`app/lib/llm/client.ts` 与 `app/lib/llm/providers/*`（openai/anthropic/google/deepseek）目前未被引用，容易误导维护者。
- **CodeBlock 中未使用逻辑**：`app/components/chat/CodeBlock.tsx` 定义了复制逻辑但未使用。

### P3 — 细节与一致性
- **路由重复**：`conversations/backup` 与 `conversations/archive` 都映射到同一文件，建议保留一个正式入口。
- **删除接口语义不清**：`fetcher.Form` 使用 `method=\"delete\"`，但 DELETE 请求体兼容性较弱，可能导致 `conversationId` 丢失；建议改 POST 或用 query param。`app/routes/conversations.delete.ts`、`app/components/layout/SidebarItem.tsx`。
- **项目创建逻辑分散**：列表页与对话页使用不同的提交方式（fetcher vs fetch），建议抽成统一 hook。`app/routes/conversations.tsx`、`app/routes/c_.$id.tsx`。
- **多余 console.log**：生产日志噪音较多，建议替换为结构化日志或移除。

## 代码卫生问题（仓库根目录）
- 发现异常文件与日志残留：`EOF`、`*.log`、`CUsers汪家俊react-router-starter-templateapproutestest-localstorage.tsx`。
- 建议清理，并确保 `.gitignore` 已覆盖。

## 类型与接口一致性
- `app/env.d.ts` 中缺少 `DB`、`AI`、`CHAT_ARCHIVE` 等 Worker 绑定的类型声明，容易引发类型漂移。

## 建议（可维护性提升路线）
1) 清理本地存储/客户端 LLM 旧代码，保留唯一主路径（服务器端 LLM）。
2) 统一格式化规则（Tab + 双引号），避免混排。
3) 抽出公共 util：`estimateTokens`、SSE 解析等。
4) 统一错误处理与日志规范（服务端集中记录、客户端展示简洁信息）。
