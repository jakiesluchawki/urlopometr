import React from "react";
import { createRoot } from "react-dom/client";
import UrlopometrApp from "../app/urlopometr-app";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UrlopometrApp />
  </React.StrictMode>,
);
