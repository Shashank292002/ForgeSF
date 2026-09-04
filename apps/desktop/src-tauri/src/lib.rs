mod commands;

use commands::{
    add_workspace, bind_workspace_to_org, cancel_retrieve, cancel_sf_command, clear_diff_sessions,
    connect_salesforce, create_workspace_item, delete_workspace_item, deploy_paths, deploy_quick,
    deploy_workspace, diff_workspace_path, get_org_details, get_workspace_root,
    list_metadata_components, list_metadata_types, list_orgs, list_workspaces, logout_org,
    open_org, read_diff_pair, read_workspace, read_workspace_file, remove_workspace,
    rename_workspace, rename_workspace_item, retrieve_metadata_progress, retrieve_paths,
    run_command, run_query, run_sf_json, set_active_workspace, set_default_org, set_workspace_org,
    set_workspace_path, set_workspace_retrieved_org, workspace_for_org, write_workspace_file,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            cancel_sf_command,
            run_sf_json,
            retrieve_paths,
            read_diff_pair,
            diff_workspace_path,
            deploy_paths,
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
            deploy_workspace,
            deploy_quick,
            run_query,
            run_command,
            get_org_details,
            read_workspace_file,
            write_workspace_file,
            read_workspace,
            get_workspace_root,
            set_workspace_path,
            create_workspace_item,
            rename_workspace_item,
            delete_workspace_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
