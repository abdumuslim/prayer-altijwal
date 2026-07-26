import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./admin.css";

const root = document.getElementById("root");
if (!root) throw new Error("admin root element missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
