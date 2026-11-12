// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 只做路由装配。新增接口请去 src/custom/routes.rs，不要改这里。
pub mod collections;
pub mod health;
pub mod items;
pub mod meta;

use axum::Router;

use crate::generated::state::SharedState;

pub fn register(router: Router<SharedState>) -> Router<SharedState> {
    router
        .merge(health::routes())
        .merge(meta::routes())
        .merge(items::routes())
        .merge(collections::routes())
        .merge(crate::generated::auth::routes())
}
