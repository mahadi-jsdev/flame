use serde::{Deserialize, Serialize};

const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: RespMessage,
}

#[derive(Deserialize)]
struct RespMessage {
    content: String,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: ApiError,
}

#[derive(Deserialize)]
struct ApiError {
    message: String,
}

const SYSTEM_PROMPT: &str = "You write excellent git commit messages. \
Given a diff stat and diff, reply with ONLY the commit message — no quotes, \
no explanation, no markdown. Use conventional commit style (feat:, fix:, \
refactor:, chore:, docs:, test:) when it fits, otherwise a short imperative \
summary. Keep the subject line under 72 characters. If the change is large, \
add up to 3 bullet body lines separated by newlines.";

pub async fn commit_message(
    stat: &str,
    diff: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let body = ChatRequest {
        model,
        temperature: 0.3,
        max_tokens: 300,
        messages: vec![
            ChatMessage {
                role: "system",
                content: SYSTEM_PROMPT.to_string(),
            },
            ChatMessage {
                role: "user",
                content: format!(
                    "Here are the staged changes.\n\n## Stat\n{}\n\n## Diff\n{}",
                    stat, diff
                ),
            },
        ],
    };

    let resp = client
        .post(OPENAI_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        if let Ok(err) = serde_json::from_str::<ErrorResponse>(&text) {
            return Err(format!("OpenAI error: {}", err.error.message));
        }
        return Err(format!("OpenAI HTTP {status}: {}", text.chars().take(200).collect::<String>()));
    }

    let parsed: ChatResponse =
        serde_json::from_str(&text).map_err(|e| format!("bad OpenAI response: {e}"))?;
    let msg = parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content.trim().to_string())
        .filter(|m| !m.is_empty())
        .ok_or_else(|| "OpenAI returned an empty message".to_string())?;

    Ok(msg)
}
