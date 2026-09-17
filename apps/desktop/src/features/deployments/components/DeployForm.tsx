import { useId, type ReactNode } from "react";
import {
  FileDiff,
  Files,
  FolderGit2,
  Layers,
  Rocket,
  RotateCw,
  ShieldCheck,
  X,
} from "lucide-react";

import type { WorkspaceChanges } from "@/types/generated";
import { Button } from "../../../components/ui";
import { cls } from "../../../lib/cls";
import type { Workspace } from "../../workspace/types";
import {
  TEST_LEVELS,
  type ScopeKind,
  type TestLevelValue,
} from "../lib/deployForm";
import styles from "./DeployForm.module.css";

export interface DeployFormValue {
  scope: ScopeKind;
  testLevel: TestLevelValue;
  testsInput: string;
  ignoreWarnings: boolean;
}

interface DeployFormProps {
  value: DeployFormValue;
  onChange: (patch: Partial<DeployFormValue>) => void;
  workspace: Workspace | null;
  changes: WorkspaceChanges | null;
  changesLoading: boolean;
  changesError: string | null;
  onRefreshChanges: () => void;
  /** Files and folders brought from the explorer; the scope shows with any. */
  selectedPaths: string[];
  onClearSelectedPaths: () => void;
  metadataCount: number;
  /** Which action is starting, while the CLI queues it. */
  starting: "validate" | "deploy" | null;
  /** Why each action cannot run, or null when it can. */
  validateProblem: string | null;
  deployProblem: string | null;
  onValidate: () => void;
  onDeploy: () => void;
  /**
   * What goes between the scope picker and the test options — the metadata
   * selector. It belongs there because the order is the order of the work:
   * choose what to send, then how to test it, then send it. Rendered after
   * the form, the Deploy button sat above the thing being deployed.
   */
  children?: ReactNode;
}

const SCOPES: Array<{ kind: ScopeKind; label: string; icon: typeof Layers }> = [
  { kind: "paths", label: "Selected files", icon: Files },
  { kind: "workspace", label: "Whole workspace", icon: FolderGit2 },
  { kind: "changed", label: "Changed files", icon: FileDiff },
  // No longer whole types only: components can be picked one by one, and the
  // source is another org rather than the workspace.
  { kind: "metadata", label: "Metadata", icon: Layers },
];

const PREVIEW_LIMIT = 8;

/** What to send, how to test it, and the buttons that send it. */
export default function DeployForm({
  value,
  onChange,
  workspace,
  changes,
  changesLoading,
  changesError,
  onRefreshChanges,
  selectedPaths,
  onClearSelectedPaths,
  metadataCount,
  starting,
  validateProblem,
  deployProblem,
  onValidate,
  onDeploy,
  children,
}: DeployFormProps) {
  const ids = useId();
  const changed = changes ? [...changes.modified, ...changes.added] : [];
  const level = TEST_LEVELS.find((item) => item.value === value.testLevel);
  const problem = deployProblem ?? validateProblem;

  return (
    <section className={styles.card} aria-labelledby={`${ids}-title`}>
      <header className={styles.header}>
        <Rocket size={18} />
        <h3 id={`${ids}-title`}>New deployment</h3>
      </header>

      {/* ── What ─────────────────────────────────────────────── */}
      <div className={styles.section}>
        <span className={styles.label} id={`${ids}-scope`}>
          What to send
        </span>
        <div
          className={styles.segments}
          role="radiogroup"
          aria-labelledby={`${ids}-scope`}
        >
          {SCOPES.filter(
            // Only reachable from the explorer, with something selected.
            ({ kind }) => kind !== "paths" || selectedPaths.length > 0,
          ).map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={value.scope === kind}
              className={cls(
                styles.segment,
                value.scope === kind && styles.segmentActive,
              )}
              onClick={() => onChange({ scope: kind })}
            >
              <Icon size={14} />
              {label}
              {kind === "changed" && changes?.baselineAt != null && (
                <span className={styles.segmentCount}>{changed.length}</span>
              )}
              {kind === "metadata" && metadataCount > 0 && (
                <span className={styles.segmentCount}>{metadataCount}</span>
              )}
              {kind === "paths" && (
                <span className={styles.segmentCount}>
                  {selectedPaths.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {value.scope === "paths" && (
          <div className={styles.changed}>
            <div className={styles.changedHead}>
              <span>Selected in the Workspace explorer</span>
              <button
                type="button"
                className={styles.iconButton}
                onClick={onClearSelectedPaths}
                title="Clear the selection"
                aria-label="Clear the selection"
              >
                <X size={13} />
              </button>
            </div>
            <ul className={styles.fileList}>
              {selectedPaths.slice(0, PREVIEW_LIMIT).map((path) => (
                <li key={path} title={path}>
                  {path}
                </li>
              ))}
              {selectedPaths.length > PREVIEW_LIMIT && (
                <li className={styles.more}>
                  …and {selectedPaths.length - PREVIEW_LIMIT} more
                </li>
              )}
            </ul>
            <p className={styles.note}>
              As saved on disk. A folder sends everything in it; a class brings
              its <span className={styles.nowrap}>-meta.xml</span>.
            </p>
          </div>
        )}

        {value.scope === "workspace" && (
          <p className={styles.note}>
            Every package directory of{" "}
            <strong>{workspace?.name ?? "the open workspace"}</strong>, as saved
            on disk.
          </p>
        )}

        {value.scope === "metadata" && (
          <p className={styles.note}>
            Components taken from a source org and deployed to the target. Pick
            the types below, and expand one to choose components within it.
          </p>
        )}

        {value.scope === "changed" && (
          <div className={styles.changed}>
            <div className={styles.changedHead}>
              <span>
                {changes?.baselineAt != null
                  ? `Modified or added since ${new Date(changes.baselineAt).toLocaleString()}`
                  : "Files changed since the last retrieve or deploy"}
              </span>
              <button
                type="button"
                className={styles.iconButton}
                onClick={onRefreshChanges}
                title="Rescan for changes"
                aria-label="Rescan for changes"
              >
                <RotateCw
                  size={13}
                  className={changesLoading ? styles.spin : undefined}
                />
              </button>
            </div>

            {changesError ? (
              <p className={cls(styles.note, styles.error)}>{changesError}</p>
            ) : changes?.baselineAt == null ? (
              <p className={styles.note}>
                {changes
                  ? "Nothing to compare with yet: changes are tracked from the next retrieve or deploy, or from “Start tracking” in the Workspace’s Pending Changes."
                  : "Scanning…"}
              </p>
            ) : changed.length === 0 ? (
              <p className={styles.note}>
                No changes — the workspace matches the last sync.
              </p>
            ) : (
              <ul className={styles.fileList}>
                {changed.slice(0, PREVIEW_LIMIT).map((path) => (
                  <li key={path} title={path}>
                    <span
                      className={cls(
                        styles.marker,
                        changes.added.includes(path) && styles.markerAdded,
                      )}
                    >
                      {changes.added.includes(path) ? "A" : "M"}
                    </span>
                    {path}
                  </li>
                ))}
                {changed.length > PREVIEW_LIMIT && (
                  <li className={styles.more}>
                    …and {changed.length - PREVIEW_LIMIT} more
                  </li>
                )}
              </ul>
            )}

            {changes && changes.deleted.length > 0 && (
              <p className={styles.note}>
                {changes.deleted.length} deleted file(s) are not included — a
                deploy does not remove anything from the org.
              </p>
            )}
          </div>
        )}
      </div>

      {children && <div className={styles.slot}>{children}</div>}

      {/* ── How ──────────────────────────────────────────────── */}
      <div className={styles.section}>
        <label className={styles.label} htmlFor={`${ids}-level`}>
          Apex tests
        </label>
        <select
          id={`${ids}-level`}
          className={styles.select}
          value={value.testLevel}
          onChange={(event) =>
            onChange({ testLevel: event.target.value as TestLevelValue })
          }
        >
          {TEST_LEVELS.map((item) => (
            <option key={item.value || "default"} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {level && <p className={styles.note}>{level.hint}</p>}

        {value.testLevel === "RunSpecifiedTests" && (
          <>
            <label className={styles.label} htmlFor={`${ids}-tests`}>
              Test classes
            </label>
            <textarea
              id={`${ids}-tests`}
              className={styles.textarea}
              rows={2}
              placeholder="AccountServiceTest, OrderServiceTest"
              value={value.testsInput}
              spellCheck={false}
              onChange={(event) => onChange({ testsInput: event.target.value })}
            />
          </>
        )}

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={value.ignoreWarnings}
            onChange={(event) =>
              onChange({ ignoreWarnings: event.target.checked })
            }
          />
          Ignore warnings
          <span className={styles.checkboxHint}>
            Warnings otherwise fail the deploy.
          </span>
        </label>
      </div>

      {/* ── Actions ──────────────────────────────────────────── */}
      <div className={styles.actions}>
        <Button
          variant="secondary"
          leftIcon={<ShieldCheck size={16} />}
          loading={starting === "validate"}
          disabled={starting !== null || validateProblem !== null}
          title={
            validateProblem ??
            "Check the deploy and run tests without changing the org"
          }
          onClick={onValidate}
        >
          Validate
        </Button>
        <Button
          variant="gradient"
          leftIcon={<Rocket size={16} />}
          loading={starting === "deploy"}
          disabled={starting !== null || deployProblem !== null}
          title={deployProblem ?? undefined}
          onClick={onDeploy}
        >
          Deploy
        </Button>
      </div>
      {problem && <p className={cls(styles.note, styles.problem)}>{problem}</p>}
      {/* Said plainly rather than left to be discovered: a deploy adds and
          changes components, and never removes one from the org. */}
      <p className={styles.note}>
        Deploys never delete. Removing a component from the org needs a
        destructive changes manifest, which ForgeSF does not send yet — use{" "}
        <code>sf project deploy start --post-destructive-changes</code> for
        that.
      </p>
    </section>
  );
}
