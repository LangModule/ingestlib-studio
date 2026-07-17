import { useCallback } from "react";
import { api } from "../../api/client";
import type { Patch, WizardState } from "../../routes/Setup";
import { Button, Card, Field, Select, TextInput, useCheck, VerifyRow } from "./ui";

const LAUNCH_COMMANDS = {
  "mlx-vlm-server":
    "cd ingestlib-studio/backend\nuv run python -m mlx_vlm.server --port 8111 --model PaddlePaddle/PaddleOCR-VL-1.6",
  "vllm-server": "vllm serve PaddlePaddle/PaddleOCR-VL-1.6 --port 8111",
};

export function Step4Machine({
  state,
  patch,
  onNext,
  onBack,
}: {
  state: WizardState;
  patch: Patch;
  onNext: () => void;
  onBack: () => void;
}) {
  const runOcr = useCallback(() => api.checkOcr(state.ocrUrl), [state.ocrUrl]);
  const [ocrCheck, verifyOcr] = useCheck(runOcr);
  const runOffice = useCallback(() => api.checkLibreOffice(), []);
  const [officeCheck, verifyOffice] = useCheck(runOffice);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Machine checks</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Both are skippable. Browsing and retrieval work without them; Try it and
          Ingest need the OCR server, and DOCX/PPTX conversion needs LibreOffice.
        </p>
      </header>

      <Card className="flex flex-col gap-4">
        <VerifyRow label="PaddleOCR-VL inference server" state={ocrCheck} onVerify={verifyOcr}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Server URL">
              <TextInput
                className="mono"
                value={state.ocrUrl}
                onChange={(e) => patch({ ocrUrl: e.target.value })}
              />
            </Field>
            <Field label="Backend">
              <Select
                value={state.ocrBackend}
                onChange={(e) =>
                  patch({ ocrBackend: e.target.value as WizardState["ocrBackend"] })
                }
              >
                <option value="mlx-vlm-server">mlx-vlm-server (Apple Silicon)</option>
                <option value="vllm-server">vllm-server (NVIDIA)</option>
              </Select>
            </Field>
          </div>
          <p className="text-xs text-ink-soft">
            {state.ocrBackend === "mlx-vlm-server"
              ? "Not running yet? Start it from the studio's backend directory, whose " +
                "environment already includes the server. The first launch downloads " +
                "about 1.8 GB of weights; later launches load from cache in seconds."
              : "Not running yet? Start it wherever vLLM is installed. The first launch " +
                "downloads about 1.8 GB of weights; later launches load from cache."}
          </p>
          <pre className="mono overflow-x-auto rounded-lg border border-line bg-lighttable p-3 text-xs text-ink">
            {LAUNCH_COMMANDS[state.ocrBackend]}
          </pre>
        </VerifyRow>
      </Card>

      <Card>
        <VerifyRow label="LibreOffice (DOCX/PPTX → PDF)" state={officeCheck} onVerify={verifyOffice}>
          <p className="text-xs text-ink-soft">
            <code className="mono">brew install --cask libreoffice</code> on macOS ·{" "}
            <code className="mono">apt install libreoffice-core libreoffice-writer libreoffice-impress</code> on Linux
          </p>
        </VerifyRow>
      </Card>

      <div className="flex justify-between">
        <Button kind="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onNext}>
          {ocrCheck.status === "ok" ? "Next: Finish →" : "Skip for now → Finish"}
        </Button>
      </div>
    </div>
  );
}
