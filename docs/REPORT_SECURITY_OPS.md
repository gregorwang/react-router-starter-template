# 安全 / 性能 / 运维深度评审

## 安全风险（优先级）
### P0（必须立刻修复）
- **认证可伪造**：固定 Cookie 值 `rr_auth=1` 无签名、无服务端校验，任何人可绕过登录。`app/lib/auth.server.ts`。
- **XSS 风险**：模型输出 Markdown 未消毒，直接 `dangerouslySetInnerHTML`。`app/lib/utils/markdown.ts`、`app/components/chat/MessageBubble.tsx`。

### P1（高风险）
- **限流被禁用**：`enforceRateLimit` 无条件放行，滥用与成本风险。`app/routes/chat.action.ts`。
- **错误信息泄露**：上游错误原样回传，可能暴露实现/供应商细节。`app/lib/llm/llm-server.ts`、`app/routes/chat.action.ts`。
- **安全 Header 缺失**：缺少 CSP/HSTS/Referrer-Policy/Permissions-Policy/X-Content-Type-Options，且未设置 `Cache-Control: no-store`。`app/entry.server.tsx`。

### P2（中风险）
- **R2 访问范围过宽**：`/conversations/archive` 可通过 `key` 获取任意对象；若桶为共享，存在数据泄露风险。`app/routes/conversations.archive.ts`。
- **CSRF 风险**：敏感操作均依赖 Cookie，未设置 CSRF token；虽使用 `SameSite=Lax`，但仍建议关键操作使用 POST + CSRF Token。
- **本地秘钥暴露风险**：`.dev.vars` 中存在真实 API Key 与密码，需确认未被提交。建议立即轮换。

## 性能与稳定性
- **请求无上限**：`/chat/action` 未限制请求体大小、消息数或输出长度，易被滥用导致内存/费用升高。
- **全量写入 D1**：保存对话时删除并重建全部消息，长对话性能退化明显。
- **运行期建表/迁移**：冷启动执行建表/ALTER，增加延迟与失败风险。
- **SSE 断连处理弱**：客户端断开时不主动终止上游请求；可能浪费计算。

## 运维与可观测性
- Wrangler observability 已开启，但缺少结构化日志与指标。
- 无健康检查路由，问题只能依靠用户报错。

## 改进建议（可执行）
1) **认证**：使用签名 Cookie（HMAC + secret）或 D1/KV 会话表；退出时废弃 token。
2) **Markdown 安全**：引入 HTML sanitizer（如 DOMPurify）或禁用 HTML 渲染。
3) **限流**：恢复限流逻辑，dev 环境可绕过，prod 必须开启。
4) **安全响应头**：至少添加 CSP + HSTS + Referrer-Policy + Permissions-Policy + X-Content-Type-Options；对登录后页面加 `Cache-Control: no-store`。
5) **请求限制**：限制消息长度/数量与最大响应体大小；超过时直接拒绝。
6) **R2 Key 限制**：仅允许 `conversationId`，由服务端拼 key，禁止任意 key。
7) **密钥管理**：仅在 `.dev.vars` 保存本地开发 key，生产用 `wrangler secret put`。
