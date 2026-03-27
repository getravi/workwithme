mod server;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // Start the HTTP server on a background thread
            std::thread::spawn(|| {
                // Create a tokio runtime for the server
                let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
                rt.block_on(async {
                    start_http_server().await;
                });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Start the HTTP server on port 4242 unless it's already in use.
/// Called from a background tokio task.
async fn start_http_server() {
    if is_port_bound(4242) {
        println!("[http-server] port 4242 already in use — skipping auto-start");
        return;
    }

    println!("[http-server] starting on http://127.0.0.1:4242");

    match server::create_app().await {
        Ok(router) => {
            let listener = match tokio::net::TcpListener::bind("127.0.0.1:4242").await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("[http-server] failed to bind to port 4242: {e}");
                    return;
                }
            };

            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("[http-server] error: {e}");
            }
        }
        Err(e) => {
            eprintln!("[http-server] failed to create app: {e}");
        }
    }
}

/// Returns true if something is already listening on the given port.
fn is_port_bound(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}
