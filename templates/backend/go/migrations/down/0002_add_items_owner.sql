-- [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
-- 0002_add_items_owner.sql 的回滚脚本：文件名必须与 up 文件同名。
-- 只有在 migrations/down 里存在同名文件的已应用版本才会被 --migrate-down 回滚。

ALTER TABLE items DROP COLUMN owner;
