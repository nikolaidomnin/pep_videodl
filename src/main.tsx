import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Отключаем контекстное меню и зум webview, чтобы окно вело себя как нативное.
document.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
