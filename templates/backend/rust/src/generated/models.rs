// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// AnyPool 下没有统一的 derive 支持，这里手写 FromRow，列名与迁移保持一致。
use sqlx::any::AnyRow;
use sqlx::Row;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

impl<'r> sqlx::FromRow<'r, AnyRow> for Item {
    fn from_row(row: &'r AnyRow) -> Result<Self, sqlx::Error> {
        Ok(Self {
            id: row.try_get("id")?,
            title: row.try_get("title")?,
            body: row.try_get("body")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}
