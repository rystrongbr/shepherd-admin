import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  LayoutDashboard, Users, Mail, GitBranch, Settings, ChevronRight, TrendingUp, UserMinus, MessageSquare, Compass
} from "lucide-react";

const navItems = [
  { label: "Overview",  icon: LayoutDashboard, path: "/" },
  { label: "Members",   icon: Users,           path: "/members" },
  { label: "Campaigns", icon: Mail,            path: "/campaigns" },
  { label: "Sequences", icon: GitBranch,       path: "/sequences" },
  { label: "Insights",  icon: TrendingUp,      path: "/insights" },
  { label: "Questions", icon: MessageSquare,   path: "/questions" },
  { label: "Discover",  icon: Compass,         path: "/discover" },
];

interface DeactivationsSummaryResp {
  ok: true;
  summary: { newInWindow: number };
}

export default function Sidebar() {
  const [location] = useLocation();

  // Lightweight poll so the Deactivations badge stays fresh. We only need the
  // summary (no rows) but the same endpoint returns both — request limit=1.
  const { data: deactivationsData } = useQuery<DeactivationsSummaryResp>({
    queryKey: ["/api/email/deactivations", "sidebar-badge"],
    queryFn: () => apiRequest("GET", "/api/email/deactivations?limit=1").then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const newDeactivations = deactivationsData?.summary?.newInWindow ?? 0;

  const manageItems: Array<{
    label: string;
    icon: any;
    path: string;
    badge?: number;
  }> = [
    { label: "Deactivations", icon: UserMinus, path: "/deactivations", badge: newDeactivations },
    { label: "Settings",      icon: Settings,  path: "/settings" },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        {/* My Shepherd SVG Logo */}
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="My Shepherd">
          <circle cx="14" cy="14" r="13" stroke="hsl(36 30% 70%)" strokeWidth="1.5" />
          {/* shepherd crook */}
          <path
            d="M10 20 L10 11 Q10 7 14 7 Q18 7 18 11 Q18 14 14 14"
            stroke="hsl(36 30% 85%)"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="10" cy="21" r="1.5" fill="hsl(36 30% 85%)" />
        </svg>
        <div>
          <div className="sidebar-logo-text">My Shepherd</div>
          <div className="sidebar-logo-sub">Church Admin</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Dashboard</div>
        {navItems.map((item) => {
          const isActive = location === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`sidebar-item ${isActive ? "active" : ""}`}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon size={16} />
              {item.label}
            </Link>
          );
        })}

        <div className="sidebar-section-label" style={{ marginTop: "1rem" }}>Manage</div>
        {manageItems.map((item) => {
          const isActive = location === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`sidebar-item ${isActive ? "active" : ""}`}
              data-testid={`nav-${item.label.toLowerCase()}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                <item.icon size={16} />
                {item.label}
              </span>
              {item.badge && item.badge > 0 ? (
                <span
                  data-testid={`badge-${item.label.toLowerCase()}`}
                  style={{
                    background: "#c69b00",
                    color: "white",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    minWidth: "1.1rem",
                    height: "1.1rem",
                    borderRadius: "0.55rem",
                    padding: "0 0.35rem",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Church selector */}
      <div style={{
        padding: "0.875rem 0.75rem",
        borderTop: "1px solid hsl(var(--sidebar-border))",
        marginTop: "auto",
      }}>
        <div style={{
          background: "hsl(var(--sidebar-active))",
          borderRadius: "0.5rem",
          padding: "0.625rem 0.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }} data-testid="church-selector">
          <div>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "hsl(36 25% 85%)" }}>
              Grace Community Church
            </div>
            <div style={{ fontSize: "0.7rem", color: "hsl(var(--sidebar-muted))", marginTop: "1px" }}>
              Austin, TX
            </div>
          </div>
          <ChevronRight size={14} style={{ color: "hsl(var(--sidebar-muted))" }} />
        </div>
      </div>
    </aside>
  );
}
