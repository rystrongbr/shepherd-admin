import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Users, Mail, TrendingUp, Calendar, Clock, UserPlus, Send, MessageSquare, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Activity, Campaign } from "@shared/schema";

const CHURCH_ID = 1;

interface Stats {
  totalMembers: number;
  activeMembers: number;
  newThisMonth: number;
  totalCampaignsSent: number;
  avgOpenRate: number;
  avgClickRate: number;
  segmentCounts: Record<string, number>;
  scheduledCampaigns: number;
  draftCampaigns: number;
}

function Topbar() {
  return (
    <div className="topbar">
      <div>
        <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Overview</h1>
        <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "1px" }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div style={{
          width: "8px", height: "8px", borderRadius: "50%",
          background: "#437a22", boxShadow: "0 0 0 3px #d4dfcc"
        }} />
        <span style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))" }}>All systems active</span>
      </div>
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const cls = type.includes("member") ? "activity-dot-member" :
    type.includes("email") || type.includes("sent") ? "activity-dot-email" :
      type.includes("sequence") ? "activity-dot-sequence" : "activity-dot-campaign";
  return <div className={`activity-dot ${cls}`} />;
}

export default function OverviewPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ["/api/churches", CHURCH_ID, "stats"],
    queryFn: () => apiRequest("GET", `/api/churches/${CHURCH_ID}/stats`).then(r => r.json()),
  });

  const { data: activities, isLoading: actLoading } = useQuery<Activity[]>({
    queryKey: ["/api/churches", CHURCH_ID, "activities"],
    queryFn: () => apiRequest("GET", `/api/churches/${CHURCH_ID}/activities`).then(r => r.json()),
  });

  const { data: campaigns } = useQuery<Campaign[]>({
    queryKey: ["/api/churches", CHURCH_ID, "campaigns"],
    queryFn: () => apiRequest("GET", `/api/churches/${CHURCH_ID}/campaigns`).then(r => r.json()),
  });

  const upcomingCampaigns = campaigns?.filter(c => c.status === "scheduled").slice(0, 4) ?? [];

  // Trending Topics — last 7 days of Q&A activity (powered by /api/insights/qa).
  // Pulls from the data of truth used by /questions so the numbers always match.
  const { data: trendingData, isLoading: trendingLoading } = useQuery<{
    topTopics: { topic: string; count: number }[];
    questionTotal: number;
    signedInTotal: number;
    anonTotal: number;
    total: number;
  }>({
    queryKey: ["/api/insights/qa", "trending-7d"],
    queryFn: () => apiRequest("GET", "/api/insights/qa?days=7&limit=1").then(r => r.json()),
    refetchInterval: 60_000,
  });
  const TOPIC_EMOJIS: Record<string, string> = {
    Anxiety: "\uD83D\uDD4A\uFE0F", Forgiveness: "\uD83E\uDD1D", Faith: "\u2720\uFE0F", Prayer: "\uD83D\uDE4F",
    Peace: "\u262E\uFE0F", Love: "\u2764\uFE0F", Hope: "\uD83C\uDF05", Temptation: "\u2694\uFE0F",
    Suffering: "\uD83D\uDD6F\uFE0F", Salvation: "\uD83D\uDCAB", Anger: "\uD83C\uDF0A", Wisdom: "\uD83D\uDCD6",
  };
  const trendingTopics = (trendingData?.topTopics ?? []).slice(0, 6);
  const maxTrendCount  = trendingTopics[0]?.count ?? 1;

  return (
    <>
      <Topbar />
      <div className="page-content">

        {/* KPI row */}
        <div className="kpi-grid">
          {[
            {
              label: "Total Members",
              value: statsLoading ? "—" : String(stats?.totalMembers ?? 0),
              sub: `${stats?.newThisMonth ?? 0} joined this month`,
              icon: <Users size={16} style={{ color: "hsl(var(--primary))" }} />,
            },
            {
              label: "Active Members",
              value: statsLoading ? "—" : String(stats?.activeMembers ?? 0),
              sub: "Not marked inactive",
              icon: <TrendingUp size={16} style={{ color: "#437a22" }} />,
            },
            {
              label: "Emails Sent",
              value: statsLoading ? "—" : String(stats?.totalCampaignsSent ?? 0),
              sub: `${stats?.scheduledCampaigns ?? 0} scheduled`,
              icon: <Send size={16} style={{ color: "#006494" }} />,
            },
            {
              label: "Avg. Open Rate",
              value: statsLoading ? "—" : `${stats?.avgOpenRate ?? 0}%`,
              sub: "Industry avg: 28%",
              icon: <Mail size={16} style={{ color: "#7a39bb" }} />,
            },
            {
              label: "Click Rate",
              value: statsLoading ? "—" : `${stats?.avgClickRate ?? 0}%`,
              sub: "Industry avg: 3.5%",
              icon: <TrendingUp size={16} style={{ color: "hsl(var(--primary))" }} />,
            },
          ].map((kpi) => (
            <div className="kpi-card" key={kpi.label} data-testid={`kpi-${kpi.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div className="kpi-label">{kpi.label}</div>
                {kpi.icon}
              </div>
              <div className="kpi-value">{kpi.value}</div>
              <div className="kpi-delta up">{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* Two-column layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>

          {/* Member segments */}
          <div style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.625rem",
            padding: "1.125rem",
          }}>
            <h2 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "1rem" }}>Member Segments</h2>
            {stats && Object.entries(stats.segmentCounts).map(([segment, count]) => {
              const total = stats.totalMembers || 1;
              const pct = Math.round((count / total) * 100);
              const labels: Record<string, string> = {
                new_visitor: "New Visitors",
                regular: "Regular Attenders",
                volunteer: "Volunteers",
                inactive: "Inactive",
                donor: "Donors",
              };
              const colors: Record<string, string> = {
                new_visitor: "#006494",
                regular: "#437a22",
                volunteer: "#7a39bb",
                inactive: "#888",
                donor: "#d19900",
              };
              return (
                <div key={segment} style={{ marginBottom: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>{labels[segment] || segment}</span>
                    <span style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>
                      {count} · {pct}%
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${pct}%`, background: colors[segment] || "hsl(var(--primary))" }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Upcoming campaigns */}
          <div style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.625rem",
            padding: "1.125rem",
          }}>
            <h2 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "1rem" }}>
              Upcoming Emails
            </h2>
            {upcomingCampaigns.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))" }}>No scheduled emails</p>
            ) : (
              upcomingCampaigns.map((c) => (
                <div key={c.id} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.625rem 0",
                  borderBottom: "1px solid hsl(var(--border))",
                }}>
                  <div style={{
                    width: "32px", height: "32px",
                    background: "hsl(var(--muted))",
                    borderRadius: "0.375rem",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Calendar size={15} style={{ color: "hsl(var(--primary))" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))" }}>
                      {c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                      {" · "}{c.recipients > 0 ? `${c.recipients} recipients` : "All members"}
                    </div>
                  </div>
                  <span className="badge badge-scheduled">scheduled</span>
                </div>
              ))
            )}
          </div>

          {/* Trending Topics (last 7 days) — Q&A from the insights table. */}
          <div style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.625rem",
            padding: "1.125rem",
            gridColumn: "1 / -1",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <h2 style={{ fontSize: "0.85rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                <MessageSquare size={14} style={{ color: "hsl(var(--primary))" }} />
                Trending Topics
                <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "hsl(var(--muted-foreground))", marginLeft: "4px" }}>
                  Last 7 days
                </span>
              </h2>
              <Link href="/questions" style={{ fontSize: "0.75rem", color: "hsl(var(--primary))", textDecoration: "none", display: "flex", alignItems: "center", gap: "3px" }}>
                View all questions <ArrowRight size={11} />
              </Link>
            </div>

            {/* Mini KPI strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "0.875rem" }}>
              {[
                { label: "Questions Asked", value: trendingLoading ? "\u2014" : (trendingData?.questionTotal ?? 0).toLocaleString() },
                { label: "Signed-in",       value: trendingLoading ? "\u2014" : (trendingData?.signedInTotal ?? 0).toLocaleString() },
                { label: "Anonymous",       value: trendingLoading ? "\u2014" : (trendingData?.anonTotal ?? 0).toLocaleString() },
              ].map(k => (
                <div key={k.label} style={{
                  background: "hsl(var(--muted) / 0.4)", borderRadius: "6px",
                  padding: "7px 10px",
                }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "hsl(var(--muted-foreground))" }}>{k.label}</div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                </div>
              ))}
            </div>

            {trendingLoading ? (
              <p style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))" }}>Loading…</p>
            ) : trendingTopics.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))" }}>No Q&amp;A activity in the last 7 days yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "7px" }}>
                {trendingTopics.map((t, i) => {
                  const pct = Math.round((t.count / maxTrendCount) * 100);
                  return (
                    <Link key={t.topic} href={`/questions`} style={{ textDecoration: "none" }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: "9px",
                        padding: "7px 9px", borderRadius: "7px",
                        background: i === 0 ? "hsl(var(--primary) / 0.06)" : "hsl(var(--muted) / 0.4)",
                        border: i === 0 ? "1px solid hsl(var(--primary) / 0.2)" : "1px solid transparent",
                      }}>
                        <span style={{ fontSize: "1rem" }}>{TOPIC_EMOJIS[t.topic] || "\uD83D\uDCD6"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "3px" }}>
                            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>{t.topic}</span>
                            <span style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{t.count}</span>
                          </div>
                          <div style={{ height: "4px", background: "hsl(var(--border))", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: "hsl(var(--primary))", borderRadius: "3px" }} />
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.625rem",
            padding: "1.125rem",
            gridColumn: "1 / -1",
          }}>
            <h2 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.75rem" }}>Recent Activity</h2>
            {actLoading ? (
              <p style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))" }}>Loading…</p>
            ) : (
              (activities ?? []).slice(0, 6).map((a) => (
                <div className="activity-item" key={a.id} data-testid={`activity-${a.id}`}>
                  <ActivityIcon type={a.type} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 500 }}>{a.description}</div>
                    <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginTop: "1px", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      <Clock size={11} />
                      {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
