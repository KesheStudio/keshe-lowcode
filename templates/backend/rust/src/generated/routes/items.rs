// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 这里只负责“把 URL 接到用户区处理器”。改接口行为请改 src/custom/items.rs。
use axum::routing::get;
use axum::Router;

use crate::custom::items as handlers;
use crate::generated::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/items", get(handlers::list).post(handlers::create))
        .route(
            "/api/items/{id}",
            get(handlers::get_one)
                .put(handlers::update)
                .delete(handlers::remove),
        )
}
