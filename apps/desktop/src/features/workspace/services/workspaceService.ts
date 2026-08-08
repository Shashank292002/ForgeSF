import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceNode {
    name: string;
    path: string;
    nodeType: string;
    children?: WorkspaceNode[];
}

export async function selectWorkspaceFolder(){

    const folder = await open({

        directory:true,

        multiple:false

    });


    if(!folder){

        return null;

    }


    return folder as string;

}



export async function loadWorkspaceFiles(path = "") {
    return await invoke<WorkspaceNode[]>("read_workspace", {
        path,
    });
}

export async function loadWorkspaceFileContent(path: string) {
    return await invoke<string>("read_workspace_file", {
        path,
    });
}