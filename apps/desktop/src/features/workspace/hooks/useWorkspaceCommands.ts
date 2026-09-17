import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import {
  workspaceCommands,
  type WorkspaceCommand,
} from "../lib/workspaceCommands";

/** The workspace's commands, for the palette and the keyboard shortcuts. */
export function useWorkspaceCommands(): WorkspaceCommand[] {
  const navigate = useNavigate();
  return useMemo(() => workspaceCommands(navigate), [navigate]);
}
