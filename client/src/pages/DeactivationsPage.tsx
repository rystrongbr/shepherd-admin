import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { UserMinus, RotateCcw, AlertTriangle, Heart, Mail as MailIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// ─── Types (mirror server/email/deactivations.ts) ────────────────────────────

type ReasonCategory = "hard_bounce" | "soft_bounce" | "unsubscribe" | "spam_report" | "other";

interface DeactivationRow {
  memberId: number;
  email: string;
  firstName: string;
  lastName: string;
  churchId: number;
  churchName: string;
  reason: string;
  deactivatedAt: string;
  reasonCategory: ReasonCategory;
  hasUnsubscribe: boolean;
  isDonor: boolean;
  donorSince: string;
  bounceCount: number;
}

interface DeactivationsResponse {
  ok: true;
  restoreEnabled: boolean;
  summary: {
    windowFromIso: string;
    windowToIso: string;
    newInWindow: number;
    donorsInWindow: number;
    totalBacklog: number;
    byReason: Record<ReasonCategory, number>;
  };
  rows: DeactivationRow[];
}

// ─── Reason filter chips ─────────────────────────────────────────────────────

const REASON_FILTERS: Array<{ value: "all" | ReasonCategory; label: string }> = [
  { value: "all",          label: "All" },
  { value: "hard_bounce",  label: "Hard bounce" },
  { value: "soft_bounce",  label: "Soft bounce" },
  { value: "unsubscribe",  label: "Unsubscribe" },
  { value: "spam_report",  label: "Spam report" },
  { value: "other",        label: "Other" },
];

const REASON_LABELS: Record<ReasonCategory, string> = {
  hard_bounce:  "Hard bounce",
  soft_bounce:  "Soft bounce",
  unsubscribe:  "Unsubscribe",
  spam_report:  "Spam report",
  other:        "Other",
};

// Map each reason to a colored badge using existing CSS classes
function reasonBadgeClass(r: ReasonCategory): string {
  switch (r) {
    case "hard_bounce": return "badge-paused";           // red-orange
    case "soft_bounce": return "badge-segment-volunteer"; // purple
    case "unsubscribe": return "badge-segment-new_visitor"; // blue
    case "spam_report": return "badge-paused";           // red-orange (most severe)
    default:            return "badge-draft";
  }
}

function fmtDateTimeCT(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " CT";
  } catch {
    return iso;
  }
}

// ─── Restore dialog ──────────────────────────────────────────────────────────

function RestoreDialog({
  row,
  open,
  onClose,
}: {
  row: DeactivationRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiRequest("POST", `/api/email/deactivations/${id}/restore`, { note }).then(r => r.json()),
    onSuccess: (resp: any) => {
      if (resp?.ok === false) {
        toast({
          title: "Restore failed",
          description: resp.reason || "Unknown error",
        });
        return;
      }
      qc.invalidateQueries({ queryKey: ["/api/email/deactivations"] });
      toast({
        title: "Member restored",
        description: `${row?.firstName ?? ""} ${row?.lastName ?? ""} can receive email again.`,
      });
      setNote("");
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Restore failed", description: err?.message || "Unknown error" });
    },
  });

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore {row.firstName} {row.lastName}?</DialogTitle>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", marginTop: "0.5rem", fontSize: "0.85rem" }}>
          <div style={{
            background: "hsl(var(--muted))",
            borderRadius: "0.5rem",
            padding: "0.75rem",
            fontSize: "0.8rem",
            color: "hsl(var(--muted-foreground))",
          }}>
            <div><strong>Email:</strong> {row.email}</div>
            <div><strong>Church:</strong> {row.churchName}</div>
            <div><strong>Reason:</strong> {row.reason || "—"}</div>
            <div><strong>Deactivated:</strong> {fmtDateTimeCT(row.deactivatedAt)}</div>
            {row.isDonor && (
              <div style={{ marginTop: "0.4rem", color: "#8a5b00", fontWeight: 600 }}>
                Donor since {row.donorSince ? new Date(row.donorSince).toLocaleDateString() : "—"}
              </div>
            )}
          </div>

          {row.hasUnsubscribe && row.reasonCategory !== "spam_report" && (
            <div style={{
              background: "#fff4d4",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              fontSize: "0.78rem",
              color: "#7a5500",
              borderLeft: "3px solid #c69b00",
            }}>
              <strong>Note:</strong> This member has an active unsubscribe.
              Restore will reactivate them for engagement tracking but will NOT
              clear the unsubscribe — they will still not receive marketing email.
              Honest unsubscribes are preserved.
            </div>
          )}

          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>
              Restore note (optional, logged for audit)
            </label>
            <Input
              data-testid="input-restore-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. user emailed support asking to be reactivated"
            />
          </div>
        </div>
        <DialogFooter style={{ marginTop: "1rem" }}>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            data-testid="button-confirm-restore"
            onClick={() => mutation.mutate({ id: row.memberId, note })}
            disabled={mutation.isPending}
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          >
            {mutation.isPending ? "Restoring…" : "Restore member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Top-line stat card ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: any;
  accent?: string;
}) {
  return (
    <div style={{
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "0.625rem",
      padding: "0.9rem 1rem",
      display: "flex",
      alignItems: "center",
      gap: "0.85rem",
      flex: "1 1 180px",
      minWidth: 0,
    }}>
      <div style={{
        width: "2.25rem",
        height: "2.25rem",
        borderRadius: "0.5rem",
        background: accent || "hsl(var(--muted))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "hsl(var(--foreground))",
        flexShrink: 0,
      }}>
        <Icon size={16} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: "1.3rem", fontWeight: 700, marginTop: "1px" }}>{value}</div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function DeactivationsPage() {
  const [reasonFilter, setReasonFilter] = useState<"all" | ReasonCategory>("all");
  const [donorsOnly, setDonorsOnly] = useState(false);
  const [sinceDays, setSinceDays] = useState<"7" | "30" | "90" | "all">("30");
  const [restoreRow, setRestoreRow] = useState<DeactivationRow | null>(null);
  const { toast } = useToast();

  // Compute since param
  const sinceParam = useMemo(() => {
    if (sinceDays === "all") return "";
    const d = new Date();
    d.setDate(d.getDate() - parseInt(sinceDays, 10));
    return d.toISOString();
  }, [sinceDays]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (sinceParam) p.set("since", sinceParam);
    if (reasonFilter !== "all") p.set("reason", reasonFilter);
    if (donorsOnly) p.set("donorsOnly", "1");
    p.set("limit", "500");
    return p.toString();
  }, [sinceParam, reasonFilter, donorsOnly]);

  const { data, isLoading, refetch } = useQuery<DeactivationsResponse>({
    queryKey: ["/api/email/deactivations", queryParams],
    queryFn: () => apiRequest("GET", `/api/email/deactivations?${queryParams}`).then(r => r.json()),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/email/founder-digest/preview", {}).then(r => r.json()),
    onSuccess: (resp: any) => {
      if (resp?.html) {
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(resp.html);
          w.document.title = resp.subject || "Founder Digest Preview";
        } else {
          toast({ title: "Popup blocked", description: "Allow popups to preview the digest." });
        }
      }
    },
  });

  const sendNowMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/email/founder-digest/run", {}).then(r => r.json()),
    onSuccess: (resp: any) => {
      if (resp?.ok) {
        toast({ title: "Digest sent", description: `Delivered to ${resp.sentTo || "founder inbox"}` });
      } else {
        toast({ title: "Digest not sent", description: resp?.reason || "Automation may be disabled" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Digest failed", description: err?.message || "Unknown error" });
    },
  });

  const recomputeDonorsMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/email/donors/recompute", {}).then(r => r.json()),
    onSuccess: (resp: any) => {
      toast({
        title: "Donor flags recomputed",
        description: `Updated ${resp?.updated ?? 0} members.`,
      });
      refetch();
    },
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const restoreEnabled = data?.restoreEnabled ?? false;

  return (
    <>
      <div className="topbar">
        <div>
          <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Deactivations</h1>
          <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "1px" }}>
            Internal founder review · Email delivery problems and donor protection
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Button
            data-testid="button-preview-digest"
            variant="outline"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
            style={{ gap: "0.4rem", fontSize: "0.8rem" }}
          >
            <MailIcon size={14} /> {previewMutation.isPending ? "Loading…" : "Preview digest"}
          </Button>
          <Button
            data-testid="button-send-digest-now"
            variant="outline"
            onClick={() => sendNowMutation.mutate()}
            disabled={sendNowMutation.isPending}
            style={{ gap: "0.4rem", fontSize: "0.8rem" }}
          >
            <MailIcon size={14} /> {sendNowMutation.isPending ? "Sending…" : "Send digest now"}
          </Button>
          <Button
            data-testid="button-recompute-donors"
            variant="outline"
            onClick={() => recomputeDonorsMutation.mutate()}
            disabled={recomputeDonorsMutation.isPending}
            style={{ gap: "0.4rem", fontSize: "0.8rem" }}
          >
            <Heart size={14} /> {recomputeDonorsMutation.isPending ? "Recomputing…" : "Recompute donors"}
          </Button>
        </div>
      </div>

      <div className="page-content">
        {/* Top-line stat cards */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <StatCard
            label="New (last 24h)"
            value={summary?.newInWindow ?? "—"}
            icon={AlertTriangle}
            accent="#fff4d4"
          />
          <StatCard
            label="Donors deactivated (24h)"
            value={summary?.donorsInWindow ?? "—"}
            icon={Heart}
            accent="#e9e0c6"
          />
          <StatCard
            label="Total backlog"
            value={summary?.totalBacklog ?? "—"}
            icon={UserMinus}
            accent="hsl(var(--muted))"
          />
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {REASON_FILTERS.map(f => (
              <button
                key={f.value}
                data-testid={`reason-filter-${f.value}`}
                className="segment-pill"
                onClick={() => setReasonFilter(f.value)}
                style={{
                  background: reasonFilter === f.value ? "hsl(var(--primary))" : "hsl(var(--muted))",
                  color: reasonFilter === f.value ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                  borderColor: reasonFilter === f.value ? "hsl(var(--primary))" : "hsl(var(--border))",
                  fontSize: "0.75rem",
                }}
              >
                {f.label}
                {summary && f.value !== "all" && (
                  <span style={{ marginLeft: "0.3rem", opacity: 0.7 }}>
                    {summary.byReason[f.value as ReasonCategory] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto", alignItems: "center" }}>
            <label style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))" }}>Window:</label>
            {(["7", "30", "90", "all"] as const).map(d => (
              <button
                key={d}
                data-testid={`window-${d}`}
                className="segment-pill"
                onClick={() => setSinceDays(d)}
                style={{
                  background: sinceDays === d ? "hsl(var(--primary))" : "hsl(var(--muted))",
                  color: sinceDays === d ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                  borderColor: sinceDays === d ? "hsl(var(--primary))" : "hsl(var(--border))",
                  fontSize: "0.72rem",
                }}
              >
                {d === "all" ? "All time" : `${d}d`}
              </button>
            ))}
            <label
              style={{
                fontSize: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                marginLeft: "0.5rem",
                cursor: "pointer",
                color: donorsOnly ? "#8a5b00" : "hsl(var(--muted-foreground))",
                fontWeight: donorsOnly ? 600 : 400,
              }}
              data-testid="donors-only-toggle"
            >
              <input
                type="checkbox"
                checked={donorsOnly}
                onChange={e => setDonorsOnly(e.target.checked)}
                style={{ accentColor: "#8a5b00" }}
              />
              Donors only
            </label>
          </div>
        </div>

        {/* Restore-disabled banner */}
        {!restoreEnabled && (
          <div style={{
            background: "hsl(var(--muted))",
            borderRadius: "0.5rem",
            padding: "0.6rem 0.9rem",
            marginBottom: "1rem",
            fontSize: "0.78rem",
            color: "hsl(var(--muted-foreground))",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}>
            <AlertTriangle size={14} />
            <span>
              Restore is currently <strong>disabled</strong> (read-only dashboard).
              Set <code>EMAIL_DEACTIVATION_RESTORE_ENABLED=true</code> in the
              environment to enable the Restore button.
            </span>
          </div>
        )}

        {/* Table */}
        <div style={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: "0.625rem",
          overflow: "hidden",
        }}>
          {isLoading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "0.85rem" }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "2.5rem 2rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "0.85rem" }}>
              No deactivations in this window. Healthy list.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Church</th>
                  <th>Reason</th>
                  <th>Deactivated</th>
                  <th>Bounces</th>
                  {restoreEnabled && <th style={{ width: "110px" }}></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.memberId} data-testid={`row-deactivation-${r.memberId}`}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                            {r.firstName} {r.lastName}
                            {r.isDonor && (
                              <span
                                className="badge badge-segment-donor"
                                title={r.donorSince ? `Donor since ${new Date(r.donorSince).toLocaleDateString()}` : "Donor"}
                                style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem" }}
                              >
                                <Heart size={10} /> Donor
                              </span>
                            )}
                            {r.hasUnsubscribe && (
                              <span className="badge badge-draft" title="Member has an active unsubscribe">
                                Unsub
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))" }}>{r.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: "0.82rem", color: "hsl(var(--muted-foreground))" }}>{r.churchName}</td>
                    <td>
                      <span className={`badge ${reasonBadgeClass(r.reasonCategory)}`}>
                        {REASON_LABELS[r.reasonCategory]}
                      </span>
                      {r.reason && (
                        <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>
                          {r.reason}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))" }}>
                      {fmtDateTimeCT(r.deactivatedAt)}
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))" }}>
                      {r.bounceCount > 0 ? r.bounceCount : "—"}
                    </td>
                    {restoreEnabled && (
                      <td>
                        <Button
                          data-testid={`button-restore-${r.memberId}`}
                          variant="outline"
                          onClick={() => setRestoreRow(r)}
                          style={{ gap: "0.3rem", fontSize: "0.75rem", height: "1.75rem", padding: "0 0.6rem" }}
                        >
                          <RotateCcw size={12} /> Restore
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {summary && (
          <div style={{
            marginTop: "0.75rem",
            fontSize: "0.72rem",
            color: "hsl(var(--muted-foreground))",
          }}>
            Window: {new Date(summary.windowFromIso).toLocaleString("en-US", { timeZone: "America/Chicago" })} → {new Date(summary.windowToIso).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT · Showing {rows.length} row{rows.length === 1 ? "" : "s"}.
          </div>
        )}
      </div>

      <RestoreDialog
        row={restoreRow}
        open={!!restoreRow}
        onClose={() => setRestoreRow(null)}
      />
    </>
  );
}
