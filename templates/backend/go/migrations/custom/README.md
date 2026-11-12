# [LC-CUSTOM] 用户区：平台永远不会覆盖这个目录

放你自己的迁移脚本，文件名建议 `0003_add_xxx.sql`、`0004_xxx.sql`，按名称排序执行。
平台生成的迁移在 `../generated/`，重新生成会整块替换；你的脚本不要放那边。

## 执行顺序与记录

- 启动服务或执行 `--migrate` 时，按 `generated/` → `custom/` 顺序，再按文件名排序执行。
- 已应用的版本记录在 `schema_migrations(version VARCHAR(64) PRIMARY KEY, applied_at VARCHAR(32))`，version 形如 `custom/0003_add_xxx.sql`。
- 已执行过的文件不要修改，要改就新增一个更高编号的迁移。
- 每条语句用分号结尾；SQL 字符串字面量里不要出现分号。
- 每个迁移在一个事务里执行；MySQL 的 DDL 会隐式提交，属正常现象。
- 占位符统一写 `?`，PostgreSQL 由模板自动改写为 `$1..$n`。

## 回滚

- 回滚脚本放在 `migrations/down/`，文件名与 up 文件**同名**，例如 `migrations/down/0003_add_xxx.sql`。
- 执行 `--migrate-down` 会回滚“最新一个有对应 down 文件的已应用版本”，并删除该版本记录；可以重复执行逐级回滚。
- 没有 down 文件的历史版本不会被自动回滚，需要手工处理。
