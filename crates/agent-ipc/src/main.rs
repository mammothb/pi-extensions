use clap::Parser;

use agent_ipc::{cli::Cli, server};

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let sock_path = Cli::parse().resolve_socket_path()?;
    server::run(&sock_path).await
}
