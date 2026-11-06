import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { GrokMark, type GrokMarkHandle } from "@/components/mascot-motion-view";
import { Select } from "@/components/Select";
import { MARK_STATES } from "@/components/mascot-motion-mark";
import { MARK_CLIPS } from "@/components/mascot-motion-engine";
import { OMB_CLIPS } from "@/components/mascot-clips";
import type { MarkReaction } from "@/components/mascot-personality";
import { cueMascot } from "@/components/mascot-events";
import { MASCOT_INK, MAUS_COLOR_NAMES, type MausColor } from "@/lib/mascot";
import { GROK_BODY_IDS } from "../shared/grok-bodies";
import "./font-faces";
import "./styles.css";

const COLORS = MAUS_COLOR_NAMES as readonly MausColor[];
const ink = (index: number) => MASCOT_INK[COLORS[index % COLORS.length]!] ?? MASCOT_INK.green;
const GROK_CLIPS = [...MARK_CLIPS.values()].map((clip) => ({ name: clip.name, duration: clip.duration, ours: false }));
const OUR_CLIPS = Object.values(OMB_CLIPS).map((clip) => ({ name: clip.name, duration: clip.duration, ours: true }));
const REACTIONS: Array<MarkReaction | "watch"> = ["hop", "greet", "cheer", "startle", "wiggle", "nod", "spin", "watch"];
const CUE = "preview-bodies";

function ClipTile({ name, duration, ours, body, color }: { name: string; duration: number; ours: boolean; body: string; color: string }) {
  const mark = useRef<GrokMarkHandle>(null);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    mark.current?.playClip(name);
    const timer = setInterval(() => mark.current?.playClip(name), duration * 1000 + 900);
    return () => clearInterval(timer);
  }, [auto, name, duration, body]);
  return (
    <figure className="flex flex-col items-center gap-2 rounded-[12px] border border-ink/[0.08] p-3" data-clip={name}>
      <GrokMark ref={mark} body={body} ink={color} size={64} seed={name} personality={false} label={name} />
      <figcaption className="text-center text-[12px] leading-4 text-ink-secondary">
        <span className="font-medium text-ink">{name}</span> · {duration}s · {ours ? "ours" : "Grok"}
      </figcaption>
      <div className="flex gap-1">
        <button type="button" className="ui-pill" onClick={() => mark.current?.playClip(name)}>Play</button>
        <button type="button" className="ui-pill" aria-pressed={auto} onClick={() => setAuto((on) => !on)}>{auto ? "Looping" : "Loop"}</button>
      </div>
    </figure>
  );
}

function Preview() {
  const [body, setBody] = useState<string>("blob");
  const bodies = useRef(new Map<string, GrokMarkHandle>());
  const bodyIndex = GROK_BODY_IDS.indexOf(body as (typeof GROK_BODY_IDS)[number]);
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-10 bg-app p-8 text-ink">
      <header className="flex flex-col gap-1">
        <h1 className="text-[17px] font-medium leading-6">Mascot motion</h1>
        <p className="text-[13px] leading-[18px] text-ink-secondary">
          Grok's engine with all {GROK_CLIPS.length} of its clips and {MARK_STATES.length} states, plus our {OUR_CLIPS.length} clips, idle life and reactions.
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="bodies-title">
        <h2 id="bodies-title" className="text-[14px] font-semibold leading-5">Every body, living idle</h2>
        <p className="text-[12px] leading-4 text-ink-secondary">Each blinks, glances, stretches and dozes on its own seeded schedule. Hover one to wake it, double-click to spin.</p>
        <div className="flex flex-wrap gap-4" data-bodies>
          {GROK_BODY_IDS.map((id, index) => (
            <GrokMark key={id} ref={(handle) => { if (handle) bodies.current.set(id, handle); else bodies.current.delete(id); }}
              body={id} ink={ink(index)} size={44} seed={`${id}-${index}`} label={id} cueKey={CUE} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Reactions">
          {REACTIONS.map((reaction) => (
            <button key={reaction} type="button" className="ui-pill" onClick={() => cueMascot(CUE, reaction)}>{reaction}</button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="clips-title">
        <div className="flex items-center gap-3">
          <h2 id="clips-title" className="text-[14px] font-semibold leading-5">Every clip</h2>
          <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
            Body
            <Select size="sm" value={body} onChange={(event) => setBody(event.target.value)}>
              {GROK_BODY_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
            </Select>
          </label>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {[...GROK_CLIPS, ...OUR_CLIPS].map((clip) => <ClipTile key={clip.name} {...clip} body={body} color={ink(bodyIndex)} />)}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="states-title">
        <h2 id="states-title" className="text-[14px] font-semibold leading-5">Every state</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
          {MARK_STATES.map((state, index) => (
            <figure key={state} className="flex flex-col items-center gap-2 rounded-[12px] border border-ink/[0.08] p-3" data-state={state}>
              <GrokMark body={GROK_BODY_IDS[index % GROK_BODY_IDS.length]!} ink={ink(index)} size={56} state={state} seed={state} personality={false} label={state} />
              <figcaption className="text-[12px] leading-4 text-ink-secondary">{state}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
