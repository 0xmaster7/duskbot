import { Component, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { stillSvgPaths } from "@/pixel/core";

const goo = stillSvgPaths("goo", { scale: 1 });

// React unmounts everything below a root that has no error boundary when a render or an effect throws (react.dev,
// "Catching rendering errors with an error boundary"), which left a page showing only the body's background.
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-[100dvh] items-center justify-center p-6 text-center">
        <div className="flex max-w-md flex-col items-center">
          <svg viewBox={`0 0 ${goo.G} ${goo.G}`} width={96} height={96} aria-hidden="true" shapeRendering="crispEdges">
            <path d={goo.body} fill="#f75e51" />
            <path d={goo.eyes} fill="#ffffff" />
          </svg>
          <h1 className="mt-5 text-lg font-semibold tracking-[-0.01em] text-ink">{t("page.broken.title")}</h1>
          <p className="mt-1.5 text-sm font-medium text-ink-secondary">{t("page.broken.body")}</p>
          <p className="mt-3 max-w-full break-words rounded-lg bg-ink/[0.05] px-3 py-2 font-mono text-xs text-ink-secondary">{this.state.error.message}</p>
          <button type="button" className="mt-5 inline-flex h-10 cursor-pointer items-center rounded-full bg-[#c9f63f] px-5 text-sm font-semibold text-[#1b1b1f] transition-colors hover:bg-[#bde834] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:scale-[0.97]" onClick={() => location.reload()}>
            {t("page.broken.reload")}
          </button>
        </div>
      </div>
    );
  }
}
