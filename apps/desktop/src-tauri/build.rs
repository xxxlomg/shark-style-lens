fn main() {
    println!("cargo:rerun-if-changed=../../../services/api/public/index.html");
    println!("cargo:rerun-if-changed=../../../services/api/public/assets");
    println!("cargo:rerun-if-changed=../../../services/api/public/stylelens.zip");
    println!("cargo:rerun-if-changed=../../../services/api/public/stylelens.crx");
    tauri_build::build()
}
