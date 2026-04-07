/// Spawn a background OS thread that runs Apple Vision OCR on the given PNG file.
/// On completion, updates the FTS table. Fire-and-forget — caller does not await.
pub fn spawn_ocr(capture_id: String, file_path: String) {
    std::thread::spawn(move || {
        match run_ocr(&file_path) {
            Ok(text) if !text.is_empty() => {
                if let Err(e) = super::db::update_ocr(&capture_id, &text) {
                    eprintln!("[library/ocr] DB update failed: {e}");
                }
            }
            Ok(_) => {} // no text found — leave ocr_text empty
            Err(e) => eprintln!("[library/ocr] OCR failed for {file_path}: {e}"),
        }
    });
}

#[cfg(target_os = "macos")]
fn run_ocr(file_path: &str) -> Result<String, String> {
    use objc2::ClassType;
    use objc2::rc::Retained;
    use objc2_foundation::{NSArray, NSDictionary, NSString, NSURL};
    use objc2_vision::{
        VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
        VNRequestTextRecognitionLevel,
    };

    unsafe {
        let path_str = NSString::from_str(file_path);
        let url = NSURL::fileURLWithPath(&path_str);
        let options: Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> =
            NSDictionary::new();
        let handler = VNImageRequestHandler::initWithURL_options(
            VNImageRequestHandler::alloc(),
            &url,
            &options,
        );

        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);

        // Coerce VNRecognizeTextRequest -> VNRequest via the superclass chain.
        let request_ref: &VNRequest = &**request;
        let requests: Retained<NSArray<VNRequest>> =
            NSArray::from_slice(&[request_ref]);

        handler
            .performRequests_error(&requests)
            .map_err(|e| format!("{e:?}"))?;

        let results = request.results().unwrap_or_default();
        let mut texts: Vec<String> = Vec::new();
        let count = results.count();
        for i in 0..count {
            let obs = results.objectAtIndex(i);
            let candidates = obs.topCandidates(1);
            if candidates.count() > 0 {
                let candidate = candidates.objectAtIndex(0);
                texts.push(candidate.string().to_string());
            }
        }
        Ok(texts.join(" "))
    }
}

#[cfg(not(target_os = "macos"))]
fn run_ocr(_file_path: &str) -> Result<String, String> {
    Ok(String::new())
}
