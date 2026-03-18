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

/// Spawn `node bundle.cjs` unless port 4242 is already bound.
/// Called from a background thread.
fn start_sidecar(app: &tauri::AppHandle) {
    // If something is already listening on 4242 (e.g. `pnpm run dev` started it
    // via the beforeDevCommand), skip spawning to avoid a port conflict.
    if is_port_bound(4242) {
        println!("[sidecar] port 4242 already in use — skipping auto-start");
        return;
    }

    let Some(bundle_path) = find_sidecar_bundle(app) else {
        eprintln!("[sidecar] could not locate bundle.cjs — skipping auto-start");
        return;
    };

    println!("[sidecar] starting {:?}", bundle_path);

    let result = std::process::Command::new("node")
        .arg(&bundle_path)
        // Inherit stdout/stderr so sidecar logs appear in the Tauri console.
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn();

    match result {
        Ok(child) => {
            if let Ok(mut guard) = app.state::<SidecarProcess>().0.lock() {
                *guard = Some(child);
            }
        }
        Err(e) => {
            eprintln!("[sidecar] failed to spawn node bundle.cjs: {e}");
        }
    }
}

/// Returns true if something is already listening on the given port.
fn is_port_bound(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

/// Locate bundle.cjs. Tries, in order:
///   1. `<resource_dir>/sidecar/bundle.cjs` — production bundle
///   2. `<exe>/../../../../sidecar/dist/bundle.cjs` — dev build
///   3. `<cwd>/sidecar/dist/bundle.cjs` — fallback
fn find_sidecar_bundle(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    // 1. Production: Tauri places resources in the app's resource directory.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("sidecar").join("bundle.cjs");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // 2. Development: exe lives at src-tauri/target/debug/<name>, so go up 4 levels
    //    to reach the project root, then into sidecar/dist/.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(project_root) = exe.ancestors().nth(4) {
            let candidate = project_root.join("sidecar").join("dist").join("bundle.cjs");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 3. Fallback: current working directory.
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("sidecar").join("dist").join("bundle.cjs");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}
