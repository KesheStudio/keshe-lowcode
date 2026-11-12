-- [LC-GENERATED] 平台生成区：重新生成会替换本目录。
-- 用户新增的迁移放 migrations/custom/，那里永远不会被覆盖。
-- 迁移语句按分号切分执行，SQL 字符串里不要出现分号。
-- 建表语句保持 SQLite / MySQL / PostgreSQL 通用；索引放 0002 之后的独立迁移，
-- 因为 MySQL 8 不支持 CREATE INDEX IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS items (
  id          VARCHAR(64) PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  created_at  VARCHAR(32) NOT NULL,
  updated_at  VARCHAR(32) NOT NULL
);
