-- [LC-GENERATED] 集合数据行表：集合定义来自 collectionsDir 下的 JSON，这里只存行的字段数据。
-- 主键用 (collection_id, id)，data 存字段 JSON 文本；列类型以三套数据库通用为准。

CREATE TABLE IF NOT EXISTS collection_rows (
  collection_id VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL,
  data TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (collection_id, id)
);
