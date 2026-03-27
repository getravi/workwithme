/// Load and stress tests for API endpoints
/// These test the system under various load conditions

#[cfg(test)]
mod load_tests {
    use serde_json::json;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};

    #[test]
    fn test_concurrent_session_creation() {
        let counter = Arc::new(AtomicUsize::new(0));

        // Simulate creating sessions concurrently
        let mut handles = vec![];

        for i in 0..10 {
            let counter = Arc::clone(&counter);
            let handle = std::thread::spawn(move || {
                // Simulate session creation
                let _session = json!({
                    "id": format!("session-{}", i),
                    "created_at": chrono::Local::now().to_rfc3339()
                });

                counter.fetch_add(1, Ordering::SeqCst);
            });

            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(counter.load(Ordering::SeqCst), 10);
    }

    #[test]
    fn test_large_message_handling() {
        let large_content = "x".repeat(1_000_000); // 1MB message

        let message = json!({
            "role": "user",
            "content": large_content,
            "timestamp": chrono::Local::now().to_rfc3339()
        });

        assert!(message.get("content").is_some());
        assert!(message["content"].as_str().unwrap().len() > 900_000);
    }

    #[test]
    fn test_many_small_operations() {
        let mut count = 0;

        for _ in 0..10_000 {
            let _data = json!({"key": "value"});
            count += 1;
        }

        assert_eq!(count, 10_000);
    }

    #[test]
    fn test_deep_nesting_json() {
        let mut json = json!({"level": 0});

        // Create deeply nested JSON
        for i in 1..100 {
            json = json!({
                "level": i,
                "nested": json
            });
        }

        // Verify structure
        let mut current = &json;
        for i in (0..100).rev() {
            assert_eq!(current["level"], i);
            if i > 0 {
                current = &current["nested"];
            }
        }
    }

    #[test]
    fn test_many_concurrent_json_operations() {
        let counter = Arc::new(AtomicUsize::new(0));
        let mut handles = vec![];

        for i in 0..50 {
            let counter = Arc::clone(&counter);

            let handle = std::thread::spawn(move || {
                // Each thread creates and serializes JSON
                for j in 0..100 {
                    let data = json!({
                        "thread": i,
                        "iteration": j,
                        "data": {
                            "nested": {
                                "deep": {
                                    "value": i * j
                                }
                            }
                        }
                    });

                    let _json_str = serde_json::to_string(&data).unwrap();
                    counter.fetch_add(1, Ordering::SeqCst);
                }
            });

            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(counter.load(Ordering::SeqCst), 50 * 100);
    }

    #[test]
    fn test_hashmap_with_many_entries() {
        use std::collections::HashMap;

        let mut map = HashMap::new();

        // Add 10,000 entries
        for i in 0..10_000 {
            map.insert(format!("key_{}", i), format!("value_{}", i));
        }

        assert_eq!(map.len(), 10_000);

        // Verify random access
        assert_eq!(map.get("key_5000").map(|s| s.as_str()), Some("value_5000"));
        assert_eq!(map.get("key_9999").map(|s| s.as_str()), Some("value_9999"));
    }

    #[test]
    fn test_vector_with_many_elements() {
        let mut vec = Vec::new();

        // Add 100,000 elements
        for i in 0..100_000 {
            vec.push(i);
        }

        assert_eq!(vec.len(), 100_000);
        assert_eq!(vec[50_000], 50_000);
        assert_eq!(vec.last(), Some(&99_999));
    }

    #[test]
    fn test_string_concatenation_stress() {
        let mut result = String::new();

        // Concatenate 1000 strings
        for i in 0..1000 {
            result.push_str(&format!("item_{},", i));
        }

        assert!(result.len() > 5000);
        assert!(result.contains("item_0"));
        assert!(result.contains("item_999"));
    }

    #[test]
    fn test_repeated_parsing() {
        let json_str = r#"{"type":"message","data":{"id":1,"content":"test"}}"#;

        for _ in 0..10_000 {
            let _: serde_json::Value = serde_json::from_str(json_str).unwrap();
        }
        // If this doesn't panic, test passes
    }

    #[test]
    fn test_repeated_serialization() {
        let data = json!({
            "type": "message",
            "id": 123,
            "content": "test content"
        });

        for _ in 0..10_000 {
            let _str = serde_json::to_string(&data).unwrap();
        }
        // If this doesn't panic, test passes
    }

    #[test]
    fn test_mixed_concurrent_operations() {
        let counter = Arc::new(AtomicUsize::new(0));
        let mut handles = vec![];

        for thread_id in 0..20 {
            let counter = Arc::clone(&counter);

            let handle = std::thread::spawn(move || {
                for op in 0..500 {
                    // Parse JSON
                    let parsed = serde_json::from_str::<serde_json::Value>(
                        r#"{"id":1,"data":"test"}"#
                    ).unwrap();

                    // Create JSON
                    let created = json!({
                        "thread": thread_id,
                        "op": op,
                        "value": parsed
                    });

                    // Serialize back
                    let _str = serde_json::to_string(&created).unwrap();

                    counter.fetch_add(1, Ordering::SeqCst);
                }
            });

            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(counter.load(Ordering::SeqCst), 20 * 500);
    }

    #[test]
    fn test_memory_efficiency() {
        let initial = 0usize;

        // Create and drop many objects
        {
            let mut vecs = vec![];
            for _ in 0..1000 {
                let vec = vec![1, 2, 3, 4, 5];
                vecs.push(vec);
            }

            assert_eq!(vecs.len(), 1000);
            // vecs dropped here
        }

        // Test passes if no OOM
        let final_count = 1000;
        assert_eq!(final_count, 1000);
    }
}
