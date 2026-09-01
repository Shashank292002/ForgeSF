import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import App from "./App";
import AppInitializer from "./providers/AppInitializer";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppInitializer>
        <App />
      </AppInitializer>
    </ErrorBoundary>
  </StrictMode>,
);
