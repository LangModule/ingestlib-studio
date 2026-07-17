import { useState } from "react";

/* The upload target shared by Try it and Ingest: a dashed drop area that
   also opens the file picker on click. */
export function Dropzone({
  hint,
  disabled = false,
  onFile,
}: {
  hint: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !disabled) onFile(file);
      }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-16 text-center transition ${
        dragging ? "border-accent bg-accent/5" : "border-line hover:border-ink-soft"
      } ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      <span className="text-2xl text-amber/70" aria-hidden>✦</span>
      <span className="text-sm font-medium">Drop a document here, or click to choose</span>
      <span className="text-xs text-ink-soft">{hint}</span>
      <input
        type="file"
        accept=".pdf,.docx,.pptx"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </label>
  );
}
