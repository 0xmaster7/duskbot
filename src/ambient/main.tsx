// The notch island's and the bot dock's page (electron/ambient-main.mjs): its own small entry, never the app. Anywhere
// but those two windows this address is the app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { Dock } from "./Dock";
import { Island } from "./Island";
import { watchStaleChunks } from "../lib/stale-chunks";
import "@fontsource-variable/geist";
import "./ambient-page.css";
import "./ambient.css";

const bridge = window.ambient;
if (bridge?.surface) {
  watchStaleChunks();
  document.documentElement.dataset.surface = bridge.surface;
  document.documentElement.classList.add("amb-root");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">{bridge.surface === "island" ? <Island bridge={bridge} /> : <Dock bridge={bridge} />}</MotionConfig>
    </StrictMode>,
  );
} else {
  location.replace("/");
}
