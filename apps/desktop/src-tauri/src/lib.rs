mod commands;

use commands::{
    connect_salesforce,
    create_workspace_item,
    delete_workspace_item,
    deploy_workspace,
    get_org_details,
    get_workspace_root,
    list_metadata_components,
    list_metadata_types,
    list_workspace_files,
    logout_org,
    open_org,
    read_workspace,
    read_workspace_file,
    rename_workspace_item,
    retrieve_metadata,
    run_command,
    run_query,
    set_default_org,
    set_workspace_path,
    write_workspace_file,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            connect_salesforce,
            open_org,
            set_default_org,
            logout_org,
            list_metadata_types,
            list_metadata_components,
            retrieve_metadata,
            deploy_workspace,
            run_query,
            run_command,
            get_org_details,
            list_workspace_files,
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