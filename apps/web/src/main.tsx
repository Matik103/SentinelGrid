import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { capturePasswordRecoveryIntent } from "./auth";
import "./tokens.css";
import "./app.css";

// Capture `#type=recovery` / `?reset=1` before Supabase clears the URL hash.
capturePasswordRecoveryIntent();

// Paint immediately. Do not await ensureConfig()/network before mount — that left a
// blank dark #root on reload while app_public_config or fonts/network stalled.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
