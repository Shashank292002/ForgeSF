import { useState } from "react";
import "./WorkspaceExplorer.css";
import { useWorkspaceStore, type WorkspaceFile } from "../store/workspaceStore";

export default function WorkspaceExplorer() {
    const files = useWorkspaceStore((state) => state.files);

    return (
        <aside className="workspace-explorer">
            <div className="explorer-header">
                <div>
                    <p className="explorer-label">Project</p>
                    <h3>Explorer</h3>
                </div>
                <span className="explorer-badge">{files.length} items</span>
            </div>

            <div className="explorer-list">
                {files.map((file) => (
                    <FileNode key={file.path} node={file} level={0} />
                ))}
            </div>
        </aside>
    );
}

interface FileNodeProps {
    node: WorkspaceFile;
    level: number;
}

function FileNode({ node, level }: FileNodeProps) {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({
        "force-app": true,
        "force-app/main": true,
        "force-app/main/default": true,
        "force-app/main/default/classes": true,
    });

    const selectedFile = useWorkspaceStore((state) => state.selectedFile);
    const selectFile = useWorkspaceStore((state) => state.selectFile);

    const isExpanded = expanded[node.path] ?? false;
    const isActive = selectedFile === node.path;

    const clickHandler = () => {
        if (node.type === "folder") {
            setExpanded((previous) => ({ ...previous, [node.path]: !isExpanded }));
            return;
        }

        selectFile(node.path);
    };

    return (
        <div>
            <div className={`tree-node ${isActive ? "active" : ""}`} style={{ paddingLeft: `${level * 14 + 10}px` }} onClick={clickHandler}>
                <span className="tree-icon">{node.type === "folder" ? (isExpanded ? "▾" : "▸") : "●"}</span>
                <span>{node.name}</span>
            </div>

            {node.type === "folder" && isExpanded && node.children?.map((child) => (
                <FileNode key={child.path} node={child} level={level + 1} />
            ))}
        </div>
    );
}
