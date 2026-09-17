import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

// monaco-editor's `exports` map rewrites `monaco-editor/<path>` to
// `esm/vs/<path>.js`, so worker entries are addressed without the `esm/vs/`
// prefix. The older deep paths no longer resolve — which went unnoticed while
// this module was only ever type-imported and so never reached the bundler.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

/* Wire Monaco language/tokenisation workers through Vite so the editor
   works fully offline inside the desktop shell (no CDN). */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

// Point @monaco-editor/react at the locally bundled Monaco instance so it
// never tries to download the editor from a CDN.
loader.config({ monaco });

export type Monaco = typeof monaco;
export default monaco;
