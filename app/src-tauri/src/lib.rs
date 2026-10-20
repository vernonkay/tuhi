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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(editor::EditorState::default())
        // No native menu bar: Studio leads with the rail + command palette (Ctrl+P),
        // and all actions have front-end keyboard shortcuts (see App.tsx).
        .invoke_handler(tauri::generate_handler![
            greet,
            editor::open_document,
            editor::get_viewport,
            editor::request_highlight,
            editor::insert_text,
            editor::delete_range,
            editor::save_document,
            editor::undo,
            editor::redo,
            editor::pretty_print,
            editor::pos_to_char,
            editor::char_to_pos,
            editor::read_range,
            editor::search,
            editor::replace_all,
            editor::list_tabs,
            editor::switch_tab,
            editor::close_tab,
            editor::refresh_highlights,
            editor::set_theme,
            editor::list_dir,
            editor::filter_lines,
            editor::file_len,
            editor::reload,
            editor::get_outline,
            editor::home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
