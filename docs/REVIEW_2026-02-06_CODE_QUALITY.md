# 代码规范与工程质量评审（2026-02-06）

## 结论
代码可编译，但“类型安全 + 测试保障 + 协议一致性”三个基础面仍偏弱，建议优先补齐。

## 主要问题

### P1-1: SSE 解析实现不规范且前后端重复
- 现象：按换行切片并假设单行 JSON，分片/多行 `data:` 场景可能丢事件。
- 影响：流式消息丢失、UI 不更新、落库内容不完整。
- 位置：`app/lib/llm/llm-server.ts:953`、`app/routes/chat.action.ts:577`、`app/hooks/useChat.ts:344`
- 建议：
1. 抽象统一 SSE parser（前后端共用）。
2. 覆盖多行 data、chunk 边界、事件终止等测试。

### P1-2: 缺少自动化测试基线
- 现象：`package.json` 无 `test` 脚本，仓库未见系统化测试。
- 影响：高频改动区域缺少回归保护。
- 位置：`package.json:45`
- 建议：
1. 引入 `vitest`，先覆盖纯函数与关键 action。
2. 增加最小 E2E（登录、发送消息、分享、归档）。

### P1-3: `any` 与未校验外部数据较多
- 现象：LLM 响应、D1 行映射、工具链数据中存在 `any` 与弱校验。
- 影响：上游字段漂移后易出现隐式运行时错误。
- 位置：`app/lib/llm/llm-server.ts:955`、`app/lib/db/conversations.server.ts:190`
- 建议：
1. 增加运行时 schema 校验（如 zod）。
2. 将 DB row -> domain model 转换集中到 mapper 层。

### P1-4: 脏 JSON 直接解析
- 现象：DB 字段直接 `JSON.parse`。
- 影响：异常数据导致 500。
- 位置：`app/lib/db/conversations.server.ts:209`、`app/lib/db/share-links.server.ts:100`
- 建议：统一 `safeJsonParse` + 监控埋点。

### P2-1: 错误处理一致性不足
- 现象：部分接口对 `request.json()` 异常未显式捕获。
- 影响：非法请求被放大为 500。
- 位置：`workers/app.ts:85`
- 建议：规范化 400/422 返回策略与错误格式。
- 当前状态（2026-02-07）：`ChatRateLimiter` 已对非法 JSON 返回 400（`application/json`），避免 500 放大。

### P2-2: 命名语义偏差
- 现象：`ImageAttachment` 类型实际承载多种文件类型。
- 影响：维护者理解成本增加。
- 位置：`app/lib/llm/types.ts:9`
- 建议：改为更中性命名（`Attachment`）或按类型拆分。
- 当前状态（2026-02-07）：已引入 `Attachment` 作为主类型，并保留 `ImageAttachment` 兼容别名，逐步迁移调用方。

### P2-3: 编译配置掩盖类型问题
- 现象：`skipLibCheck: true`。
- 影响：依赖类型破坏可能被延后暴露。
- 位置：`tsconfig.json:8`
- 建议：CI 中增加定期全量类型检查任务。
- 当前状态（2026-02-07）：已新增 `Strict Lib Check` workflow（`.github/workflows/strict-libcheck.yml`），按周执行并支持手动触发，失败日志保留为 artifact。
- 治理方式：引入基线漂移检测脚本（`scripts/strict-libcheck-check.mjs` + `config/strict-libcheck-baseline.txt`），仅在出现“新增”三方类型漂移时告警/失败。

## 建议补齐的最小测试集
1. `validateChatActionData` 输入边界测试（空值/超长/非法字段）。
2. SSE parser 分片与多行事件测试。
3. 会话持久化映射测试（含脏 JSON）。
4. 限流器边界测试（窗口切换、并发冲突）。
5. 分享与附件访问链路集成测试。
