// Dockman — Tauri 2 application entry point.
// Registers plugins, the process registry, and every runtime command.

mod commands;

use commands::{
    builds, compose, containers, downloader, exec, images, networks, runtime, system,
    volumes,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(commands::Registry::default())
        .invoke_handler(tauri::generate_handler![
            // runtime
            runtime::detect_runtime,
            runtime::detect_all_runtimes,
            runtime::get_runtime_mode,
            runtime::set_runtime_mode,
            runtime::get_runtime_path,
            runtime::set_runtime_path,
            runtime::start_runtime_daemon,
            runtime::stop_runtime_daemon,
            runtime::set_start_on_login,
            runtime::get_start_on_login,
            runtime::get_setup_status,
            runtime::remove_binary,
            // containers
            containers::list_containers,
            containers::list_container_stats,
            containers::start_container,
            containers::stop_container,
            containers::restart_container,
            containers::pause_container,
            containers::unpause_container,
            containers::remove_container,
            containers::inspect_container,
            containers::get_container_env,
            containers::run_container,
            containers::get_container_logs,
            containers::stop_container_logs,
            containers::get_container_stats,
            containers::stop_container_stats,
            // exec
            exec::exec_start,
            exec::exec_input,
            exec::exec_resize,
            exec::exec_stop,
            // images
            images::list_images,
            images::remove_image,
            images::pull_image,
            images::inspect_image,
            images::search_image,
            images::push_image,
            images::prune_images,
            images::tag_image,
            // system
            system::system_prune,
            system::open_url,
            system::quit_app,
            // volumes
            volumes::list_volumes,
            volumes::create_volume,
            volumes::remove_volume,
            volumes::inspect_volume,
            volumes::prune_volumes,
            // networks
            networks::list_networks,
            networks::inspect_network,
            // compose
            compose::list_compose_projects,
            compose::compose_up,
            compose::compose_down,
            compose::compose_restart,
            compose::compose_logs,
            compose::open_compose_file,
            // builds
            builds::list_builds,
            builds::get_build,
            builds::delete_build,
            builds::clear_build_history,
            builds::read_dockerfile,
            builds::cancel_build,
            builds::start_build,
            // downloader
            downloader::get_default_install_dir,
            downloader::verify_binary,
            downloader::add_to_path,
            downloader::get_available_releases,
            downloader::download_binary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dockman");
}
