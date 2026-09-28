import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Contact = {
  id: number; email: string; firstName: string; device: string; createdAt: string;
  source: string; campaign: string; status: string; emailStatus: string;
};
type Result = {
  enabled: boolean; rows: Contact[];
  summary: { total: number; subscribed: number; unsubscribed: number; emailFailed: number };
};
export default function WaitlistPage() {
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const { data, isLoading, error, refetch } = useQuery<Result>({
    queryKey: ["/api/waitlist/contacts", offset],
    queryFn: async () => (await apiRequest("GET", `/api/waitlist/contacts?offset=${offset}`)).json(),
  });
  async function download() {
    setExporting(true); setExportError("");
    try {
      const response = await apiRequest("GET", "/api/waitlist/export");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "my-shepherd-launch-list.csv";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError("Export failed. Sign in as the owner and try again."); }
    finally { setExporting(false); }
  }
  return (
    <div className="p-6 space-y-6" data-testid="waitlist-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Mobile launch list</h1>
          <p className="text-sm text-muted-foreground">Separate from app users and church members. Owner access only.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refetch()}>Refresh</Button>
          <Button onClick={download} disabled={exporting || !data}>{exporting ? "Exporting…" : "Export subscribed contacts"}</Button>
        </div>
      </div>
      {isLoading && <p role="status">Loading launch signups…</p>}
      {error && <p role="alert">Could not load the list. This page requires the platform owner account. Try signing in again.</p>}
      {exportError && <p role="alert">{exportError}</p>}
      {data && <>
        <p className="text-sm">Signup collection: <strong>{data.enabled ? "Enabled" : "Disabled"}</strong>. Public page:{" "}
          <a className="underline" href="https://app.myshepherdapp.church/waitlist/" target="_blank" rel="noopener noreferrer">Open waitlist</a>
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            ["Total signups", data.summary.total], ["Subscribed", data.summary.subscribed],
            ["Unsubscribed", data.summary.unsubscribed], ["Welcome email failures", data.summary.emailFailed],
          ].map(([label, count]) => <Card key={label}><CardHeader><CardTitle className="text-sm">{label}</CardTitle></CardHeader><CardContent className="text-2xl">{count}</CardContent></Card>)}
        </div>
        <p className="text-sm text-muted-foreground">Export excludes unsubscribed contacts. No launch announcement is sent from this page. Keep exports private and refresh the export immediately before an approved campaign so recent opt-outs are respected.</p>
        {data.rows.length === 0 ? <p>No signups yet. Approve and enable the page before sharing your launch link.</p> :
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">Waitlist signups with device preference and consent status</caption>
              <thead><tr className="border-b text-left">{["Contact", "Phone", "Joined", "Campaign", "Consent", "Welcome email"].map(label => <th scope="col" className="p-3" key={label}>{label}</th>)}</tr></thead>
              <tbody>{data.rows.map(row => <tr className="border-b" key={row.id}>
                <td className="p-3"><div>{row.firstName || "No name provided"}</div><div className="text-muted-foreground">{row.email}</div></td>
                <td className="p-3">{row.device || "No preference"}</td>
                <td className="p-3">{new Date(row.createdAt).toLocaleDateString()}</td>
                <td className="p-3">{[row.source, row.campaign].filter(Boolean).join(" / ") || "Direct / untagged"}</td>
                <td className="p-3">{row.status}</td><td className="p-3">{row.emailStatus}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
          <span className="text-sm">Page {Math.floor(offset / 50) + 1}</span>
          <Button variant="outline" disabled={offset + 50 >= data.summary.total} onClick={() => setOffset(offset + 50)}>Next</Button>
        </div>
      </>}
    </div>
  );
}
