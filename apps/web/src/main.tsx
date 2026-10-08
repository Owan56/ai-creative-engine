import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/tokens.css";
import "./styles/base.css";

const racine = document.getElementById("root");
if (!racine) throw new Error("Élément #root introuvable.");

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
