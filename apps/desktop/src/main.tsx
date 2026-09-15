import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import App from "./App";
import AppInitializer from "./providers/AppInitializer";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";
import ConfirmHost from "./components/ui/Confirm/ConfirmHost";
import Toaster from "./components/ui/Toast/Toaster";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppInitializer>
        <App />
      </AppInitializer>
      {/* Outside the router, so dialogs and notices survive page changes. */}
      <ConfirmHost />
      <Toaster />
    </ErrorBoundary>
  </StrictMode>,
);
