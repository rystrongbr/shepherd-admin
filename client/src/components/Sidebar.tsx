import { useLocation, Link } from "wouter";
import {
  LayoutDashboard, Users, Mail, GitBranch, Settings, ChevronRight, TrendingUp
} from "lucide-react";

const navItems = [
  { label: "Overview",  icon: LayoutDashboard, path: "/" },
  { label: "Members",   icon: Users,           path: "/members" },
  { label: "Campaigns", icon: Mail,            path: "/campaigns" },
  { label: "Sequences", icon: GitBranch,       path: "/sequences" },
  { label: "Insights",  icon: TrendingUp,      path: "/insights" },
];

const bottomItems = [
  { label: "Settings", icon: Settings, path: "/settings" },
];

export default function Sidebar() {
  const [location] = useLocation();

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
        {bottomItems.map((item) => {
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
