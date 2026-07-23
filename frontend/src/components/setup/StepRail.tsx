import { IconCheck } from "../icons";

const STEPS = ["Connect AWS", "Choices", "Permissions", "Machine", "Finish"];

export function StepRail({ current }: { current: number }) {
  return (
    <ol className="flex flex-col gap-4">
      {STEPS.map((title, index) => {
        const number = index + 1;
        const state = number < current ? "done" : number === current ? "active" : "todo";
        return (
          <li key={title} className="flex items-center gap-3">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                state === "done"
                  ? "border-ok bg-ok-soft text-ok"
                  : state === "active"
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-line bg-card text-ink-soft"
              }`}
            >
              {state === "done" ? <IconCheck /> : number}
            </span>
            <span
              className={`text-sm ${state === "active" ? "font-semibold text-ink" : "text-ink-soft"}`}
            >
              {title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
