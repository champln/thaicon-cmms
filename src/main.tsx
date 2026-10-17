import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/anuphan";
import App from "./App";
import "./global.css";
import "./cmms.css";
import "./iot-monitor.css";
import "./readability.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
