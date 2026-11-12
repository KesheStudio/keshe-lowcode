-- [LC-CUSTOM] 用户区：回滚脚本，平台永远不会覆盖这里。
-- 与 migrations/generated/0002_add_items_owner.sql 对应，文件名必须与版本号一致。
-- `--migrate-down` 会挑选「已应用且存在本文件」的最大版本执行一次。

ALTER TABLE items DROP COLUMN owner;
