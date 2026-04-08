import { useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, setAuthToken } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Sidebar from "@/components/Sidebar";
import LoginPage from "@/pages/LoginPage";
import OverviewPage from "@/pages/OverviewPage";
import MembersPage from "@/pages/MembersPage";
import CampaignsPage from "@/pages/CampaignsPage";
import SequencesPage from "@/pages/SequencesPage";
import SettingsPage from "@/pages/SettingsPage";
import OnboardPage from "@/pages/OnboardPage";
import InsightsPage from "@/pages/InsightsPage";
import NotFound from "@/pages/not-found";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

// Read token from URL hash param ?token=... (lets Ryan share a pre-authed link)
function getTokenFromUrl(): string | null {
  const hash = window.location.hash || "";
  const match = hash.match(/[?&]token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const urlToken = getTokenFromUrl();
  const [token, setToken] = useState<string | null>(urlToken);

  function handleLogin(t: string) {
    setToken(t);
    setAuthToken(t);
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <Switch>
          {/* Onboarding page — always public, no auth, no sidebar */}
          <Route path="/onboard" component={OnboardPage} />

          {/* Everything else requires auth */}
          <Route>
            {!token ? (
              <LoginPage onLogin={handleLogin} />
            ) : (
              <div className="dashboard-layout">
                <Sidebar />
                <main className="main-area">
                  <Switch>
                    <Route path="/"          component={OverviewPage} />
                    <Route path="/members"   component={MembersPage} />
                    <Route path="/campaigns" component={CampaignsPage} />
                    <Route path="/sequences" component={SequencesPage} />
                    <Route path="/insights"  component={InsightsPage} />
                    <Route path="/settings"  component={SettingsPage} />
                    <Route component={NotFound} />
                  </Switch>
                  <PerplexityAttribution />
                </main>
              </div>
            )}
          </Route>
        </Switch>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
