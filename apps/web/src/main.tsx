import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ensureConfig } from "./api";
import { capturePasswordRecoveryIntent } from "./auth";
import "./tokens.css";
import "./app.css";

async function start() {
  // Capture `#type=recovery` / `?reset=1` before Supabase clears the URL hash.
  capturePasswordRecoveryIntent();
  await ensureConfig();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

void start();
