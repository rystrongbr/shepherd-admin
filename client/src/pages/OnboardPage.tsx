import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, ChevronRight, ChevronLeft, Church, User, Palette, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  // Step 1 — Church Info
  churchName: string;
  city: string;
  state: string;
  denomination: string;
  size: string;
  website: string;
  // Step 2 — Pastor / Contact
  pastorFirstName: string;
  pastorLastName: string;
  email: string;
  phone: string;
  // Step 3 — Branding
  primaryColor: string;
  logoUrl: string;
}

const INITIAL: FormData = {
  churchName: "", city: "", state: "", denomination: "", size: "", website: "",
  pastorFirstName: "", pastorLastName: "", email: "", phone: "",
  primaryColor: "#7B4A1E", logoUrl: "",
};

const DENOMINATIONS = [
  "Non-denominational", "Baptist", "Methodist", "Presbyterian", "Lutheran",
  "Pentecostal", "Catholic", "Anglican / Episcopal", "Assembly of God",
  "Church of Christ", "Adventist", "Other",
];

const SIZES = [
  "Under 50", "50–150", "150–500", "500–1,000", "1,000–5,000", "5,000+",
];

const STEPS = [
  { label: "Church Info", icon: Church },
  { label: "Contact",     icon: User },
  { label: "Branding",    icon: Palette },
  { label: "All Set",     icon: Sparkles },
];

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total, primaryColor }: { current: number; total: number; primaryColor: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0", marginBottom: "2rem" }}>
      {STEPS.slice(0, total).map((step, i) => {
        const Icon = step.icon;
        const done    = i < current;
        const active  = i === current;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: i < total - 1 ? 1 : "none" }}>
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem",
              minWidth: "56px",
            }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: done || active ? primaryColor : "hsl(var(--muted))",
                border: `2px solid ${done || active ? primaryColor : "hsl(var(--border))"}`,
                transition: "all 0.25s ease",
              }}>
                {done
                  ? <CheckCircle size={16} color="#fff" />
                  : <Icon size={16} color={active ? "#fff" : "hsl(var(--muted-foreground))"} />
                }
              </div>
              <span style={{
                fontSize: "0.65rem", fontWeight: active ? 700 : 400,
                color: active ? primaryColor : "hsl(var(--muted-foreground))",
                whiteSpace: "nowrap",
              }}>
                {step.label}
              </span>
            </div>
            {i < total - 1 && (
              <div style={{
                flex: 1, height: "2px", margin: "0 4px",
                marginBottom: "18px",
                background: done ? primaryColor : "hsl(var(--border))",
                transition: "background 0.25s ease",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))", margin: 0 }}>{hint}</p>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardPage() {
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState<FormData>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [churchId, setChurchId] = useState<number | null>(null);
  const { toast } = useToast();

  const set = (key: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const primary = form.primaryColor || "#7B4A1E";

  // Validate each step before advancing
  const canAdvance = () => {
    if (step === 0) return form.churchName.trim() && form.city.trim() && form.state.trim();
    if (step === 1) return form.pastorFirstName.trim() && form.pastorLastName.trim() && form.email.trim();
    return true;
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          churchName:      form.churchName.trim(),
          city:            form.city.trim(),
          state:           form.state.trim(),
          denomination:    form.denomination || "Non-denominational",
          primaryColor:    form.primaryColor,
          logoUrl:         form.logoUrl.trim(),
          pastorFirstName: form.pastorFirstName.trim(),
          pastorLastName:  form.pastorLastName.trim(),
          email:           form.email.trim(),
          phone:           form.phone.trim(),
          size:            form.size,
          website:         form.website.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok && data.churchId) {
        setChurchId(data.churchId);
        setStep(3);
      } else {
        throw new Error(data.error || "Signup failed");
      }
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ─── Confirmation screen ───────────────────────────────────────────────────

  if (step === 3) {
    return (
      <div style={{
        minHeight: "100vh", background: "#f5f0eb",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "2rem",
        fontFamily: "'Inter', sans-serif",
      }}>
        <div style={{
          background: "#fff", borderRadius: "1rem",
          padding: "3rem 2.5rem", maxWidth: "480px", width: "100%",
          boxShadow: "0 4px 24px rgba(61,31,13,0.10)",
          textAlign: "center",
        }}>
          {/* Success icon */}
          <div style={{
            width: "72px", height: "72px", borderRadius: "50%",
            background: primary, display: "flex", alignItems: "center",
            justifyContent: "center", margin: "0 auto 1.5rem",
          }}>
            <CheckCircle size={36} color="#fff" />
          </div>

          <h1 style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "1.6rem", fontWeight: 700,
            color: "#3D1F0D", margin: "0 0 0.5rem",
          }}>
            Welcome, {form.pastorFirstName}!
          </h1>
          <p style={{ fontSize: "0.95rem", color: "#6b5a4a", margin: "0 0 2rem", lineHeight: 1.6 }}>
            <strong>{form.churchName}</strong> is set up and ready to go.
            We'll reach out to <strong>{form.email}</strong> within 24 hours to get your
            email system fully configured.
          </p>

          {/* What happens next */}
          <div style={{
            background: "#f9f5f0", borderRadius: "0.75rem",
            padding: "1.25rem 1.5rem", textAlign: "left", marginBottom: "2rem",
          }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: primary, margin: "0 0 0.875rem" }}>
              What happens next
            </p>
            {[
              "We set up your dedicated SendGrid sender so emails come from your church's address.",
              "Your branded email templates are configured in your church colors.",
              "You get access to your own dashboard to manage members and campaigns.",
              "Your first welcome email sequence goes live — ready to greet new members.",
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", marginBottom: i < 3 ? "0.75rem" : 0 }}>
                <div style={{
                  width: "20px", height: "20px", borderRadius: "50%",
                  background: primary, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.65rem", fontWeight: 700, flexShrink: 0, marginTop: "1px",
                }}>{i + 1}</div>
                <p style={{ fontSize: "0.82rem", color: "#4a4038", margin: 0, lineHeight: 1.5 }}>{item}</p>
              </div>
            ))}
          </div>

          {/* Color preview */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            padding: "0.875rem 1rem",
            background: "#f9f5f0", borderRadius: "0.5rem",
            marginBottom: "1.75rem",
          }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: primary, flexShrink: 0 }} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#3D1F0D" }}>{form.churchName}</div>
              <div style={{ fontSize: "0.7rem", color: "#9a8a7a" }}>{form.city}, {form.state} · {form.denomination || "Non-denominational"}</div>
            </div>
          </div>

          <a
            href="https://www.perplexity.ai/computer/a/my-shepherd-b60itYhoS.KMg3WAjfUPEQ"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              background: primary, color: "#fff",
              textDecoration: "none",
              padding: "0.75rem 2rem",
              borderRadius: "0.5rem",
              fontSize: "0.875rem", fontWeight: 600,
              marginBottom: "1rem",
            }}
          >
            Explore My Shepherd →
          </a>

          <p style={{ fontSize: "0.72rem", color: "#9a8a7a", margin: 0 }}>
            Questions? Reply to the confirmation email or contact us directly.
          </p>
        </div>
      </div>
    );
  }

  // ─── Form steps ────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #f5f0eb 0%, #ede5da 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "3rem 1.5rem",
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "0.625rem",
          marginBottom: "0.75rem",
        }}>
          {/* Shepherd icon */}
          <div style={{
            width: "40px", height: "40px", borderRadius: "50%",
            background: primary,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8 2 5 5 5 9c0 3 2 5.5 5 7v4h4v-4c3-1.5 5-4 5-7 0-4-3-7-7-7z"/>
              <path d="M9 21h6"/>
            </svg>
          </div>
          <span style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "1.4rem", fontWeight: 700,
            color: "#3D1F0D", letterSpacing: "-0.01em",
          }}>My Shepherd</span>
        </div>
        <h2 style={{
          fontFamily: "'Lora', Georgia, serif",
          fontSize: "1.6rem", fontWeight: 700,
          color: "#3D1F0D", margin: "0 0 0.5rem",
        }}>
          Get your church set up
        </h2>
        <p style={{ fontSize: "0.9rem", color: "#6b5a4a", margin: 0, maxWidth: "400px" }}>
          Automated, faith-centered emails for your congregation — up and running in minutes.
        </p>
      </div>

      {/* Card */}
      <div style={{
        background: "#fff",
        borderRadius: "1rem",
        padding: "2rem 2.5rem",
        maxWidth: "520px", width: "100%",
        boxShadow: "0 4px 24px rgba(61,31,13,0.10)",
      }}>
        <StepIndicator current={step} total={3} primaryColor={primary} />

        {/* ── Step 0: Church Info ── */}
        {step === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem", fontWeight: 700, color: "#3D1F0D" }}>
              Tell us about your church
            </h3>
            <Field label="Church Name *">
              <Input data-testid="input-church-name" value={form.churchName} onChange={set("churchName")} placeholder="Grace Community Church" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <Field label="City *">
                <Input data-testid="input-city" value={form.city} onChange={set("city")} placeholder="Austin" />
              </Field>
              <Field label="State *">
                <Input data-testid="input-state" value={form.state} onChange={set("state")} placeholder="TX" maxLength={2} style={{ textTransform: "uppercase" }} />
              </Field>
            </div>
            <Field label="Denomination">
              <select
                data-testid="select-denomination"
                value={form.denomination}
                onChange={set("denomination")}
                style={{
                  height: "2.5rem", borderRadius: "0.375rem",
                  border: "1px solid hsl(var(--border, 220 13% 84%))",
                  padding: "0 0.75rem", fontSize: "0.875rem",
                  background: "#fff", color: "#3D1F0D",
                  outline: "none", width: "100%",
                }}
              >
                <option value="">Select denomination…</option>
                {DENOMINATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Congregation Size">
              <select
                data-testid="select-size"
                value={form.size}
                onChange={set("size")}
                style={{
                  height: "2.5rem", borderRadius: "0.375rem",
                  border: "1px solid hsl(var(--border, 220 13% 84%))",
                  padding: "0 0.75rem", fontSize: "0.875rem",
                  background: "#fff", color: "#3D1F0D",
                  outline: "none", width: "100%",
                }}
              >
                <option value="">Approximate size…</option>
                {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Website" hint="Optional">
              <Input data-testid="input-website" value={form.website} onChange={set("website")} placeholder="https://yourchurch.com" />
            </Field>
          </div>
        )}

        {/* ── Step 1: Pastor / Contact ── */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem", fontWeight: 700, color: "#3D1F0D" }}>
              Pastor & contact info
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <Field label="First Name *">
                <Input data-testid="input-first-name" value={form.pastorFirstName} onChange={set("pastorFirstName")} placeholder="James" />
              </Field>
              <Field label="Last Name *">
                <Input data-testid="input-last-name" value={form.pastorLastName} onChange={set("pastorLastName")} placeholder="Wilson" />
              </Field>
            </div>
            <Field label="Email Address *" hint="We'll send your setup confirmation here">
              <Input data-testid="input-email" type="email" value={form.email} onChange={set("email")} placeholder="pastor@yourchurch.com" />
            </Field>
            <Field label="Phone Number" hint="Optional — for onboarding support">
              <Input data-testid="input-phone" type="tel" value={form.phone} onChange={set("phone")} placeholder="(512) 555-0100" />
            </Field>

            {/* Trust signal */}
            <div style={{
              display: "flex", alignItems: "flex-start", gap: "0.625rem",
              background: "#f9f5f0", borderRadius: "0.5rem",
              padding: "0.75rem 0.875rem", marginTop: "0.25rem",
            }}>
              <CheckCircle size={15} color={primary} style={{ flexShrink: 0, marginTop: "1px" }} />
              <p style={{ fontSize: "0.75rem", color: "#6b5a4a", margin: 0, lineHeight: 1.5 }}>
                Your information is only used to set up your email system. We never share your data with third parties.
              </p>
            </div>
          </div>
        )}

        {/* ── Step 2: Branding ── */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem", fontWeight: 700, color: "#3D1F0D" }}>
              Make it yours
            </h3>
            <p style={{ fontSize: "0.82rem", color: "#6b5a4a", margin: "0 0 0.5rem" }}>
              Your emails will be styled in your church's colors so members immediately recognize them.
            </p>

            <Field label="Brand Color" hint="Pick your church's primary color — used in email headers and buttons">
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                <input
                  data-testid="input-color-picker"
                  type="color"
                  value={form.primaryColor}
                  onChange={set("primaryColor")}
                  style={{ width: "44px", height: "40px", borderRadius: "0.375rem", border: "1px solid hsl(var(--border))", padding: "2px", cursor: "pointer" }}
                />
                <Input
                  value={form.primaryColor}
                  onChange={set("primaryColor")}
                  style={{ fontFamily: "monospace", fontSize: "0.875rem" }}
                  placeholder="#7B4A1E"
                />
              </div>
            </Field>

            <Field label="Logo URL" hint="Optional — a link to your church logo image (PNG or SVG works best)">
              <Input data-testid="input-logo" value={form.logoUrl} onChange={set("logoUrl")} placeholder="https://yourchurch.com/logo.png" />
            </Field>

            {/* Live email preview card */}
            <div style={{ marginTop: "0.5rem" }}>
              <p style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9a8a7a", margin: "0 0 0.5rem" }}>
                Email preview
              </p>
              <div style={{
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.625rem", overflow: "hidden",
                boxShadow: "0 2px 8px rgba(61,31,13,0.07)",
              }}>
                {/* Email header preview */}
                <div style={{ background: primary, padding: "16px 20px" }}>
                  <div style={{ fontFamily: "'Lora', Georgia, serif", fontWeight: 700, fontSize: "15px", color: "#fff" }}>
                    {form.churchName || "Your Church Name"}
                  </div>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)", marginTop: "2px" }}>A word for your week</div>
                </div>
                {/* Email body preview */}
                <div style={{ padding: "14px 20px", background: "#fff" }}>
                  <div style={{
                    borderLeft: `3px solid ${primary}`,
                    paddingLeft: "12px",
                    fontStyle: "italic",
                    fontSize: "13px",
                    color: "#3a2e1e",
                    marginBottom: "10px",
                    lineHeight: 1.5,
                  }}>
                    "For God so loved the world that he gave his one and only Son…"
                  </div>
                  <div style={{
                    display: "inline-block",
                    background: primary, color: "#fff",
                    fontSize: "11px", fontWeight: 600,
                    padding: "6px 14px", borderRadius: "4px",
                  }}>
                    Go Deeper in My Shepherd →
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Navigation buttons ── */}
        <div style={{
          display: "flex", justifyContent: step > 0 ? "space-between" : "flex-end",
          marginTop: "1.75rem", gap: "0.75rem",
        }}>
          {step > 0 && (
            <button
              data-testid="button-back"
              onClick={() => setStep(s => s - 1)}
              style={{
                display: "flex", alignItems: "center", gap: "0.3rem",
                padding: "0.625rem 1.25rem", borderRadius: "0.5rem",
                border: "1px solid hsl(var(--border))",
                background: "transparent", cursor: "pointer",
                fontSize: "0.875rem", fontWeight: 500, color: "#6b5a4a",
              }}
            >
              <ChevronLeft size={16} /> Back
            </button>
          )}

          {step < 2 ? (
            <button
              data-testid="button-next"
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance()}
              style={{
                display: "flex", alignItems: "center", gap: "0.3rem",
                padding: "0.625rem 1.5rem", borderRadius: "0.5rem",
                background: canAdvance() ? primary : "hsl(var(--muted))",
                color: canAdvance() ? "#fff" : "hsl(var(--muted-foreground))",
                border: "none", cursor: canAdvance() ? "pointer" : "not-allowed",
                fontSize: "0.875rem", fontWeight: 600,
                transition: "all 0.15s",
              }}
            >
              Continue <ChevronRight size={16} />
            </button>
          ) : (
            <button
              data-testid="button-submit"
              onClick={handleSubmit}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: "0.4rem",
                padding: "0.625rem 1.75rem", borderRadius: "0.5rem",
                background: primary, color: "#fff",
                border: "none", cursor: loading ? "wait" : "pointer",
                fontSize: "0.875rem", fontWeight: 600,
                opacity: loading ? 0.7 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {loading ? "Submitting…" : <><Sparkles size={15} /> Get Started</>}
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#9a8a7a", textAlign: "center" }}>
        Questions? Email us at{" "}
        <a href="mailto:ryan+shepherd@guacapp.com" style={{ color: "#7B4A1E" }}>ryan+shepherd@guacapp.com</a>
      </p>
      <p style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "#b8a898" }}>
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" style={{ color: "#b8a898" }}>Created with Perplexity Computer</a>
      </p>
    </div>
  );
}
