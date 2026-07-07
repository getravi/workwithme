fn main() {
    // rust-embed's derive on StaticAssets requires ../dist to exist at compile
    // time. On a fresh checkout or a Rust-only `cargo test` the Vite build hasn't
    // produced it yet, which fails the build. Create a placeholder so the crate
    // still compiles; a real `npm run build` overwrites it with the frontend.
    let dist = std::path::Path::new("../dist");
    if !dist.exists() {
        let _ = std::fs::create_dir_all(dist);
        let _ = std::fs::write(
            dist.join("index.html"),
            "<!doctype html><title>workwithme</title>",
        );
    }
    tauri_build::build()
}
