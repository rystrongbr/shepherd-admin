import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { UserPlus, Search, Trash2, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Member } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

const CHURCH_ID = 1;

const SEGMENTS = [
  { value: "all", label: "All Members" },
  { value: "new_visitor", label: "New Visitors" },
  { value: "regular", label: "Regular Attenders" },
  { value: "volunteer", label: "Volunteers" },
  { value: "inactive", label: "Inactive" },
  { value: "donor", label: "Donors" },
];

const SEGMENT_LABELS: Record<string, string> = {
  new_visitor: "New Visitor",
  regular: "Regular",
  volunteer: "Volunteer",
  inactive: "Inactive",
  donor: "Donor",
};

function AddMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", segment: "new_visitor"
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/churches/${CHURCH_ID}/members`, {
        ...data,
        churchId: CHURCH_ID,
        joinedAt: new Date().toISOString(),
        lastEngaged: new Date().toISOString(),
        notes: "",
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "members"] });
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "stats"] });
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "activities"] });
      toast({ title: "Member added", description: `${form.firstName} ${form.lastName} has been added.` });
      onClose();
      setForm({ firstName: "", lastName: "", email: "", phone: "", segment: "new_visitor" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Member</DialogTitle>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", marginTop: "0.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>First Name</label>
              <Input data-testid="input-first-name" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="James" />
            </div>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Last Name</label>
              <Input data-testid="input-last-name" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Smith" />
            </div>
          </div>
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Email</label>
            <Input data-testid="input-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="james@example.com" />
          </div>
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Phone (optional)</label>
            <Input data-testid="input-phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="512-555-0000" />
          </div>
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, display: "block", marginBottom: "0.3rem" }}>Segment</label>
            <Select value={form.segment} onValueChange={v => setForm(f => ({ ...f, segment: v }))}>
              <SelectTrigger data-testid="select-segment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEGMENTS.filter(s => s.value !== "all").map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter style={{ marginTop: "1rem" }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-add-member"
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.firstName || !form.email}
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          >
            {mutation.isPending ? "Adding…" : "Add Member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MembersPage() {
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ["/api/churches", CHURCH_ID, "members"],
    queryFn: () => apiRequest("GET", `/api/churches/${CHURCH_ID}/members`).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/members/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "members"] });
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "stats"] });
      toast({ title: "Member removed" });
    },
  });

  const updateSegmentMutation = useMutation({
    mutationFn: ({ id, segment }: { id: number; segment: string }) =>
      apiRequest("PATCH", `/api/members/${id}`, { segment }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "members"] });
      qc.invalidateQueries({ queryKey: ["/api/churches", CHURCH_ID, "stats"] });
    },
  });

  const filtered = members.filter(m => {
    const matchSearch = search === "" || `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(search.toLowerCase());
    const matchSegment = segment === "all" || m.segment === segment;
    return matchSearch && matchSegment;
  });

  return (
    <>
      <div className="topbar">
        <div>
          <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Members</h1>
          <p style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", marginTop: "1px" }}>
            {members.length} total · {members.filter(m => m.segment !== "inactive").length} active
          </p>
        </div>
        <Button
          data-testid="button-open-add-member"
          onClick={() => setAddOpen(true)}
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", gap: "0.5rem", fontSize: "0.8rem" }}
        >
          <UserPlus size={15} /> Add Member
        </Button>
      </div>

      <div className="page-content">
        {/* Filters */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 220px" }}>
            <Search size={14} style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
            <Input
              data-testid="input-search-members"
              placeholder="Search members…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: "2rem", fontSize: "0.85rem", height: "2.125rem" }}
            />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {SEGMENTS.map(s => (
              <button
                key={s.value}
                data-testid={`segment-filter-${s.value}`}
                className="segment-pill"
                onClick={() => setSegment(s.value)}
                style={{
                  background: segment === s.value ? "hsl(var(--primary))" : "hsl(var(--muted))",
                  color: segment === s.value ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                  borderColor: segment === s.value ? "hsl(var(--primary))" : "hsl(var(--border))",
                  fontSize: "0.75rem",
                }}
              >
                {s.label}
                <span style={{ marginLeft: "0.3rem", opacity: 0.7 }}>
                  {s.value === "all" ? members.length : members.filter(m => m.segment === s.value).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: "0.625rem",
          overflow: "hidden",
        }}>
          {isLoading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "0.85rem" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: "0.85rem" }}>No members found</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Segment</th>
                  <th>Joined</th>
                  <th>Last Active</th>
                  <th style={{ width: "60px" }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} data-testid={`row-member-${m.id}`}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{m.firstName} {m.lastName}</div>
                      {m.phone && <div style={{ fontSize: "0.72rem", color: "hsl(var(--muted-foreground))" }}>{m.phone}</div>}
                    </td>
                    <td style={{ fontSize: "0.82rem", color: "hsl(var(--muted-foreground))" }}>{m.email}</td>
                    <td>
                      <Select
                        value={m.segment}
                        onValueChange={v => updateSegmentMutation.mutate({ id: m.id, segment: v })}
                      >
                        <SelectTrigger
                          data-testid={`select-segment-${m.id}`}
                          style={{ width: "auto", height: "auto", padding: "0", border: "none", background: "transparent", gap: "0.25rem" }}
                        >
                          <span className={`badge badge-segment-${m.segment}`}>
                            {SEGMENT_LABELS[m.segment] || m.segment}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {SEGMENTS.filter(s => s.value !== "all").map(s => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))" }}>
                      {new Date(m.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))" }}>
                      {new Date(m.lastEngaged).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td>
                      <button
                        data-testid={`button-delete-member-${m.id}`}
                        onClick={() => deleteMutation.mutate(m.id)}
                        style={{ color: "hsl(var(--muted-foreground))", padding: "0.25rem", borderRadius: "0.25rem" }}
                        title="Remove member"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <AddMemberDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
