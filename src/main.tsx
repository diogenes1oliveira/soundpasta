import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import DebugInput from "./debug/DebugInput.tsx";
import DebugOutput from "./debug/DebugOutput.tsx";
import DebugQuietJS from "./debug/DebugQuietJS.tsx";
import { QueryProvider } from "./providers/QueryProvider.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/debug/input" element={<DebugInput />} />
          <Route path="/debug/output" element={<DebugOutput />} />
          <Route path="/debug/quietjs" element={<DebugQuietJS />} />
        </Routes>
      </BrowserRouter>
    </QueryProvider>
  </StrictMode>
);
