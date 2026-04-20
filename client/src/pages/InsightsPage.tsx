import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, BookOpen, MessageSquare, Zap, BarChart2,
  Globe, Loader2, RefreshCw, Clock, Download, Eye, EyeOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { Insight } from "@shared/schema";

const CHURCH_ID = 1;
const APP_URL = "https://app.myshepherdapp.church";

const TOPIC_EMOJIS: Record<string, string> = {
  Anxiety: "🕊️", Forgiveness: "🤝", Faith: "✝️", Prayer: "🙏",
  Peace: "☮️", Love: "❤️", Hope: "🌅", Temptation: "⚔️",
  Suffering: "🕯️", Salvation: "💫", Anger: "🌊", Wisdom: "📖",
};

const BIBLE_TOPICS = [
  "Anxiety", "Forgiveness", "Faith", "Prayer", "Peace",
  "Love", "Hope", "Temptation", "Suffering", "Salvation", "Anger", "Wisdom",
];

// ── Full KJV scripture + reflections (mirrors My Shepherd app) ───────────────
const KJV_SCRIPTURE: Record<string, { ref: string; text: string }> = {
  Anxiety:     { ref: "Philippians 4:6-7", text: "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus." },
  Forgiveness: { ref: "Colossians 3:13",   text: "Forbearing one another, and forgiving one another, if any man have a quarrel against any: even as Christ forgave you, so also do ye." },
  Faith:       { ref: "Hebrews 11:1",      text: "Now faith is the substance of things hoped for, the evidence of things not seen." },
  Prayer:      { ref: "Matthew 6:6",       text: "But thou, when thou prayest, enter into thy closet, and when thou hast shut thy door, pray to thy Father which is in secret; and thy Father which seeth in secret shall reward thee openly." },
  Peace:       { ref: "John 14:27",        text: "Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid." },
  Love:        { ref: "1 Corinthians 13:4-5", text: "Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up, doth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil." },
  Hope:        { ref: "Romans 15:13",      text: "Now the God of hope fill you with all joy and peace in believing, that ye may abound in hope, through the power of the Holy Ghost." },
  Temptation:  { ref: "1 Corinthians 10:13", text: "There hath no temptation taken you but such as is common to man: but God is faithful, who will not suffer you to be tempted above that ye are able; but will with the temptation also make a way to escape, that ye may be able to bear it." },
  Suffering:   { ref: "Romans 8:28",       text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose." },
  Salvation:   { ref: "John 3:16",         text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
  Anger:       { ref: "Ephesians 4:26-27", text: "Be ye angry, and sin not: let not the sun go down upon your wrath: Neither give place to the devil." },
  Wisdom:      { ref: "Proverbs 3:5-6",    text: "Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths." },
};

const REFLECTIONS: Record<string, string> = {
  Anxiety:     "Anxiety reminds us of our own limits — and that is not a weakness. When we bring our worries to God in prayer, we are not burdening Him; we are trusting Him. This week, invite your congregation to rest in the knowledge that He holds tomorrow.",
  Forgiveness: "Forgiveness is not excusing what was done — it is releasing the weight it places on the soul. As we have been forgiven, so we are called to forgive. Share this path to wholeness with your congregation this week.",
  Faith:       "Faith is not the absence of doubt; it is choosing to trust even when the path is unclear. Every step taken in faith, however small, draws us nearer to the God who goes before us.",
  Prayer:      "Prayer is simply talking with God — no special words required. He already knows the heart. Encourage your congregation to open honestly to Him and allow His peace to meet them in that quiet place.",
  Peace:       "The peace God offers is not the absence of storms — it is an anchor that holds through them. When the world is turbulent, His peace becomes the steady ground beneath our feet.",
  Love:        "Love in its purest form is not a feeling alone, but a choice made daily. The love God asks of us mirrors the love He first showed us — patient, kind, and without condition.",
  Hope:        "Hope in God is not wishful thinking — it is confident expectation rooted in His faithfulness. His mercies are new every morning. Whatever yesterday held, today is a fresh beginning.",
  Temptation:  "Every temptation carries the lie that there is no other way. God promises there is always a way out. Encourage your congregation to turn to Him in that moment — He has already prepared their escape.",
  Suffering:   "Suffering is not a sign that God is distant. Often it is the very place He is most near — refining, sustaining, and revealing His strength made perfect in weakness.",
  Salvation:   "Salvation is a gift — fully given, never earned. You don't have to be worthy of it; no one is. You simply have to receive it. That is the wonder of grace.",
  Anger:       "Anger is not always wrong — but it can lead us wrong. Encourage your congregation to bring it honestly before God. He reveals what is underneath it: often grief, fear, or unmet longing that He longs to heal.",
  Wisdom:      "Wisdom begins when we acknowledge we don't have all the answers. Encourage your congregation to ask God openly, and lean not on their own understanding. He guides those who trust Him.",
};

// ── Build devotional email HTML body ─────────────────────────────────────────
function buildEmailHtml(opts: { churchName: string; primaryColor: string; topic: string }): string {
  const { churchName, primaryColor, topic } = opts;
  const verse = KJV_SCRIPTURE[topic];
  const reflection = REFLECTIONS[topic] || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${topic} — A Word for Your Week from ${churchName}</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f0eb; font-family: Georgia, 'Times New Roman', serif; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: ${primaryColor}; padding: 28px 32px; }
    .header h1 { margin: 0; color: #fff; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
    .header p { margin: 4px 0 0; color: rgba(255,255,255,0.7); font-size: 13px; font-family: Arial, sans-serif; }
    .topic-bar { background: #f9f5f0; border-left: 4px solid ${primaryColor}; padding: 14px 24px; font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${primaryColor}; }
    .body { padding: 32px; }
    .ref { font-family: Arial, sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: ${primaryColor}; margin-bottom: 8px; }
    .verse { font-style: italic; font-size: 18px; line-height: 1.7; color: #3a2e1e; border-left: 3px solid ${primaryColor}; padding-left: 20px; margin: 0 0 24px; }
    .reflection { font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4a4038; margin: 0 0 32px; }
    .cta-block { text-align: center; padding: 24px; background: #f9f5f0; border-radius: 8px; margin-bottom: 32px; }
    .cta-block p { margin: 0 0 14px; font-family: Arial, sans-serif; font-size: 14px; color: #6b5a4a; }
    .cta-btn { display: inline-block; background: ${primaryColor}; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
    .footer { padding: 20px 32px; border-top: 1px solid #e8e0d8; font-family: Arial, sans-serif; font-size: 12px; color: #9a8a7a; text-align: center; }
    .footer a { color: #9a8a7a; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${churchName}</h1>
      <p>A word for your week</p>
    </div>
    <div class="topic-bar">This week's topic: ${topic}</div>
    <div class="body">
      ${verse ? `<div class="ref">${verse.ref}</div><blockquote class="verse">"${verse.text}"</blockquote>` : ""}
      <p class="reflection">${reflection}</p>
      <div class="cta-block">
        <p>Explore more Scripture on <strong>${topic}</strong> in the My Shepherd app</p>
        <a href="${APP_URL}" class="cta-btn">Go Deeper in My Shepherd →</a>
      </div>
    </div>
    <div class="footer">
      <p>You're receiving this because you're a member of ${churchName}.</p>
      <p><a href="{{unsubscribe}}">Unsubscribe</a> &nbsp;·&nbsp; <a href="{{unsubscribe_preferences}}">Update preferences</a></p>
    </div>
  </div>
</body>
</html>`;
}

type Scope = "church" | "all";
type Days = "7" | "30" | "90";

interface TopTopic { topic: string; count: number }
interface InsightsData {
  topTopics: TopTopic[];
  recentInsights: Insight[];
}

// ── Topic bar chart ───────────────────────────────────────────────────────────
function TopicBar({ topic, count, max, rank }: { topic: string; count: number; max: number; rank: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const emoji = TOPIC_EMOJIS[topic] || "📖";
  const isTop = rank <= 3;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 48px", alignItems: "center", gap: "10px", padding: "6px 0" }}
      data-testid={`topic-bar-${topic.toLowerCase()}`}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.82rem", color: "hsl(var(--foreground))", fontWeight: isTop ? 600 : 400 }}>
        <span style={{ fontSize: "1rem", lineHeight: 1 }}>{emoji}</span>
        {topic}
      </div>
      <div style={{ position: "relative", height: "10px", background: "hsl(var(--muted))", borderRadius: "99px", overflow: "hidden" }}>
        <div style={{
          position: "absolute", left: 0, top: 0, height: "100%",
          width: `${pct}%`,
          background: isTop ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.45)",
          borderRadius: "99px",
          transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
      <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "hsl(var(--primary))", textAlign: "right" }}>{count}</div>
    </div>
  );
}

// ── Create Campaign dialog ────────────────────────────────────────────────────
function CreateCampaignDialog({ open, onClose, topic, scope, churchName, primaryColor }: {
  open: boolean; onClose: () => void; topic: string; scope: Scope;
  churchName: string; primaryColor: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName]       = useState(`${topic} — Devotional`);
  const [subject, setSubject] = useState(`Your word for this week: ${topic}`);
  const [preview, setPreview] = useState(false);

  const bodyHtml = buildEmailHtml({ churchName, primaryColor, topic });
  const verse = KJV_SCRIPTURE[topic];

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/churches/${CHURCH_ID}/campaigns`, {
        name, subject,
        type: "devotional",
        previewText: `A reflection on ${topic} — ${verse?.ref ?? "Scripture"}`,
        bodyHtml,
        status: "draft",
        bibleTopicTag: topic,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/churches/${CHURCH_ID}/campaigns`] });
      toast({ title: "Campaign created", description: `"${name}" saved as a draft in Campaigns.` });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Could not create campaign.", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent style={{ maxWidth: preview ? 660 : 480 }}>
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.2rem" }}>{TOPIC_EMOJIS[topic] || "📖"}</span>
            Create Campaign from Insight
          </DialogTitle>
          <DialogDescription>
            A devotional campaign will be created as a draft tagged with <strong>{topic}</strong>.{" "}
            {scope === "all" ? "Based on platform-wide trending data." : "Based on your congregation's activity."}
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "4px 0" }}>
          {/* Name */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "4px" }}>Campaign Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "0.87rem", fontFamily: "inherit", background: "hsl(var(--background))", color: "hsl(var(--foreground))", outline: "none" }}
              data-testid="input-campaign-name" />
          </div>

          {/* Subject */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "4px" }}>Subject Line</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "0.87rem", fontFamily: "inherit", background: "hsl(var(--background))", color: "hsl(var(--foreground))", outline: "none" }}
              data-testid="input-campaign-subject" />
          </div>

          {/* Verse preview strip */}
          {verse && (
            <div style={{ background: "hsl(var(--muted))", borderRadius: "8px", padding: "12px 14px", borderLeft: "3px solid hsl(var(--primary))" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "hsl(var(--primary))", marginBottom: "4px" }}>{verse.ref}</div>
              <div style={{ fontSize: "0.82rem", fontStyle: "italic", color: "hsl(var(--foreground))", lineHeight: 1.5 }}>"{verse.text.slice(0, 120)}{verse.text.length > 120 ? "…" : ""}"</div>
            </div>
          )}

          {/* Email preview toggle */}
          <button
            onClick={() => setPreview(p => !p)}
            style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "1px solid hsl(var(--border))", borderRadius: "6px", padding: "7px 12px", fontSize: "0.8rem", color: "hsl(var(--muted-foreground))", cursor: "pointer", fontFamily: "inherit" }}
            data-testid="button-toggle-preview"
          >
            {preview ? <EyeOff size={13} /> : <Eye size={13} />}
            {preview ? "Hide email preview" : "Preview full email"}
          </button>

          {preview && (
            <div style={{ border: "1px solid hsl(var(--border))", borderRadius: "8px", overflow: "hidden", maxHeight: "360px", overflowY: "auto" }}>
              <iframe
                srcDoc={bodyHtml}
                style={{ width: "100%", height: "500px", border: "none", display: "block" }}
                title="Email preview"
                sandbox="allow-same-origin"
              />
            </div>
          )}

          <div style={{ background: "hsl(var(--muted))", borderRadius: "6px", padding: "10px 12px", fontSize: "0.8rem", color: "hsl(var(--muted-foreground))", display: "flex", gap: "6px" }}>
            <BookOpen size={14} style={{ flexShrink: 0, marginTop: "1px", color: "hsl(var(--primary))" }} />
            <span>Saved as a draft in <strong>Campaigns</strong>. Edit, schedule, or push to SendGrid from there.</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name || !subject || mutation.isPending}
            data-testid="button-create-campaign"
            style={{ background: "hsl(var(--primary))", color: "#fff" }}>
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Create Campaign Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Question row ──────────────────────────────────────────────────────────────
function QuestionRow({ insight }: { insight: Insight }) {
  const emoji = TOPIC_EMOJIS[insight.topic] || "📖";
  const timeAgo = formatTimeAgo(new Date(insight.createdAt));
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 0", borderBottom: "1px solid hsl(var(--border))" }}
      data-testid={`question-row-${insight.id}`}>
      <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "hsl(var(--muted))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", flexShrink: 0 }}>
        {emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.87rem", color: "hsl(var(--foreground))", lineHeight: 1.4, fontStyle: "italic" }}>"{insight.question}"</div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
          <Badge variant="secondary" style={{ fontSize: "0.7rem", padding: "1px 7px" }}>{insight.topic}</Badge>
          {insight.location && <span style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))" }}>📍 {insight.location}</span>}
          <span style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginLeft: "auto", display: "flex", alignItems: "center", gap: "3px" }}>
            <Clock size={10} />{timeAgo}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs  < 24) return `${hrs}h ago`;
  return `${days}d ago`;
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(insights: Insight[], scope: Scope, days: string) {
  const headers = ["ID", "Topic", "Question", "Session ID", "Church ID", "Location", "Created At"];
  const rows = insights.map(i => [
    i.id, i.topic,
    `"${(i.question || "").replace(/"/g, '""')}"`,
    i.sessionId, i.churchId ?? "", i.location,
    new Date(i.createdAt).toLocaleString(),
  ]);
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `my-shepherd-insights-${scope}-${days}d-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function InsightsPage() {
  const [scope, setScope]             = useState<Scope>("church");
  const [days, setDays]               = useState<Days>("30");
  const [campaignTopic, setCampaignTopic] = useState<string | null>(null);
  const [campaignScope, setCampaignScope] = useState<Scope>("church");

  const url = scope === "church"
    ? `/api/insights?churchId=${CHURCH_ID}&days=${days}`
    : `/api/insights/all?days=${days}`;

  const { data, isLoading, refetch, isFetching } = useQuery<InsightsData>({
    queryKey: ["/api/insights", scope, days],
    queryFn: () => apiRequest("GET", url).then(r => r.json()),
    staleTime: 30_000,
  });

  // Fetch church info for email builder
  const { data: church } = useQuery<{ name: string; primaryColor: string }>({
    queryKey: [`/api/churches/${CHURCH_ID}`],
    queryFn: () => apiRequest("GET", `/api/churches/${CHURCH_ID}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const topTopics: TopTopic[]  = data?.topTopics      ?? [];
  const recentInsights: Insight[] = data?.recentInsights ?? [];
  const questions = recentInsights.filter(i => i.question && i.question.trim() !== "");
  const maxCount  = topTopics.length > 0 ? topTopics[0].count : 1;
  const totalTaps = topTopics.reduce((s, t) => s + t.count, 0);

  const allTopicsWithCounts = BIBLE_TOPICS
    .map(t => ({ topic: t, count: topTopics.find(x => x.topic === t)?.count ?? 0 }))
    .sort((a, b) => b.count - a.count);

  const churchName    = church?.name         ?? "Grace Community Church";
  const primaryColor  = church?.primaryColor ?? "#7B4A1E";

  function openCampaignDialog(topic: string, s: Scope) {
    setCampaignTopic(topic);
    setCampaignScope(s);
  }

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: "900px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: "3px" }}>Insights</h1>
          <p style={{ fontSize: "0.83rem", color: "hsl(var(--muted-foreground))" }}>What your congregation is seeking in the My Shepherd app</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {/* Scope toggle */}
          <div style={{ display: "flex", background: "hsl(var(--muted))", borderRadius: "8px", padding: "3px" }}>
            {(["church", "all"] as Scope[]).map(s => (
              <button key={s} onClick={() => setScope(s)} data-testid={`scope-${s}`} style={{
                padding: "5px 12px", borderRadius: "6px", border: "none", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", gap: "5px",
                background: scope === s ? "hsl(var(--background))" : "transparent",
                color: scope === s ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                boxShadow: scope === s ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s",
              }}>
                {s === "church" ? <BookOpen size={12} /> : <Globe size={12} />}
                {s === "church" ? "My Church" : "All Churches"}
              </button>
            ))}
          </div>

          <Select value={days} onValueChange={v => setDays(v as Days)}>
            <SelectTrigger style={{ width: "110px", height: "32px", fontSize: "0.8rem" }} data-testid="select-days">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>

          {/* CSV export */}
          <Button variant="outline" size="sm"
            onClick={() => exportCSV(recentInsights, scope, days)}
            disabled={isLoading || recentInsights.length === 0}
            data-testid="button-export-csv"
            style={{ height: "32px", padding: "0 10px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "5px" }}>
            <Download size={13} />
            Export
          </Button>

          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}
            data-testid="button-refresh" style={{ height: "32px", padding: "0 10px" }}>
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "1.5rem" }}>
        {[
          { label: "Total Topic Taps",  value: isLoading ? "—" : totalTaps.toLocaleString(), icon: <TrendingUp size={16} />, sub: `Last ${days} days` },
          { label: "Top Topic",         value: isLoading ? "—" : (topTopics[0]?.topic ?? "—"), icon: <span style={{ fontSize: "1rem" }}>{TOPIC_EMOJIS[topTopics[0]?.topic] ?? "📖"}</span>, sub: isLoading ? "" : `${topTopics[0]?.count ?? 0} taps` },
          { label: "Questions Asked",   value: isLoading ? "—" : questions.length.toLocaleString(), icon: <MessageSquare size={16} />, sub: "Free-form questions" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "hsl(var(--primary))", marginBottom: "6px" }}>
              {kpi.icon}
              <span style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))" }}>{kpi.label}</span>
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "hsl(var(--foreground))", lineHeight: 1.1 }}>{kpi.value}</div>
            <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "3px" }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" }}>

        {/* Topic chart */}
        <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <BarChart2 size={15} style={{ color: "hsl(var(--primary))" }} />
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>Topic Activity</span>
            </div>
            <span style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))" }}>{scope === "church" ? "Your congregation" : "All churches"}</span>
          </div>
          {isLoading
            ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", color: "hsl(var(--muted-foreground))" }}><Loader2 size={20} className="animate-spin" /></div>
            : allTopicsWithCounts.map((t, i) => <TopicBar key={t.topic} topic={t.topic} count={t.count} max={maxCount} rank={i + 1} />)
          }
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Trending + create campaign */}
          <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "14px" }}>
              <TrendingUp size={15} style={{ color: "hsl(var(--primary))" }} />
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>Top Topics — Create Campaigns</span>
            </div>
            {isLoading
              ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}><Loader2 size={18} className="animate-spin" /></div>
              : topTopics.length === 0
              ? <p style={{ fontSize: "0.83rem", color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "16px 0" }}>No data yet for this period.</p>
              : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {topTopics.slice(0, 5).map((t, i) => (
                    <div key={t.topic} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "9px 10px", borderRadius: "8px",
                      background: i === 0 ? "hsl(var(--primary) / 0.06)" : "hsl(var(--muted) / 0.5)",
                      border: i === 0 ? "1px solid hsl(var(--primary) / 0.2)" : "1px solid transparent",
                    }} data-testid={`trending-row-${t.topic.toLowerCase()}`}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "hsl(var(--muted-foreground))", width: "16px" }}>#{i + 1}</span>
                        <span style={{ fontSize: "1rem" }}>{TOPIC_EMOJIS[t.topic] || "📖"}</span>
                        <div>
                          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>{t.topic}</div>
                          <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))" }}>{t.count} taps</div>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => openCampaignDialog(t.topic, scope)}
                        data-testid={`btn-create-campaign-${t.topic.toLowerCase()}`}
                        style={{ height: "28px", fontSize: "0.72rem", padding: "0 10px", background: "hsl(var(--primary))", color: "#fff", display: "flex", alignItems: "center", gap: "4px" }}>
                        <Zap size={11} />Campaign
                      </Button>
                    </div>
                  ))}
                </div>
            }
            {scope === "all" && !isLoading && topTopics.length > 0 && (
              <p style={{ fontSize: "0.73rem", color: "hsl(var(--muted-foreground))", marginTop: "10px", borderTop: "1px solid hsl(var(--border))", paddingTop: "8px" }}>
                <Globe size={11} style={{ display: "inline", marginRight: "4px" }} />
                Platform-wide data across all connected churches
              </p>
            )}
          </div>

          {/* Questions feed */}
          <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "12px" }}>
              <MessageSquare size={15} style={{ color: "hsl(var(--primary))" }} />
              <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>Questions from Members</span>
              {questions.length > 0 && <Badge variant="secondary" style={{ marginLeft: "auto", fontSize: "0.7rem" }}>{questions.length}</Badge>}
            </div>
            {isLoading
              ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}><Loader2 size={18} className="animate-spin" /></div>
              : questions.length === 0
              ? <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <MessageSquare size={28} style={{ color: "hsl(var(--muted-foreground))", margin: "0 auto 8px", display: "block" }} />
                  <p style={{ fontSize: "0.83rem", color: "hsl(var(--muted-foreground))" }}>No questions yet. They appear here when members type free-form questions in My Shepherd.</p>
                </div>
              : <div style={{ maxHeight: "320px", overflowY: "auto" }}>
                  {questions.slice(0, 20).map(insight => <QuestionRow key={insight.id} insight={insight} />)}
                </div>
            }
          </div>
        </div>
      </div>

      {/* Campaign dialog */}
      {campaignTopic && (
        <CreateCampaignDialog
          open={!!campaignTopic}
          onClose={() => setCampaignTopic(null)}
          topic={campaignTopic}
          scope={campaignScope}
          churchName={churchName}
          primaryColor={primaryColor}
        />
      )}
    </div>
  );
}
