import { useEffect, useRef } from "react";
import type { editor, IDisposable, languages, Position } from "monaco-editor";
import Editor from "@monaco-editor/react";

// Side-effect import: points @monaco-editor/react at the bundled Monaco, so
// the editor works offline and inside the packaged app's CSP.
import "../workspace/lib/monaco";
import type { Monaco } from "../workspace/lib/monaco";
import { soqlContextAt } from "./lib/soqlContext";
import { useDescriber, useSObjectLister } from "./hooks/useDescribe";

import "./SoqlEditor.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/⌘+Enter, the same shortcut the page's Run button advertises. */
  onRun: () => void;
  /** The org to describe against; no completions without one. */
  username: string | undefined;
  /** Tooling objects have their own describes. */
  tooling: boolean;
  placeholder?: string;
  readOnly?: boolean;
}

const LANGUAGE = "forgesf-soql";

/** SOQL's keywords, for highlighting and for the completion list. */
const KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "WITH",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "AND",
  "OR",
  "NOT",
  "IN",
  "NOT IN",
  "LIKE",
  "NULL",
  "ASC",
  "DESC",
  "NULLS FIRST",
  "NULLS LAST",
  "FOR VIEW",
  "FOR REFERENCE",
  "FOR UPDATE",
  "TYPEOF",
  "END",
  "COUNT",
  "COUNT_DISTINCT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "TODAY",
  "YESTERDAY",
  "TOMORROW",
  "THIS_WEEK",
  "LAST_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
  "LAST_N_DAYS",
  "NEXT_N_DAYS",
  "TRUE",
  "FALSE",
];

let registered = false;

/** Registers the SOQL language once per Monaco instance. */
function registerSoql(monaco: Monaco) {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: LANGUAGE });
  monaco.languages.setMonarchTokensProvider(LANGUAGE, {
    ignoreCase: true,
    keywords: KEYWORDS.flatMap((word) => word.split(" ")),
    tokenizer: {
      root: [
        [/'([^'\\]|\\.)*'/, "string"],
        [/\b\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?\b/, "number"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/:[A-Za-z_]\w*/, "variable"],
        [
          /[A-Za-z_]\w*/,
          { cases: { "@keywords": "keyword", "@default": "identifier" } },
        ],
        [/[(),.]/, "delimiter"],
        [/[=<>!]+|\bLIKE\b/, "operator"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration(LANGUAGE, {
    brackets: [["(", ")"]],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "'", close: "'" },
    ],
    // SOQL has no comments of its own, but a leading `--` is a common habit.
    comments: { lineComment: "--" },
  });
}

/**
 * A SOQL editor with the org's own objects and fields in its completion list.
 *
 * Replaces a plain textarea: highlighting, bracket matching and — the point of
 * it — suggestions that come from the connected org rather than a fixed list,
 * so a custom field is offered by name the moment the org has one.
 */
export default function SoqlEditor({
  value,
  onChange,
  onRun,
  username,
  tooling,
  placeholder,
  readOnly = false,
}: Props) {
  const describe = useDescriber();
  const listObjects = useSObjectLister();

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const completion = useRef<IDisposable | null>(null);
  // Read inside the completion provider, which Monaco keeps for the life of
  // the language rather than re-creating on each render — so it needs the
  // current values, not the ones captured when it was registered.
  const latest = useRef({ username, tooling, onRun });
  useEffect(() => {
    latest.current = { username, tooling, onRun };
  }, [username, tooling, onRun]);

  useEffect(() => () => completion.current?.dispose(), []);

  const handleMount = (
    instance: editor.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => {
    editorRef.current = instance;

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      latest.current.onRun(),
    );

    completion.current?.dispose();
    completion.current = monaco.languages.registerCompletionItemProvider(
      LANGUAGE,
      {
        triggerCharacters: [" ", ".", ","],
        provideCompletionItems: async (model, position: Position) => {
          const { username, tooling } = latest.current;
          if (!username) return { suggestions: [] };

          const text = model.getValue();
          const offset = model.getOffsetAt(position);
          const context = soqlContextAt(text, offset);
          if (context.kind === "none") return { suggestions: [] };

          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          try {
            if (context.kind === "object") {
              const objects = await listObjects(username);
              return {
                suggestions: objects.map((name) => ({
                  label: name,
                  kind: monaco.languages.CompletionItemKind.Class,
                  insertText: name,
                  range,
                })),
              };
            }

            if (!context.object) return { suggestions: [] };

            // Follow the relationship path: `Account.Owner.` describes User.
            let object = context.object;
            for (const step of context.path) {
              const described = await describe(username, object, tooling);
              const field = described.fields.find(
                (candidate) =>
                  candidate.relationshipName?.toLowerCase() ===
                  step.toLowerCase(),
              );
              const next = field?.referenceTo[0];
              if (!next) return { suggestions: [] };
              object = next;
            }

            const described = await describe(username, object, tooling);
            const suggestions: languages.CompletionItem[] =
              described.fields.map((field) => ({
                label: field.name,
                kind:
                  field.fieldType === "reference"
                    ? monaco.languages.CompletionItemKind.Reference
                    : monaco.languages.CompletionItemKind.Field,
                detail: `${field.fieldType}${field.custom ? " · custom" : ""}`,
                documentation: field.label,
                insertText: field.name,
                // Fields first. Monaco sorts by label unless told otherwise,
                // and a sub-query snippet starts with "(", which sorted every
                // child relationship above every field.
                sortText: `0${field.name}`,
                range,
              }));

            // Sub-queries, offered only where a field list is being written.
            for (const child of described.childRelationships) {
              suggestions.push({
                label: `(SELECT Id FROM ${child})`,
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: "child relationship",
                insertText: `(SELECT Id FROM ${child})`,
                sortText: `1${child}`,
                range,
              });
            }

            return { suggestions };
          } catch {
            // An org that cannot be described — expired auth, no network —
            // should leave the editor usable rather than throwing at each
            // keystroke.
            return { suggestions: [] };
          }
        },
      },
    );
  };

  return (
    <div className="soql-editor">
      <Editor
        language={LANGUAGE}
        theme="vs-dark"
        value={value}
        onChange={(next) => onChange(next ?? "")}
        beforeMount={registerSoql}
        onMount={handleMount}
        options={{
          readOnly,
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          minimap: { enabled: false },
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          padding: { top: 10, bottom: 10 },
          renderLineHighlight: "none",
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, strings: false, comments: false },
          placeholder,
        }}
      />
    </div>
  );
}
