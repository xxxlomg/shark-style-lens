mod config;
mod provider;
mod stream;

use axum::body::Body;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::header::{self, HeaderName, HeaderValue};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{body::Bytes, Json, Router};
use config::{ConfigStore, ConfigUpdateError};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tower_http::cors::{Any, CorsLayer};

pub use config::{
    config_path_from_env, default_config, is_allowed_provider_base_url,
    ConfigStore as UserConfigStore,
};
pub const DEFAULT_API_PORT: u16 = config::DEFAULT_API_PORT;
pub const DEFAULT_API_SECRET: &str = config::DEFAULT_API_SECRET;

#[derive(Clone)]
pub struct ApiSettings {
    pub port: u16,
    pub secret: String,
    pub config_path: PathBuf,
    pub public_dir: PathBuf,
    pub embedded_public: bool,
    routes: Vec<Arc<dyn ApiRoute>>,
}

impl Default for ApiSettings {
    fn default() -> Self {
        Self::from_env()
    }
}

impl ApiSettings {
    pub fn from_env() -> Self {
        let public_dir = std::env::var("STYLELENS_PUBLIC_DIR")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join("public")
            });
        Self {
            port: std::env::var("PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .filter(|port: &u16| *port > 0)
                .unwrap_or(DEFAULT_API_PORT),
            secret: std::env::var("STYLELENS_API_SECRET")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.trim().to_string())
                .unwrap_or_else(|| DEFAULT_API_SECRET.to_string()),
            config_path: config_path_from_env(),
            public_dir,
            embedded_public: false,
            routes: Vec::new(),
        }
    }

    pub fn with_port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    pub fn with_secret(mut self, secret: impl Into<String>) -> Self {
        self.secret = secret.into();
        self
    }

    pub fn with_config_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.config_path = path.into();
        self
    }

    pub fn with_public_dir(mut self, path: impl Into<PathBuf>) -> Self {
        self.public_dir = path.into();
        self
    }

    pub fn with_embedded_public(mut self, enabled: bool) -> Self {
        self.embedded_public = enabled;
        self
    }

    pub fn with_route(mut self, route: Arc<dyn ApiRoute>) -> Self {
        self.routes.push(route);
        self
    }
}

#[derive(Clone)]
pub struct ApiContext {
    pub config: ConfigStore,
    pub public_dir: Arc<PathBuf>,
    pub embedded_public: bool,
    secret: Arc<String>,
}

impl ApiContext {
    fn new(settings: &ApiSettings) -> Self {
        Self {
            config: ConfigStore::new(settings.config_path.clone()),
            public_dir: Arc::new(settings.public_dir.clone()),
            embedded_public: settings.embedded_public,
            secret: Arc::new(settings.secret.clone()),
        }
    }

    pub fn is_authorized(&self, headers: &HeaderMap) -> bool {
        let Some(value) = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
        else {
            return false;
        };
        let Some(token) = value
            .strip_prefix("Bearer ")
            .or_else(|| value.strip_prefix("bearer "))
        else {
            return false;
        };
        !token.is_empty() && token == self.secret.as_str()
    }

    pub fn protected_router(&self, router: Router<ApiContext>) -> Router<ApiContext> {
        router.layer(middleware::from_fn_with_state(self.clone(), require_auth))
    }
}

pub trait ApiRoute: Send + Sync + 'static {
    fn router(&self, context: &ApiContext) -> Router<ApiContext>;
}

pub struct ApiService {
    settings: ApiSettings,
    context: ApiContext,
}

impl ApiService {
    pub fn new(settings: ApiSettings) -> Self {
        let context = ApiContext::new(&settings);
        Self { settings, context }
    }

    pub fn context(&self) -> &ApiContext {
        &self.context
    }

    pub fn router(&self) -> Router {
        let protected_config = self
            .context
            .protected_router(Router::new().route("/", get(get_config).put(put_config)));
        let mut api = Router::new()
            .route("/health", get(health))
            .nest("/config", protected_config);
        api = api
            .nest(
                "/prompt",
                self.context.protected_router(stream::prompt_router()),
            )
            .nest(
                "/prompt/vision",
                self.context.protected_router(stream::vision_router()),
            );
        for route in &self.settings.routes {
            api = api.merge(route.router(&self.context));
        }

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::PUT, Method::OPTIONS])
            .allow_headers(Any);

        Router::new()
            .nest("/api", api.layer(cors))
            .route("/assets/{*path}", get(asset))
            .route("/stylelens.zip", get(zip))
            .route("/stylelens.crx", get(crx))
            .fallback(get(index))
            .with_state(self.context.clone())
    }

    pub async fn start(self) -> Result<ApiServer, ApiError> {
        ApiServer::start(self).await
    }
}

pub struct ApiServer {
    address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<Result<(), std::io::Error>>>,
}

impl ApiServer {
    pub async fn start(service: ApiService) -> Result<Self, ApiError> {
        let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), service.settings.port);
        let listener = TcpListener::bind(address).await.map_err(ApiError::Bind)?;
        let address = listener.local_addr().map_err(ApiError::Bind)?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(listener, service.router())
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
        });
        Ok(Self {
            address,
            shutdown: Some(shutdown_tx),
            task: Some(task),
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    pub async fn shutdown(mut self) -> Result<(), ApiError> {
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
        if let Some(task) = self.task.take() {
            task.await
                .map_err(ApiError::Join)?
                .map_err(ApiError::Serve)?;
        }
        Ok(())
    }
}

#[derive(Debug)]
pub enum ApiError {
    Bind(std::io::Error),
    Serve(std::io::Error),
    Join(tokio::task::JoinError),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Bind(error) => write!(formatter, "unable to bind StyleLens API: {error}"),
            Self::Serve(error) => write!(formatter, "StyleLens API stopped with an error: {error}"),
            Self::Join(error) => write!(formatter, "StyleLens API task failed: {error}"),
        }
    }
}

impl std::error::Error for ApiError {}

async fn require_auth(
    State(context): State<ApiContext>,
    request: Request<Body>,
    next: Next,
) -> Response {
    if !context.is_authorized(request.headers()) {
        return error_response(
            StatusCode::UNAUTHORIZED,
            "E_AUTH_FAILED",
            "Invalid shared secret",
        );
    }
    next.run(request).await
}

async fn health(
    State(context): State<ApiContext>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let config = context.config.read();
    let provider = &config["provider"];
    let configured = !provider["apiKey"].as_str().unwrap_or_default().is_empty();
    let analysis_mode = config["analysisMode"].as_str().unwrap_or("multimodal");
    let agent_vision = !configured;
    let vision = if configured {
        json!({
            "model": provider["visionModel"],
            "vision": true
        })
    } else {
        Value::Null
    };
    let vision_dispatch = if analysis_mode != "multimodal" {
        "skip"
    } else if configured {
        "vision"
    } else {
        "delegate"
    };
    let connection = if analysis_mode == "template" {
        json!({
            "ok": true,
            "kind": "template",
            "message": "template-mode"
        })
    } else if query.get("probe").map(String::as_str) == Some("1") {
        probe_connection(&config).await
    } else {
        json!({
            "ok": true,
            "kind": "local",
            "message": "local-service-ok"
        })
    };
    Json(json!({
        "status": "ok",
        "provider": "deepseek",
        "configured": configured,
        "modelConfig": {
            "analysisMode": analysis_mode,
            "agent": {
                "model": provider["agentModel"],
                "vision": agent_vision
            },
            "vision": vision,
            "visionDispatch": vision_dispatch
        },
        "connection": connection
    }))
}

async fn probe_connection(config: &Value) -> Value {
    let provider = &config["provider"];
    let api_key = provider["apiKey"].as_str().unwrap_or_default();
    if api_key.is_empty() {
        return json!({
            "ok": false,
            "kind": "local",
            "message": "api-key-not-configured"
        });
    }
    let base_url = provider["baseUrl"]
        .as_str()
        .unwrap_or("https://api.deepseek.com")
        .trim_end_matches('/');
    let endpoint = format!("{base_url}/models");
    let result = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .ok()
        .map(|client| async move { client.get(endpoint).bearer_auth(api_key).send().await });
    let Some(result) = result else {
        return json!({
            "ok": false,
            "kind": "deepseek",
            "message": "remote-unreachable"
        });
    };
    match result.await {
        Ok(response) => json!({
            "ok": response.status().is_success(),
            "kind": "deepseek",
            "message": if response.status().is_success() {
                "remote-ok"
            } else {
                "remote-http"
            }
        }),
        Err(_) => json!({
            "ok": false,
            "kind": "deepseek",
            "message": "remote-unreachable"
        }),
    }
}

async fn get_config(State(context): State<ApiContext>) -> Json<Value> {
    Json(context.config.public())
}

async fn put_config(State(context): State<ApiContext>, body: Bytes) -> Response {
    let body = match serde_json::from_slice::<Value>(&body) {
        Ok(body) => body,
        Err(_) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "E_INVALID_PAYLOAD",
                "Request body must be JSON",
            )
        }
    };

    match context.config.update(&body) {
        Ok(public) => Json(public).into_response(),
        Err(ConfigUpdateError::Invalid { code, message }) => {
            error_response(StatusCode::BAD_REQUEST, code, &message)
        }
        Err(ConfigUpdateError::Io(error)) => {
            eprintln!("[StyleLens API] config:update-failed error={error}");
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "E_CONFIG_WRITE_FAILED",
                "Unable to save local configuration",
            )
        }
    }
}

async fn asset(State(context): State<ApiContext>, AxumPath(path): AxumPath<String>) -> Response {
    serve_file(&context, &format!("assets/{path}"), None).await
}

async fn zip(State(context): State<ApiContext>) -> Response {
    serve_file(&context, "stylelens.zip", Some("stylelens.zip")).await
}

async fn crx(State(context): State<ApiContext>) -> Response {
    let _ = context;
    StatusCode::NOT_FOUND.into_response()
}

async fn index(State(context): State<ApiContext>) -> Response {
    serve_file(&context, "index.html", None).await
}

async fn serve_file(context: &ApiContext, relative: &str, download_name: Option<&str>) -> Response {
    let Some(path) = safe_public_path(&context.public_dir, relative) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let bytes = if context.embedded_public {
        let Some(bytes) = embedded_file(relative) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        bytes.to_vec()
    } else {
        match tokio::fs::read(path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return StatusCode::NOT_FOUND.into_response()
            }
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
    };

    let content_type = mime_type(relative);
    let mut response = Response::new(Body::from(bytes));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    if let Some(download_name) = download_name {
        response.headers_mut().insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{download_name}\""))
                .expect("static download name is a valid header"),
        );
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

fn embedded_file(relative: &str) -> Option<&'static [u8]> {
    match relative {
        "index.html" => Some(include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../services/api/public/index.html"
        ))),
        "stylelens.zip" => Some(include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../services/api/public/stylelens.zip"
        ))),
        "assets/stylelens-icon-128.png" => Some(include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../services/api/public/assets/stylelens-icon-128.png"
        ))),
        "assets/stylelens-icon.svg" => Some(include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../services/api/public/assets/stylelens-icon.svg"
        ))),
        _ => None,
    }
}

fn safe_public_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let relative = percent_decode(relative)?;
    if relative.contains('\0') {
        return None;
    }
    let path = Path::new(&relative);
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return None;
    }
    Some(root.join(path))
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = hex(bytes[index + 1])?;
            let low = hex(bytes[index + 2])?;
            decoded.push(high << 4 | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn mime_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("zip") => "application/zip",
        Some("crx") => "application/x-chrome-extension",
        _ => "application/octet-stream",
    }
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "error": { "code": code, "message": message } })),
    )
        .into_response()
}

pub fn sse_event(event: &str, data: &str) -> String {
    let mut output = format!("event: {event}\n");
    for line in data.lines() {
        output.push_str("data: ");
        output.push_str(line);
        output.push('\n');
    }
    output.push('\n');
    output
}

pub fn sse_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(
        HeaderName::from_static("x-accel-buffering"),
        HeaderValue::from_static("no"),
    );
    headers
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tower::ServiceExt;

    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "stylelens-rust-api-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("assets")).unwrap();
        fs::write(path.join("index.html"), "<html>ok</html>").unwrap();
        fs::write(path.join("assets/test.txt"), "asset").unwrap();
        fs::write(path.join("stylelens.zip"), b"zip").unwrap();
        path
    }

    fn service(public_dir: PathBuf, config_path: PathBuf) -> ApiService {
        ApiService::new(
            ApiSettings::default()
                .with_secret("test-secret")
                .with_public_dir(public_dir)
                .with_config_path(config_path),
        )
    }

    async fn body(response: Response) -> Value {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn health_is_public_and_config_is_protected() {
        let directory = temp_dir();
        let config_path = directory.join("config.json");
        let app = service(directory.clone(), config_path.clone()).router();

        let health = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        assert_eq!(body(health).await["status"], "ok");

        let denied = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);

        let allowed = app
            .oneshot(
                Request::builder()
                    .uri("/api/config")
                    .header(header::AUTHORIZATION, "Bearer test-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
        assert_eq!(body(allowed).await["apiKeyConfigured"], false);
        let _ = fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn config_put_and_static_routes_match_contract() {
        let directory = temp_dir();
        let config_path = directory.join("config.json");
        let app = service(directory.clone(), config_path.clone()).router();
        let update = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri("/api/config")
                    .header(header::AUTHORIZATION, "Bearer test-secret")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"apiKey":"sk-test-secret","analysisMode":"text"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(update.status(), StatusCode::OK);
        let public = body(update).await;
        assert_eq!(public["apiKeyHint"], "sk-…cret");
        assert!(public.get("apiKey").is_none());
        assert!(fs::read_to_string(&config_path)
            .unwrap()
            .contains("sk-test-secret"));

        let index = app
            .clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(index.status(), StatusCode::OK);
        assert_eq!(
            index.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );

        let asset = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/assets/test.txt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(asset.status(), StatusCode::OK);

        let zip = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/stylelens.zip")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(zip.status(), StatusCode::OK);
        assert_eq!(
            zip.headers()[header::CONTENT_DISPOSITION],
            "attachment; filename=\"stylelens.zip\""
        );

        let crx = app
            .oneshot(
                Request::builder()
                    .uri("/stylelens.crx")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(crx.status(), StatusCode::NOT_FOUND);
        let _ = fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn prompt_and_vision_stream_routes_match_extension_contract() {
        let directory = temp_dir();
        let config_path = directory.join("config.json");
        let app = service(directory.clone(), config_path).router();
        let prompt = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/prompt/stream")
                    .header(header::AUTHORIZATION, "Bearer test-secret")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"profile":{"version":"0.1.0","target":{"uid":"t-1","tagName":"button"},"context":{},"layout":{},"typography":{},"visual":{},"facts":[{"property":"display","value":"inline-flex","source":"computed"}],"inferences":[],"warnings":[]},"options":{}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(prompt.status(), StatusCode::OK);
        let prompt_body = String::from_utf8(
            axum::body::to_bytes(prompt.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(prompt_body.contains("event: prompt_start"));
        assert!(prompt_body.contains("event: prompt_chunk"));
        assert!(prompt_body.contains("event: prompt_complete"));

        let vision = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/prompt/vision/stream")
                    .header(header::AUTHORIZATION, "Bearer test-secret")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"task":"inspect the crop","images":["data:image/png;base64,AAAA"]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(vision.status(), StatusCode::OK);
        let vision_body = String::from_utf8(
            axum::body::to_bytes(vision.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(vision_body.contains("event: vision_start"));
        assert!(vision_body.contains("event: vision_result"));
        assert!(vision_body.contains("event: vision_complete"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn sse_helpers_keep_the_provider_contract_small() {
        assert_eq!(
            sse_event("prompt_chunk", "line 1\nline 2"),
            "event: prompt_chunk\ndata: line 1\ndata: line 2\n\n"
        );
        assert_eq!(
            sse_headers()[header::CONTENT_TYPE],
            "text/event-stream; charset=utf-8"
        );
    }
}
