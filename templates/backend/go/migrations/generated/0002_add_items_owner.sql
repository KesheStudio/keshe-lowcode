-- [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
-- 演示：给 items 增加 owner 列。回滚脚本在 migrations/down/0002_add_items_owner.sql。
-- 迁移语句按分号切分执行，SQL 字符串里不要出现分号。

ALTER TABLE items ADD COLUMN owner VARCHAR(64) NOT NULL DEFAULT '';
