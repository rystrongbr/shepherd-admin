import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Check, Loader2 } from "lucide-react";

const SOURCE = "cloudflare";
const METRIC = "uniques_30d";

// Accepts what the founder actually types from the Cloudflare dashboard:
// plain digits ("2260"), grouped ("2,260"), or shorthand ("2.26k").
// Returns a finite integer, or null if it can't be parsed.
export function parseUniqueUsers(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, "").replace(/\s/g, "");
  if (!s) return null;
  const km = s.match(/^(\d*\.?\d+)k$/);
  const n = km ? parseFloat(km[1]) * 1000 : Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function UpdateUniqueUsersForm() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: { value: number; note: string }) =>
      apiRequest("POST", "/api/traffic/snapshot", {
        source: SOURCE,
        metric: METRIC,
        value: payload.value,
        note: payload.note,
      }).then((r) => r.json()),
    onSuccess: (_resp, payload) => {
      qc.invalidateQueries({ queryKey: ["/api/traffic/latest", SOURCE, METRIC] });
      toast({ title: `Updated to ${payload.value.toLocaleString()}` });
      setValue("");
      setNote("");
      setError(null);
      setOpen(false);
    },
    onError: (err: any) => {
      setError(err?.message || "Update failed");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseUniqueUsers(value);
    if (parsed === null) {
      setError("Enter a valid number (e.g. 2260 or 2.26k)");
      return;
    }
    setError(null);
    mutation.mutate({ value: parsed, note: note.trim() });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="update-unique-users-toggle"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "0.15rem 0",
          fontSize: "0.72rem",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        <Pencil size={11} />
        Update Unique Users
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="update-unique-users-form"
      style={{
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: "0.5rem",
        padding: "0.75rem 0.875rem",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: "0.625rem",
        maxWidth: "520px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
        <label style={{ fontSize: "0.68rem", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>
          Unique Users
        </label>
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 2260"
          data-testid="update-unique-users-value"
          style={{
            width: "120px",
            height: "32px",
            borderRadius: "0.375rem",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
            padding: "0 0.55rem",
            fontSize: "0.8rem",
            fontVariantNumeric: "tabular-nums",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1, minWidth: "180px" }}>
        <label style={{ fontSize: "0.68rem", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>
          Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`e.g., 30-day window ending ${todayISO()}`}
          data-testid="update-unique-users-note"
          style={{
            width: "100%",
            height: "32px",
            borderRadius: "0.375rem",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
            padding: "0 0.55rem",
            fontSize: "0.8rem",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button
          type="submit"
          disabled={mutation.isPending}
          data-testid="update-unique-users-submit"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            height: "32px",
            padding: "0 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid hsl(var(--primary))",
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
            fontSize: "0.78rem",
            fontWeight: 600,
            cursor: mutation.isPending ? "default" : "pointer",
            opacity: mutation.isPending ? 0.7 : 1,
          }}
        >
          {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {mutation.isPending ? "Saving…" : "Update"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={mutation.isPending}
          data-testid="update-unique-users-cancel"
          style={{
            height: "32px",
            padding: "0 0.65rem",
            borderRadius: "0.375rem",
            border: "1px solid hsl(var(--border))",
            background: "transparent",
            color: "hsl(var(--muted-foreground))",
            fontSize: "0.78rem",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div
          data-testid="update-unique-users-error"
          style={{ flexBasis: "100%", fontSize: "0.72rem", color: "hsl(var(--destructive))" }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
