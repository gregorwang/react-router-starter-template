# 产品功能与页面/CSS评审（2026-02-06）

## 产品功能问题

### P0-1: 聊天附件上传后无法访问
- 现象：附件已写入 R2，但媒体路由前缀校验不匹配。
- 位置：`app/routes/chat.action.ts:652`、`app/routes/media.$key.tsx:12`
- 影响：聊天内附件不可见，核心体验断裂。
- 建议：统一 key 规则并改为元数据鉴权。

### P0-2: 分享页不展示附件且公开访问受限
- 现象：分享页只渲染文本内容；媒体路由还依赖登录态/前缀。
- 位置：`app/routes/s.$token.tsx:1`、`app/routes/media.$key.tsx:12`
- 影响：外部分享内容不完整，功能价值显著下降。
- 建议：为分享场景提供受控公共资源访问策略。

### P1-1: 归档能力后端有、前端入口缺失
- 现象：接口支持 `archive/unarchive`，但会话菜单无归档操作。
- 位置：`app/routes/conversations.update.ts:1`、`app/components/layout/Sidebar.tsx:1`
- 影响：“已归档”筛选存在但难以产生数据。
- 建议：补全归档/取消归档入口和反馈状态。

### P1-2: 下载行为缺少前置引导
- 现象：未先归档到 R2 时点击下载容易 404。
- 位置：`app/routes/conversations.tsx:1`、`app/routes/conversations.archive.ts:1`
- 影响：用户感知为“功能坏了”。
- 建议：下载前判断归档状态并提供一步式引导。

### P1-3: 新会话未落库时仍可触发清理/归档
- 现象：占位会话可触发需要持久化 ID 的动作，返回 not found。
- 位置：`app/routes/c_.$id.tsx:241`、`app/routes/conversations.clear-context.ts:1`
- 影响：操作失败率高，降低可信度。
- 建议：前端禁用条件增加“已持久化且有消息”判定。

### P1-4: 分享缺少撤销与过期管理
- 现象：有 `revoked_at` 字段，但缺撤销路由与界面。
- 位置：`app/routes/conversations.share.ts:1`、`app/lib/db/share-links.server.ts:1`
- 影响：运营与安全不可控。
- 建议：提供撤销、过期策略与审计日志。

### P2-1: 项目描述字段无可视化维护入口
- 现象：后端支持 `description`，前端创建/编辑流程未覆盖。
- 位置：`app/routes/projects.create.ts:1`、`app/components/layout/Sidebar.tsx:1`
- 影响：数据字段价值未释放。
- 建议：在项目创建与编辑弹层中补齐描述字段。
- 当前状态（2026-02-07）：已补最小维护入口（创建项目可填写描述，重命名时可编辑描述，侧栏可见描述）。

## 页面布局与 CSS 问题

### P1-UI-1: 移动端 `h-screen` 导致可视区域问题
- 现象：移动浏览器地址栏伸缩时会产生裁切或空白。
- 位置：`app/routes/c_.$id.tsx:241`、`app/components/layout/Sidebar.tsx:413`
- 建议：移动端改为 `dvh/min-h-[100dvh]`。

### P1-UI-2: `background-attachment: fixed` 移动端性能风险
- 现象：iOS/低端机常见滚动卡顿与背景抖动。
- 位置：`app/app.css:64`
- 建议：小屏禁用 fixed，或使用伪元素背景层。
- 当前状态（2026-02-07）：已在移动端媒体查询下切换为 `background-attachment: scroll`。

### P1-UI-3: 横向滚动策略冲突
- 现象：消息容器与代码块均可横向滚动，易出现双滚动条。
- 位置：`app/components/chat/MessageList.tsx:106`
- 建议：外层 `overflow-x-hidden`，只保留代码块横向滚动。
- 当前状态（2026-02-07）：消息列表外层已切换 `overflow-x-hidden`，代码块保留横向滚动。

### P2-UI-1: 低对比文本可读性偏弱
- 位置：`app/components/chat/MessageBubble.tsx:107`、`app/routes/login.tsx:165`
- 建议：提升前景色或提高背景不透明度，满足 WCAG AA。
- 当前状态（2026-02-07）：已提升聊天消息元信息、流式提示、登录页说明文案与输入区提示文本对比度。

### P2-UI-2: 部分交互控件缺少可见焦点态
- 位置：`app/components/layout/SidebarItem.tsx:44`、`app/components/chat/InputArea.tsx:226`
- 建议：统一补齐 `focus-visible` 样式系统。
- 当前状态（2026-02-07）：已补齐侧栏删除按钮与附件移除按钮焦点态。

### P2-UI-3: 表单样式在多个页面重复且不一致
- 位置：`app/routes/login.tsx:176`、`app/routes/conversations.tsx:100`、`app/components/chat/InputArea.tsx:284`
- 建议：抽象统一 `Button/Input` 设计令牌与组件。

## 结论
产品主流程具备基础形态，但附件与分享链路问题已影响“可用性底线”；UI 层建议以“移动端适配 + 无障碍 + 样式收敛”作为下一阶段重点。
