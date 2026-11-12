// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// items 表的存取实现。想换数据库/换成外部服务，只改这个文件即可。
// 连接池是 sqlx AnyPool：SQLite / MySQL / PostgreSQL 共用，源码统一写 `?` 占位符。
use sqlx::any::AnyRow;
use sqlx::{AnyPool, Row};

use crate::generated::db::adapt_sql;
use crate::generated::models::Item;

/// sqlx 的 MySQL 驱动把 `TEXT` 识别为 BLOB，直接按 `String` 解码会报
/// “String is not compatible with BLOB”。这里按驱动分支：MySQL 先取原始字节再转 UTF-8，
/// SQLite / PostgreSQL 直接按 `String` 解码。写入不受影响，TEXT 列可以直接绑定字符串。
fn is_mysql(pool: &AnyPool) -> bool {
    pool.connect_options().database_url.scheme() == "mysql"
}

fn row_to_item(row: &AnyRow, mysql: bool) -> sqlx::Result<Item> {
    let body = if mysql {
        let bytes: Vec<u8> = row.try_get("body")?;
        String::from_utf8(bytes).map_err(|err| sqlx::Error::Decode(Box::new(err)))?
    } else {
        row.try_get("body")?
    };
    Ok(Item {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        body,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub async fn list_items(pool: &AnyPool, limit: i64, offset: i64) -> sqlx::Result<(Vec<Item>, i64)> {
    let sql = adapt_sql(
        pool,
        "SELECT id, title, body, created_at, updated_at
         FROM items
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?",
    );
    let mysql = is_mysql(pool);
    let rows = sqlx::query(&sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
    let items = rows
        .iter()
        .map(|row| row_to_item(row, mysql))
        .collect::<sqlx::Result<Vec<Item>>>()?;

    let count_sql = adapt_sql(pool, "SELECT COUNT(*) FROM items");
    let total: i64 = sqlx::query_scalar(&count_sql).fetch_one(pool).await?;

    Ok((items, total))
}

pub async fn get_item(pool: &AnyPool, id: &str) -> sqlx::Result<Option<Item>> {
    let sql = adapt_sql(
        pool,
        "SELECT id, title, body, created_at, updated_at FROM items WHERE id = ?",
    );
    let mysql = is_mysql(pool);
    let row = sqlx::query(&sql).bind(id).fetch_optional(pool).await?;
    match row {
        Some(row) => Ok(Some(row_to_item(&row, mysql)?)),
        None => Ok(None),
    }
}

pub async fn create_item(pool: &AnyPool, title: &str, body: &str) -> sqlx::Result<Item> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let item = Item {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        body: body.to_string(),
        created_at: now.clone(),
        updated_at: now,
    };

    let sql = adapt_sql(
        pool,
        "INSERT INTO items (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    sqlx::query(&sql)
        .bind(&item.id)
        .bind(&item.title)
        .bind(&item.body)
        .bind(&item.created_at)
        .bind(&item.updated_at)
        .execute(pool)
        .await?;

    Ok(item)
}

pub async fn update_item(
    pool: &AnyPool,
    id: &str,
    title: &str,
    body: &str,
) -> sqlx::Result<Option<Item>> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let sql = adapt_sql(
        pool,
        "UPDATE items SET title = ?, body = ?, updated_at = ? WHERE id = ?",
    );
    let result = sqlx::query(&sql)
        .bind(title)
        .bind(body)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Ok(None);
    }

    get_item(pool, id).await
}

pub async fn delete_item(pool: &AnyPool, id: &str) -> sqlx::Result<bool> {
    let sql = adapt_sql(pool, "DELETE FROM items WHERE id = ?");
    let result = sqlx::query(&sql).bind(id).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}
