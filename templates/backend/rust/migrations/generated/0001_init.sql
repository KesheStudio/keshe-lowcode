-- [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
-- 0001_init.sql
-- 演示资源表；新增业务表请另起 0002_xxx.sql 放到 migrations/custom/，不要改已执行过的文件。
-- 迁移语句按分号切分执行，SQL 字符串里不要出现分号。
-- 列类型选择以三套数据库通用为准：MySQL 不允许 TEXT 直接做主键，也不能给 TEXT 写 DEFAULT。

CREATE TABLE IF NOT EXISTS items (
  id          VARCHAR(64) PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  created_at  VARCHAR(32) NOT NULL,
  updated_at  VARCHAR(32) NOT NULL
);
