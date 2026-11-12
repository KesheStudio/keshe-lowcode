-- [LC-GENERATED] 演示“加字段”的迁移。
-- 三种数据库都支持 ADD COLUMN ... DEFAULT ''；MySQL 8 的 DDL 会隐式提交，
-- 失败时请按 README 的回滚说明人工核对后再重跑。

ALTER TABLE items ADD COLUMN owner VARCHAR(64) NOT NULL DEFAULT '';
