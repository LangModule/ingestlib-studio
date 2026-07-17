import { useState } from "react";
import { BrandArt } from "../components/BrandArt";
import type { Reranker, VectorStore } from "../api/types";
import { StepRail } from "../components/setup/StepRail";
import { Step1Aws } from "../components/setup/Step1Aws";
import { Step2Choices } from "../components/setup/Step2Choices";
import { Step3Permissions } from "../components/setup/Step3Permissions";
import { Step4Machine } from "../components/setup/Step4Machine";
import { StepFinish } from "../components/setup/StepFinish";

export interface WizardState {
  profile: string;
  region: string;
  accountId: string;
  arn: string;
  bucket: string;
  store: VectorStore;
  secrets: Record<string, string>;
  reranker: Reranker;
  ocrUrl: string;
  ocrBackend: "mlx-vlm-server" | "vllm-server";
}

const INITIAL: WizardState = {
  profile: "",
  region: "us-east-1",
  accountId: "",
  arn: "",
  // A short global bucket name; the verify step reports a collision if
  // another account already owns it, and the user can rename it here.
  bucket: "ingestlib",
  // SQLite needs no keys and no server, which makes the fastest first run.
  store: "sqlite",
  secrets: {},
  reranker: "jina",
  ocrUrl: "http://localhost:8111/",
  ocrBackend: "mlx-vlm-server",
};

export type Patch = (update: Partial<WizardState>) => void;

export default function Setup() {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL);
  const patch: Patch = (update) => setState((previous) => ({ ...previous, ...update }));

  // Finishing the wizard reloads the page so the app boots with fresh status.
  const finish = () => window.location.assign("/");

  const steps: Record<number, React.ReactNode> = {
    1: <Step1Aws state={state} patch={patch} onNext={() => setStep(2)} />,
    2: (
      <Step2Choices
        state={state}
        patch={patch}
        onNext={() => setStep(3)}
        onBack={() => setStep(1)}
      />
    ),
    3: (
      <Step3Permissions
        state={state}
        onNext={() => setStep(4)}
        onBack={() => setStep(2)}
        onCredentialFailure={() => setStep(1)}
      />
    ),
    4: (
      <Step4Machine
        state={state}
        patch={patch}
        onNext={() => setStep(5)}
        onBack={() => setStep(3)}
      />
    ),
    5: <StepFinish state={state} onBack={() => setStep(4)} onDone={finish} />,
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <BrandArt />
      <header className="mb-10 flex items-start justify-between">
        <div>
          <span className="wordmark text-2xl font-semibold text-ink">
            ingestlib<span className="text-accent">·</span>studio
          </span>
          <p className="mt-1 text-sm text-ink-soft">
            self-hosted document intelligence for RAG
          </p>
        </div>
        <span aria-hidden className="pt-1 text-base text-amber/70">✦</span>
      </header>
      <div className="flex gap-10">
        <aside className="w-44 shrink-0 pt-2">
          <StepRail current={step} />
        </aside>
        <main className="min-w-0 flex-1">
          <div key={step} className="step-enter">
            {steps[step]}
          </div>
        </main>
      </div>
    </div>
  );
}
