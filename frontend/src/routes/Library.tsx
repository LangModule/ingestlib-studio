import { BrandArt } from "../components/BrandArt";

export default function Library() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-24">
      <BrandArt />
      <div className="mx-auto max-w-md text-center">
        <p className="text-2xl text-amber/70" aria-hidden>
          ✦
        </p>
        <h1 className="mt-3 text-lg font-semibold">No documents yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Try it runs the pipeline on a file without storing anything, and Ingest commits
          the result to your stack. The grid of everything you have ingested arrives in
          the next slice.
        </p>
      </div>
    </div>
  );
}
