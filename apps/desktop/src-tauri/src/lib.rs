mod apex_tests;
mod dependencies;
mod deploy;
mod describe;
mod devtools;
mod diff;
mod error;
mod export;
mod logs;
mod metadata;
mod orgs;
mod sf;
mod terminal;
mod util;
mod workspace;

use apex_tests::run_apex_tests;
use dependencies::{dependency_types, metadata_dependencies};
use deploy::{deploy_cancel, deploy_history, deploy_quick_start, deploy_report, deploy_start};
use describe::{describe_sobject, list_sobjects};
use devtools::{run_apex, run_command, run_query, run_search, run_sf_json};
use diff::{clear_diff_sessions, compare_orgs, diff_workspace_path, read_diff_pair};
use export::save_text_file;
use logs::{get_apex_log, list_apex_logs, tail_apex_logs};
use metadata::{
    cancel_retrieve, list_metadata_components, list_metadata_types, retrieve_metadata_progress,
    retrieve_paths,
};
use orgs::{
    connect_salesforce, get_org_details, list_orgs, logout_org, open_org, org_limits,
    set_default_org,
};
use sf::discover::{cli_info, set_sf_path};
use sf::runner::cancel_sf_command;
use terminal::run_terminal_command;
use workspace::changes::{reset_workspace_baseline, workspace_changes};
use workspace::files::{
    apex_declared_name, copy_workspace_items, create_workspace_item, delete_workspace_items,
    include_companions, move_workspace_items, read_workspace_file, rename_workspace_item,
    reveal_workspace_item, workspace_package_directories, write_workspace_file,
};
use workspace::folders::{
    add_workspace, get_workspace_root, list_workspaces, pick_workspace_folder, remove_workspace,
    rename_workspace, set_active_workspace, set_workspace_retrieved_org, workspace_for_org,
};
use workspace::generate::generate_source;
use workspace::manifest::{generate_manifest, list_manifests, retrieve_manifest};
use workspace::search::{cancel_workspace_search, list_workspace_files, search_workspace};
use workspace::tree::read_workspace;
use workspace::watcher::{unwatch_workspace, watch_workspace};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Resolves the neutral working directory for CLI calls.
            sf::discover::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cancel_sf_command,
            cli_info,
            set_sf_path,
            run_sf_json,
            run_apex,
            retrieve_paths,
            read_diff_pair,
            diff_workspace_path,
            compare_orgs,
            clear_diff_sessions,
            workspace_for_org,
            set_workspace_retrieved_org,
            set_active_workspace,
            rename_workspace,
            remove_workspace,
            list_workspaces,
            pick_workspace_folder,
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
            list_sobjects,
            describe_sobject,
            metadata_dependencies,
            dependency_types,
            save_text_file,
            run_search,
            run_command,
            get_org_details,
            org_limits,
            run_apex_tests,
            list_apex_logs,
            get_apex_log,
            tail_apex_logs,
            read_workspace,
            get_workspace_root,
            read_workspace_file,
            write_workspace_file,
            create_workspace_item,
            generate_source,
            generate_manifest,
            list_manifests,
            retrieve_manifest,
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
