import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);

// Register the static-shell PWA worker only in production. Supabase/API data is never cached.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .catch(error => console.warn("GMS service worker registration failed:", error));
  });
}
