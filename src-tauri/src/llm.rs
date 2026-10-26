//! OpenAI-compatible chat completion proxy (DeepSeek by default).
//! Done in Rust so the webview doesn't need CORS access to the API.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<Value>,
    #[serde(default)]
    json_mode: bool,
    #[serde(default = "default_temperature")]
    temperature: f64,
}

fn default_temperature() -> f64 {
    1.1
}

#[tauri::command]
pub async fn llm_chat(req: ChatRequest) -> Result<String, String> {
    if req.api_key.trim().is_empty() {
        return Err("missing API key".into());
    }
    let url = format!("{}/chat/completions", req.base_url.trim_end_matches('/'));
    let mut body = json!({
        "model": req.model,
        "messages": req.messages,
        "temperature": req.temperature,
        "max_tokens": 300,
        "stream": false,
    });
    if req.json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(40))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(url)
        .bearer_auth(req.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let msg = v["error"]["message"].as_str().unwrap_or("request failed");
        return Err(format!("{status}: {msg}"));
    }
    v["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "empty response".into())
}
