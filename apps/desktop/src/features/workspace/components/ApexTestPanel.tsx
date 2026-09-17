import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Loader2,
  Play,
  RotateCcw,
  Search,
  X,
  XCircle,
} from "lucide-react";

import { useApexTestStore, type TestLevel } from "../store/apexTestStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { apexFilesIn, testClassesIn } from "../lib/apexTests";
import { listWorkspaceFiles } from "../services/workspaceService";
import { COVERAGE_TARGET } from "../../../lib/testLevels";
import type { ApexTestCase } from "@/types/generated";

import "./ApexTestPanel.css";

/**
 * Running tests is not deploying, so these read as scopes of a run rather
 * than as the deploy levels of the same name — "Selected classes", not
 * "Specified tests". The values are the shared `TestLevelValue` ones, so the
 * two cannot drift; only the wording is local. `NoTestRun` has no meaning
 * here, and neither does the deploy-only "relevant tests".
 */
const LEVELS: { value: TestLevel; label: string; hint: string }[] = [
  {
    value: "RunSpecifiedTests",
    label: "Selected classes",
    hint: "Only the test classes ticked below.",
  },
  {
    value: "RunLocalTests",
    label: "All local tests",
    hint: "Every test in the org except managed packages.",
  },
  {
    value: "RunAllTestsInOrg",
    label: "Every test in the org",
    hint: "Including managed packages. Slow.",
  },
];

function iconFor(outcome: string) {
  if (outcome === "Pass") return <CheckCircle2 size={13} />;
  if (outcome === "Skip") return <CircleSlash size={13} />;
  return <XCircle size={13} />;
}

/** "Pass" → `is-pass`, so one class name covers every outcome. */
function toneOf(outcome: string): string {
  if (outcome === "Pass") return "is-pass";
  if (outcome === "Skip") return "is-skip";
  return "is-fail";
}

function TestRow({ test }: { test: ApexTestCase }) {
  const [open, setOpen] = useState(false);
  const failed = test.outcome !== "Pass" && test.outcome !== "Skip";
  const detail = [test.message, test.stackTrace].filter(Boolean).join("\n\n");

  return (
    <li className={`fw-tests__row ${toneOf(test.outcome)}`}>
      <button
        type="button"
        className="fw-tests__row-head"
        onClick={() => failed && detail && setOpen((value) => !value)}
        aria-expanded={failed && detail ? open : undefined}
        // A passing test has nothing to expand, so it is not a control.
        tabIndex={failed && detail ? 0 : -1}
      >
        <span className="fw-tests__row-icon">{iconFor(test.outcome)}</span>
        <span className="fw-tests__row-name">
          <span className="fw-tests__row-method">{test.methodName}</span>
          <span className="fw-tests__row-class">{test.className}</span>
        </span>
        <span className="fw-tests__row-time">{test.runTimeMs} ms</span>
        {failed && detail && (
          <span className={`fw-tests__row-caret ${open ? "is-open" : ""}`}>
            <ChevronRight size={12} />
          </span>
        )}
      </button>
      {open && detail && <pre className="fw-tests__trace">{detail}</pre>}
    </li>
  );
}

/**
 * Running Apex tests without leaving the editor, and seeing which lines the
 * run never reached.
 *
 * The coverage this records is what `WorkspaceEditor` draws in its gutter, so
 * the numbers here and the marks there always come from the same run.
 */
export default function ApexTestPanel() {
  const { running, run, error, start, cancel, clear } = useApexTestStore();
  const files = useWorkspaceStore((state) => state.files);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const workspaceId = useWorkspaceStore((state) => state.openWorkspaceId);

  const [level, setLevel] = useState<TestLevel>("RunSpecifiedTests");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  // Test classes in the workspace, so a run can be started from what is on
  // disk rather than from a name typed correctly.
  const classes = useMemo(() => testClassesIn(files), [files]);
  // Coverage names classes the run touched, most of which are neither tests
  // nor in a folder the explorer has expanded — so this asks for every path
  // rather than reading the lazily-loaded tree.
  const [allPaths, setAllPaths] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    listWorkspaceFiles(workspaceId)
      .then((list) => current && setAllPaths(list.files))
      .catch(() => current && setAllPaths([]));
    return () => {
      current = false;
    };
  }, [workspaceId, run]);

  const apexFiles = useMemo(() => apexFilesIn(allPaths), [allPaths]);
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? classes.filter((item) => item.name.toLowerCase().includes(query))
      : classes;
  }, [classes, search]);

  const ready =
    !running && (level !== "RunSpecifiedTests" || picked.length > 0);

  function toggle(name: string) {
    setPicked((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  }

  return (
    <div className="fw-tests">
      <div className="fw-tests__scope">
        {LEVELS.map((option) => (
          <label
            key={option.value}
            className="fw-tests__level"
            title={option.hint}
          >
            <input
              type="radio"
              name="apex-test-level"
              value={option.value}
              checked={level === option.value}
              onChange={() => setLevel(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>

      {level === "RunSpecifiedTests" && (
        <div className="fw-tests__classes">
          <div className="fw-tests__search">
            <Search size={12} />
            <input
              type="text"
              value={search}
              placeholder="Filter test classes…"
              aria-label="Filter test classes"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear filter"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {classes.length === 0 ? (
            <p className="fw-tests__empty">
              No test classes in this workspace. Retrieve them, or run all local
              tests instead.
            </p>
          ) : (
            <ul className="fw-tests__class-list">
              {shown.map((item) => (
                <li key={item.path}>
                  <label className="fw-tests__class">
                    <input
                      type="checkbox"
                      checked={picked.includes(item.name)}
                      onChange={() => toggle(item.name)}
                    />
                    <span>{item.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="fw-tests__actions">
        <button
          type="button"
          className="fw-tests__run"
          disabled={!ready}
          onClick={() =>
            void start({
              level,
              tests: level === "RunSpecifiedTests" ? picked : null,
              suites: null,
            })
          }
        >
          {running ? (
            <Loader2 size={13} className="fw-spin" />
          ) : (
            <Play size={13} />
          )}
          {running ? "Running…" : "Run Tests"}
        </button>
        {running ? (
          <button type="button" className="fw-tests__ghost" onClick={cancel}>
            Cancel
          </button>
        ) : (
          run && (
            <button
              type="button"
              className="fw-tests__ghost"
              onClick={clear}
              title="Clear these results and their coverage marks"
            >
              <RotateCcw size={13} /> Clear
            </button>
          )
        )}
      </div>

      {error && (
        <p className="fw-tests__error" role="alert">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {run && (
        <>
          <div
            className={`fw-tests__summary ${run.summary.failing > 0 ? "is-fail" : "is-pass"}`}
          >
            <span className="fw-tests__outcome">{run.summary.outcome}</span>
            <span>
              {run.summary.passing}/{run.summary.testsRan} passed
              {run.summary.skipped > 0 && ` · ${run.summary.skipped} skipped`}
            </span>
            <span className="fw-tests__timing">{run.summary.runTimeMs} ms</span>
            {run.summary.runCoverage && (
              <span title="Coverage of the classes this run touched">
                {run.summary.runCoverage} covered
              </span>
            )}
          </div>

          {run.tests.length > 0 && (
            <ul className="fw-tests__results">
              {run.tests.map((test) => (
                <TestRow key={test.name} test={test} />
              ))}
            </ul>
          )}

          {run.coverage.length > 0 && (
            <div className="fw-tests__coverage">
              <span className="fw-tests__section">Coverage</span>
              <ul>
                {run.coverage.map((item) => {
                  const file = apexFiles.get(item.name);
                  const low = item.coveredPercent < COVERAGE_TARGET;
                  return (
                    <li key={item.name}>
                      <button
                        type="button"
                        className="fw-tests__coverage-row"
                        disabled={!file}
                        title={
                          file
                            ? `Open ${item.name}`
                            : `${item.name} is not in this workspace`
                        }
                        onClick={() => file && void selectFile(file)}
                      >
                        <span className="fw-tests__coverage-name">
                          {item.name}
                        </span>
                        <span
                          className={`fw-tests__coverage-value ${low ? "is-low" : ""}`}
                        >
                          {Math.round(item.coveredPercent)}%
                        </span>
                        <span className="fw-tests__coverage-track">
                          <span
                            className={`fw-tests__coverage-bar ${low ? "is-low" : ""}`}
                            style={{ width: `${item.coveredPercent}%` }}
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
