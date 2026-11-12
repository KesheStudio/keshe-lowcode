-- [LC-GENERATED] 集合数据行表：集合定义来自 collections/*.json，行数据统一存这里。
-- 主键用 (collection_id, id)，三个库都不需要额外建索引即可按集合查询。

CREATE TABLE IF NOT EXISTS collection_rows (
  collection_id VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL,
  data TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (collection_id, id)
);
