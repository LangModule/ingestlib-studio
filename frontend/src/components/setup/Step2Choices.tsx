import type { Reranker, VectorStore } from "../../api/types";
import type { Patch, WizardState } from "../../routes/Setup";
import { OpensearchDeployHint } from "./OpensearchDeployHint";
import { Button, Card, Field, TextInput } from "./ui";

export interface SecretField {
  key: string;
  label: string;
  placeholder: string;
  password?: boolean;
  // Optional fields may stay empty, for example keys of unsecured local servers.
  optional?: boolean;
}

export interface StoreOption {
  id: VectorStore;
  title: string;
  blurb: string;
  secretFields: SecretField[];
  dockerHint?: string;
}

export const STORES: StoreOption[] = [
  {
    id: "sqlite",
    title: "SQLite",
    blurb: "Zero setup: one local file, no server, no keys. Retrieves as well as the clouds in our evals.",
    secretFields: [],
  },
  {
    id: "pinecone",
    title: "Pinecone",
    blurb: "Serverless cloud, free tier works. Hybrid dense and sparse search.",
    secretFields: [
      { key: "PINECONE_API_KEY", label: "API key", placeholder: "pcsk_…", password: true },
    ],
  },
  {
    id: "qdrant",
    title: "Qdrant",
    blurb: "Local docker or Qdrant Cloud. Hybrid search fused server-side.",
    secretFields: [
      { key: "QDRANT_URL", label: "URL", placeholder: "http://localhost:6333" },
      {
        key: "QDRANT_API_KEY",
        label: "API key, empty for a local server",
        placeholder: "",
        password: true,
        optional: true,
      },
    ],
    dockerHint: "docker run -p 6333:6333 qdrant/qdrant",
  },
  {
    id: "pgvector",
    title: "Postgres / pgvector",
    blurb: "The Postgres you already run: RDS, Supabase, Neon, or docker.",
    secretFields: [
      {
        key: "PGVECTOR_URL",
        label: "Connection URL",
        placeholder: "postgresql://user:pass@host:5432/db",
      },
    ],
    dockerHint: "docker run -p 5432:5432 pgvector/pgvector:pg18",
  },
  {
    id: "mongodb",
    title: "MongoDB",
    blurb: "Atlas on any tier, the free M0 included, or self-managed 8.2+.",
    secretFields: [
      { key: "MONGODB_URL", label: "Connection URL", placeholder: "mongodb+srv://…" },
    ],
    dockerHint: "docker run -p 27017:27017 mongodb/mongodb-atlas-local",
  },
  {
    id: "milvus",
    title: "Milvus",
    blurb: "Dedicated open-source vector database: local docker or Zilliz Cloud.",
    secretFields: [
      { key: "MILVUS_URL", label: "URL", placeholder: "http://localhost:19530" },
      {
        key: "MILVUS_TOKEN",
        label: "Token, empty for a local server",
        placeholder: "",
        password: true,
        optional: true,
      },
    ],
    dockerHint: "docker run -p 19530:19530 milvusdb/milvus",
  },
  {
    id: "opensearch",
    title: "OpenSearch",
    blurb: "Amazon OpenSearch on your AWS account. Requests sign with the same profile, no new key.",
    secretFields: [
      {
        // Optional at this step: a fresh user deploys the domain with the
        // next step's IAM policy first, then returns to paste the endpoint.
        key: "OPENSEARCH_URL",
        label: "Domain endpoint URL, empty until your domain exists",
        placeholder: "https://search-your-domain.us-east-1.es.amazonaws.com",
        optional: true,
      },
    ],
  },
  {
    id: "weaviate",
    title: "Weaviate",
    blurb: "Native hybrid search fused in one call. Local docker or Weaviate Cloud.",
    secretFields: [
      { key: "WEAVIATE_URL", label: "URL", placeholder: "http://localhost:8080" },
      {
        key: "WEAVIATE_API_KEY",
        label: "API key, empty for a local server",
        placeholder: "",
        password: true,
        optional: true,
      },
    ],
    dockerHint: "docker run -p 8080:8080 -p 50051:50051 "
      + "-e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true cr.weaviate.io/semitechnologies/weaviate",
  },
];

export const RERANKERS: { id: Reranker; title: string; blurb: string }[] = [
  {
    id: "jina",
    title: "Jina (recommended)",
    blurb: "The biggest retrieval-quality lever: +5 to +14 points hit@1 in our evals. Free key, 100 requests per minute.",
  },
  {
    id: "aws",
    title: "Amazon Rerank",
    blurb: "Uses the same AWS credentials, no new account. Default quotas are low; request an increase for real workloads.",
  },
  {
    id: "none",
    title: "None",
    blurb: "Skip reranking. Retrieval returns plain vector order.",
  },
];

export function ChoiceCard({
  selected,
  title,
  blurb,
  onSelect,
}: {
  selected: boolean;
  title: string;
  blurb: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative rounded-lg border p-4 text-left transition ${
        selected
          ? "border-accent ring-1 ring-accent shadow-[0_0_24px_rgba(95,212,180,0.14)]"
          : "border-line hover:border-ink-soft"
      } bg-card`}
    >
      {selected && (
        <span className="check-in absolute top-3 right-3 text-xs font-bold text-accent">✓</span>
      )}
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-1 block text-xs leading-relaxed text-ink-soft">{blurb}</span>
    </button>
  );
}

export function Step2Choices({
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
  const store = STORES.find((option) => option.id === state.store)!;
  const setSecret = (key: string, value: string) =>
    patch({ secrets: { ...state.secrets, [key]: value } });

  const jinaKeyMissing = state.reranker === "jina" && !state.secrets.JINA_API_KEY;
  const storeKeyMissing = store.secretFields.some(
    (field) => !field.optional && !state.secrets[field.key],
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">Choices</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Three decisions. Nothing is created now; everything bootstraps on first use.
        </p>
      </header>

      <Card>
        <Field
          label="S3 bucket (artifact store)"
          hint="bucket names are global across AWS · created automatically on first use"
        >
          <TextInput
            value={state.bucket}
            className="mono"
            onChange={(e) => patch({ bucket: e.target.value })}
          />
        </Field>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Vector database</h2>
        <div className="grid grid-cols-2 gap-3">
          {STORES.map((option) => (
            <ChoiceCard
              key={option.id}
              selected={state.store === option.id}
              title={option.title}
              blurb={option.blurb}
              onSelect={() => patch({ store: option.id })}
            />
          ))}
        </div>
        {(store.secretFields.length > 0 || store.dockerHint) && (
          <Card className="mt-3 flex flex-col gap-3">
            {store.secretFields.map((field) => (
              <Field key={field.key} label={field.label}>
                <TextInput
                  type={field.password ? "password" : "text"}
                  className="mono"
                  placeholder={field.placeholder}
                  value={state.secrets[field.key] ?? ""}
                  onChange={(e) => setSecret(field.key, e.target.value)}
                />
              </Field>
            ))}
            {store.dockerHint && (
              <p className="text-xs text-ink-soft">
                No server yet? <code className="mono">{store.dockerHint}</code>
              </p>
            )}
            {state.store === "opensearch" && (
              <OpensearchDeployHint
                arn={state.arn}
                profile={state.profile}
                region={state.region}
              />
            )}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Reranker</h2>
        <div className="grid grid-cols-3 gap-3">
          {RERANKERS.map((option) => (
            <ChoiceCard
              key={option.id}
              selected={state.reranker === option.id}
              title={option.title}
              blurb={option.blurb}
              onSelect={() => patch({ reranker: option.id })}
            />
          ))}
        </div>
        {state.reranker === "jina" && (
          <Card className="mt-3">
            <Field label="Jina API key" hint="free at jina.ai/api-dashboard">
              <TextInput
                type="password"
                className="mono"
                placeholder="jina_…"
                value={state.secrets.JINA_API_KEY ?? ""}
                onChange={(e) => setSecret("JINA_API_KEY", e.target.value)}
              />
            </Field>
          </Card>
        )}
      </section>

      <div className="flex justify-between">
        <Button kind="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onNext} disabled={!state.bucket || jinaKeyMissing || storeKeyMissing}>
          Next: Permissions →
        </Button>
      </div>
    </div>
  );
}
