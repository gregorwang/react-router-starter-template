# 事故调查报告：用户名+密码登录 500

- 日期：2026-02-05
- 服务：ai.wangjiajun.asia（Cloudflare Workers + D1）
- 影响范围：仅用户名+密码登录路径
- 严重性：中（存在临时后门登录绕过，但正常登录不可用）

## 摘要

用户在云端使用 管理员用户名 + 密码登录时，/login.data 返回 500，并触发前端通用错误页（Oops! An unexpected error occurred）。仅填写密码（AUTH_PASSWORD 后门登录）可以正常进入系统。

## 影响

- 用户名+密码登录不可用，所有需要账户密码验证的登录方式失败。
- 通过 AUTH_PASSWORD 后门登录仍可使用，业务可临时继续，但降低了正常登录可用性。

## 发现与诊断

- 发现方式：用户反馈云端登录 500。
- 现象：
  - POST /login.data（带用户名+密码）返回 500。
  - POST /login.data（仅带密码）返回 200/302，可登录。
- 初步结论：
  - 500 发生在用户名+密码登录路径，仅此路径会调用 erifyPassword()。
  - 由于后门登录路径不调用 erifyPassword() 且能登录，故错误最可能发生在密码校验流程。

## 根因分析

**最可能根因：**
- 在 Cloudflare Workers 运行时，erifyPassword() 里使用的 WebCrypto PBKDF2 派生流程出现异常或不兼容，导致抛错并返回 500。
- 异常未被捕获，直接触发 React Router 的 SanitizedError。

**证据链（间接）：**
- 500 仅在用户名+密码路径出现。
- 该路径唯一新增逻辑为 erifyPassword()。
- 后门登录可用，说明数据库连接和 Session 写入正常。

## 处置措施

- **短期绕过：**
  - 在生产 D1 创建 dmin 用户，并保留 AUTH_PASSWORD 后门登录，保证系统可用。
- **代码修复：**
  - 在 erifyPassword() 中加入 Node.js crypto PBKDF2 作为 fallback。
  - 即使 WebCrypto 异常或不一致，也能完成密码校验。

相关修改文件：
- pp/lib/auth/password.server.ts

## 时间线（2026-02-05）

1. 用户反馈云端用户名+密码登录返回 500。
2. 确认后门登录可用，定位到登录校验路径差异。
3. 作为临时绕过在 D1 创建 dmin 用户，确保可用性。
4. 加入 PBKDF2 校验兼容修复（WebCrypto + Node.js crypto fallback）。
5. 输出本事故报告。

## 预防与改进

1. 增加登录路径的结构化日志（失败原因、异常类型）。
2. 在 CI 或预生产环境增加密码校验回归测试。
3. 记录并固化 D1 管理员初始化/重置流程。
4. 提供运维 Runbook（如何验证登录路径、如何查看 Cloudflare 日志）。

## 结论

本次事故为运行时密码校验异常导致的 500 错误，已通过兼容性修复和后门登录绕过保证系统可用。后续将通过日志与测试完善，避免同类问题再次出现。
