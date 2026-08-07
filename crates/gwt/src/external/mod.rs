//! Re-exports for anything that shells out to an external program.

pub mod git;
pub mod parse;

pub use git::{Git, GitError};
