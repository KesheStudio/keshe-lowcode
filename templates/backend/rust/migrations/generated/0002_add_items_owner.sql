-- [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
-- 0002_add_items_owner.sql
-- 版本号取文件名（去掉 .sql），回滚脚本放 migrations/down/0002_add_items_owner.sql。

ALTER TABLE items ADD COLUMN owner VARCHAR(64) NOT NULL DEFAULT '';
