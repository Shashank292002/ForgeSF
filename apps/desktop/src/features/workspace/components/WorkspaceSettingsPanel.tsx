import { RotateCcw } from "lucide-react";

import {
  DEFAULT_PREFERENCES,
  usePreferencesStore,
} from "../../../store/preferencesStore";

import "./WorkspaceSettingsPanel.css";

/**
 * The editor preferences, where the workspace's gear and `Ctrl+,` lead.
 *
 * Those two entry points and a command-palette item all opened a panel that
 * said "Workspace settings are coming soon" — the last such string in the
 * app. These are the settings that actually change what the editor beside it
 * does, so they belong here; everything else stays on the Settings page.
 */
export default function WorkspaceSettingsPanel() {
  const fontSize = usePreferencesStore((s) => s.editorFontSize);
  const tabSize = usePreferencesStore((s) => s.editorTabSize);
  const wordWrap = usePreferencesStore((s) => s.editorWordWrap);
  const minimap = usePreferencesStore((s) => s.editorMinimap);
  const set = usePreferencesStore((s) => s.set);

  const atDefaults =
    fontSize === DEFAULT_PREFERENCES.editorFontSize &&
    tabSize === DEFAULT_PREFERENCES.editorTabSize &&
    wordWrap === DEFAULT_PREFERENCES.editorWordWrap &&
    minimap === DEFAULT_PREFERENCES.editorMinimap;

  const restore = () => {
    set("editorFontSize", DEFAULT_PREFERENCES.editorFontSize);
    set("editorTabSize", DEFAULT_PREFERENCES.editorTabSize);
    set("editorWordWrap", DEFAULT_PREFERENCES.editorWordWrap);
    set("editorMinimap", DEFAULT_PREFERENCES.editorMinimap);
  };

  return (
    <div className="fw-wssettings">
      <p className="fw-wssettings__intro">
        These apply to every workspace, and take effect as you change them.
      </p>

      <label className="fw-wssettings__row" htmlFor="ws-font-size">
        <span className="fw-wssettings__label">
          Font size
          <span className="fw-wssettings__value">{fontSize}px</span>
        </span>
        <input
          id="ws-font-size"
          type="range"
          min={10}
          max={24}
          step={1}
          value={fontSize}
          onChange={(event) =>
            set("editorFontSize", Number(event.target.value))
          }
        />
      </label>

      <label className="fw-wssettings__row" htmlFor="ws-tab-size">
        <span className="fw-wssettings__label">
          Tab size
          <span className="fw-wssettings__value">{tabSize}</span>
        </span>
        <input
          id="ws-tab-size"
          type="range"
          min={1}
          max={8}
          step={1}
          value={tabSize}
          onChange={(event) => set("editorTabSize", Number(event.target.value))}
        />
      </label>

      <label className="fw-wssettings__check" htmlFor="ws-word-wrap">
        <input
          id="ws-word-wrap"
          type="checkbox"
          checked={wordWrap}
          onChange={(event) => set("editorWordWrap", event.target.checked)}
        />
        <span>
          Wrap long lines
          <small>Otherwise the editor scrolls sideways.</small>
        </span>
      </label>

      <label className="fw-wssettings__check" htmlFor="ws-minimap">
        <input
          id="ws-minimap"
          type="checkbox"
          checked={minimap}
          onChange={(event) => set("editorMinimap", event.target.checked)}
        />
        <span>
          Show the minimap
          <small>The overview strip down the right of the editor.</small>
        </span>
      </label>

      <button
        type="button"
        className="fw-wssettings__reset"
        disabled={atDefaults}
        onClick={restore}
      >
        <RotateCcw size={13} aria-hidden="true" />
        Restore defaults
      </button>
    </div>
  );
}
