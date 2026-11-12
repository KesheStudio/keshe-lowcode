// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 迁移执行器：generated 在前、custom 在后；已应用版本跳过；每份脚本一个事务。
// 版本号取文件名（去掉 .sql），记录在 schema_migrations 表里。
// 回滚脚本放在 migrations/down/，文件名与版本号一致，例如 0002_add_items_owner.sql。
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use sqlx::AnyPool;

use crate::generated::db::adapt_sql;

const MIGRATIONS_DIR: &str = "migrations";
const DOWN_DIR: &str = "migrations/down";
const VERSION_MAX: usize = 64;

struct Migration {
    version: String,
    path: PathBuf,
    sql: String,
}

/// 执行全部待应用的 up 迁移，返回本次实际应用的版本列表。
pub async fn up(pool: &AnyPool) -> Result<Vec<String>> {
    ensure_table(pool).await?;

    let applied: HashSet<String> =
        sqlx::query_scalar::<_, String>("SELECT version FROM schema_migrations")
            .fetch_all(pool)
            .await
            .context("读取已应用迁移失败")?
            .into_iter()
            .collect();

    let migrations = collect_up()?;
    let mut applied_now = Vec::new();

    for migration in migrations {
        if applied.contains(&migration.version) {
            continue;
        }
        let mut tx = pool.begin().await.context("开启迁移事务失败")?;
        for statement in split_statements(&migration.sql) {
            let sql = adapt_sql(pool, &statement);
            sqlx::query(&sql).execute(&mut *tx).await.with_context(|| {
                format!(
                    "迁移 {} 执行失败（{}）",
                    migration.version,
                    migration.path.display()
                )
            })?;
        }
        let insert = adapt_sql(
            pool,
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        );
        sqlx::query(&insert)
            .bind(&migration.version)
            .bind(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .execute(&mut *tx)
            .await
            .context("记录迁移版本失败")?;
        tx.commit().await.context("提交迁移事务失败")?;
        tracing::info!(version = %migration.version, "已应用迁移");
        applied_now.push(migration.version);
    }

    Ok(applied_now)
}

/// 回滚「版本号最大的、且存在 down 脚本」的一个已应用迁移。
pub async fn down(pool: &AnyPool) -> Result<Option<String>> {
    ensure_table(pool).await?;

    let versions: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT version FROM schema_migrations ORDER BY version DESC",
    )
    .fetch_all(pool)
    .await
    .context("读取已应用迁移失败")?;

    for version in versions {
        let path = PathBuf::from(DOWN_DIR).join(format!("{version}.sql"));
        if !path.is_file() {
            continue;
        }
        let sql = std::fs::read_to_string(&path)
            .with_context(|| format!("读取回滚脚本失败：{}", path.display()))?;
        let mut tx = pool.begin().await.context("开启回滚事务失败")?;
        for statement in split_statements(&sql) {
            let sql = adapt_sql(pool, &statement);
            sqlx::query(&sql)
                .execute(&mut *tx)
                .await
                .with_context(|| format!("回滚 {version} 执行失败（{}）", path.display()))?;
        }
        let delete = adapt_sql(pool, "DELETE FROM schema_migrations WHERE version = ?");
        sqlx::query(&delete)
            .bind(&version)
            .execute(&mut *tx)
            .await
            .context("删除迁移记录失败")?;
        tx.commit().await.context("提交回滚事务失败")?;
        tracing::info!(version = %version, "已回滚迁移");
        return Ok(Some(version));
    }

    Ok(None)
}

async fn ensure_table(pool: &AnyPool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version VARCHAR(64) PRIMARY KEY,
           applied_at VARCHAR(32) NOT NULL
         )",
    )
    .execute(pool)
    .await
    .context("创建 schema_migrations 表失败")?;
    Ok(())
}

fn collect_up() -> Result<Vec<Migration>> {
    let root = Path::new(MIGRATIONS_DIR);
    if !root.exists() {
        bail!("找不到 migrations 目录：请从 server/ 目录启动，或把 migrations 一起拷贝过去");
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for zone in ["generated", "custom"] {
        let dir = root.join(zone);
        if !dir.exists() {
            continue;
        }
        for path in sorted_sql_files(&dir)? {
            let version = file_stem(&path);
            if version.len() > VERSION_MAX {
                bail!("迁移版本号超过 {VERSION_MAX} 个字符：{version}");
            }
            if !seen.insert(version.clone()) {
                bail!("迁移版本号重复：{version}（generated 与 custom 的文件名必须唯一）");
            }
            let sql = std::fs::read_to_string(&path)
                .with_context(|| format!("读取迁移文件失败：{}", path.display()))?;
            out.push(Migration { version, path, sql });
        }
    }
    Ok(out)
}

fn sorted_sql_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .with_context(|| format!("读取迁移目录失败：{}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().map(|ext| ext == "sql").unwrap_or(false))
        .collect();
    files.sort();
    Ok(files)
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn split_statements(sql: &str) -> Vec<String> {
    sql.split(';')
        .map(str::trim)
        .filter(|statement| {
            !statement.is_empty()
                && !statement
                    .lines()
                    .all(|line| line.trim().is_empty() || line.trim_start().starts_with("--"))
        })
        .map(str::to_string)
        .collect()
}
