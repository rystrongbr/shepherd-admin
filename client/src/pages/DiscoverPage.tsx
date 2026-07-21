import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Compass, Search, ChevronDown, ChevronRight, Loader2, RefreshCw,
  Users, Layers, Star, BarChart2, Filter, Copy, Check, MessageSquare,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Discover — cross-church anonymous questions feed ────────────────────────
// Mirrors the /#/questions page structure (same header, stat-tile, category-mix
// and table treatment) but aggregates ANONYMIZED questions across the whole My
// Shepherd community. The backend never returns anything identifying — see
// server/storage.ts getDiscoverQuestions.

const TOPIC_EMOJIS: Record<string, string> = {
  Anxiety: "🕊️", Forgiveness: "🤝", Faith: "✝️", Prayer: "🙏",
  Peace: "☮️", Love: "❤️", Hope: "🌅", Temptation: "⚔️",
  Suffering: "🕯️", Salvation: "💫", Anger: "🌊", Wisdom: "📖",
};

type Range = "7d" | "30d" | "90d";
type Sort = "recent" | "similar" | "longest";

interface DiscoverRow {
  id: number;
  when: string;
  category: string;
  question: string;
  verseRef: string;
  verseText: string;
  reflection: string;
  who: "anon";
  curated: boolean;
}

interface DiscoverResponse {
  questions: DiscoverRow[];
  pagination: { page: number; total_pages: number; total_count: number };
  category_mix: Record<string, number>;
  stats: { total: number; unique_users: number; categories_covered: number; curated_count: number };
}

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const hrs = diffMs / (1000 * 60 * 60);
    if (hrs < 1) {
      const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
      return `${mins}m ago`;
    }
    if (hrs < 24) return `${Math.floor(hrs)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return iso; }
}

function truncate(s: string, max = 120): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

export default function DiscoverPage() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [range, setRange] = useState<Range>("30d");
  const [category, setCategory] = useState<string>("");     // "" = all
  const [curatedOnly, setCuratedOnly] = useState<boolean>(false);
  const [sort, setSort] = useState<Sort>("recent");
  const [search, setSearch] = useState<string>("");
  const [searchDraft, setSearchDraft] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  // Optimistic curation overrides (id -> desired state) applied on top of the
  // server value until the query refetches.
  const [curatedOverride, setCuratedOverride] = useState<Record<number, boolean>>({});

  // Reset to page 1 whenever a filter changes.
  const filterKey = `${range}-${category}-${curatedOnly}-${sort}-${search}`;
  useMemo(() => { setPage(1); }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = new URLSearchParams();
  params.set("range", range);
  if (category) params.set("category", category);
  if (curatedOnly) params.set("curated_only", "1");
  if (sort !== "recent") params.set("sort", sort);
  if (search.trim()) params.set("search", search.trim());
  params.set("page", String(page));

  const url = `/api/discover/questions?${params.toString()}`;
  const { data, isLoading, isFetching, refetch } = useQuery<DiscoverResponse>({
    queryKey: [url],
    queryFn: () => apiRequest("GET", url).then(r => r.json()),
    refetchInterval: 60_000,
  });

  const rows = data?.questions ?? [];
  const stats = data?.stats;
  const categoryMix = data?.category_mix ?? {};
  const pagination = data?.pagination;
  const mixEntries = Object.entries(categoryMix).sort((a, b) => b[1] - a[1]);
  const maxMixCount = mixEntries[0]?.[1] ?? 1;
  const totalPages = pagination?.total_pages ?? 1;

  const curateMutation = useMutation({
    mutationFn: async ({ id, next }: { id: number; next: boolean }) => {
      if (next) return apiRequest("POST", "/api/discover/curate", { question_id: id });
      return apiRequest("DELETE", `/api/discover/curate/${id}`);
    },
    onError: (_err, vars) => {
      // Revert optimistic state and let the user know.
      setCuratedOverride(prev => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      toast({
        title: "Couldn't update star",
        description: "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ["/api/discover/curated"] });
    },
  });

  function isCurated(r: DiscoverRow): boolean {
    return curatedOverride[r.id] ?? r.curated;
  }

  function toggleCurate(r: DiscoverRow, e: React.MouseEvent) {
    e.stopPropagation();
    const next = !isCurated(r);
    setCuratedOverride(prev => ({ ...prev, [r.id]: next }));
    curateMutation.mutate({ id: r.id, next });
  }

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
    setPage(1);
  }

  async function copyResponse(r: DiscoverRow) {
    const parts: string[] = [];
    if (r.verseRef) parts.push(`${r.verseRef} (KJV)`);
    if (r.verseText) parts.push(r.verseText);
    if (r.reflection) parts.push(r.reflection);
    try {
      await navigator.clipboard.writeText(parts.join("\n\n"));
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(c => (c === r.id ? null : c)), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  }

  const gridCols = "28px 110px 110px 1fr 150px 70px";

  // ── Empty-state copy depends on which filter produced zero rows ──
  function emptyState() {
    if (search.trim()) {
      return `No questions match "${search.trim()}". Try a broader search or different category.`;
    }
    if (curatedOnly) {
      return "You haven't curated any questions yet. Click the star on any question to add it here.";
    }
    return "No questions in this window yet. Try a wider range.";
  }

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "hsl(var(--foreground))", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <Compass size={20} style={{ color: "hsl(var(--primary))" }} /> Discover
          </h1>
          <p style={{ fontSize: "0.82rem", color: "hsl(var(--muted-foreground))", margin: "4px 0 0", maxWidth: "640px" }}>
            Real anonymous questions from the My Shepherd community. Your congregation's private data stays in Questions.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Select value={range} onValueChange={v => { setRange(v as Range); setPage(1); }}>
            <SelectTrigger style={{ width: "150px", height: "32px", fontSize: "0.8rem" }} data-testid="select-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}
            data-testid="button-refresh" style={{ height: "32px", padding: "0 10px" }}>
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: "12px", marginBottom: "1.25rem" }}>
        {[
          { key: "total",      label: "Total Questions",   value: stats?.total,              icon: <MessageSquare size={16} />, sub: "Across all churches & users", onClick: undefined as undefined | (() => void) },
          { key: "users",      label: "Unique Users",      value: stats?.unique_users,       icon: <Users size={16} />,         sub: "Asked at least one question" },
          { key: "categories", label: "Categories Covered", value: stats?.categories_covered, icon: <Layers size={16} />,        sub: "Distinct topics represented" },
          { key: "curated",    label: "Curated",           value: stats?.curated_count,      icon: <Star size={16} />,          sub: "Your starred questions", onClick: () => { setCuratedOnly(true); setPage(1); } },
        ].map(kpi => {
          const clickable = !!kpi.onClick;
          return (
            <div
              key={kpi.key}
              onClick={kpi.onClick}
              data-testid={`tile-${kpi.key}`}
              style={{
                background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px",
                padding: "14px 16px", cursor: clickable ? "pointer" : "default",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "hsl(var(--primary))", marginBottom: "6px" }}>
                {kpi.icon}
                <span style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))" }}>{kpi.label}</span>
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "hsl(var(--foreground))", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
                {isLoading || kpi.value == null ? "—" : kpi.value.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginTop: "3px" }}>{kpi.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Filter bar */}
      <div style={{
        background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px",
        padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "1rem"
      }}>
        <Filter size={14} style={{ color: "hsl(var(--muted-foreground))" }} />

        {/* Category */}
        <Select value={category || "__all__"} onValueChange={v => { setCategory(v === "__all__" ? "" : v); setPage(1); }}>
          <SelectTrigger style={{ width: "170px", height: "30px", fontSize: "0.8rem" }} data-testid="select-category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {mixEntries.map(([topic, count]) => (
              <SelectItem key={topic} value={topic}>
                {(TOPIC_EMOJIS[topic] || "📖") + "  " + topic + " (" + count + ")"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select value={sort} onValueChange={v => { setSort(v as Sort); setPage(1); }}>
          <SelectTrigger style={{ width: "190px", height: "30px", fontSize: "0.8rem" }} data-testid="select-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Most recent</SelectItem>
            <SelectItem value="similar">Most similar questions</SelectItem>
            <SelectItem value="longest">Longest response</SelectItem>
          </SelectContent>
        </Select>

        {/* Curated only */}
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", color: "hsl(var(--foreground))", cursor: "pointer" }}>
          <input type="checkbox" checked={curatedOnly} onChange={e => { setCuratedOnly(e.target.checked); setPage(1); }} data-testid="check-curated-only" />
          Curated only
        </label>

        {/* Search */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: isMobile ? 0 : "auto" }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
            <input
              type="text"
              placeholder="Search question text…"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") applySearch(); }}
              data-testid="input-search"
              style={{
                height: "30px", paddingLeft: "26px", paddingRight: "10px",
                border: "1px solid hsl(var(--border))", borderRadius: "6px",
                fontSize: "0.8rem", fontFamily: "inherit",
                background: "hsl(var(--background))", color: "hsl(var(--foreground))",
                outline: "none", minWidth: isMobile ? "160px" : "240px",
              }}
            />
          </div>
          <Button size="sm" variant="outline" onClick={applySearch} style={{ height: "30px", padding: "0 10px", fontSize: "0.8rem" }}>Search</Button>
          {search && (
            <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setSearchDraft(""); setPage(1); }} style={{ height: "30px", padding: "0 10px", fontSize: "0.8rem" }}>Clear</Button>
          )}
        </div>
      </div>

      {/* Category Mix */}
      <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", padding: "16px 18px", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "12px" }}>
          <BarChart2 size={15} style={{ color: "hsl(var(--primary))" }} />
          <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>Category Mix</span>
          <span style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginLeft: "6px" }}>
            Across the whole community in this window
          </span>
        </div>
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : mixEntries.length === 0 ? (
          <p style={{ fontSize: "0.83rem", color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "12px 0" }}>
            No data yet in this window.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "8px" }}>
            {mixEntries.map(([topic, count]) => {
              const pct = Math.round((count / maxMixCount) * 100);
              const isActive = category === topic;
              return (
                <button
                  key={topic}
                  onClick={() => { setCategory(isActive ? "" : topic); setPage(1); }}
                  data-testid={`bar-topic-${topic.toLowerCase()}`}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "8px 10px", borderRadius: "8px",
                    background: isActive ? "hsl(var(--primary) / 0.08)" : "hsl(var(--muted) / 0.4)",
                    border: isActive ? "1px solid hsl(var(--primary) / 0.35)" : "1px solid transparent",
                    cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontSize: "1.1rem" }}>{TOPIC_EMOJIS[topic] || "📖"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                      <span style={{ fontSize: "0.83rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>{topic}</span>
                      <span style={{ fontSize: "0.77rem", color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{count}</span>
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
        {!isMobile && (
          <div style={{
            display: "grid", gridTemplateColumns: gridCols,
            padding: "10px 14px", borderBottom: "1px solid hsl(var(--border))",
            fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
            color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted) / 0.3)",
          }}>
            <div>★</div>
            <div>When</div>
            <div>Category</div>
            <div>Question</div>
            <div>Verse</div>
            <div>Who</div>
          </div>
        )}

        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 16px", color: "hsl(var(--muted-foreground))" }} data-testid="empty-state">
            <Compass size={20} style={{ opacity: 0.4, marginBottom: "6px" }} />
            <p style={{ fontSize: "0.85rem", margin: 0 }}>{emptyState()}</p>
          </div>
        ) : rows.map(r => {
          const isOpen = expanded.has(r.id);
          const curated = isCurated(r);
          const hasResponse = (r.reflection || "").trim().length > 0 || (r.verseText || "").trim().length > 0;
          return (
            <div key={r.id} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              <div
                onClick={() => hasResponse && toggleExpand(r.id)}
                data-testid={`row-${r.id}`}
                style={{
                  width: "100%",
                  display: isMobile ? "block" : "grid",
                  gridTemplateColumns: isMobile ? undefined : gridCols,
                  alignItems: "center", padding: "10px 14px",
                  cursor: hasResponse ? "pointer" : "default",
                  color: "hsl(var(--foreground))",
                }}
              >
                {isMobile ? (
                  // Stacked card layout (≤767px)
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "5px" }}>
                        <span>{TOPIC_EMOJIS[r.category] || "📖"}</span>
                        <span>{r.category}</span>
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))" }}>{fmtWhen(r.when)}</span>
                        <button onClick={e => toggleCurate(r, e)} data-testid={`star-${r.id}`}
                          aria-label={curated ? "Unstar" : "Star"}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}>
                          <Star size={16} fill={curated ? "hsl(var(--primary))" : "none"} style={{ color: "hsl(var(--primary))" }} />
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: "0.86rem", marginBottom: "4px" }}>{truncate(r.question)}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", fontFamily: "ui-serif, Georgia, serif" }}>{r.verseRef || "—"}</span>
                      <Badge variant="secondary" style={{ fontSize: "0.68rem", padding: "1px 7px" }}>
                        <Users size={10} style={{ marginRight: "3px" }} />anon
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <button onClick={e => toggleCurate(r, e)} data-testid={`star-${r.id}`}
                        aria-label={curated ? "Unstar" : "Star"}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}>
                        <Star size={15} fill={curated ? "hsl(var(--primary))" : "none"} style={{ color: "hsl(var(--primary))" }} />
                      </button>
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", gap: "4px" }}>
                      {hasResponse ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span style={{ width: 13 }} />}
                      {fmtWhen(r.when)}
                    </div>
                    <div style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "5px" }}>
                      <span>{TOPIC_EMOJIS[r.category] || "📖"}</span>
                      <span>{r.category}</span>
                    </div>
                    <div style={{ fontSize: "0.86rem", color: "hsl(var(--foreground))", paddingRight: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.question}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "hsl(var(--muted-foreground))", fontFamily: "ui-serif, Georgia, serif" }}>
                      {r.verseRef || "—"}
                    </div>
                    <div>
                      <Badge variant="secondary" style={{ fontSize: "0.68rem", padding: "1px 7px" }}>
                        <Users size={10} style={{ marginRight: "3px" }} />anon
                      </Badge>
                    </div>
                  </>
                )}
              </div>

              {isOpen && hasResponse && (
                <div style={{ padding: isMobile ? "0 14px 14px" : "0 16px 14px 42px", background: "hsl(var(--muted) / 0.25)" }}>
                  {(r.verseText || "").trim() && (
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>
                        {r.verseRef} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· KJV</span>
                      </div>
                      <p style={{ fontSize: "0.86rem", color: "hsl(var(--foreground))", margin: 0, fontFamily: "ui-serif, Georgia, serif", lineHeight: 1.55 }}>
                        {r.verseText}
                      </p>
                    </div>
                  )}
                  {(r.reflection || "").trim() && (
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}>
                        Reflection
                      </div>
                      <p style={{ fontSize: "0.85rem", color: "hsl(var(--foreground))", margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                        {r.reflection}
                      </p>
                    </div>
                  )}
                  <Button size="sm" variant="outline" onClick={() => copyResponse(r)} data-testid={`copy-${r.id}`}
                    style={{ height: "28px", padding: "0 10px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "5px" }}>
                    {copiedId === r.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {/* Pagination (filtered views only — the default balanced view is a single page) */}
        {!isLoading && totalPages > 1 && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", fontSize: "0.78rem", color: "hsl(var(--muted-foreground))",
            background: "hsl(var(--muted) / 0.2)",
          }}>
            <span>{pagination?.total_count.toLocaleString()} total</span>
            <div style={{ display: "flex", gap: "6px" }}>
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{ height: "28px", padding: "0 10px", fontSize: "0.75rem" }}>Previous</Button>
              <span style={{ alignSelf: "center", padding: "0 6px" }}>Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ height: "28px", padding: "0 10px", fontSize: "0.75rem" }}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <p style={{ fontSize: "0.7rem", color: "hsl(var(--muted-foreground))", marginTop: "10px", textAlign: "center" }}>
        Fully anonymized · No user, church, or location data is ever shown here
      </p>
    </div>
  );
}
