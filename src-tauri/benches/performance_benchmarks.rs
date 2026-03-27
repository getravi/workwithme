/// Performance benchmarks for critical paths
/// Run with: cargo bench

use criterion::{black_box, criterion_group, criterion_main, Criterion};

/// Benchmark UUID generation
fn bench_uuid_generation(c: &mut Criterion) {
    c.bench_function("uuid_generation", |b| {
        b.iter(|| {
            let _id = uuid::Uuid::new_v4().to_string();
            black_box(_id)
        })
    });
}

/// Benchmark JSON parsing
fn bench_json_parsing(c: &mut Criterion) {
    c.bench_function("json_parsing", |b| {
        let json_str = r#"{"type":"test","data":{"nested":"value"}}"#;
        b.iter(|| {
            let _: serde_json::Value = serde_json::from_str(black_box(json_str)).unwrap();
        })
    });
}

/// Benchmark JSON serialization
fn bench_json_serialization(c: &mut Criterion) {
    c.bench_function("json_serialization", |b| {
        let data = serde_json::json!({
            "type": "message",
            "content": "test message",
            "metadata": {
                "timestamp": "2025-03-27T19:30:00Z",
                "user": "test"
            }
        });

        b.iter(|| {
            let _s = serde_json::to_string(black_box(&data)).unwrap();
        })
    });
}

/// Benchmark string sanitization
fn bench_string_operations(c: &mut Criterion) {
    c.bench_function("string_lowercase", |b| {
        let text = "TestStringWithMixedCase";
        b.iter(|| {
            let _result = text.to_lowercase();
            black_box(_result)
        })
    });
}

/// Benchmark HashMap lookups
fn bench_hashmap_operations(c: &mut Criterion) {
    use std::collections::HashMap;

    c.bench_function("hashmap_insert_and_lookup", |b| {
        b.iter(|| {
            let mut map = HashMap::new();
            for i in 0..100 {
                map.insert(format!("key_{}", i), i);
            }

            let _result = map.get("key_50");
            black_box(_result)
        })
    });
}

/// Benchmark Vec operations
fn bench_vec_operations(c: &mut Criterion) {
    c.bench_function("vec_push_and_collect", |b| {
        b.iter(|| {
            let mut vec = Vec::new();
            for i in 0..100 {
                vec.push(i);
            }

            let _result: Vec<i32> = vec.iter().map(|x| x * 2).collect();
            black_box(_result)
        })
    });
}

/// Benchmark timestamp generation
fn bench_timestamp_generation(c: &mut Criterion) {
    c.bench_function("timestamp_generation", |b| {
        b.iter(|| {
            let _ts = chrono::Local::now().to_rfc3339();
            black_box(_ts)
        })
    });
}

/// Benchmark regex matching (if used)
fn bench_path_operations(c: &mut Criterion) {
    use std::path::PathBuf;

    c.bench_function("path_creation_and_joining", |b| {
        b.iter(|| {
            let home = PathBuf::from("/home/user");
            let config = home.join(".pi").join("config.json");
            black_box(config)
        })
    });
}

/// Benchmark error message formatting
fn bench_error_formatting(c: &mut Criterion) {
    c.bench_function("error_message_format", |b| {
        b.iter(|| {
            let error = format!(
                "Failed to process: {} (code: {})",
                "test error",
                400
            );
            black_box(error)
        })
    });
}

criterion_group!(
    benches,
    bench_uuid_generation,
    bench_json_parsing,
    bench_json_serialization,
    bench_string_operations,
    bench_hashmap_operations,
    bench_vec_operations,
    bench_timestamp_generation,
    bench_path_operations,
    bench_error_formatting,
);

criterion_main!(benches);
