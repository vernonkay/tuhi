//! Typed errors for the editor core and the Tauri commands.
//!
//! The web-view only ever displays a message string, so `EditorError` serialises to
//! its `Display` text: the front-end contract (a string in the promise rejection) is
//! unchanged, while Rust code gets typed, matchable variants and `?` on `io::Error`.

/// An error from a buffer operation or an editor command.
#[derive(Debug, thiserror::Error)]
pub enum EditorError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("no document open")]
    NoActiveDocument,
    #[error("the active tab is missing")]
    ActiveTabMissing,
    #[error("no path to save to")]
    NoPath,
    #[error("character index {idx} is out of range (document length {len})")]
    IndexOutOfRange { idx: usize, len: usize },
    #[error("invalid range {start}..{end}")]
    InvalidRange { start: usize, end: usize },
    #[error("this file is open read-only (large-file mode)")]
    ReadOnly,
    #[error("the editor state lock was poisoned")]
    LockPoisoned,
    #[error("invalid regular expression: {0}")]
    Regex(String),
    #[error("{0}")]
    Other(String),
}

// Serialise as the message string, so the web-view keeps receiving a plain string
// (the promise rejects with the text, exactly as with the old `Result<_, String>`).
impl serde::Serialize for EditorError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
