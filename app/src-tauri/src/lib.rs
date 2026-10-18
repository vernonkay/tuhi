// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod editor;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(editor::EditorState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            editor::open_document,
            editor::get_viewport,
            editor::insert_text,
            editor::delete_range,
            editor::save_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
