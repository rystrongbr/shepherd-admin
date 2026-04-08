import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  CheckCircle, AlertCircle, Save, ExternalLink,
  Wifi, WifiOff, RefreshCw, Users, Eye,
} from "lucide-react";
import type { Church } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const CHURCH_ID = 1;

interface TestResult {
  success: boolean;
  accountName?: string;
  email?: string;
  contactCount?: number;
  error?: string;
}

interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const { data: church, isLoading } = useQuery<Church>({
    queryKey: ["/api/churches", CHURCH_ID],
    queryFn: () => apiRequest("GET", `/api/churches/${CHURCH_ID}`).then(r => r.json()),
  });

  const [form, setForm] = useState<Partial<Church>>({});
  const effectiveForm = { ...church, ...form };

  const saveMutation = useMutation({
    mutationFn: (data: Partial<Church>) =>
      apiRequest("PATCH", `/api/churches/${CHURCH_ID}`, data).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID] });
      setSaved(true);
      setTestResult(null);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: "Settings saved" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/churches/${CHURCH_ID}/sendgrid/sync`).then(r => r.json()),
    onSuccess: (data: SyncResult) => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "activities"] });
      if (data.success) {
        toast({
          title: "Sync complete",
          description: `${data.synced} members synced to SendGrid${data.failed > 0 ? `, ${data.failed} failed` : ""}.`,
        });
      } else {
        toast({ title: "Sync failed", description: data.errors?.[0] || "Unknown error", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Sync failed", description: "Could not connect to SendGrid.", variant: "destructive" });
    },
  });

  const handleTestConnection = async () => {
    const apiKey = effectiveForm.sendgridApiKey;
    const fromEmail = effectiveForm.sendgridFromEmail;
    if (!apiKey || !fromEmail) {
      toast({ title: "Enter your API key and From Email first", variant: "destructive" });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/sendgrid/test", { apiKey, fromEmail });
      const result: TestResult = await res.json();
      setTestResult(result);
      if (result.success) {
        toast({
          title: "Connected!",
          description: `${result.accountName}${result.contactCount !== undefined ? ` · ${result.contactCount} contacts` : ""}`,
        });
      } else {
        toast({ title: "Connection failed", description: result.error, variant: "destructive" });
      }
    } catch {
      setTestResult({ success: false, error: "Network error — check your API key and try again." });
    } finally {
      setIsTesting(false);
    }
  };

  const handlePreviewEmail = (type: "devotional" | "onboarding") => {
    const campaignId = type === "devotional" ? 2 : 1; // demo campaign IDs
    window.open(`/api/sendgrid/email-preview?churchId=${CHURCH_ID}&campaignId=${campaignId}`, "_blank");
  };

  if (isLoading) {
    return (
      <>
        <div className="topbar"><h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Settings</h1></div>
        <div className="page-content" style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.85rem" }}>Loading…</div>
      </>
    );
  }

  const isConnected = !!(testResult?.success || (church?.sendgridApiKey && church?.sendgridFromEmail));

  return (
    <>
      <div className="topbar">
        <div>
          <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Settings</h1>
          <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "1px" }}>
            Church profile, branding, and SendGrid integration
          </p>
        </div>
        <Button
          data-testid="button-save-settings"
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending || Object.keys(form).length === 0}
          style={{
            background: saved ? "#437a22" : "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
            gap: "0.5rem", fontSize: "0.8rem",
            transition: "background 300ms ease",
          }}
        >
          {saved ? <><CheckCircle size={14} /> Saved</> : <><Save size={14} /> Save Changes</>}
        </Button>
      </div>

      <div className="page-content">
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "640px" }}>

          {/* Church Profile */}
          <section style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.625rem", overflow: "hidden" }}>
            <div style={{ padding: "0.875rem 1.125rem", borderBottom: "1px solid hsl(var(--border))" }}>
              <h2 style={{ fontSize: "0.875rem", fontWeight: 700 }}>Church Profile</h2>
              <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>Appears in your email headers and templates.</p>
            </div>
            <div style={{ padding: "1rem 1.125rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Church Name</label>
                <Input data-testid="input-church-name" value={effectiveForm.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Grace Community Church" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>City, State</label>
                  <Input data-testid="input-location" value={effectiveForm.location ?? ""} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Austin, TX" />
                </div>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Denomination</label>
                  <Input data-testid="input-denomination" value={effectiveForm.denomination ?? ""} onChange={e => setForm(f => ({ ...f, denomination: e.target.value }))} placeholder="Non-denominational" />
                </div>
              </div>
            </div>
          </section>

          {/* Email Branding */}
          <section style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.625rem", overflow: "hidden" }}>
            <div style={{ padding: "0.875rem 1.125rem", borderBottom: "1px solid hsl(var(--border))" }}>
              <h2 style={{ fontSize: "0.875rem", fontWeight: 700 }}>Email Branding</h2>
              <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>Customize how your emails look to members.</p>
            </div>
            <div style={{ padding: "1rem 1.125rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Logo URL</label>
                <Input data-testid="input-logo-url" value={effectiveForm.logoUrl ?? ""} onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://yourchurch.com/logo.png" />
              </div>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Brand Color</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                  <input
                    data-testid="input-brand-color"
                    type="color"
                    value={effectiveForm.primaryColor ?? "#7B4A1E"}
                    onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                    style={{ width: "40px", height: "36px", borderRadius: "0.375rem", border: "1px solid hsl(var(--border))", padding: "2px", cursor: "pointer" }}
                  />
                  <Input value={effectiveForm.primaryColor ?? "#7B4A1E"} onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))} style={{ flex: 1, fontFamily: "monospace", fontSize: "0.85rem" }} placeholder="#7B4A1E" />
                  <div style={{ width: "36px", height: "36px", borderRadius: "0.375rem", background: effectiveForm.primaryColor ?? "#7B4A1E", border: "1px solid hsl(var(--border))", flexShrink: 0 }} />
                </div>
              </div>

              {/* Email preview buttons */}
              <div style={{ display: "flex", gap: "0.625rem", paddingTop: "0.25rem" }}>
                <button
                  data-testid="button-preview-devotional"
                  onClick={() => handlePreviewEmail("devotional")}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.375rem",
                    fontSize: "0.75rem", fontWeight: 500,
                    padding: "0.375rem 0.75rem",
                    borderRadius: "0.375rem",
                    background: "hsl(var(--muted))",
                    border: "1px solid hsl(var(--border))",
                    cursor: "pointer",
                    color: "hsl(var(--foreground))",
                  }}
                >
                  <Eye size={13} /> Preview Devotional Email
                </button>
                <button
                  data-testid="button-preview-welcome"
                  onClick={() => handlePreviewEmail("onboarding")}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.375rem",
                    fontSize: "0.75rem", fontWeight: 500,
                    padding: "0.375rem 0.75rem",
                    borderRadius: "0.375rem",
                    background: "hsl(var(--muted))",
                    border: "1px solid hsl(var(--border))",
                    cursor: "pointer",
                    color: "hsl(var(--foreground))",
                  }}
                >
                  <Eye size={13} /> Preview Welcome Email
                </button>
              </div>
            </div>
          </section>

          {/* SendGrid Integration */}
          <section style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.625rem", overflow: "hidden" }}>
            <div style={{ padding: "0.875rem 1.125rem", borderBottom: "1px solid hsl(var(--border))" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ fontSize: "0.875rem", fontWeight: 700 }}>SendGrid Integration</h2>
                  <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "2px" }}>Connect your SendGrid account to start sending automated emails.</p>
                </div>
                <a
                  href="https://app.sendgrid.com/settings/api_keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "hsl(var(--primary))", textDecoration: "none" }}
                >
                  Get API key <ExternalLink size={12} />
                </a>
              </div>
            </div>

            <div style={{ padding: "1rem 1.125rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>

              {/* Connection status */}
              <div style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.625rem 0.75rem", borderRadius: "0.375rem",
                background: testResult?.success ? "hsl(103 20% 92%)" :
                  testResult?.error ? "hsl(0 20% 95%)" : "hsl(var(--muted))",
                border: `1px solid ${testResult?.success ? "hsl(103 30% 80%)" :
                  testResult?.error ? "hsl(0 30% 85%)" : "hsl(var(--border))"}`,
              }}>
                {testResult?.success
                  ? <Wifi size={14} style={{ color: "#437a22", flexShrink: 0 }} />
                  : testResult?.error
                    ? <WifiOff size={14} style={{ color: "#a13544", flexShrink: 0 }} />
                    : <AlertCircle size={14} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                }
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                    {testResult?.success
                      ? `Connected — ${testResult.accountName || "SendGrid Account"}`
                      : testResult?.error
                        ? "Connection failed"
                        : effectiveForm.sendgridApiKey
                          ? "Credentials entered — test to verify"
                          : "Not connected — add your API key below"}
                  </div>
                  {testResult?.success && (
                    <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginTop: "1px" }}>
                      {testResult.email && `${testResult.email} · `}
                      {testResult.contactCount !== undefined ? `${testResult.contactCount} marketing contacts` : ""}
                    </div>
                  )}
                  {testResult?.error && (
                    <div style={{ fontSize: "0.72rem", color: "#a13544", marginTop: "1px" }}>{testResult.error}</div>
                  )}
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>SendGrid API Key</label>
                <Input
                  data-testid="input-sendgrid-key"
                  type="password"
                  value={effectiveForm.sendgridApiKey ?? ""}
                  onChange={e => { setForm(f => ({ ...f, sendgridApiKey: e.target.value })); setTestResult(null); }}
                  placeholder="SG.xxxxxxxxxxxxxxxxxxxxxxxx"
                />
                <p style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginTop: "0.3rem" }}>
                  SendGrid → Settings → API Keys → Create API Key (Full Access or Mail Send + Marketing)
                </p>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>From Email Address</label>
                <Input
                  data-testid="input-sendgrid-from"
                  type="email"
                  value={effectiveForm.sendgridFromEmail ?? ""}
                  onChange={e => { setForm(f => ({ ...f, sendgridFromEmail: e.target.value })); setTestResult(null); }}
                  placeholder="hello@yourchurch.com"
                />
                <p style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", marginTop: "0.3rem" }}>
                  Must be a verified sender in SendGrid → Settings → Sender Authentication
                </p>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
                <button
                  data-testid="button-test-connection"
                  onClick={handleTestConnection}
                  disabled={isTesting || !effectiveForm.sendgridApiKey || !effectiveForm.sendgridFromEmail}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.375rem",
                    fontSize: "0.8rem", fontWeight: 600,
                    padding: "0.5rem 1rem",
                    borderRadius: "0.375rem",
                    background: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    border: "none", cursor: isTesting ? "wait" : "pointer",
                    opacity: (!effectiveForm.sendgridApiKey || !effectiveForm.sendgridFromEmail) ? 0.5 : 1,
                    transition: "opacity 150ms",
                  }}
                >
                  {isTesting
                    ? <><RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> Testing…</>
                    : <><Wifi size={13} /> Test Connection</>
                  }
                </button>

                {testResult?.success && (
                  <button
                    data-testid="button-sync-members"
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.375rem",
                      fontSize: "0.8rem", fontWeight: 600,
                      padding: "0.5rem 1rem",
                      borderRadius: "0.375rem",
                      background: "#437a22",
                      color: "#fff",
                      border: "none", cursor: syncMutation.isPending ? "wait" : "pointer",
                    }}
                  >
                    {syncMutation.isPending
                      ? <><RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> Syncing…</>
                      : <><Users size={13} /> Sync All Members</>
                    }
                  </button>
                )}
              </div>

              {/* Spin animation */}
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
          </section>

          {/* How SendGrid Sending Works */}
          <section style={{
            background: "hsl(22 35% 96%)",
            border: "1px solid hsl(22 25% 86%)",
            borderRadius: "0.625rem",
            padding: "1rem 1.125rem",
          }}>
            <h2 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.75rem" }}>How SendGrid Sending Works</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              {[
                { step: "1", text: "Save your SendGrid API key and verified From Email, then test the connection above." },
                { step: "2", text: "Add members — they automatically sync to your SendGrid marketing contacts." },
                { step: "3", text: "Create a campaign in the Campaigns page. Hit \"Push to SendGrid\" to create a Single Send in your account." },
                { step: "4", text: "Schedule delivery right from the dashboard, or send immediately using the Send Now button." },
                { step: "5", text: "Live open and click stats are pulled back into the dashboard via the SendGrid stats API." },
              ].map(item => (
                <div key={item.step} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                  <div style={{
                    width: "20px", height: "20px", borderRadius: "50%",
                    background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.65rem", fontWeight: 700, flexShrink: 0, marginTop: "1px",
                  }}>{item.step}</div>
                  <p style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: "1.5" }}>{item.text}</p>
                </div>
              ))}
            </div>
          </section>

          {/* My Shepherd Connection */}
          <section style={{
            background: "hsl(22 35% 96%)",
            border: "1px solid hsl(22 25% 86%)",
            borderRadius: "0.625rem",
            padding: "1rem 1.125rem",
            display: "flex", gap: "0.75rem", alignItems: "flex-start",
          }}>
            <CheckCircle size={16} style={{ color: "hsl(var(--primary))", marginTop: "2px", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.15rem" }}>My Shepherd app connected</div>
              <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))" }}>
                Devotional emails automatically link to the corresponding Bible topic in My Shepherd. Members tap "Go Deeper" to explore full Scripture in the app.
              </div>
              <a href="https://www.perplexity.ai/computer/a/my-shepherd-b60itYhoS.KMg3WAjfUPEQ" target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "hsl(var(--primary))", textDecoration: "none", marginTop: "0.5rem", fontWeight: 500 }}>
                Open My Shepherd <ExternalLink size={11} />
              </a>
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
