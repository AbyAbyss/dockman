// Menu-bar tray and the app menu's Quit item. Closing the window only hides
// it; Dockman lives on in the tray, like Docker Desktop and OrbStack, until
// it is quit from here, from Settings or with ⌘Q — all of which ask about
// running engines first (`system::request_quit`).

use crate::commands::{runtime, system};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// Tray items that change with engine state.
struct TrayItems {
    status: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    // The app menu is tauri's default with its Quit item swapped out: the
    // predefined one terminates the process on the spot, skipping the check.
    // About and Hide get explicit labels — macOS derives them from the
    // process name, which is the lower-case executable in a dev build.
    let menu = Menu::default(app)?;
    #[cfg(target_os = "macos")]
    if let Some(sub) = menu.items()?.first().and_then(|i| i.as_submenu().cloned()) {
        for item in sub.items()? {
            if let Some(p) = item.as_predefined_menuitem() {
                match p.text()?.split(' ').next() {
                    Some("About") => p.set_text("About Dockman")?,
                    Some("Hide") if !p.text()?.starts_with("Hide Others") => p.set_text("Hide Dockman")?,
                    _ => {}
                }
            }
        }
        if let Some(last) = sub.items()?.last() {
            sub.remove(last)?;
        }
        sub.append(&MenuItem::with_id(app, "quit", "Quit Dockman", true, Some("CmdOrCtrl+Q"))?)?;
    }
    app.set_menu(menu)?;

    let open = MenuItem::with_id(app, "open", "Open Dockman", true, None::<&str>)?;
    let status = MenuItem::with_id(app, "status", "Engines: checking…", false, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "Start engines", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop engines", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Dockman", true, None::<&str>)?;
    let tray_menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &status,
            &start,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip("Dockman")
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    app.manage(TrayItems { status, stop });

    // Keep the status line and the Stop item honest while the app runs.
    let app = app.clone();
    std::thread::spawn(move || loop {
        refresh(&app);
        std::thread::sleep(std::time::Duration::from_secs(15));
    });
    Ok(())
}

fn refresh(app: &AppHandle) {
    let running = runtime::running_engines();
    let items = app.state::<TrayItems>();
    let _ = items.status.set_text(if running.is_empty() {
        "Engines: stopped".to_string()
    } else {
        format!("Running: {}", running.join(", "))
    });
    let _ = items.stop.set_enabled(!running.is_empty());
}

/// Handle every menu event — the tray's and the app menu's share one handler.
pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => show_main(app),
        "quit" => system::request_quit(app.clone()),
        "start" | "stop" => {
            let app = app.clone();
            let stopping = id == "stop";
            std::thread::spawn(move || {
                let done = if stopping { runtime::stop_engines() } else { runtime::start_engines() };
                if let Err(e) = done {
                    app.dialog()
                        .message(e)
                        .title(if stopping { "Could not stop engines" } else { "Could not start engines" })
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                }
                refresh(&app);
            });
        }
        _ => {}
    }
}

/// Bring the main window back from the tray.
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
