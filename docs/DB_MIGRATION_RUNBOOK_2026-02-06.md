# D1 迁移执行手册（2026-02-06）

## 变更背景
- 已将 D1 迁移目录固定为：`app/lib/db/migrations`
- Worker 运行时迁移已改为显式开关：
1. `DB_RUNTIME_MIGRATIONS`
2. `DB_RUNTIME_ADMIN_BOOTSTRAP`

生产默认建议：两个都关闭，仅使用离线迁移。

## 已落地内容
1. `wrangler.json` 已配置 `migrations_dir: "app/lib/db/migrations"`
2. 新增初始迁移：`app/lib/db/migrations/0001_initial_schema.sql`
3. 新增分享过期迁移：`app/lib/db/migrations/0002_share_link_expires_at.sql`
4. 新增命令：
   - `npm run db:migrate:local`
   - `npm run db:migrate:remote`

## 本次执行记录
1. `2026-02-06` 已执行 `npm run db:migrate:remote`
2. 已成功应用：`0001_initial_schema.sql`、`0002_share_link_expires_at.sql`

## 推荐执行流程（生产）
1. 先执行远程迁移  
`npm run db:migrate:remote`
2. 再部署 Worker  
`npm run deploy`
3. 确保未开启运行时迁移  
`DB_RUNTIME_MIGRATIONS=false`
4. 如无需要，不开启管理员运行时引导  
`DB_RUNTIME_ADMIN_BOOTSTRAP=false`

## 兼容旧库说明
如果历史库结构缺列，且当前还未整理成离线升级脚本，可临时使用一次运行时迁移：
1. 临时设置 `DB_RUNTIME_MIGRATIONS=true`
2. 访问一次服务触发升级
3. 立即改回 `false`

该步骤只建议作为过渡方案，不建议长期开启。
