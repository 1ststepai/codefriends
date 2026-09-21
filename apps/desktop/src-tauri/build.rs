use std::fs;
use std::path::Path;

fn main() {
    // `tauri::generate_context!` requires frontendDist to exist even for
    // `tauri dev` (which loads the Vite URL) and `cargo test`.
    let dist = Path::new("../../popout/dist");
    if !dist.join("index.html").exists() {
        fs::create_dir_all(dist).expect("create popout dist placeholder");
        fs::write(
            dist.join("index.html"),
            "<!doctype html><title>CodeFriends</title><p>Build the popout or run npm run dev.</p>\n",
        )
        .expect("write popout dist placeholder");
    }
    tauri_build::build()
}
