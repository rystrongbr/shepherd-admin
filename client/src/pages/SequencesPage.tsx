import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { GitBranch, Play, Pause, Users } from "lucide-react";
import type { Sequence } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const CHURCH_ID = 1;

const TRIGGER_LABELS: Record<string, string> = {
  new_visitor: "New Visitor joins",
  inactive: "Member inactive 60+ days",
  donor: "Member marked as Donor",
};

const SEQUENCE_STEPS: Record<string, { day: number; desc: string }[]> = {
  new_visitor: [
    { day: 1, desc: "Welcome email — glad you're here" },
    { day: 3, desc: "Introduction to the church community" },
    { day: 7, desc: "Member testimonial story" },
    { day: 14, desc: "Invitation to small group / volunteer" },
    { day: 21, desc: "First devotional + My Shepherd app intro" },
  ],
  inactive: [
    { day: 1, desc: "\"We've been thinking about you...\"" },
    { day: 7, desc: "Personal invitation from pastor" },
    { day: 14, desc: "Upcoming event / community news" },
  ],
  donor: [
    { day: 1, desc: "Thank you — your gift matters" },
    { day: 7, desc: "Impact story from your giving" },
    { day: 14, desc: "How funds are being used" },
    { day: 30, desc: "Year-end giving summary" },
  ],
};

export default function SequencesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: sequences = [], isLoading } = useQuery<Sequence[]>({
    queryKey: ["/api/churches", CHURCH_ID, "sequences"],
    queryFn: () => apiRequest("GET", `/api/churches/${CHURCH_ID}/sequences`).then(r => r.json()),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/sequences/${id}`, { status }).then(r => r.json()),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "sequences"] });
      toast({ title: vars.status === "active" ? "Sequence activated" : "Sequence paused" });
    },
  });

  return (
    <>
      <div className="topbar">
        <div>
          <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Email Sequences</h1>
          <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "1px" }}>
            Automated drip campaigns — triggered by member events
          </p>
        </div>
      </div>

      <div className="page-content">
        {/* Info banner */}
        <div style={{
          background: "hsl(22 35% 95%)",
          border: "1px solid hsl(22 30% 85%)",
          borderRadius: "0.5rem",
          padding: "0.875rem 1rem",
          marginBottom: "1.25rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}>
          <GitBranch size={16} style={{ color: "hsl(var(--primary))", marginTop: "2px", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.15rem" }}>Sequences run automatically</div>
            <div style={{ fontSize: "0.78rem", color: "hsl(var(--muted-foreground))" }}>
              When a member matches a trigger condition, they are automatically enrolled and receive emails at the scheduled intervals. Each member only goes through a sequence once.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {isLoading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "0.85rem" }}>Loading…</div>
          ) : sequences.map(seq => {
            const steps = SEQUENCE_STEPS[seq.triggerSegment] || [];
            const completionRate = seq.enrolledCount > 0
              ? Math.round((seq.completedCount / seq.enrolledCount) * 100)
              : 0;

            return (
              <div
                key={seq.id}
                data-testid={`card-sequence-${seq.id}`}
                style={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.625rem",
                  overflow: "hidden",
                }}
              >
                {/* Header */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.875rem",
                  padding: "1rem 1.125rem",
                  borderBottom: "1px solid hsl(var(--border))",
                }}>
                  <div style={{
                    width: "36px", height: "36px",
                    borderRadius: "0.5rem",
                    background: seq.status === "active" ? "hsl(22 35% 92%)" : "hsl(var(--muted))",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: seq.status === "active" ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                    flexShrink: 0,
                  }}>
                    <GitBranch size={16} />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{seq.name}</span>
                      <span className={`badge badge-${seq.status}`}>{seq.status}</span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>
                      Triggers when: <strong>{TRIGGER_LABELS[seq.triggerSegment] || seq.triggerSegment}</strong>
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: "flex", gap: "1.5rem", marginRight: "0.75rem" }}>
                    {[
                      { label: "Enrolled", value: seq.enrolledCount, icon: <Users size={11} /> },
                      { label: "Completed", value: seq.completedCount },
                      { label: "Steps", value: seq.stepCount },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "1rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                        <div style={{ fontSize: "0.68rem", color: "hsl(var(--muted-foreground))" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Toggle button */}
                  <button
                    data-testid={`button-toggle-sequence-${seq.id}`}
                    onClick={() => toggleMutation.mutate({
                      id: seq.id,
                      status: seq.status === "active" ? "paused" : "active"
                    })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      padding: "0.375rem 0.75rem",
                      borderRadius: "0.375rem",
                      fontSize: "0.78rem",
                      fontWeight: 500,
                      background: seq.status === "active" ? "hsl(var(--muted))" : "hsl(22 35% 92%)",
                      color: seq.status === "active" ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))",
                      border: `1px solid ${seq.status === "active" ? "hsl(var(--border))" : "hsl(22 30% 80%)"}`,
                      cursor: "pointer",
                      transition: "all 150ms ease",
                    }}
                  >
                    {seq.status === "active" ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Activate</>}
                  </button>
                </div>

                {/* Completion bar */}
                {seq.enrolledCount > 0 && (
                  <div style={{ padding: "0.625rem 1.125rem", borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", minWidth: "80px" }}>Completion rate</span>
                    <div className="progress-bar" style={{ flex: 1 }}>
                      <div className="progress-bar-fill" style={{ width: `${completionRate}%` }} />
                    </div>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, minWidth: "32px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {completionRate}%
                    </span>
                  </div>
                )}

                {/* Steps */}
                <div style={{ padding: "0.75rem 1.125rem" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: "0.625rem" }}>
                    Email Steps
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                    {steps.map((step, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "0.5rem 0",
                          borderBottom: i < steps.length - 1 ? "1px solid hsl(var(--border))" : "none",
                        }}
                      >
                        <div style={{
                          width: "24px", height: "24px",
                          borderRadius: "50%",
                          border: "2px solid hsl(22 30% 80%)",
                          background: i < 3 ? "hsl(22 35% 92%)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          color: "hsl(var(--primary))",
                        }}>
                          {i + 1}
                        </div>
                        <div style={{ flex: 1, fontSize: "0.8rem" }}>{step.desc}</div>
                        <div style={{
                          fontSize: "0.7rem",
                          color: "hsl(var(--muted-foreground))",
                          background: "hsl(var(--muted))",
                          padding: "0.15rem 0.4rem",
                          borderRadius: "0.25rem",
                        }}>
                          Day {step.day}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
