import "./WorkspaceTerminal.css";

export default function WorkspaceTerminal() {
    return (
        <section className="workspace-terminal">
            <div className="terminal-header">
                <div>
                    <p className="terminal-label">Console</p>
                    <h3>Developer Terminal</h3>
                </div>
                <span className="terminal-pill">Ready</span>
            </div>

            <pre>
$ sf org list
=== Connected orgs ===
• DemoOrg (alias: demo)
• DevHub (alias: hub)

$ sfdx force:source:status
No local changes detected
            </pre>
        </section>
    );
}