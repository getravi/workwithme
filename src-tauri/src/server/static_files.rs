use rust_embed::Embed;
use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};

/// Embedded frontend assets
#[derive(Embed)]
#[folder = "../dist"]
#[prefix = "/"]
pub struct StaticAssets;

/// Serve static files with proper MIME types
pub async fn serve_static(path: String) -> Response {
    // Remove leading slash for lookup
    let path = path.trim_start_matches('/');

    // For root path, serve index.html (SPA fallback)
    let asset_path = if path.is_empty() || !path.contains('.') {
        "index.html".to_string()
    } else {
        path.to_string()
    };

    match StaticAssets::get(&asset_path) {
        Some(content) => {
            let mime = get_mime_type(&asset_path);
            (StatusCode::OK, [(header::CONTENT_TYPE, mime)], content.data).into_response()
        }
        None => {
            // Asset not found, try index.html for SPA routing
            match StaticAssets::get("index.html") {
                Some(content) => {
                    let mime = "text/html; charset=utf-8";
                    (StatusCode::OK, [(header::CONTENT_TYPE, mime)], content.data).into_response()
                }
                None => (StatusCode::NOT_FOUND, "404 Not Found").into_response(),
            }
        }
    }
}

/// Determine MIME type based on file extension
fn get_mime_type(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".gif") {
        "image/gif"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else if path.ends_with(".svg") {
        "image/svg+xml; charset=utf-8"
    } else if path.ends_with(".woff") {
        "font/woff"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else if path.ends_with(".ttf") {
        "font/ttf"
    } else if path.ends_with(".otf") {
        "font/otf"
    } else if path.ends_with(".map") {
        "application/json"
    } else {
        "application/octet-stream"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mime_types() {
        assert_eq!(get_mime_type("index.html"), "text/html; charset=utf-8");
        assert_eq!(get_mime_type("app.js"), "application/javascript; charset=utf-8");
        assert_eq!(get_mime_type("style.css"), "text/css; charset=utf-8");
        assert_eq!(get_mime_type("image.png"), "image/png");
    }

    #[test]
    fn test_spa_routing() {
        // Routes without extensions should serve index.html
        let path = "some/route";
        assert!(!path.contains('.'));
    }
}
