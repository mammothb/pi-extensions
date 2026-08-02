use clap::{Parser, crate_version};
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "Agent IPC daemon.")]
#[command(version = crate_version!())]
pub struct Cli {
    /// Path to the Unix domain socket.
    #[arg(long, default_value = "~/.pi/agent/research-ipc.sock")]
    pub socket_path: PathBuf,
}

impl Cli {
    /// Resolve and validate the socket path (~ expansion).
    pub fn resolve_socket_path(&self) -> anyhow::Result<PathBuf> {
        let raw = self.socket_path.to_string_lossy();
        let expanded = shellexpand::tilde(&raw);
        let path = PathBuf::from(expanded.as_ref());
        if let Some(parent) = path.parent() {
            fs_err::create_dir_all(parent)?;
        }
        Ok(path)
    }
}
