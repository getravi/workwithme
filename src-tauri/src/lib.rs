use std::sync::Mutex;
use tauri::Manager;

/// Holds the spawned sidecar child process so we can kill it on exit.
struct SidecarProcess(Mutex<Option<std::process::Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            // Spawn on a background thread so setup() returns immediately
            // and the window opens without waiting for npm to start.
            std::thread::spawn(move || {
                start_sidecar(&handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill the sidecar when the last window closes.
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut guard) = window.state::<SidecarProcess>().0.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Spawn the sidecar SEA binary unless port 4242 is already bound.
/// Called from a background thread.
fn start_sidecar(app: &tauri::AppHandle) {
    if is_port_bound(4242) {
        println!("[sidecar] port 4242 already in use — skipping auto-start");
        return;
    }

    let Some(binary_path) = find_sidecar_binary(app) else {
        eprintln!("[sidecar] could not locate sidecar binary — skipping auto-start");
        return;
    };

    println!("[sidecar] starting {:?}", binary_path);

    match std::process::Command::new(&binary_path)
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn()
    {
        Ok(child) => {
            if let Ok(mut guard) = app.state::<SidecarProcess>().0.lock() {
                *guard = Some(child);
            }
        }
        Err(e) => {
            eprintln!("[sidecar] failed to spawn sidecar: {e}");
        }
    }
}

/// Returns true if something is already listening on the given port.
fn is_port_bound(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

/// Returns the Tauri-style target triple for this build.
fn tauri_target_triple() -> &'static str {
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    return "aarch64-apple-darwin";
    #[cfg(all(target_arch = "x86_64", target_os = "macos"))]
    return "x86_64-apple-darwin";
    #[cfg(all(target_arch = "x86_64", target_os = "linux"))]
    return "x86_64-unknown-linux-gnu";
    #[cfg(all(target_arch = "x86_64", target_os = "windows"))]
    return "x86_64-pc-windows-msvc";
    #[allow(unreachable_code)]
    "unknown"
}

/// Locate the sidecar SEA binary. Tries:
///   1. Alongside the main exe (production: externalBin placement by Tauri)
///   2. `src-tauri/binaries/` relative to project root (dev builds)
fn find_sidecar_binary(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let _ = app;
    let triple = tauri_target_triple();
    // On Windows, binaries have .exe suffix.
    #[cfg(target_os = "windows")]
    let bin_name = format!("sidecar-{}.exe", triple);
    #[cfg(not(target_os = "windows"))]
    let bin_name = format!("sidecar-{}", triple);

    // 1. Production: Tauri places externalBin alongside the main executable.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidate = exe_dir.join(&bin_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 2. Dev: exe at src-tauri/target/debug/<name> → up 4 levels to project root.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(project_root) = exe.ancestors().nth(4) {
            let candidate = project_root.join("src-tauri").join("binaries").join(&bin_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}
