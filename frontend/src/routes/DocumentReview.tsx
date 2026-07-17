import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { DocumentView } from "../api/types";
import { ReviewShell } from "../components/review/ReviewShell";
import { Button, Card } from "../components/setup/ui";

/* A stored document in the review shell, loaded from the S3 artifacts.
   Delete removes the document everywhere: vectors first, then S3. */

export default function DocumentReview() {
  const { docId } = useParams<{ docId: string }>();
  const [view, setView] = useState<DocumentView | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!docId) return;
    api
      .documentGet(docId)
      .then(setView)
      .catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
  }, [docId]);

  const remove = async () => {
    if (!docId) return;
    // The first click arms the button; only the second click deletes.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    try {
      await api.documentDelete(docId);
      navigate("/");
    } catch (exc) {
      setDeleting(false);
      setConfirming(false);
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm text-fail">{error}</p>
          <Button kind="ghost" className="mt-3" onClick={() => navigate("/")}>
            ← Library
          </Button>
        </Card>
      </div>
    );
  }

  if (!view) {
    return (
      <p className="mono px-6 py-16 text-center text-sm text-ink-soft">
        loading document…
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <ReviewShell
        document={view}
        footer={
          <div className="flex justify-between border-t border-line pt-4">
            <Button kind="ghost" onClick={() => navigate("/")}>← Library</Button>
            <Button
              kind="ghost"
              onClick={remove}
              disabled={deleting}
              className={confirming ? "border-fail text-fail" : ""}
            >
              {deleting
                ? "Deleting…"
                : confirming
                  ? "Click again to delete vectors and artifacts"
                  : "Delete from library"}
            </Button>
          </div>
        }
      />
    </div>
  );
}
