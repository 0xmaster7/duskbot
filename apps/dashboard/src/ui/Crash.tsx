import { Component, type ReactNode } from "react";
import { stillSvgPaths } from "@/pixel/engine";
import { BOT_COLOURS } from "./Mascot";

const goo = stillSvgPaths("goo", { scale: 1 });

/** the page the dashboard shows when a render throws: a still pixel bot, what happened, two ways out. drawn with plain
 * markup and no motion so it cannot fall over the same way the page did */
export function CrashSky() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-bg px-6 py-14 text-center">
      <div className="flex max-w-[44ch] flex-col items-center">
        <svg viewBox={`0 0 ${goo.G} ${goo.G}`} width={112} height={112} aria-hidden="true" shapeRendering="crispEdges">
          <path d={goo.body} fill={BOT_COLOURS.orange} />
          <path d={goo.eyes} fill="#ffffff" />
        </svg>
        <h1 className="mt-6 text-20 font-medium tracking-[-0.03em] text-ink">this page tripped over itself.</h1>
        <p className="mt-1.5 text-14 font-medium leading-[1.55] text-ink-3">your bots and your data are fine, only this screen stopped. reloading usually sorts it out; the error was sent to us.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => location.reload()} className="press inline-flex h-11 items-center rounded-full bg-primary px-5 text-14 font-medium text-primary-ink hover-primary">reload</button>
          <a href="/" className="press inline-flex h-11 items-center rounded-full bg-btn px-5 text-14 font-medium text-ink hover-btn">go home</a>
        </div>
      </div>
    </main>
  );
}

/** catches a render error anywhere below it; the error still reaches page-errors, which listens on window */
export class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error: Error) {
    window.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));
  }
  render() { return this.state.crashed ? <CrashSky /> : this.props.children; }
}
