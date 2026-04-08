import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Trash2, Send, Calendar, FileText, BookOpen,
  Mail, Zap, BarChart2, ExternalLink, Loader2, CheckCircle2, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Campaign } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const CHURCH_ID = 1;

const BIBLE_TOPICS = [
  "Anxiety", "Forgiveness", "Faith", "Prayer", "Peace",
  "Love", "Hope", "Temptation", "Suffering", "Salvation", "Anger", "Wisdom",
];

const TYPE_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  devotional: "Devotional",
  event: "Event",
  announcement: "Announcement",
};

const TYPE_COLORS: Record<string, string> = {
  onboarding: "#006494",
  devotional: "hsl(var(--primary))",
  event: "#7a39bb",
  announcement: "#d19900",
};

function CampaignTypeIcon({ type }: { type: string }) {
  const icons: Record<string, JSX.Element> = {
    onboarding: <Send size={14} />,
    devotional: <BookOpen size={14} />,
    event: <Calendar size={14} />,
    announcement: <FileText size={14} />,
  };
  return (
    <div style={{
      width: "30px", height: "30px",
      borderRadius: "0.375rem",
      background: "hsl(var(--muted))",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: TYPE_COLORS[type] || "hsl(var(--muted-foreground))",
      flexShrink: 0,
    }}>
      {icons[type] || <FileText size={14} />}
    </div>
  );
}

function CreateCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", type: "devotional", subject: "", bibleTopicTag: "", status: "draft",
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/churches/${CHURCH_ID}/campaigns`, {
        ...data,
        churchId: CHURCH_ID,
        previewText: "",
        bodyHtml: "",
        recipients: 0, opens: 0, clicks: 0,
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "campaigns"] });
      toast({ title: "Campaign created", description: `"${form.name}" saved as draft.` });
      onClose();
      setForm({ name: "", type: "devotional", subject: "", bibleTopicTag: "", status: "draft" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Email Campaign</DialogTitle>
          <DialogDescription>Create a draft campaign to push to SendGrid when ready.</DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", marginTop: "0.5rem" }}>
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Campaign Name</label>
            <Input data-testid="input-campaign-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Monday Scripture: Peace" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Type</label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger data-testid="select-campaign-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Bible Topic</label>
              <Select value={form.bibleTopicTag} onValueChange={v => setForm(f => ({ ...f, bibleTopicTag: v }))}>
                <SelectTrigger data-testid="select-bible-topic"><SelectValue placeholder="Link to topic" /></SelectTrigger>
                <SelectContent>
                  {BIBLE_TOPICS.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Subject Line</label>
            <Input data-testid="input-campaign-subject" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Your word for this week — Peace" />
          </div>
        </div>
        <DialogFooter style={{ marginTop: "1rem" }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-create-campaign"
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.name || !form.subject}
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          >
            {mutation.isPending ? "Creating…" : "Create Campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog: Push to SendGrid — create the campaign in SendGrid, optionally schedule */
function PushToSendGridDialog({
  campaign,
  open,
  onClose,
}: {
  campaign: Campaign | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");

  const pushMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {};
      if (scheduleDate) {
        // Combine date + time into ISO string
        body.scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      }
      return apiRequest("POST", `/api/campaigns/${campaign!.id}/sendgrid/push`, body).then(r => r.json());
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "campaigns"] });
      if (data.scheduled) {
        toast({
          title: "Scheduled in SendGrid",
          description: `Campaign scheduled for ${new Date(scheduleDate + "T" + scheduleTime).toLocaleString()}.`,
        });
      } else {
        toast({
          title: "Pushed to SendGrid",
          description: "Campaign created as a draft in SendGrid. Review in your SendGrid dashboard or send now.",
        });
      }
      onClose();
      setScheduleDate("");
      setScheduleTime("09:00");
    },
    onError: (err: Error) => {
      toast({
        title: "Push failed",
        description: err.message || "Could not push to SendGrid. Check your API key in Settings.",
        variant: "destructive",
      });
    },
  });

  if (!campaign) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent style={{ maxWidth: "440px" }}>
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Mail size={18} style={{ color: "hsl(var(--primary))" }} />
            Push to SendGrid
          </DialogTitle>
          <DialogDescription>
            Create <strong>"{campaign.name}"</strong> in your SendGrid account. Optionally schedule delivery.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", margin: "0.25rem 0 0.5rem" }}>
          {/* Campaign summary */}
          <div style={{
            background: "hsl(var(--muted))",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            fontSize: "0.8rem",
          }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", marginBottom: "0.25rem" }}>
              <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{campaign.name}</span>
              <span style={{ color: "hsl(var(--muted-foreground))" }}>·</span>
              <span style={{ color: TYPE_COLORS[campaign.type] || "hsl(var(--muted-foreground))" }}>
                {TYPE_LABELS[campaign.type] || campaign.type}
              </span>
            </div>
            <div style={{ color: "hsl(var(--muted-foreground))" }}>
              Subject: {campaign.subject || "(no subject set)"}
            </div>
          </div>

          {/* Schedule option */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.4rem" }}>
              Schedule Send (optional)
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem" }}>
              <Input
                data-testid="input-schedule-date"
                type="date"
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                style={{ fontSize: "0.82rem" }}
              />
              <Input
                data-testid="input-schedule-time"
                type="time"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
                style={{ fontSize: "0.82rem", width: "100px" }}
                disabled={!scheduleDate}
              />
            </div>
            <p style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginTop: "0.3rem" }}>
              Leave blank to create as a SendGrid draft — you can send manually from SendGrid.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-confirm-push-sendgrid"
            onClick={() => pushMutation.mutate()}
            disabled={pushMutation.isPending}
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", gap: "0.4rem" }}
          >
            {pushMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Pushing…</>
            ) : scheduleDate ? (
              <><Calendar size={14} /> Schedule in SendGrid</>
            ) : (
              <><Mail size={14} /> Push as Draft</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog: Send Now — immediately send a previously-pushed campaign */
function SendNowDialog({
  campaign,
  open,
  onClose,
}: {
  campaign: Campaign | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Extract sendgridCampaignId from campaign.meta JSON
  const sendgridCampaignId = (() => {
    try {
      const m = campaign?.meta ? JSON.parse(campaign.meta as string) : {};
      return m.sendgridCampaignId || "";
    } catch {
      return "";
    }
  })();

  const sendMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/campaigns/${campaign!.id}/sendgrid/send`, {
        sendgridCampaignId,
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "campaigns"] });
      toast({
        title: "Sent via SendGrid",
        description: `"${campaign?.name}" is sending to your audience now.`,
      });
      onClose();
    },
    onError: (err: Error) => {
      toast({
        title: "Send failed",
        description: err.message || "Could not send via SendGrid.",
        variant: "destructive",
      });
    },
  });

  if (!campaign) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent style={{ maxWidth: "400px" }}>
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Zap size={18} style={{ color: "#437a22" }} />
            Send Now
          </DialogTitle>
          <DialogDescription>
            Immediately send <strong>"{campaign.name}"</strong> to your SendGrid audience. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div style={{
          background: "hsl(var(--muted))",
          borderRadius: "0.5rem",
          padding: "0.75rem 1rem",
          fontSize: "0.82rem",
          margin: "0.5rem 0",
        }}>
          <div style={{ color: "hsl(var(--muted-foreground))", marginBottom: "0.25rem" }}>SendGrid Single Send ID</div>
          <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "0.78rem" }}>
            {sendgridCampaignId || "—"}
          </div>
        </div>

        {!sendgridCampaignId && (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            fontSize: "0.78rem", color: "#b45309",
            background: "#fef3c7", padding: "0.6rem 0.75rem", borderRadius: "0.375rem",
          }}>
            <AlertCircle size={14} />
            This campaign hasn't been pushed to SendGrid yet. Use "Push to SendGrid" first.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-confirm-send-now"
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending || !sendgridCampaignId}
            style={{ background: "#437a22", color: "#fff", gap: "0.4rem" }}
          >
            {sendMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Sending…</>
            ) : (
              <><Zap size={14} /> Send Now</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ textAlign: "center", minWidth: "52px" }}>
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: color || "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: "0.68rem", color: "hsl(var(--muted-foreground))", marginTop: "1px" }}>{label}</div>
    </div>
  );
}

/** Returns the sendgridCampaignId stored in campaign.meta, or "" */
function getSendGridId(campaign: Campaign): string {
  try {
    const m = campaign?.meta ? JSON.parse(campaign.meta as string) : {};
    return m.sendgridCampaignId || "";
  } catch {
    return "";
  }
}

export default function CampaignsPage() {
  const [tab, setTab] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [pushTarget, setPushTarget] = useState<Campaign | null>(null);
  const [sendTarget, setSendTarget] = useState<Campaign | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/churches", CHURCH_ID, "campaigns"],
    queryFn: () => apiRequest("GET", `/api/churches/${CHURCH_ID}/campaigns`).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/campaigns/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "campaigns"] });
      toast({ title: "Campaign deleted" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/campaigns/${id}`, { status }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "campaigns"] });
    },
  });

  const filtered = tab === "all" ? campaigns : campaigns.filter(c => c.status === tab || c.type === tab);

  const sentCount = campaigns.filter(c => c.status === "sent").length;
  const scheduledCount = campaigns.filter(c => c.status === "scheduled").length;
  const draftCount = campaigns.filter(c => c.status === "draft").length;

  return (
    <TooltipProvider>
      <>
        <div className="topbar">
          <div>
            <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Campaigns</h1>
            <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "1px" }}>
              {sentCount} sent · {scheduledCount} scheduled · {draftCount} drafts
            </p>
          </div>
          <Button
            data-testid="button-open-create-campaign"
            onClick={() => setCreateOpen(true)}
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", gap: "0.5rem", fontSize: "0.8rem" }}
          >
            <Plus size={15} /> New Campaign
          </Button>
        </div>

        <div className="page-content">
          {/* Summary row */}
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem" }}>
            {[
              { label: "Sent", value: sentCount, color: "#437a22" },
              { label: "Scheduled", value: scheduledCount, color: "#006494" },
              { label: "Drafts", value: draftCount, color: "hsl(var(--muted-foreground))" },
              {
                label: "Avg Open", color: "hsl(var(--primary))",
                value: campaigns.filter(c => c.status === "sent").length > 0
                  ? `${Math.round(campaigns.filter(c => c.status === "sent").reduce((s, c) => s + (c.recipients > 0 ? c.opens / c.recipients : 0), 0) / campaigns.filter(c => c.status === "sent").length * 100)}%`
                  : "—",
              },
            ].map(s => (
              <div key={s.label} style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
                padding: "0.625rem 1rem",
                display: "flex", alignItems: "center", gap: "0.5rem",
              }}>
                <span style={{ fontSize: "1.1rem", fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
                <span style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))" }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* SendGrid info banner */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.625rem",
            background: "hsl(var(--muted))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.5rem",
            padding: "0.6rem 0.875rem",
            marginBottom: "1rem",
            fontSize: "0.78rem",
            color: "hsl(var(--muted-foreground))",
          }}>
            <Mail size={14} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
            <span>
              Use <strong style={{ color: "hsl(var(--foreground))" }}>Push to SendGrid</strong> on any draft to create and schedule it in your SendGrid account.
              Configure your API key in{" "}
              <a href="/#/settings" style={{ color: "hsl(var(--primary))", textDecoration: "underline" }}>Settings</a>.
            </span>
          </div>

          {/* Tab filter */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {[
              { value: "all", label: "All" },
              { value: "sent", label: "Sent" },
              { value: "scheduled", label: "Scheduled" },
              { value: "draft", label: "Drafts" },
              { value: "devotional", label: "Devotionals" },
              { value: "onboarding", label: "Onboarding" },
              { value: "event", label: "Events" },
            ].map(t => (
              <button
                key={t.value}
                data-testid={`tab-${t.value}`}
                className="segment-pill"
                onClick={() => setTab(t.value)}
                style={{
                  background: tab === t.value ? "hsl(var(--primary))" : "hsl(var(--muted))",
                  color: tab === t.value ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                  borderColor: tab === t.value ? "hsl(var(--primary))" : "hsl(var(--border))",
                  fontSize: "0.75rem",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Campaign list */}
          <div style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.625rem",
            overflow: "hidden",
          }}>
            {isLoading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "0.85rem" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "0.85rem" }}>No campaigns found</div>
            ) : filtered.map((c, i) => {
              const sendgridId = getSendGridId(c);
              const isPushed = !!sendgridId;

              return (
                <div
                  key={c.id}
                  data-testid={`card-campaign-${c.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.875rem",
                    padding: "0.875rem 1rem",
                    borderBottom: i < filtered.length - 1 ? "1px solid hsl(var(--border))" : "none",
                  }}
                >
                  <CampaignTypeIcon type={c.type} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{c.name}</span>
                      <span className={`badge badge-${c.status}`}>{c.status}</span>
                      {c.bibleTopicTag && (
                        <span style={{
                          fontSize: "0.68rem",
                          padding: "0.1rem 0.4rem",
                          background: "hsl(var(--muted))",
                          borderRadius: "9999px",
                          color: "hsl(var(--muted-foreground))",
                        }}>
                          {c.bibleTopicTag}
                        </span>
                      )}
                      {/* SendGrid pushed badge */}
                      {isPushed && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: "0.2rem",
                              fontSize: "0.65rem",
                              padding: "0.1rem 0.4rem",
                              background: "#e8f5e9",
                              borderRadius: "9999px",
                              color: "#2e7d32",
                              fontWeight: 500,
                            }}>
                              <CheckCircle2 size={9} />
                              SendGrid
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" style={{ fontSize: "0.72rem" }}>
                            Pushed · ID: {sendgridId}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "hsl(var(--muted-foreground))" }}>
                      {c.subject}
                      {c.scheduledAt && ` · ${new Date(c.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                      {c.sentAt && ` · Sent ${new Date(c.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                    </div>
                  </div>

                  {/* Stats for sent campaigns */}
                  {c.status === "sent" && c.recipients > 0 ? (
                    <div style={{ display: "flex", gap: "1.25rem", marginRight: "0.5rem" }}>
                      <StatPill label="Sent" value={c.recipients} />
                      <StatPill label="Opens" value={`${Math.round((c.opens / c.recipients) * 100)}%`} color="#437a22" />
                      <StatPill label="Clicks" value={`${Math.round((c.clicks / c.recipients) * 100)}%`} color="#006494" />
                    </div>
                  ) : c.status === "scheduled" ? (
                    <Select
                      value={c.status}
                      onValueChange={v => updateStatusMutation.mutate({ id: c.id, status: v })}
                    >
                      <SelectTrigger
                        data-testid={`select-status-${c.id}`}
                        style={{ width: "auto", minWidth: "100px", height: "2rem", fontSize: "0.75rem" }}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="draft">Move to Draft</SelectItem>
                        <SelectItem value="paused">Pause</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={c.status}
                      onValueChange={v => updateStatusMutation.mutate({ id: c.id, status: v })}
                    >
                      <SelectTrigger
                        data-testid={`select-status-${c.id}`}
                        style={{ width: "auto", minWidth: "100px", height: "2rem", fontSize: "0.75rem" }}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="scheduled">Schedule</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                      </SelectContent>
                    </Select>
                  )}

                  {/* SendGrid action buttons */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexShrink: 0 }}>
                    {/* Push to SendGrid — available for non-sent campaigns */}
                    {c.status !== "sent" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            data-testid={`button-push-sendgrid-${c.id}`}
                            onClick={() => setPushTarget(c)}
                            style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              gap: "0.3rem",
                              height: "2rem",
                              padding: "0 0.6rem",
                              borderRadius: "0.375rem",
                              border: `1px solid ${isPushed ? "hsl(var(--border))" : "hsl(var(--primary))"}`,
                              background: isPushed ? "transparent" : "hsl(var(--primary) / 0.08)",
                              color: isPushed ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))",
                              fontSize: "0.72rem",
                              fontWeight: 500,
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            <Mail size={12} />
                            {isPushed ? "Re-push" : "Push"}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" style={{ fontSize: "0.72rem" }}>
                          {isPushed ? "Push updated version to SendGrid" : "Create this campaign in SendGrid"}
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* Send Now — only if already pushed to SendGrid */}
                    {isPushed && c.status !== "sent" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            data-testid={`button-send-now-${c.id}`}
                            onClick={() => setSendTarget(c)}
                            style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              gap: "0.3rem",
                              height: "2rem",
                              padding: "0 0.6rem",
                              borderRadius: "0.375rem",
                              border: "1px solid #437a22",
                              background: "rgba(67,122,34,0.08)",
                              color: "#437a22",
                              fontSize: "0.72rem",
                              fontWeight: 500,
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            <Zap size={12} />
                            Send
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" style={{ fontSize: "0.72rem" }}>
                          Send immediately via SendGrid
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* Delete */}
                    <button
                      data-testid={`button-delete-campaign-${c.id}`}
                      onClick={() => deleteMutation.mutate(c.id)}
                      style={{ color: "hsl(var(--muted-foreground))", padding: "0.25rem", borderRadius: "0.25rem" }}
                      title="Delete campaign"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <CreateCampaignDialog open={createOpen} onClose={() => setCreateOpen(false)} />
        <PushToSendGridDialog
          campaign={pushTarget}
          open={!!pushTarget}
          onClose={() => setPushTarget(null)}
        />
        <SendNowDialog
          campaign={sendTarget}
          open={!!sendTarget}
          onClose={() => setSendTarget(null)}
        />
      </>
    </TooltipProvider>
  );
}
