// Browser-only presentation. Never enforces or changes the server quota.
// Mobile does not load this file. Progress is just a waitlist-invitation trigger,
// not a remaining-questions counter or an account entitlement.
(function (root) {
  "use strict";
  const memory = new Map();
  const WAITLIST_URL = "/waitlist/?utm_source=webapp&utm_medium=question_limit&utm_campaign=mobile_launch";

  function classify(status, payload) {
    if (status === 429 && /^Daily question limit reached\b/i.test(payload?.error || "")) return "quota";
    if (status === 429) return "capacity";
    return "unavailable";
  }

  async function readResponse(response) {
    if (response.ok) return response.json();
    const payload = await response.json().catch(() => ({}));
    const error = new Error("Unable to complete the question");
    error.kind = classify(response.status, payload);
    error.status = response.status;
    throw error;
  }

  function recordAnswer(identity, now = new Date()) {
    // UTC bucket is only for presentation cadence. Do not use it to deny requests:
    // the server uses a 24h IP window for guests and a date bucket for accounts.
    const key = `shepherd:web-launch:v1:${identity || "guest"}:${now.toISOString().slice(0, 10)}`;
    let count = memory.get(key) || 0;
    try {
      const stored = Number(root.localStorage.getItem(key));
      if (Number.isFinite(stored) && stored > count) count = stored;
    } catch { /* Private/embedded browsing: in-memory cadence still works. */ }
    count = Math.min(count + 1, 3);
    memory.set(key, count);
    try { root.localStorage.setItem(key, String(count)); } catch { /* optional */ }
    return count >= 3;
  }

  function noticeHTML(kind, hasPrevious = false) {
    if (kind === "capacity" || kind === "unavailable") {
      return `<section class="web-question-notice web-question-notice--error" role="status" tabindex="-1">
        <h3>${kind === "capacity" ? "A little busy right now" : "Your question couldn't be completed"}</h3>
        <p>${kind === "capacity" ? "Please try again in a moment. This is a temporary service limit, not a message that you've used your daily allowance." : "Please check your connection and try again. We haven't replaced your answer with a prewritten response."}</p>
      </section>`;
    }
    const quota = kind === "quota";
    return `<section class="web-question-notice" role="status" tabindex="-1">
      <p class="web-question-notice__eyebrow">${quota ? "Daily allowance reached" : "Coming soon to mobile"}</p>
      <h3>${quota ? "You've reached your question allowance" : "Continue your journey with My Shepherd"}</h3>
      ${quota ? `<p>${hasPrevious ? "Your previous answer is still available. " : ""}Please come back when your allowance resets.</p>` : ""}
      <p>The full mobile experience is coming soon, with Bible reading, verse explanations, and your personal journal. Join the waitlist to hear when it launches.</p>
      <a class="web-question-notice__cta" href="${WAITLIST_URL}" target="_blank" rel="noopener noreferrer">Join the Mobile Waitlist <span aria-hidden="true">↗</span></a>
      ${quota ? '<p class="web-question-notice__support">Need immediate crisis support in the U.S.? Call or text <a href="tel:988">988</a>. If there is immediate danger, call your local emergency number.</p>' : ""}
    </section>`;
  }

  root.WebQuestionLimit = Object.freeze({ classify, readResponse, recordAnswer, noticeHTML, WAITLIST_URL });
})(globalThis);
