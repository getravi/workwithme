import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "./AppProviders";
import App2 from "./App2";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App2 />
    </AppProviders>
  </React.StrictMode>,
);
