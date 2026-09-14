use keyring::Entry;

const SERVICE: &str = "ai-terminal-agent";
const ACCOUNT: &str = "openai-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

/// Reads the OpenAI API key from the OS keychain. Returns `None` if no
/// entry exists or the platform keychain is unavailable — callers should
/// fall back to another source (e.g. an env var) rather than treat this
/// as a hard error.
pub fn get_api_key() -> Option<String> {
    entry().ok()?.get_password().ok()
}

pub fn save_api_key(key: &str) -> Result<(), String> {
    entry()?.set_password(key).map_err(|e| e.to_string())
}

pub fn delete_api_key() -> Result<(), String> {
    let e = entry()?;
    match e.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

pub fn has_api_key() -> bool {
    get_api_key().map(|k| !k.trim().is_empty()).unwrap_or(false)
}
