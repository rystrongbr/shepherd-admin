import { useState } from "react";
import { Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface LoginPageProps {
  onLogin: (token: string) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const data = await res.json();
        onLogin(data.token);
      } else {
        toast({ title: "Incorrect password", description: "Please try again.", variant: "destructive" });
        setPassword("");
      }
    } catch {
      toast({ title: "Connection error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "hsl(var(--background))",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "380px",
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: "16px",
        padding: "36px 32px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{
            width: "52px", height: "52px",
            background: "hsl(var(--primary) / 0.1)",
            borderRadius: "14px",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px",
          }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="13" stroke="hsl(var(--primary))" strokeWidth="2"/>
              <path d="M14 6 L14 22 M9 10 C9 10 11 8 14 10 C17 8 19 10 19 10"
                stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 style={{ fontFamily: "'Lora', Georgia, serif", fontSize: "1.3rem", fontWeight: 700, color: "hsl(var(--foreground))", margin: "0 0 4px" }}>
            My Shepherd
          </h1>
          <p style={{ fontSize: "0.82rem", color: "hsl(var(--muted-foreground))", margin: 0 }}>
            Church Admin Dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: "6px", letterSpacing: "0.03em" }}>
              Admin Password
            </label>
            <div style={{ position: "relative" }}>
              <Input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
                style={{ paddingRight: "40px" }}
                data-testid="input-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                style={{
                  position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  color: "hsl(var(--muted-foreground))", padding: "2px",
                }}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={!password.trim() || loading}
            data-testid="button-login"
            style={{ width: "100%", background: "hsl(var(--primary))", color: "#fff", height: "40px" }}
          >
            {loading
              ? <Loader2 size={15} className="animate-spin" />
              : <><Lock size={14} /> Sign In</>
            }
          </Button>
        </form>

        <p style={{ marginTop: "20px", textAlign: "center", fontSize: "0.75rem", color: "hsl(var(--muted-foreground))" }}>
          My Shepherd · Church Admin · Secure Access
        </p>
      </div>
    </div>
  );
}
