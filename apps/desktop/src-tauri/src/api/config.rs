use serde_json::{json, Map, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const DEFAULT_API_PORT: u16 = 3001;
pub const DEFAULT_API_SECRET: &str = "stylelens-dev";
const USER_CONFIG_VERSION: u64 = 1;
const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
const DEFAULT_AGENT_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_VISION_MODEL: &str = "deepseek-v4-flash-vision-exp";

#[derive(Clone)]
pub struct ConfigStore {
    path: Arc<PathBuf>,
    write_lock: Arc<Mutex<()>>,
}

#[derive(Debug)]
pub enum ConfigUpdateError {
    Invalid { code: &'static str, message: String },
    Io(io::Error),
}

impl ConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path: Arc::new(path),
            write_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn from_env() -> Self {
        Self::new(config_path_from_env())
    }

    pub fn path(&self) -> &Path {
        self.path.as_ref()
    }

    pub fn read(&self) -> Value {
        let _guard = self.write_lock.lock().expect("config lock poisoned");
        self.read_unlocked()
    }

    pub fn public(&self) -> Value {
        to_public_config(&self.read(), self.path())
    }

    pub fn update(&self, patch: &Value) -> Result<Value, ConfigUpdateError> {
        let _guard = self.write_lock.lock().expect("config lock poisoned");
        let current = self.read_unlocked();
        let next = apply_patch(current, patch)?;
        write_atomic(self.path(), &next).map_err(ConfigUpdateError::Io)?;
        Ok(to_public_config(&next, self.path()))
    }

    fn read_unlocked(&self) -> Value {
        match fs::read_to_string(self.path()) {
            Ok(contents) => match serde_json::from_str::<Value>(&contents) {
                Ok(value) => normalize_config(value),
                Err(error) => {
                    eprintln!(
                        "[StyleLens API] config:read-failed path={} error={error}",
                        self.path().display()
                    );
                    default_config()
                }
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => default_config(),
            Err(error) => {
                eprintln!(
                    "[StyleLens API] config:read-failed path={} error={error}",
                    self.path().display()
                );
                default_config()
            }
        }
    }
}

pub fn default_config() -> Value {
    json!({
        "version": USER_CONFIG_VERSION,
        "provider": {
            "name": "deepseek",
            "apiKey": "",
            "baseUrl": DEFAULT_BASE_URL,
            "agentModel": DEFAULT_AGENT_MODEL,
            "visionModel": DEFAULT_VISION_MODEL
        },
        "analysisMode": "multimodal",
        "thinkingEnabled": false,
        "reasoningEffort": "high",
        "api": { "port": DEFAULT_API_PORT }
    })
}

pub fn config_path_from_env() -> PathBuf {
    if let Some(path) = non_empty_env("STYLELENS_CONFIG_FILE") {
        return resolve_path(path);
    }

    if let Some(directory) = non_empty_env("STYLELENS_CONFIG_DIR") {
        return resolve_path(directory).join("config.json");
    }

    if let Some(app_data) = non_empty_env("APPDATA") {
        return PathBuf::from(app_data)
            .join("shark")
            .join("shark-style-lens")
            .join("config.json");
    }

    if cfg!(windows) {
        let roaming = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("AppData")
            .join("Roaming")
            .join("shark")
            .join("shark-style-lens");
        return roaming.join("config.json");
    }

    let config_home = non_empty_env("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config")
        });
    config_home
        .join("shark")
        .join("shark-style-lens")
        .join("config.json")
}

pub fn is_allowed_provider_base_url(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty()
        || value.chars().any(char::is_whitespace)
        || value.contains('?')
        || value.contains('#')
    {
        return false;
    }

    let Some((scheme, remainder)) = value.split_once("://") else {
        return false;
    };
    let scheme = scheme.to_ascii_lowercase();
    let authority_end = remainder.find('/').unwrap_or_else(|| remainder.len());
    let authority = &remainder[..authority_end];
    if authority.is_empty() || authority.contains('@') {
        return false;
    }

    let (host, port) = if authority.starts_with('[') {
        let Some(end) = authority.find(']') else {
            return false;
        };
        let host = &authority[1..end];
        let port = authority[end + 1..].strip_prefix(':');
        (host, port)
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) if !port.contains(':') => (host, Some(port)),
            _ => (authority, None),
        }
    };

    if host.is_empty() || !valid_port(port) {
        return false;
    }

    let host = host.to_ascii_lowercase();
    let official = scheme == "https" && host == "api.deepseek.com";
    let loopback = (scheme == "http" || scheme == "https")
        && matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1");
    official || loopback
}

fn apply_patch(mut current: Value, patch: &Value) -> Result<Value, ConfigUpdateError> {
    let Some(patch) = patch.as_object() else {
        return Err(ConfigUpdateError::Invalid {
            code: "E_INVALID_PAYLOAD",
            message: "Configuration body must be an object".to_string(),
        });
    };

    let provider = current
        .get_mut("provider")
        .and_then(Value::as_object_mut)
        .expect("normalized config provider must be an object");

    for key in ["apiKey", "baseUrl", "agentModel", "visionModel"] {
        let Some(value) = patch.get(key) else {
            continue;
        };
        let Some(value) = value.as_str() else {
            return Err(invalid_payload(key));
        };
        let value = value.trim();
        if key != "apiKey" && value.is_empty() {
            return Err(invalid_payload(key));
        }
        if key == "baseUrl" && !is_allowed_provider_base_url(value) {
            return Err(ConfigUpdateError::Invalid {
                code: "E_INVALID_BASE_URL",
                message: "Base URL must be api.deepseek.com or a loopback development proxy"
                    .to_string(),
            });
        }
        provider.insert(key.to_string(), Value::String(value.to_string()));
    }

    if let Some(value) = patch.get("analysisMode") {
        let valid = matches!(value.as_str(), Some("template" | "text" | "multimodal"));
        if !valid {
            return Err(invalid_payload("analysisMode"));
        }
        current["analysisMode"] = value.clone();
    }
    if let Some(value) = patch.get("thinkingEnabled") {
        if !value.is_boolean() {
            return Err(invalid_payload("thinkingEnabled"));
        }
        current["thinkingEnabled"] = value.clone();
    }
    if let Some(value) = patch.get("reasoningEffort") {
        let valid = matches!(value.as_str(), Some("low" | "high" | "max"));
        if !valid {
            return Err(invalid_payload("reasoningEffort"));
        }
        current["reasoningEffort"] = value.clone();
    }

    Ok(normalize_config(current))
}

fn normalize_config(value: Value) -> Value {
    let defaults = default_config();
    let Some(input) = value.as_object() else {
        return defaults;
    };
    let default_provider = defaults["provider"].as_object().expect("default provider");
    let input_provider = input
        .get("provider")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let input_api = input
        .get("api")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let api_key = string_value(&input_provider, "apiKey").unwrap_or_default();
    let base_url = string_value(&input_provider, "baseUrl")
        .filter(|value| is_allowed_provider_base_url(value))
        .unwrap_or_else(|| default_provider["baseUrl"].as_str().unwrap().to_string());
    let agent_model = non_empty(string_value(&input_provider, "agentModel"))
        .unwrap_or_else(|| default_provider["agentModel"].as_str().unwrap().to_string());
    let vision_model =
        non_empty(string_value(&input_provider, "visionModel")).unwrap_or_else(|| {
            default_provider["visionModel"]
                .as_str()
                .unwrap()
                .to_string()
        });
    let analysis_mode = match input.get("analysisMode").and_then(Value::as_str) {
        Some(value @ ("template" | "text" | "multimodal")) => value,
        _ => defaults["analysisMode"].as_str().unwrap(),
    };
    let reasoning_effort = match input.get("reasoningEffort").and_then(Value::as_str) {
        Some(value @ ("low" | "high" | "max")) => value,
        _ => defaults["reasoningEffort"].as_str().unwrap(),
    };
    let port = input_api
        .get("port")
        .and_then(Value::as_u64)
        .filter(|port| (1..=u16::MAX as u64).contains(port))
        .unwrap_or(DEFAULT_API_PORT as u64);

    json!({
        "version": USER_CONFIG_VERSION,
        "provider": {
            "name": "deepseek",
            "apiKey": api_key.trim(),
            "baseUrl": base_url,
            "agentModel": agent_model,
            "visionModel": vision_model
        },
        "analysisMode": analysis_mode,
        "thinkingEnabled": input.get("thinkingEnabled").and_then(Value::as_bool).unwrap_or(false),
        "reasoningEffort": reasoning_effort,
        "api": { "port": port }
    })
}

fn to_public_config(config: &Value, path: &Path) -> Value {
    let provider = config["provider"].as_object().expect("normalized provider");
    let key = provider["apiKey"].as_str().unwrap_or_default();
    let api_key_hint = if key.is_empty() {
        Value::Null
    } else {
        let prefix: String = key.chars().take(3).collect();
        let mut suffix: String = key.chars().rev().take(4).collect();
        suffix = suffix.chars().rev().collect();
        Value::String(format!("{prefix}…{suffix}"))
    };

    json!({
        "configPath": path.to_string_lossy(),
        "configured": !key.is_empty(),
        "provider": "deepseek",
        "apiKeyConfigured": !key.is_empty(),
        "apiKeyHint": api_key_hint,
        "baseUrl": provider["baseUrl"],
        "agentModel": provider["agentModel"],
        "visionModel": provider["visionModel"],
        "analysisMode": config["analysisMode"],
        "thinkingEnabled": config["thinkingEnabled"],
        "reasoningEffort": config["reasoningEffort"]
    })
}

fn write_atomic(path: &Path, value: &Value) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("config.json"),
        std::process::id()
    ));
    let contents = format!(
        "{}\n",
        serde_json::to_string_pretty(value).expect("config is serializable")
    );
    fs::write(&temporary, contents.as_bytes())?;
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            fs::write(path, contents.as_bytes())?;
            let _ = fs::remove_file(temporary);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(temporary);
            Err(error)
        }
    }
}

fn valid_port(value: Option<&str>) -> bool {
    value
        .map(|value| value.parse::<u16>().map(|port| port > 0).unwrap_or(false))
        .unwrap_or(true)
}

fn string_value(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(str::to_string)
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .and_then(|value| non_empty(Some(value)))
}

fn resolve_path(value: String) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn invalid_payload(field: &'static str) -> ConfigUpdateError {
    ConfigUpdateError::Invalid {
        code: "E_INVALID_PAYLOAD",
        message: format!("Invalid configuration field: {field}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "stylelens-rust-config-{}-{}.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn public_config_never_contains_the_api_key() {
        let path = temp_path();
        let store = ConfigStore::new(path.clone());
        let result = store
            .update(&json!({ "apiKey": "  sk-test-secret  " }))
            .unwrap();
        assert_eq!(result["apiKeyHint"], "sk-…cret");
        assert!(result.get("apiKey").is_none());
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("sk-test-secret"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn base_url_policy_matches_the_node_service() {
        assert!(is_allowed_provider_base_url("https://api.deepseek.com"));
        assert!(is_allowed_provider_base_url("https://api.deepseek.com/v1"));
        assert!(is_allowed_provider_base_url("http://127.0.0.1:4312"));
        assert!(!is_allowed_provider_base_url("https://evil.example"));
        assert!(!is_allowed_provider_base_url(
            "https://api.deepseek.com?redirect=evil"
        ));
        assert!(!is_allowed_provider_base_url(
            "https://user:pass@api.deepseek.com"
        ));
    }

    #[test]
    fn invalid_stored_config_falls_back_to_defaults() {
        let normalized = normalize_config(json!({
            "provider": { "baseUrl": "https://evil.example", "apiKey": "secret" },
            "analysisMode": "unknown",
            "api": { "port": 0 }
        }));
        assert_eq!(normalized["provider"]["baseUrl"], DEFAULT_BASE_URL);
        assert_eq!(normalized["analysisMode"], "multimodal");
        assert_eq!(normalized["api"]["port"], DEFAULT_API_PORT);
    }
}
