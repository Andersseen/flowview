use flowview_static_runtime::Template;
use serde_json::json;

fn artifact() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "magic": "FLOWVIEW-STATIC",
        "format_version": 1,
        "compiler_version": "0.3.0",
        "source": "<h1>{{ context.title }}</h1>",
        "filename": "pages/home.flow",
        "nodes": [
            {"type":"text", "value":"<h1>", "span":{"start":0,"end":4}},
            {"type":"interpolation", "expression":{"type":"member","object":{"type":"ident","name":"context"},"key":{"type":"name","value":"title"}},"raw":false,"span":{"start":4,"end":26}},
            {"type":"text", "value":"</h1>", "span":{"start":26,"end":31}}
        ]
    })).unwrap()
}

#[test]
// @spec SPEC-HTML-129
fn artifact_renders_and_keeps_logical_source_location() {
    let template = Template::from_bytes(&artifact()).unwrap();
    assert_eq!(
        template.render(&json!({"title": "A & <B>"})).unwrap(),
        "<h1>A &amp; &lt;B&gt;</h1>"
    );
    let error = template
        .render(&json!({"title": {"nested": true}}))
        .unwrap_err();
    assert_eq!(error[0].code, "FV0020");
    assert_eq!(error[0].filename, "pages/home.flow");
    assert_eq!(error[0].start, 4);
}

#[test]
// @spec SPEC-HTML-130
fn version_identity_truncation_and_oversize_fail_without_panicking() {
    let mut bytes = artifact();
    let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    value["format_version"] = json!(2);
    assert!(Template::from_bytes(&serde_json::to_vec(&value).unwrap())
        .unwrap_err()
        .to_string()
        .contains("unsupported"));
    value["format_version"] = json!(1);
    value["magic"] = json!("other");
    assert!(Template::from_bytes(&serde_json::to_vec(&value).unwrap())
        .unwrap_err()
        .to_string()
        .contains("identity"));
    assert!(Template::from_bytes(&bytes[..bytes.len() / 2]).is_err());
    bytes.resize(flowview_static_runtime::MAX_ARTIFACT_BYTES + 1, b' ');
    assert!(Template::from_bytes(&bytes)
        .unwrap_err()
        .to_string()
        .contains("limit"));
}

#[test]
// @spec SPEC-HTML-129
fn prepared_template_is_safe_for_concurrent_repeated_rendering() {
    let template = std::sync::Arc::new(Template::from_bytes(&artifact()).unwrap());
    let threads: Vec<_> = (0..8)
        .map(|n| {
            let template = template.clone();
            std::thread::spawn(move || {
                for i in 0..20 {
                    let context = json!({"title": format!("{n}-{i}")});
                    assert_eq!(
                        template.render(&context).unwrap(),
                        format!("<h1>{n}-{i}</h1>")
                    );
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
}

proptest::proptest! {
    // @spec SPEC-HTML-130
    #[test]
    fn arbitrary_artifact_bytes_never_panic(bytes in proptest::collection::vec(proptest::prelude::any::<u8>(), 0..2048)) {
        let _ = Template::from_bytes(&bytes);
    }
}
