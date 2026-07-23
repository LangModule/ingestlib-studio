/* Shared inline SVG icons, replacing the text glyphs (✓ ✗ ✦ 🗑) that used
   to render through the platform's font — and, for the trash can, as a
   color emoji. All inherit currentColor; size and spacing come from the
   caller's className. Checkmarks embedded in sentences stay as text. */

export function IconCheck({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M3 8.5 6.5 12 13 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconX({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="m4 4 8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconTrash({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M2.5 4.5h11M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5m2 0-.6 8.6a1 1 0 0 1-1 .9H6.1a1 1 0 0 1-1-.9l-.6-8.6M6.7 7.5v4M9.3 7.5v4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSparkle({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2q1.5 7 8 8.5Q13.5 12 12 19q-1.5-7-8-8.5Q10.5 9 12 2Z" />
    </svg>
  );
}
