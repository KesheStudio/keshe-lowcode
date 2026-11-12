-- [LC-CUSTOM] 用户区：回滚脚本，永远不会被生成器覆盖。
-- 与 generated/0002_add_items_owner.sql 对应；执行 `npm run migrate:down` 会运行本文件。

ALTER TABLE items DROP COLUMN owner;
