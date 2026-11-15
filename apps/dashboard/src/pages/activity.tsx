import { useMemo, useState } from "react";
import type { WorkspaceDetail } from "../../../../shared/dashboard-protocol";
import { exact, usd } from "../lib/format";
import { Figure } from "../ui/Figure";
import { activityStats, Heatmap, HeatStats, splitLine, type HeatMetric } from "../ui/Heatmap";
import { streakLine } from "../lib/fun";
import { Mascot } from "../ui/Mascot";
import { Card, Segmented } from "../ui/kit";

/** a year of bot work, one square a day; with nothing reported yet it is the empty grid and a line on what fills it */
export function Activity({ detail, now, className, style }: { detail: WorkspaceDetail | null; now: number; className?: string; style?: React.CSSProperties }) {
  const [metric, setMetric] = useState<HeatMetric>("turns");
  const activity = detail?.report?.activity;
  const days = activity?.days ?? [];
  const empty = !days.length;
  const total = metric === "turns" ? (activity?.totals.turns ?? 0).toLocaleString("en-US") : metric === "tokens" ? exact(activity?.totals.tokens ?? 0) : usd(activity?.totals.costUsd ?? 0);
  const streak = useMemo(() => streakLine(activityStats(days, "turns", now).current), [days, now]);
  const what = metric === "turns" ? "bot turns" : metric === "tokens" ? "tokens" : "estimated spend";
  return (
    <Card className={className} style={style} aria-labelledby="activity-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="activity-title" className="text-14 text-ink-2">{detail ? `${what} on ${detail.workspace.name}` : what}</h2>
          <p className="mt-1.5"><Figure value={total} /></p>
          {metric === "tokens" && splitLine(activity?.totals) && <p className="num mt-1 text-13 text-ink-3">{splitLine(activity?.totals)}</p>}
          {streak && <p className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-full bg-pop ps-1.5 pe-3 text-13 text-ink-2" data-streak>
            <Mascot body="kit" color="blue" size={20} state="happy" tappable />{streak}
          </p>}
        </div>
        {!empty && <Segmented<HeatMetric> label="measure" value={metric} onChange={setMetric} options={[{ value: "turns", label: "turns" }, { value: "tokens", label: "tokens" }, { value: "spend", label: "spend" }]} />}
      </div>
      <div className="mt-6"><Heatmap days={days} metric={metric} now={now} /></div>
      {empty
        ? <div className="mt-5 flex items-center gap-3"><span className="shrink-0" aria-hidden><Mascot body="wisp" color="purple" size={30} state="sleeping" tappable /></span><p className="text-14 text-ink-3">each square is a day. they fill in as your bots get work done.</p></div>
        : <div className="mt-7 pt-5"><HeatStats days={days} metric={metric} now={now} /></div>}
    </Card>
  );
}
