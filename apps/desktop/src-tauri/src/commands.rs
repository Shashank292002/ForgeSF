use serde::{Deserialize, Serialize};
use std::process::Command;
use std::process::Stdio;
use std::fs;
use std::path::{Path, PathBuf};

fn find_sf_executable() -> Result<String, String> {
    let candidates = vec![
        r"C:\Program Files\sf\bin\sf.cmd".to_string(),
        "sf".to_string(),
        "sf.cmd".to_string(),
    ];

    for c in candidates {
        let attempt = Command::new(&c).arg("--version").output();
        if let Ok(output) = attempt {
            // If the command ran (even if it printed to stderr), accept it.
            if output.status.success() || !output.stdout.is_empty() || !output.stderr.is_empty() {
                return Ok(c);
            }
        }
    }

    Err("Could not find 'sf' Salesforce CLI. Install 'sf' and ensure it's on PATH or set the expected path.".to_string())
}
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

    let sf = find_sf_executable()?;


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

    let sf = find_sf_executable()?;

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

    let sf = find_sf_executable()?;

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

    let sf = find_sf_executable()?;

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

    let sf = find_sf_executable()?;

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

    let sf = find_sf_executable()?;

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

    let sf = find_sf_executable()?;

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

    let sf = find_sf_executable()?;

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

#[tauri::command]
pub fn deploy_workspace(
    username: String,
    check_only: bool,
) -> Result<String, String> {

    let sf = find_sf_executable()?;

    let workspace = get_workspace()?;

    let mut command = Command::new(&sf);

    command.args([
        "project",
        "deploy",
        "start",
        "--target-org",
        &username,
        "--source-dir",
        "force-app",
        "--json",
    ]);

    if check_only {
        // prefer --check-only; if unsupported the command will return stderr which we capture
        command.arg("--check-only");
    }

    command.current_dir(&workspace);

    println!("Running deploy command: {:?}", command);

    let output = command
        .output()
        .map_err(|e| e.to_string())?;

    println!("Deploy Exit Status: {:?}", output.status);

    println!(
        "DEPLOY STDOUT:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );

    println!(
        "DEPLOY STDERR:\n{}",
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

#[tauri::command]
pub fn write_workspace_file(
    path: String,
    content: String,
) -> Result<String, String> {

    let workspace = get_workspace()?;

    let full_path = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        workspace.join(path)
    };

    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| e.to_string())?;
    }

    fs::write(&full_path, content)
        .map_err(|e| e.to_string())?;

    Ok(full_path.to_string_lossy().to_string())
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

#[tauri::command]
pub fn run_query(username: String, query: String) -> Result<String, String> {
    let sf = find_sf_executable()?;

    let mut command = Command::new(&sf);
    command.args(["data", "query", "--target-org", &username, "--json"]);
    command.arg("--query");
    command.arg(query);

    let output = command.output().map_err(|e| e.to_string())?;

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

#[tauri::command]
pub fn run_command(args: Vec<String>, input: Option<String>) -> Result<String, String> {
    let sf = find_sf_executable()?;

    let mut command = Command::new(&sf);
    if !args.is_empty() {
        command.args(args);
    }

    // If input provided, pipe to stdin
    if input.is_some() {
        command.stdin(Stdio::piped());
    }

    let mut child = command.spawn().map_err(|e| e.to_string())?;

    if let Some(input_str) = input {
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin
                .write_all(input_str.as_bytes())
                .map_err(|e| e.to_string())?;
        }
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;

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