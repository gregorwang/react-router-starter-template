# 分阶段整改计划（2026-02-06）

## 执行进度（更新于 2026-02-06）

- 阶段 1（P0）：已完成（4/4）
  - 附件 key 与媒体路由校验一致性：完成
  - 分享页附件展示与访问：完成
  - 请求体字节上限保护：完成
  - 运行时 DB 初始化职责剥离：完成
- 阶段 2（P1）：主要项已完成（5/5）
  - SSE parser 统一：完成
  - 归档/取消归档 UI 与下载前置提示：完成
  - 新会话未落库动作禁用：完成
  - DB JSON `safeJsonParse`：完成
  - 分享撤销/过期管理：已交付基础能力（含 D1 `expires_at` 迁移），后续扩展按当前范围冻结
- 阶段 3（P2）：已完成（5/5）
  - 分层重构：完成（`conversations.share` 完成；`chat.action` 已拆分为 guards/conversation/rate-limit/stream/persistence + media adapter）
  - 最小测试矩阵：完成（单测 + 路由集成 + 关键 E2E 已落地）
  - E2E 执行状态：`test:e2e` 已可执行并通过（当前 3 条 smoke）
  - 样式系统收敛：完成（共享 `form-styles` + `Button` 已覆盖登录/会话/用量/侧栏/admin 的最后一轮收口）
  - 移动端视口与滚动策略：已完成第二批（移动端禁用 `background-attachment: fixed`，消息列表改为外层 `overflow-x-hidden`）
  - 可访问性焦点态：补齐附件移除按钮与侧栏删除按钮 `focus-visible`
  - 文本可读性：已提升消息元信息与登录说明文案对比度（P2-UI-1）
  - 项目描述可维护性：已补最小入口（创建可填描述、重命名可改描述、侧栏列表可见描述）
  - Worker 错误映射：`ChatRateLimiter` 对非法 JSON 返回 400，避免 500 放大
  - `skipLibCheck` 评估：已完成（当前依赖树存在三方类型阻塞，暂不建议直接关闭）
  - `skipLibCheck` 治理策略：已落地（strict libcheck 引入 baseline 漂移检测，仅新增问题触发失败；日志产物可追踪）
  - 第三方类型深度清理：按当前范围暂缓（后续如需彻底关闭 `skipLibCheck` 再专项推进）

## 阶段 1（P0，1-3 天）
目标：先恢复核心链路稳定性与安全边界。

1. 修复附件 key 与媒体路由校验不一致  
涉及：`app/routes/chat.action.ts`、`app/routes/media.$key.tsx`
2. 修复分享页附件不可见与不可访问  
涉及：`app/routes/s.$token.tsx`、`app/routes/media.$key.tsx`
3. 引入请求体字节上限保护（不依赖 `Content-Length`）  
涉及：`app/routes/chat.action.ts`
4. 将运行时 DB 初始化中的迁移/修复职责剥离  
涉及：`workers/app.ts`、`app/lib/db/conversations.server.ts`

验收标准：
- 聊天上传附件后可在会话和分享页稳定访问。
- 超限请求返回 413，不出现 Worker 内存异常。
- 运行时不再执行高风险迁移逻辑。

## 阶段 2（P1，3-7 天）
目标：降低回归风险并修复高频体验问题。

1. 统一 SSE parser（前后端共用）并补测试  
涉及：`app/lib/llm/llm-server.ts`、`app/hooks/useChat.ts`、`app/routes/chat.action.ts`
2. 补齐归档/取消归档 UI 入口，完善下载前置提示  
涉及：`app/components/layout/Sidebar.tsx`、`app/routes/conversations.tsx`
3. 为“新会话未落库”状态增加动作禁用条件  
涉及：`app/routes/c_.$id.tsx`
4. 对 DB JSON 字段引入 `safeJsonParse`  
涉及：`app/lib/db/conversations.server.ts`、`app/lib/db/share-links.server.ts`
5. 增加分享撤销/过期管理能力  
涉及：`app/routes/conversations.share.ts`、`app/lib/db/share-links.server.ts`

验收标准：
- 流式消息在弱网/分片场景不丢事件。
- 归档、下载、分享流程具备清晰成功路径。
- 脏数据不再触发 500。

## 阶段 3（P2，1-2 周）
目标：提升长期可维护性与 UI 一致性。

1. 推进 `routes -> services -> repositories` 分层重构
2. 建立最小测试矩阵（单测 + 路由集成 + 关键 E2E）
3. 收敛样式系统（按钮/输入框/焦点态统一）
4. 移动端视口与滚动策略优化（`dvh`、overflow 策略）
5. 评估并修正 `skipLibCheck` 策略

验收标准：
- 关键模块具备可回归测试。
- 样式实现减少重复与漂移。
- 移动端与可访问性问题显著下降。

## 建议负责人分工
1. 平台后端：P0 的请求边界、初始化职责、媒体鉴权。
2. 前端产品：P0/P1 的附件展示、分享体验、归档入口。
3. 工程效率：测试基建、SSE parser 公共模块、类型治理。
