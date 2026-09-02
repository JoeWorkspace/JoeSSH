fn main() {
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");

    // tauri-winres serializes inline manifests one trimmed line at a time and
    // adds spaces around every line. Resource Compiler can embed the reviewed
    // UTF-8 manifest file directly, preserving its bytes for strict WACK
    // parsers. Disable the default manifest so RT_MANIFEST/#1 stays unique.
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest()
        .append_rc_content(r#"1 24 "windows-app-manifest.xml""#);
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);

    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}
