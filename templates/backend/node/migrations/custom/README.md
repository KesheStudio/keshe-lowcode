# 用户迁移目录

把自定义迁移放这里，文件名用 `0003_xxx.sql` 递增，生成器永远不会覆盖本目录。

- 只写一条语句最稳；多条语句用分号分隔，runner 会切分执行。
- 迁移必须可重复执行：优先 `CREATE TABLE IF NOT EXISTS`；`ALTER TABLE` 由 `schema_migrations` 记录保证只跑一次。
- 需要回滚时，在 `../down/` 放同名文件（如 `../down/0003_xxx.sql`），再运行回滚命令。
