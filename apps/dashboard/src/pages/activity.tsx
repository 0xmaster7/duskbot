import { useState } from "react";
import type { WorkspaceDetail } from "../../../../shared/dashboard-protocol";
import { compact, usd } from "../lib/format";
import { Figure } from "../ui/Figure";
import { Heatmap, HeatStats, type HeatMetric } from "../ui/Heatmap";
import { Card, Segmented } from "../ui/kit";

/** a year of bot work, one square a day; with nothing reported yet it is the empty grid and a line on what fills it */
export function Activity({ detail, now, className, style }: { detail: WorkspaceDetail | null; now: number; className?: string; style?: React.CSSProperties }) {
  const [metric, setMetric] = useState<HeatMetric>("turns");
  const activity = detail?.report?.activity;
  const days = activity?.days ?? [];
  const empty = !days.length;
  const total = metric === "turns" ? (activity?.totals.turns ?? 0).toLocaleString("en-US") : metric === "tokens" ? compact(activity?.totals.tokens ?? 0) : usd(activity?.totals.costUsd ?? 0);
  const what = metric === "turns" ? "bot turns" : metric === "tokens" ? "tokens" : "estimated spend";
  return (
    <Card className={className} style={style} aria-labelledby="activity-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="activity-title" className="text-14 text-ink-2">{detail ? `${what} on ${detail.workspace.name}` : what}</h2>
          <p className="mt-1.5"><Figure value={total} /></p>
        </div>
        {!empty && <Segmented<HeatMetric> label="measure" value={metric} onChange={setMetric} options={[{ value: "turns", label: "turns" }, { value: "tokens", label: "tokens" }, { value: "spend", label: "spend" }]} />}
      </div>
      <div key={metric} className="swap-in mt-6"><Heatmap days={days} metric={metric} now={now} /></div>
      {empty
        ? <p className="mt-5 text-14 text-ink-3">each square is a day. they fill in as your bots get work done.</p>
        : <div className="mt-7 border-t border-line pt-5"><HeatStats days={days} metric={metric} now={now} /></div>}
    </Card>
  );
}
