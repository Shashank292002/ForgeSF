mod apex;
mod changes;
mod commands;
mod deploy_jobs;
mod search;
mod terminal;
mod watcher;
mod workspace_fs;

use changes::{reset_workspace_baseline, workspace_changes};
use commands::{
    add_workspace, bind_workspace_to_org, cancel_retrieve, cancel_sf_command, clear_diff_sessions,
    cli_info, connect_salesforce, diff_workspace_path, get_org_details, get_workspace_root,
    list_metadata_components, list_metadata_types, list_orgs, list_workspaces, logout_org,
    open_org, read_diff_pair, read_workspace, remove_workspace, rename_workspace,
    retrieve_metadata_progress, retrieve_paths, run_command, run_query, run_search, run_sf_json,
    set_active_workspace, set_default_org, set_workspace_org, set_workspace_path,
    set_workspace_retrieved_org, workspace_for_org,
};
use deploy_jobs::{deploy_cancel, deploy_history, deploy_quick_start, deploy_report, deploy_start};
use search::{cancel_workspace_search, list_workspace_files, search_workspace};
use terminal::run_terminal_command;
use watcher::{unwatch_workspace, watch_workspace};
use workspace_fs::{
    apex_declared_name, copy_workspace_items, create_workspace_item, delete_workspace_items,
    include_companions, move_workspace_items, read_workspace_file, rename_workspace_item,
    reveal_workspace_item, workspace_package_directories, write_workspace_file,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Resolves the neutral working directory for CLI calls.
            commands::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cancel_sf_command,
            cli_info,
            run_sf_json,
            retrieve_paths,
            read_diff_pair,
            diff_workspace_path,
            clear_diff_sessions,
            workspace_for_org,
            bind_workspace_to_org,
            set_workspace_retrieved_org,
            set_workspace_org,
            set_active_workspace,
            rename_workspace,
            remove_workspace,
            list_workspaces,
            add_workspace,
            cancel_retrieve,
            connect_salesforce,
            list_orgs,
            open_org,
            set_default_org,
            logout_org,
            list_metadata_types,
            list_metadata_components,
            retrieve_metadata_progress,
            deploy_start,
            deploy_quick_start,
            deploy_report,
            deploy_cancel,
            deploy_history,
            workspace_changes,
            reset_workspace_baseline,
            run_query,
            run_search,
            run_command,
            get_org_details,
            read_workspace,
            get_workspace_root,
            set_workspace_path,
            read_workspace_file,
            write_workspace_file,
            create_workspace_item,
            rename_workspace_item,
            include_companions,
            delete_workspace_items,
            move_workspace_items,
            copy_workspace_items,
            reveal_workspace_item,
            workspace_package_directories,
            apex_declared_name,
            watch_workspace,
            unwatch_workspace,
            search_workspace,
            cancel_workspace_search,
            list_workspace_files,
            run_terminal_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
