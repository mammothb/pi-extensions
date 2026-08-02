use std::path::PathBuf;

use agent_ipc::server;

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let home = shellexpand::tilde("~");
    let sock_path = PathBuf::from(home.as_ref()).join(".pi/agent/research-ipc.sock");
    server::run(&sock_path).await
}
