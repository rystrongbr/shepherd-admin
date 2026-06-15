import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  MessageSquare, Search, ChevronDown, ChevronRight, Loader2, RefreshCw,
  Users, UserCheck, UserX, Download, BarChart2, Filter,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Insight } from "@shared/schema";

// ── Q&A Admin Dashboard ────────────────────────────────────────────────────
// Shows every question asked in My Shepherd + the response delivered.
//
// Access:
//   * Today  — Admin only (renders platform-wide totals, churchId omitted).
//   * Future — Church Admin (pass ?churchId= when their account is provisioned).
//             Today's UI hides the church filter; the API already supports it.
//
// View mode (per founder spec): "Q + verse ref only, expandable to see reflection".

const TOPIC_EMOJIS: Record<string, string> = {
  Anxiety: "🕊️", Forgiveness: "🤝", Faith: "✝️", Prayer: "🙏",
  Peace: "☮️", Love: "❤️", Hope: "🌅", Temptation: "⚔️",
  Suffering: "🕯️", Salvation: "💫", Anger: "🌊", Wisdom: "📖",
};

type Audience = "all" | "signed_in" | "anon";

interface QAResponse {
  rows: Insight[];
  total: number;
  questionTotal: number;
  signedInTotal: number;
  anonTotal: number;
  topTopics: { topic: string; count: number }[];
}

const PAGE_SIZE = 50;

function looksSignedIn(sessionId: string): boolean {
  return typeof sessionId === "string" && sessionId.startsWith("user-");
}

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

function escapeCsv(s: string): string {
  if (s == null) return "";
  const v = String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function exportCSV(rows: Insight[], days: number) {
  const header = ["When", "Type", "Topic", "Question", "Verse Ref", "Verse Text", "Reflection", "Session"];
  const lines = rows.map(r => [
    fmtWhen(r.createdAt),
    looksSignedIn(r.sessionId) ? "signed_in" : "anon",
    r.topic,
    r.question,
    r.verseRef,
    r.verseText,
    r.reflection,
    r.sessionId,
  ].map(escapeCsv).join(","));
  const blob = new Blob([header.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `myshepherd_questions_${days}d_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function QuestionsPage() {
  const [days, setDays] = useState<number>(30);
  const [topic, setTopic] = useState<string>("");          // "" = all categories
  const [audience, setAudience] = useState<Audience>("all");
  const [questionsOnly, setQuestionsOnly] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [searchDraft, setSearchDraft] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Reset page when filters change
  const filterKey = `${days}-${topic}-${audience}-${questionsOnly}-${search}`;
  useMemo(() => { setPage(0); }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = new URLSearchParams();
  params.set("days", String(days));
  if (topic) params.set("topic", topic);
  if (audience !== "all") params.set("audience", audience);
  if (questionsOnly) params.set("questionsOnly", "1");
  if (search.trim()) params.set("search", search.trim());
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const url = `/api/insights/qa?${params.toString()}`;
  const { data, isLoading, isFetching, refetch } = useQuery<QAResponse>({
    queryKey: [url],
    queryFn: () => apiRequest("GET", url).then(r => r.json()),
    refetchInterval: 60_000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const questionTotal = data?.questionTotal ?? 0;
  const signedInTotal = data?.signedInTotal ?? 0;
  const anonTotal = data?.anonTotal ?? 0;
  const topTopics = data?.topTopics ?? [];
  const maxTopicCount = topTopics[0]?.count ?? 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applySearch() {
    setSearch(searchDraft);
    setPage(0);
  }

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "hsl(var(--foreground))", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <MessageSquare size={20} style={{ color: "hsl(var(--primary))" }} /> Questions
          </h1>
          <p style={{ fontSize: "0.82rem", color: "hsl(var(--muted-foreground))", margin: "4px 0 0" }}>
            Every question asked in My Shepherd and the response delivered.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger style={{ width: "150px", height: "32px", fontSize: "0.8rem" }} data-testid="select-days">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="0">All time</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm"
            onClick={() => exportCSV(rows, days)}
            disabled={isLoading || rows.length === 0}
            data-testid="button-export-csv"
            style={{ height: "32px", padding: "0 10px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "5px" }}>
            <Download size={13} /> Export
          </Button>

          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}
            data-testid="button-refresh" style={{ height: "32px", padding: "0 10px" }}>
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "1.25rem" }}>
        {[
          { label: "Total Logged",    value: isLoading ? "—" : total.toLocaleString(),         icon: <BarChart2 size={16} />,  sub: `Matching current filters · ${days === 0 ? "all time" : `${days}d`}` },
          { label: "Questions Asked", value: isLoading ? "—" : questionTotal.toLocaleString(), icon: <MessageSquare size={16} />, sub: "Free-form questions (non-tap)" },
          { label: "Signed-In",       value: isLoading ? "—" : signedInTotal.toLocaleString(), icon: <UserCheck size={16} />,  sub: "Authenticated app users" },
          { label: "Anonymous",       value: isLoading ? "—" : anonTotal.toLocaleString(),     icon: <UserX size={16} />,      sub: "Pre-signup visitors" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "hsl(var(--primary))", marginBottom: "6px" }}>
              {kpi.icon}
              <span style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))" }}>{kpi.label}</span>
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "hsl(var(--foreground))", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{kpi.value}</div>
            <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginTop: "3px" }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{
        background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px",
        padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "1rem"
      }}>
        <Filter size={14} style={{ color: "hsl(var(--muted-foreground))" }} />

        {/* Category */}
        <Select value={topic || "__all__"} onValueChange={v => { setTopic(v === "__all__" ? "" : v); setPage(0); }}>
          <SelectTrigger style={{ width: "170px", height: "30px", fontSize: "0.8rem" }} data-testid="select-topic">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {topTopics.map(t => (
              <SelectItem key={t.topic} value={t.topic}>
                {(TOPIC_EMOJIS[t.topic] || "📖") + "  " + t.topic + " (" + t.count + ")"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Audience */}
        <Select value={audience} onValueChange={v => { setAudience(v as Audience); setPage(0); }}>
          <SelectTrigger style={{ width: "150px", height: "30px", fontSize: "0.8rem" }} data-testid="select-audience">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="signed_in">Signed-in only</SelectItem>
            <SelectItem value="anon">Anonymous only</SelectItem>
          </SelectContent>
        </Select>

        {/* Questions-only */}
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", color: "hsl(var(--foreground))", cursor: "pointer" }}>
          <input type="checkbox" checked={questionsOnly} onChange={e => { setQuestionsOnly(e.target.checked); setPage(0); }} data-testid="check-questions-only" />
          Questions only (hide topic taps)
        </label>

        {/* Search */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
            <input
              type="text"
              placeholder="Search question, topic, verse…"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") applySearch(); }}
              data-testid="input-search"
              style={{
                height: "30px", paddingLeft: "26px", paddingRight: "10px",
                border: "1px solid hsl(var(--border))", borderRadius: "6px",
                fontSize: "0.8rem", fontFamily: "inherit",
                background: "hsl(var(--background))", color: "hsl(var(--foreground))",
                outline: "none", minWidth: "240px",
              }}
            />
          </div>
          <Button size="sm" variant="outline" onClick={applySearch} style={{ height: "30px", padding: "0 10px", fontSize: "0.8rem" }}>Search</Button>
          {search && (
            <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setSearchDraft(""); setPage(0); }} style={{ height: "30px", padding: "0 10px", fontSize: "0.8rem" }}>Clear</Button>
          )}
        </div>
      </div>

      {/* Category breakdown */}
      <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", padding: "16px 18px", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "12px" }}>
          <BarChart2 size={15} style={{ color: "hsl(var(--primary))" }} />
          <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>Category Mix</span>
          <span style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginLeft: "6px" }}>
            Based on the topic the app picked for each question
          </span>
        </div>
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : topTopics.length === 0 ? (
          <p style={{ fontSize: "0.83rem", color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "12px 0" }}>
            No data yet in this window.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "8px" }}>
            {topTopics.map(t => {
              const pct = Math.round((t.count / maxTopicCount) * 100);
              const isActive = topic === t.topic;
              return (
                <button
                  key={t.topic}
                  onClick={() => { setTopic(isActive ? "" : t.topic); setPage(0); }}
                  data-testid={`bar-topic-${t.topic.toLowerCase()}`}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "8px 10px", borderRadius: "8px",
                    background: isActive ? "hsl(var(--primary) / 0.08)" : "hsl(var(--muted) / 0.4)",
                    border: isActive ? "1px solid hsl(var(--primary) / 0.35)" : "1px solid transparent",
                    cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontSize: "1.1rem" }}>{TOPIC_EMOJIS[t.topic] || "📖"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                      <span style={{ fontSize: "0.83rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>{t.topic}</span>
                      <span style={{ fontSize: "0.77rem", color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{t.count}</span>
                    </div>
                    <div style={{ height: "5px", background: "hsl(var(--border))", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "hsl(var(--primary))", borderRadius: "3px" }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "28px 130px 110px 1fr 180px 90px",
          padding: "10px 14px", borderBottom: "1px solid hsl(var(--border))",
          fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
          color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted) / 0.3)",
        }}>
          <div></div>
          <div>When</div>
          <div>Category</div>
          <div>Question</div>
          <div>Verse</div>
          <div>Who</div>
        </div>

        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 16px", color: "hsl(var(--muted-foreground))" }}>
            <MessageSquare size={20} style={{ opacity: 0.4, marginBottom: "6px" }} />
            <p style={{ fontSize: "0.85rem", margin: 0 }}>No Q&amp;A logs match these filters.</p>
            <p style={{ fontSize: "0.75rem", margin: "4px 0 0" }}>Try widening the date range or removing the search.</p>
          </div>
        ) : rows.map(r => {
          const isOpen = expanded.has(r.id);
          const signedIn = looksSignedIn(r.sessionId);
          const hasReflection = (r.reflection || "").trim().length > 0;
          const hasVerseText  = (r.verseText  || "").trim().length > 0;
          const expandable = hasReflection || hasVerseText;
          return (
            <div key={r.id} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              <button
                onClick={() => expandable && toggleExpand(r.id)}
                disabled={!expandable}
                data-testid={`row-${r.id}`}
                style={{
                  width: "100%", display: "grid", gridTemplateColumns: "28px 130px 110px 1fr 180px 90px",
                  alignItems: "center", padding: "10px 14px",
                  background: "transparent", border: "none", textAlign: "left",
                  cursor: expandable ? "pointer" : "default", fontFamily: "inherit", color: "hsl(var(--foreground))",
                }}
              >
                <div style={{ color: "hsl(var(--muted-foreground))" }}>
                  {expandable ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                </div>
                <div style={{ fontSize: "0.78rem", color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>
                  {fmtWhen(r.createdAt)}
                </div>
                <div style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "5px" }}>
                  <span>{TOPIC_EMOJIS[r.topic] || "📖"}</span>
                  <span>{r.topic}</span>
                </div>
                <div style={{ fontSize: "0.86rem", color: "hsl(var(--foreground))", paddingRight: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.question || <span style={{ color: "hsl(var(--muted-foreground))", fontStyle: "italic" }}>(topic tap, no question)</span>}
                </div>
                <div style={{ fontSize: "0.78rem", color: "hsl(var(--muted-foreground))", fontFamily: "ui-serif, Georgia, serif" }}>
                  {r.verseRef || "—"}
                </div>
                <div>
                  <Badge variant={signedIn ? "default" : "secondary"} style={{ fontSize: "0.68rem", padding: "1px 7px" }}>
                    {signedIn ? <><UserCheck size={10} style={{ marginRight: "3px" }} />signed-in</> : <><Users size={10} style={{ marginRight: "3px" }} />anon</>}
                  </Badge>
                </div>
              </button>

              {isOpen && expandable && (
                <div style={{ padding: "0 16px 14px 42px", background: "hsl(var(--muted) / 0.25)" }}>
                  {hasVerseText && (
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>
                        {r.verseRef} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· KJV</span>
                      </div>
                      <p style={{ fontSize: "0.86rem", color: "hsl(var(--foreground))", margin: 0, fontFamily: "ui-serif, Georgia, serif", lineHeight: 1.55 }}>
                        {r.verseText}
                      </p>
                    </div>
                  )}
                  {hasReflection && (
                    <div>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>
                        Reflection
                      </div>
                      <p style={{ fontSize: "0.85rem", color: "hsl(var(--foreground))", margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                        {r.reflection}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Pagination */}
        {!isLoading && total > PAGE_SIZE && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", fontSize: "0.78rem", color: "hsl(var(--muted-foreground))",
            background: "hsl(var(--muted) / 0.2)",
          }}>
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} style={{ height: "28px", padding: "0 10px", fontSize: "0.75rem" }}>Previous</Button>
              <span style={{ alignSelf: "center", padding: "0 6px" }}>Page {page + 1} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)} style={{ height: "28px", padding: "0 10px", fontSize: "0.75rem" }}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <p style={{ fontSize: "0.7rem", color: "hsl(var(--muted-foreground))", marginTop: "10px", textAlign: "center" }}>
        Admin-only view · Built for future Church Admin scoping by church_id
      </p>
    </div>
  );
}
