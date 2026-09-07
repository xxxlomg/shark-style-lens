use super::provider::{PromptChunkKind, Provider, ProviderConfig};
use super::{error_response, sse_event, sse_headers, ApiContext};
use async_stream::stream;
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::convert::Infallible;
use uuid::Uuid;

pub fn prompt_router() -> Router<ApiContext> {
    Router::new().route("/stream", post(prompt))
}

pub fn vision_router() -> Router<ApiContext> {
    Router::new().route("/stream", post(vision))
}

async fn prompt(State(context): State<ApiContext>, body: Bytes) -> Response {
    let body = match parse_json(body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (profile, options, images) = match validate_prompt(&body) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let config = context.config.read();
    let provider = Provider::new(ProviderConfig::from_config(&config));
    let trace_id = Uuid::new_v4().to_string();
    let started = std::time::Instant::now();
    let mut upstream = provider.stream_prompt(profile, options, images);
    let body = stream! {
        yield Ok::<Bytes, Infallible>(Bytes::from(sse_event("ping", "{}")));
        yield Ok(Bytes::from(sse_event("prompt_start", "{}")));
        let mut content_count = 0;
        while let Some(result) = upstream.next().await {
            match result {
                Ok(chunk) => {
                    let event = match chunk.kind {
                        PromptChunkKind::Reasoning => "prompt_reasoning_chunk",
                        PromptChunkKind::Content => {
                            content_count += 1;
                            "prompt_chunk"
                        }
                    };
                    yield Ok(Bytes::from(sse_event(
                        event,
                        &serde_json::to_string(&json!({ "text": chunk.text })).unwrap(),
                    )));
                }
                Err(error) => {
                    yield Ok(Bytes::from(sse_event(
                        "prompt_error",
                        &serde_json::to_string(&json!({
                            "code": error.code(),
                            "message": error.to_string(),
                            "recoverable": error.recoverable()
                        })).unwrap(),
                    )));
                    return;
                }
            }
        }
        if content_count > 0 {
            yield Ok(Bytes::from(sse_event(
                "prompt_complete",
                &serde_json::to_string(&json!({
                    "promptId": Uuid::new_v4().to_string(),
                    "traceId": trace_id,
                    "durationMs": started.elapsed().as_millis()
                })).unwrap(),
            )));
        } else {
            yield Ok(Bytes::from(sse_event(
                "prompt_error",
                &serde_json::to_string(&json!({
                    "code": "E_PROVIDER_INVALID_OUTPUT",
                    "message": "Agent returned no reconstruction prompt content",
                    "recoverable": false
                })).unwrap(),
            )));
        }
    };
    streaming_response(body, sse_headers())
}

async fn vision(State(context): State<ApiContext>, body: Bytes) -> Response {
    let body = match parse_json(body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (task, images, image_detail) = match validate_vision(&body) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let config = context.config.read();
    let provider_config = ProviderConfig::from_config(&config);
    let trace_id = Uuid::new_v4().to_string();
    if provider_config.analysis_mode != "multimodal" {
        return Json(json!({
            "available": false,
            "reason": format!("vision disabled by analysis mode: {}", provider_config.analysis_mode),
            "traceId": trace_id
        }))
        .into_response();
    }

    let source = if provider_config.api_key.is_empty() {
        "delegate"
    } else {
        "vision"
    };
    let provider = Provider::new(provider_config);
    let detail = image_detail.unwrap_or_else(|| "auto".to_string());
    let body = stream! {
        yield Ok::<Bytes, Infallible>(Bytes::from(sse_event(
            "ping",
            "{}"
        )));
        yield Ok(Bytes::from(sse_event(
            "vision_start",
            &serde_json::to_string(&json!({
                "source": source,
                "traceId": trace_id
            })).unwrap(),
        )));
        match provider.complete_vision(task, images, &detail).await {
            Ok(analysis) => {
                let text = serde_json::to_string(&analysis).unwrap();
                yield Ok(Bytes::from(sse_event(
                    "vision_chunk",
                    &serde_json::to_string(&json!({ "text": text })).unwrap(),
                )));
                yield Ok(Bytes::from(sse_event(
                    "vision_result",
                    &serde_json::to_string(&json!({
                        "source": source,
                        "analysis": analysis
                    })).unwrap(),
                )));
                yield Ok(Bytes::from(sse_event(
                    "vision_complete",
                    &serde_json::to_string(&json!({
                        "source": source,
                        "structured": true
                    })).unwrap(),
                )));
            }
            Err(error) => {
                yield Ok(Bytes::from(sse_event(
                    "vision_error",
                    &serde_json::to_string(&json!({
                        "code": error.code(),
                        "message": error.to_string(),
                        "recoverable": error.recoverable()
                    })).unwrap(),
                )));
            }
        }
    };
    streaming_response(body, sse_headers())
}

fn streaming_response<S>(body: S, mut headers: HeaderMap) -> Response
where
    S: futures_util::Stream<Item = Result<Bytes, Infallible>> + Send + 'static,
{
    headers.insert(
        axum::http::header::CONNECTION,
        axum::http::HeaderValue::from_static("keep-alive"),
    );
    let mut response = Response::new(Body::from_stream(body));
    *response.headers_mut() = headers;
    response
}

fn parse_json(body: Bytes) -> Result<Value, Response> {
    serde_json::from_slice(&body).map_err(|_| {
        error_response(
            StatusCode::BAD_REQUEST,
            "E_INVALID_PAYLOAD",
            "Request body must be JSON",
        )
    })
}

fn validate_prompt(body: &Value) -> Result<(Value, Value, Vec<Value>), Response> {
    let Some(object) = body.as_object() else {
        return Err(invalid_payload("Request body must be an object"));
    };
    let Some(profile) = object.get("profile").filter(|value| value.is_object()) else {
        return Err(invalid_payload("Request body failed validation: profile"));
    };
    if !profile["version"].is_string()
        || !profile["target"].is_object()
        || !profile["target"]["uid"].is_string()
        || !profile["target"]["tagName"].is_string()
        || !profile["context"].is_object()
        || !profile["layout"].is_object()
        || !profile["typography"].is_object()
        || !profile["visual"].is_object()
        || !profile["facts"].is_array()
        || !profile["inferences"].is_array()
        || !profile["warnings"].is_array()
    {
        return Err(invalid_payload("Request body failed validation: profile"));
    }
    if let Some(path) = find_sensitive_payload(profile, "$.profile") {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "E_SENSITIVE_PAYLOAD",
            &format!("Payload contains prohibited sensitive data at {path}"),
        ));
    }
    let options = object.get("options").cloned().unwrap_or_else(|| json!({}));
    if !options.is_object() {
        return Err(invalid_payload("Request body failed validation: options"));
    }
    let images = object
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if images.len() > 8 {
        return Err(invalid_payload("Request body failed validation: images"));
    }
    validate_images(&images)?;
    Ok((profile.clone(), options, images))
}

fn validate_vision(body: &Value) -> Result<(String, Vec<Value>, Option<String>), Response> {
    let Some(object) = body.as_object() else {
        return Err(invalid_payload("Request body must be an object"));
    };
    let Some(task) = object.get("task").and_then(Value::as_str) else {
        return Err(invalid_payload("Request body failed validation: task"));
    };
    if task.trim().is_empty() {
        return Err(invalid_payload("Request body failed validation: task"));
    }
    let Some(images) = object.get("images").and_then(Value::as_array) else {
        return Err(invalid_payload("Request body failed validation: images"));
    };
    if images.is_empty() || images.len() > 8 {
        return Err(invalid_payload("Request body failed validation: images"));
    }
    validate_images(images)?;
    let detail = object
        .get("imageDetail")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(value) = &detail {
        if !matches!(value.as_str(), "low" | "high" | "original" | "auto") {
            return Err(invalid_payload(
                "Request body failed validation: imageDetail",
            ));
        }
    }
    Ok((task.to_string(), images.clone(), detail))
}

fn validate_images(images: &[Value]) -> Result<(), Response> {
    for image in images {
        if let Some(data_url) = image.as_str() {
            if !valid_data_url(data_url) {
                return Err(invalid_payload("Request body failed validation: images"));
            }
            continue;
        }
        let Some(object) = image.as_object() else {
            return Err(invalid_payload("Request body failed validation: images"));
        };
        let valid_kind = matches!(
            object.get("kind").and_then(Value::as_str),
            Some("target" | "context")
        );
        let valid_space =
            object.get("coordinateSpace").and_then(Value::as_str) == Some("viewport-css");
        let valid_data = object
            .get("dataUrl")
            .and_then(Value::as_str)
            .map(valid_data_url)
            .unwrap_or(false);
        let valid_size = object
            .get("width")
            .and_then(Value::as_f64)
            .map(|v| v > 0.0)
            .unwrap_or(false)
            && object
                .get("height")
                .and_then(Value::as_f64)
                .map(|v| v > 0.0)
                .unwrap_or(false);
        let crop = object.get("crop").and_then(Value::as_object);
        let valid_crop = crop
            .map(|value| {
                matches!(
                    value.get("kind").and_then(Value::as_str),
                    Some("target" | "context")
                ) && value.get("coordinateSpace").and_then(Value::as_str) == Some("viewport-css")
                    && value.get("left").and_then(Value::as_f64).is_some()
                    && value.get("top").and_then(Value::as_f64).is_some()
                    && value
                        .get("width")
                        .and_then(Value::as_f64)
                        .map(|v| v > 0.0)
                        .unwrap_or(false)
                    && value
                        .get("height")
                        .and_then(Value::as_f64)
                        .map(|v| v > 0.0)
                        .unwrap_or(false)
            })
            .unwrap_or(false);
        if !(valid_kind && valid_space && valid_data && valid_size && valid_crop) {
            return Err(invalid_payload("Request body failed validation: images"));
        }
    }
    Ok(())
}

fn valid_data_url(value: &str) -> bool {
    value.len() <= 12_000_000 && value.starts_with("data:image/png;base64,")
}

fn find_sensitive_payload(value: &Value, path: &str) -> Option<String> {
    if let Some(items) = value.as_array() {
        for (index, item) in items.iter().enumerate() {
            if let Some(found) = find_sensitive_payload(item, &format!("{path}[{index}]")) {
                return Some(found);
            }
        }
        return None;
    }
    if let Some(object) = value.as_object() {
        for (key, item) in object {
            if matches!(
                key.to_ascii_lowercase().as_str(),
                "password"
                    | "authorization"
                    | "cookie"
                    | "localstorage"
                    | "sessionstorage"
                    | "indexeddb"
            ) {
                return Some(format!("{path}.{key}"));
            }
            if let Some(found) = find_sensitive_payload(item, &format!("{path}.{key}")) {
                return Some(found);
            }
        }
        return None;
    }
    value.as_str().and_then(|text| {
        let lower = text.to_ascii_lowercase();
        [
            "bearer ",
            "api_key=",
            "api key=",
            "password=",
            "authorization=",
            "cookie=",
        ]
        .iter()
        .any(|pattern| lower.contains(pattern))
        .then(|| path.to_string())
    })
}

fn invalid_payload(message: &str) -> Response {
    error_response(StatusCode::BAD_REQUEST, "E_INVALID_PAYLOAD", message)
}
