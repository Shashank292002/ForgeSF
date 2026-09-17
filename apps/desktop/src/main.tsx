import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./index.css";

import App from "./App";
import AppInitializer from "./providers/AppInitializer";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";
import ConfirmHost from "./components/ui/Confirm/ConfirmHost";
import Toaster from "./components/ui/Toast/Toaster";
import ReauthHost from "./features/org-manager/components/ReauthHost";

/**
 * Cache for data read from an org through the Salesforce CLI.
 *
 * A miss costs a CLI start, so nothing is retried on its own and nothing is
 * refetched when the window regains focus — which a desktop window does
 * constantly. Each query says how long its own answer stays fresh.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      gcTime: 30 * 60 * 1000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppInitializer>
          <App />
        </AppInitializer>
        {/* Outside the router, so dialogs and notices survive page changes. */}
        <ConfirmHost />
        <ReauthHost />
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
