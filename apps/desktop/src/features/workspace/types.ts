export interface Workspace {
    id: string;
    name: string;

    path: string;

    orgId?: string;
    orgAlias?: string;

    status:
        | "Connected"
        | "Disconnected";

    createdAt: string;
}


export interface WorkspaceFile {

    path: string;

    name: string;

    type:
        | "folder"
        | "file";

}