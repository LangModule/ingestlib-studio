import type { StageEvent } from "../../api/types";
import { IconCheck, IconX } from "../icons";

/* Live pipeline progress driven by the SSE event stream. Try it passes three
   stages; Ingest will pass five and reuse this unchanged. */

type StageState = "pending" | "running" | "done" | "failed";

function deriveState(stage: string, events: StageEvent[]): { state: StageState; seconds?: number; detail?: string } {
  let state: StageState = "pending";
  let seconds: number | undefined;
  let detail: string | undefined;
  for (const event of events) {
    if (event.stage !== stage) continue;
    if (event.event === "start") state = "running";
    if (event.event === "done") {
      state = "done";
      seconds = event.seconds ?? undefined;
    }
    if (event.event === "failed") {
      state = "failed";
      detail = event.detail ?? undefined;
    }
  }
  return { state, seconds, detail };
}

export function StageStepper({ stages, events }: { stages: string[]; events: StageEvent[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {stages.map((stage) => {
        const { state, seconds, detail } = deriveState(stage, events);
        return (
          <li key={stage} className="flex items-center gap-3">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                state === "done"
                  ? "border-ok bg-ok-soft text-ok"
                  : state === "failed"
                    ? "border-fail bg-fail-soft text-fail"
                    : state === "running"
                      ? "border-accent text-accent"
                      : "border-line text-ink-soft"
              }`}
            >
              {state === "done" && <IconCheck />}
              {state === "failed" && <IconX />}
              {state === "running" && (
                <span className="h-3 w-3 animate-spin rounded-full border border-accent border-t-transparent" />
              )}
              {state === "pending" && "·"}
            </span>
            <span className={`text-sm ${state === "pending" ? "text-ink-soft" : "text-ink"}`}>
              {stage}
            </span>
            {seconds !== undefined && (
              <span className="mono text-xs text-ink-soft">{seconds.toFixed(1)}s</span>
            )}
            {detail && <span className="text-xs text-fail">{detail}</span>}
          </li>
        );
      })}
    </ol>
  );
}
