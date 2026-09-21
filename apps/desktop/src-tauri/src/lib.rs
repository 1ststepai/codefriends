use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};
use tauri_plugin_deep_link::DeepLinkExt;

const DEFAULT_POPOUT: &str = "http://127.0.0.1:5173";
const DEFAULT_API: &str = "http://127.0.0.1:8787";

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main(app);
            if let Some(link) = argv.iter().find(|arg| arg.starts_with("codefriends:")) {
                open_deep_link(app, link);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            create_main_window(app.handle())?;
            create_tray(app.handle())?;

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    open_deep_link(&handle, url.as_str());
                }
            });

            // Unpackaged `tauri dev` on Linux/Windows does not get OS-registered
            // schemes unless we claim them at runtime. Failure is non-fatal
            // (no ~/.local/share/applications write, restricted sandbox, etc.).
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            if let Err(err) = app.deep_link().register_all() {
                eprintln!("codefriends:// registration skipped: {err}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CodeFriends desktop");
}

fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, "main", webview_url())
        .title("CodeFriends")
        .inner_size(960.0, 680.0)
        .min_inner_size(360.0, 520.0)
        .resizable(true)
        .decorations(true)
        .visible(true)
        .background_color(tauri::window::Color(0x1e, 0x1e, 0x1e, 0xff))
        .initialization_script(&api_inject_script())
        .build()?;

    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });

    Ok(window)
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open CodeFriends", true, None::<&str>)?;
    let available = MenuItem::with_id(app, "available", "Available", true, None::<&str>)?;
    let away = MenuItem::with_id(app, "away", "Away", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &available,
            &away,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let tray = TrayIconBuilder::new()
        .icon(tauri::include_image!("icons/tray.png"))
        .menu(&menu)
        .tooltip("CodeFriends")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "available" => set_presence(app, "available"),
            "away" => set_presence(app, "away"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    tray.build(app)?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn set_presence(app: &AppHandle, status: &str) {
    show_main(app);
    if let Some(window) = app.get_webview_window("main") {
        let detail = serde_json::json!({ "status": status });
        let script = format!(
            "window.dispatchEvent(new CustomEvent('codefriends:desktop', {{ detail: {detail} }}));"
        );
        let _ = window.eval(&script);
    }
}

fn open_deep_link(app: &AppHandle, link: &str) {
    show_main(app);
    let dest = merge_deep_link(link, &popout_base());
    if let Some(window) = app.get_webview_window("main") {
        let href = serde_json::to_string(&dest).unwrap_or_else(|_| "\"/\"".into());
        let _ = window.eval(&format!("window.location.replace({href});"));
    }
}

fn webview_url() -> WebviewUrl {
    if let Some(parsed) = env_url("CODEFRIENDS_POPOUT_URL") {
        return WebviewUrl::External(parsed);
    }
    if cfg!(debug_assertions) {
        WebviewUrl::External(DEFAULT_POPOUT.parse().expect("default popout url"))
    } else {
        WebviewUrl::App("index.html".into())
    }
}

fn popout_base() -> String {
    env_url("CODEFRIENDS_POPOUT_URL")
        .map(|url| url.to_string())
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                DEFAULT_POPOUT.to_string()
            } else {
                DEFAULT_API.to_string()
            }
        })
}

fn env_url(key: &str) -> Option<url::Url> {
    let raw = std::env::var(key).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.parse().ok()
}

fn api_inject_script() -> String {
    let explicit = std::env::var("CODEFRIENDS_API_URL")
        .ok()
        .filter(|s| !s.trim().is_empty());
    if cfg!(debug_assertions) && explicit.is_none() {
        return String::new();
    }
    let api = explicit.unwrap_or_else(|| DEFAULT_API.to_string());
    let api = api.trim_end_matches('/').to_string();
    let ws = std::env::var("CODEFRIENDS_WS_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| derive_ws_url(&api));
    format!(
        "Object.assign(window, {{ __CODEFRIENDS_API_URL__: {}, __CODEFRIENDS_WS_URL__: {} }});",
        serde_json::to_string(&api).unwrap_or_else(|_| "\"\"".into()),
        serde_json::to_string(&ws).unwrap_or_else(|_| "\"\"".into()),
    )
}

fn derive_ws_url(api: &str) -> String {
    let trimmed = api.trim_end_matches('/');
    if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}/ws")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}/ws")
    } else {
        format!("{trimmed}/ws")
    }
}

/// Copy query params from `codefriends://open?...` onto the running popout origin.
pub fn merge_deep_link(deep: &str, popout_base: &str) -> String {
    let Ok(deep_url) = url::Url::parse(deep) else {
        return popout_base.to_string();
    };
    let Ok(mut dest) = url::Url::parse(popout_base) else {
        return popout_base.to_string();
    };
    dest.set_query(None);
    dest.set_fragment(None);
    {
        let mut pairs = dest.query_pairs_mut();
        for (key, value) in deep_url.query_pairs() {
            pairs.append_pair(&key, &value);
        }
    }
    dest.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_link_copies_query_onto_popout() {
        let out = merge_deep_link(
            "codefriends://open?dm=abc&handoff=xyz",
            "http://127.0.0.1:5173",
        );
        let parsed = url::Url::parse(&out).unwrap();
        assert_eq!(parsed.scheme(), "http");
        assert_eq!(parsed.host_str(), Some("127.0.0.1"));
        assert_eq!(parsed.port(), Some(5173));
        let query: Vec<(String, String)> = parsed
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert!(query.contains(&("dm".into(), "abc".into())));
        assert!(query.contains(&("handoff".into(), "xyz".into())));
    }

    #[test]
    fn ws_url_follows_http_scheme() {
        assert_eq!(
            derive_ws_url("http://127.0.0.1:8787"),
            "ws://127.0.0.1:8787/ws"
        );
        assert_eq!(
            derive_ws_url("https://codefriends-api.example.workers.dev"),
            "wss://codefriends-api.example.workers.dev/ws"
        );
    }
}
