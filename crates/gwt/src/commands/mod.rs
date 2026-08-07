//! Command implementations: parse validated input, call the spawn layer,
//! convert [`GitError`]s into [`CommandError`]s with throw-site hints.

pub mod add;
pub mod init;
