/**
 * Founder digest email template (Phase B.5).
 *
 * Internal-only daily digest sent to the founder (admin@barabove.app by
 * default) summarizing the prior 24 hours of email deactivations. This
 * is the review surface BEFORE we expose anything to church admins —
 * the goal is to spot false positives and tune thresholds.
 *
 * Plain HTML, no church-branding (this isn't a member-facing email).
 * Designed to be skimmable on phone: top-line counts, then donor-priority
 * rows, then everyone else.
 */

import type { DigestSummary, DeactivationRow, CrisisSignalSummary } from "../deactivations";

const CRISIS_CATEGORY_LABEL: Record<string, string> = {
  ACUTE_DANGER:      "Acute danger",
  METHOD_SEEKING:    "Method seeking",
  SUICIDAL_IDEATION: "Suicidal ideation",
  ABUSE_DISCLOSURE:  "Abuse disclosure",
  SELF_HARM:         "Self-harm",
};

/**
 * Crisis-safety signals block. Renders anonymous category counts only — there
 * is no member identity and no message content, by design. When a quiet day
 * (total 0) we still show the section so its absence isn't mistaken for a bug.
 */
function crisisSignalsHtml(c: CrisisSignalSummary): string {
  const rows =
    c.byCategory.length === 0
      ? `<div style="color:#8a7f73;font-size:13px;font-style:italic;">No crisis language detected in this window.</div>`
      : c.byCategory
          .map(
            (r) => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1ece4;font-size:14px;">
              <span style="color:#4a4038;">${escapeHtml(CRISIS_CATEGORY_LABEL[r.category] || r.category)}</span>
              <strong style="color:#3a2e1e;">${r.count}</strong>
            </div>`,
          )
          .join("");

  const followUp = c.hasHighUrgency
    ? `<div style="margin-top:12px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:13px;">
         <strong>Follow-up:</strong> ACUTE_DANGER or METHOD_SEEKING fired. Review whether app copy or a proactive push notification should follow up.
       </div>`
    : "";

  return `
    <div style="padding:14px 16px;background:#f9f5f0;border:1px solid #e7dfd2;border-radius:8px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#8a7f73;">Signals fired</span>
        <span style="font-size:24px;font-weight:700;color:#3a2e1e;line-height:1;">${c.total}</span>
      </div>
      ${rows}
      ${followUp}
      <div style="margin-top:12px;font-size:11px;color:#8a7f73;font-style:italic;">
        No message content is stored or shown. These are anonymous pattern counts only.
      </div>
    </div>
  `;
}

const REASON_LABEL: Record<DeactivationRow["reasonCategory"], string> = {
  hard_bounce:  "Hard bounce",
  soft_bounce:  "Soft bounce",
  unsubscribe:  "Unsubscribed",
  spam_report:  "Spam report",
  other:        "Other",
};

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fmtDateRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return `${from.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" })} – ${to.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" })}`;
}

function rowHtml(r: DeactivationRow, accent: string): string {
  const donorBadge = r.isDonor
    ? `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:6px;">DONOR</span>`
    : "";
  const unsubBadge = r.hasUnsubscribe
    ? `<span style="display:inline-block;background:#e5e7eb;color:#374151;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:6px;">unsubscribed</span>`
    : "";
  return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1ece4;vertical-align:top;">
        <div style="font-weight:600;color:#3a2e1e;font-size:14px;">
          ${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)}${donorBadge}${unsubBadge}
        </div>
        <div style="color:#6b6258;font-size:12px;font-family:'SFMono-Regular',Menlo,monospace;">
          ${escapeHtml(r.email)}
        </div>
        <div style="color:#8a7f73;font-size:12px;margin-top:2px;">
          ${escapeHtml(r.churchName)} · member #${r.memberId}
        </div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1ece4;vertical-align:top;color:#4a4038;font-size:13px;">
        <span style="display:inline-block;background:${accent};color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;">
          ${REASON_LABEL[r.reasonCategory]}
        </span>
        <div style="margin-top:6px;color:#6b6258;font-size:12px;">${escapeHtml(r.reason)}</div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1ece4;vertical-align:top;color:#6b6258;font-size:12px;white-space:nowrap;">
        ${fmtTime(r.deactivatedAt)}
      </td>
    </tr>
  `;
}

const ACCENT_BY_REASON: Record<DeactivationRow["reasonCategory"], string> = {
  hard_bounce:  "#dc2626", // red
  soft_bounce:  "#f59e0b", // amber
  unsubscribe:  "#6b6258", // neutral
  spam_report:  "#7c2d12", // dark red
  other:        "#6b6258",
};

function tableHtml(rows: DeactivationRow[]): string {
  if (rows.length === 0) {
    return `<p style="color:#8a7f73;font-style:italic;margin:0;">None.</p>`;
  }
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e7dfd2;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f9f5f0;">
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#6b6258;">Member</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#6b6258;">Reason</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#6b6258;">When (CT)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => rowHtml(r, ACCENT_BY_REASON[r.reasonCategory])).join("")}
      </tbody>
    </table>
  `;
}

export interface FounderDigestEmailOptions {
  summary: DigestSummary;
  dashboardUrl: string;
}

export function buildFounderDigestSubject(summary: DigestSummary): string {
  const n = summary.newDeactivations.length;
  const donors = summary.donorDeactivations.length;
  if (n === 0) return "My Shepherd · 0 deactivations yesterday";
  if (donors > 0) return `My Shepherd · ${n} deactivation${n === 1 ? "" : "s"} (${donors} donor${donors === 1 ? "" : "s"})`;
  return `My Shepherd · ${n} deactivation${n === 1 ? "" : "s"} yesterday`;
}

export function buildFounderDigestHtml(options: FounderDigestEmailOptions): string {
  const { summary, dashboardUrl } = options;
  const n = summary.newDeactivations.length;
  const donorRows = summary.donorDeactivations;
  const nonDonorRows = summary.newDeactivations.filter((r) => !r.isDonor);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Shepherd · Founder Digest</title>
</head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e7dfd2;">

        <!-- Header -->
        <tr><td style="padding:24px 28px;border-bottom:1px solid #f1ece4;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:#8a7f73;">My Shepherd · Internal</div>
          <h1 style="margin:6px 0 0;font-size:22px;color:#3a2e1e;font-family:Georgia,'Times New Roman',serif;">Founder Digest — ${fmtDateRange(summary.windowFromIso, summary.windowToIso)}</h1>
        </td></tr>

        <!-- Top-line stats -->
        <tr><td style="padding:20px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:14px;background:#f9f5f0;border-radius:8px;text-align:center;width:33%;">
                <div style="font-size:32px;font-weight:700;color:#3a2e1e;line-height:1;">${n}</div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#8a7f73;margin-top:4px;">new yesterday</div>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:14px;background:#fef3c7;border-radius:8px;text-align:center;width:33%;">
                <div style="font-size:32px;font-weight:700;color:#92400e;line-height:1;">${donorRows.length}</div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#92400e;margin-top:4px;">donors</div>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:14px;background:#f9f5f0;border-radius:8px;text-align:center;width:33%;">
                <div style="font-size:32px;font-weight:700;color:#3a2e1e;line-height:1;">${summary.totalDeactivated}</div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#8a7f73;margin-top:4px;">total backlog</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Reason breakdown -->
        ${n > 0 ? `
        <tr><td style="padding:0 28px 16px;">
          <div style="font-size:12px;color:#6b6258;">
            <strong style="color:#3a2e1e;">By reason:</strong>
            ${Object.entries(summary.byReason)
              .filter(([, count]) => count > 0)
              .map(([cat, count]) => `${REASON_LABEL[cat as DeactivationRow["reasonCategory"]]} ${count}`)
              .join(" · ")}
          </div>
        </td></tr>
        ` : ""}

        <!-- Donor priority -->
        ${donorRows.length > 0 ? `
        <tr><td style="padding:8px 28px 16px;">
          <h2 style="margin:0 0 10px;font-size:15px;color:#92400e;font-family:Georgia,'Times New Roman',serif;">⚠ Donor deactivations (review first)</h2>
          ${tableHtml(donorRows)}
        </td></tr>
        ` : ""}

        <!-- Everyone else -->
        <tr><td style="padding:8px 28px 16px;">
          <h2 style="margin:0 0 10px;font-size:15px;color:#3a2e1e;font-family:Georgia,'Times New Roman',serif;">All deactivations in this window</h2>
          ${tableHtml(nonDonorRows)}
        </td></tr>

        <!-- Crisis safety signals -->
        <tr><td style="padding:8px 28px 16px;">
          <h2 style="margin:0 0 10px;font-size:15px;color:#3a2e1e;font-family:Georgia,'Times New Roman',serif;">Crisis Safety Signals (last 24h)</h2>
          ${crisisSignalsHtml(summary.crisisSignals)}
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:8px 28px 28px;">
          <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#3a2e1e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">Open dashboard →</a>
          <div style="font-size:11px;color:#8a7f73;margin-top:12px;">
            Sent automatically by the My Shepherd admin server at 8:00 AM CT. This digest is internal-only and will not be shown to church admins until threshold tuning is complete (target: 30 days of review at ≤10% false-positive rate).
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
