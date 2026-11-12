// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// 新增接口的扩展点：在这里注册，不会影响 src/generated 里的路由。
// 重新生成时本文件原样保留。
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::generated::error::ok;
use crate::generated::state::SharedState;

pub fn register(router: Router<SharedState>) -> Router<SharedState> {
    router.route("/api/custom/example", get(example))
}

// 示例处理器：可以直接删掉，或照着它加自己的接口。
async fn example(State(state): State<SharedState>) -> Json<Value> {
    ok(json!({
        "message": "这是用户区自定义接口",
        "uptimeSeconds": state.started.elapsed().as_secs(),
    }))
}
