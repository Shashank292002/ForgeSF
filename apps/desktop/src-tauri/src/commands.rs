use serde::{Deserialize, Serialize};
use std::process::Command;
use std::fs;
use std::path::{Path, PathBuf};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
    pub id: String,
    pub alias: String,
    pub username: String,
    pub instance_url: String,
    pub org_type: String,
    pub is_default: bool,
    pub status: String,
}

    #[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgDetails {
    pub access_token: String,
    pub instance_url: String,
    pub api_version: String,
}



#[tauri::command]
pub fn connect_salesforce() -> Result<Organization, String> {

    let sf = r"C:\Program Files\sf\bin\sf.cmd";


    // Login and get the exact org that was authenticated
    let login = Command::new(sf)
        .args([
            "org",
            "login",
            "web",
            "--json"
        ])
        .output()
        .map_err(|e| e.to_string())?;



    if !login.status.success() {

        return Err(
            String::from_utf8_lossy(
                &login.stderr
            )
            .to_string()
        );

    }



    let json: serde_json::Value =
        serde_json::from_slice(
            &login.stdout
        )
        .map_err(|e| e.to_string())?;



    println!(
        "LOGIN RESPONSE: {}",
        serde_json::to_string_pretty(&json)
            .unwrap()
    );



let result = &json["result"];


Ok(
    Organization {

        id: result["orgId"]
            .as_str()
            .unwrap_or_default()
            .to_string(),


        alias: result["alias"]
            .as_str()
            .unwrap_or(
                result["username"]
                    .as_str()
                    .unwrap_or_default()
            )
            .to_string(),


        username: result["username"]
            .as_str()
            .unwrap_or_default()
            .to_string(),


        instance_url: result["instanceUrl"]
            .as_str()
            .unwrap_or_default()
            .to_string(),


        org_type: "Production".to_string(),


        is_default: true,


        status: "Connected".to_string(),

    }
)
}


#[tauri::command]
pub fn open_org(
    username: String,
) -> Result<(), String> {

    let sf = r"C:\Program Files\sf\bin\sf.cmd";

    let output = Command::new(sf)
        .args([
            "org",
            "open",
            "--target-org",
            &username,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(
            String::from_utf8_lossy(&output.stderr)
                .to_string(),
        )
    }
}

#[tauri::command]
pub fn set_default_org(
    username: String
) -> Result<String, String> {

    let sf = r"C:\Program Files\sf\bin\sf.cmd";

    let output = Command::new(sf)
        .args([
            "config",
            "set",
            "target-org",
            &username
        ])
        .output()
        .map_err(|e| e.to_string())?;


    if output.status.success() {

        Ok(
            String::from_utf8_lossy(
                &output.stdout
            )
            .to_string()
        )

    } else {

        Err(
            String::from_utf8_lossy(
                &output.stderr
            )
            .to_string()
        )
    }
}

#[tauri::command]
pub fn logout_org(
    username: String
) -> Result<String, String> {

    let sf = r"C:\Program Files\sf\bin\sf.cmd";

    let output = Command::new(sf)
        .args([
            "org",
            "logout",
            "--target-org",
            &username,
            "--no-prompt"
        ])
        .output()
        .map_err(|e| e.to_string())?;


    if output.status.success() {

        Ok(
            String::from_utf8_lossy(
                &output.stdout
            )
            .to_string()
        )

    } else {

        Err(
            String::from_utf8_lossy(
                &output.stderr
            )
            .to_string()
        )
    }
}



#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataType {
    pub xml_name: String,
    pub directory_name: String,
    pub suffix: Option<String>,
    pub in_folder: bool,
    pub meta_file: bool,
    pub child_xml_names: Vec<String>,
}

#[tauri::command]
pub fn list_metadata_types(
    username: String,
) -> Result<Vec<MetadataType>, String> {

    let sf = r"C:\Program Files\sf\bin\sf.cmd";

    let output = Command::new(sf)
        .args([
            "org",
            "list",
            "metadata-types",
            "--target-org",
            &username,
            "--json",
        ])
        .output()
        .map_err(|e| e.to_string())?;

if !output.status.success() {

    println!(
        "STDERR:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    println!(
        "STDOUT:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );

    return Err(
        String::from_utf8_lossy(&output.stderr)
            .to_string(),
    );
}

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout)
            .map_err(|e| e.to_string())?;

let metadata: Vec<MetadataType> =
    serde_json::from_value(
        json["result"]["metadataObjects"].clone(),
    )
    .map_err(|e| e.to_string())?;

    Ok(metadata)
}

#[tauri::command]
pub fn get_org_details(
    username: String,
) -> Result<OrgDetails, String> {

    let sf = r"C:\Program Files\sf\bin\sf.cmd";

    let output = Command::new(sf)
        .args([
            "org",
            "display",
            "--target-org",
            &username,
            "--json",
        ])
        .output()
        .map_err(|e| e.to_string())?;

if !output.status.success() {

    println!(
        "STDERR:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    println!(
        "STDOUT:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );

    return Err(
        String::from_utf8_lossy(&output.stderr)
            .to_string(),
    );
}

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout)
            .map_err(|e| e.to_string())?;

    let result = &json["result"];

    Ok(OrgDetails {
        access_token: result["accessToken"]
            .as_str()
            .unwrap_or_default()
            .to_string(),

        instance_url: result["instanceUrl"]
            .as_str()
            .unwrap_or_default()
            .to_string(),

        api_version: result["apiVersion"]
            .as_str()
            .unwrap_or("65.0")
            .to_string(),
    })
}

#[tauri::command]
pub fn list_metadata_components(
    metadata_type: String,
    username: String,
) -> Result<Vec<String>, String> {

    let sf = r"C:\Program Files\sf\bin\sf.cmd";

    let output = Command::new(sf)
        .args([
            "org",
            "list",
            "metadata",
            "--metadata-type",
            &metadata_type,
            "--target-org",
            &username,
            "--json",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(
            String::from_utf8_lossy(&output.stderr)
                .to_string(),
        );
    }

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout)
            .map_err(|e| e.to_string())?;

    println!(
        "{}",
        serde_json::to_string_pretty(&json).unwrap()
    );

    let members = json["result"]
        .as_array()
        .ok_or("No metadata found")?;

    let mut components = Vec::new();

    for member in members {

        if let Some(full_name) =
            member["fullName"].as_str()
        {
            components.push(full_name.to_string());
        }

    }

    Ok(components)
}

#[tauri::command]
pub fn retrieve_metadata(
    metadata_types: Vec<String>,
    username: String,
) -> Result<String, String> {

    let sf = r"C:\Program Files\sf\bin\sf.cmd";

    let mut command = Command::new(sf);

    command.args([
        "project",
        "retrieve",
        "start",
        "--target-org",
        &username,
    ]);

    for metadata in metadata_types {
        command.arg("--metadata");
        command.arg(metadata);
    }

    command.arg("--json");

    println!("Running command: {:?}", command);
    let workspace = get_workspace()?;

    command.current_dir(&workspace);

    println!("Workspace: {:?}", workspace);
    
    let output = command
        .output()
        .map_err(|e| e.to_string())?;

    println!("Exit Status: {:?}", output.status);

    println!(
        "STDOUT:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );

    println!(
        "STDERR:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "STDOUT:\n{}\n\nSTDERR:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

fn get_workspace() -> Result<PathBuf, String> {

    let mut path = std::env::current_dir()
        .map_err(|e| e.to_string())?;

    // current_dir = apps/desktop/src-tauri

    path.pop(); // src-tauri

    // now = apps/desktop

    path.push("workspace");

    if !path.exists() {

        fs::create_dir_all(
            path.join("force-app/main/default")
        )
        .map_err(|e| e.to_string())?;

        fs::write(
            path.join("sfdx-project.json"),
            r#"{
  "packageDirectories": [
    {
      "path": "force-app",
      "default": true
    }
  ],
  "namespace": "",
  "sourceApiVersion": "65.0"
}"#
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(path)
}

#[tauri::command]
pub fn list_workspace_files() -> Result<Vec<String>, String> {

    let workspace = get_workspace()?;

    let mut files = Vec::new();

    collect_files(&workspace, &workspace, &mut files)?;

    files.sort();

    Ok(files)
}

fn collect_files(
    current: &Path,
    root: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {

    for entry in fs::read_dir(current)
        .map_err(|e| e.to_string())?
    {
        let entry = entry.map_err(|e| e.to_string())?;

        let path = entry.path();

        if path.is_dir() {

            collect_files(&path, root, files)?;

        } else {

            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace("\\", "/");

            files.push(relative);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn read_workspace_file(
    path: String,
) -> Result<String, String> {

    let workspace = get_workspace()?;

    let full_path = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        workspace.join(path)
    };

    let contents =
        fs::read_to_string(full_path)
            .map_err(|e| e.to_string())?;

    Ok(contents)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {

    pub name:String,

    pub path:String,

    pub node_type:String,

    pub children:Option<Vec<FileNode>>

}



#[tauri::command]
pub fn read_workspace(
    path:String
) -> Result<Vec<FileNode>, String>{

    let root = if path.trim().is_empty() {
        get_workspace()?
    } else {
        PathBuf::from(path)
    };

    let result = read_directory(&root, &root)?;

    Ok(result)

}



fn read_directory(
    root:&Path,
    path:&Path
)
-> Result<Vec<FileNode>, String>{


    let mut nodes = Vec::new();



    let entries =
        fs::read_dir(path)
        .map_err(|e|e.to_string())?;



    for entry in entries {


        let entry =
            entry.map_err(|e|e.to_string())?;


        let path =
            entry.path();



        let name =
            entry.file_name()
            .to_string_lossy()
            .to_string();



        if path.is_dir(){

            let relative_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace("\\", "/");

            nodes.push(

                FileNode{

                    name,

                    path: relative_path,

                    node_type:
                    "folder".to_string(),

                    children:
                    Some(
                        read_directory(root, &path)?
                    )

                }

            );


        }
        else{

            let relative_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace("\\", "/");

            nodes.push(

                FileNode{

                    name,

                    path: relative_path,

                    node_type:
                    "file".to_string(),

                    children:None

                }

            );

        }

    }


    Ok(nodes)

}