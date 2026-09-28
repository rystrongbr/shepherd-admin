(() => {
  "use strict";
  // The private preview replaces only this constant in its own copy.
  const API_BASE = "";
  const PREVIEW = false;
  const $ = id => document.getElementById(id);
  const theme = $("theme-toggle");
  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    theme.textContent = dark ? "Light mode" : "Dark mode";
    theme.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
  theme.addEventListener("click", () => setTheme(document.documentElement.dataset.theme !== "dark"));
  $("preview-notice").hidden = !PREVIEW;

  const campaign = new URLSearchParams(location.search);
  function tag(key) {
    return (campaign.get(key) || "").replace(/[^a-zA-Z0-9_. -]/g, "").slice(0, 100);
  }
  async function post(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${API_BASE}/api/waitlist${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "omit", body: JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error("Too many attempts. Please try again in 15 minutes.");
        if (response.status === 503) throw new Error("The launch list is temporarily unavailable. Please try again soon.");
        if (response.status === 400) throw new Error("Please check your details and try again.");
        throw new Error("We couldn't complete your request. Please try again.");
      }
      const result = await response.json();
      if (result.ok !== true) throw new Error("We couldn't confirm your request. Please try again.");
    } finally { clearTimeout(timeout); }
  }
  function message(error) {
    return error.name === "AbortError" || error instanceof TypeError
      ? "We couldn't reach My Shepherd. Check your connection and try again."
      : error.message;
  }
  let busy = false;
  $("waitlist-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !$("waitlist-form").reportValidity()) return;
    busy = true;
    const button = $("join-button");
    button.disabled = true;
    button.textContent = "Saving your place…";
    $("form-error").hidden = true;
    try {
      await post("", {
        email: $("email").value.trim(), firstName: $("first-name").value.trim(),
        device: new FormData($("waitlist-form")).get("device") || "",
        consent: $("consent").checked, consentVersion: "launch-updates-2026-09-28",
        website: $("website").value,
        source: tag("utm_source"), medium: tag("utm_medium"),
        campaign: tag("utm_campaign"), content: tag("utm_content"),
      });
      $("waitlist-form").reset();
      $("signup-panel").hidden = true;
      $("success-panel").hidden = false;
      $("success-panel").focus();
    } catch (error) {
      $("form-error").textContent = message(error);
      $("form-error").hidden = false;
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = "Notify me at launch →";
    }
  });

  let unsubscribeToken = "";
  function handleHash() {
    if (location.hash === "#privacy") $("privacy-details").open = true;
    if (!location.hash.startsWith("#unsubscribe=")) return;
    unsubscribeToken = location.hash.slice("#unsubscribe=".length);
    $("signup-panel").hidden = true;
    $("success-panel").hidden = true;
    $("unsubscribe-panel").hidden = false;
    if (!/^[a-f0-9]{64}$/.test(unsubscribeToken)) {
      $("unsubscribe-button").disabled = true;
      $("unsubscribe-result").textContent = "This link is incomplete. Contact myshepherdadmin@gmail.com to unsubscribe.";
    }
    $("unsubscribe-panel").focus();
  }
  handleHash();
  window.addEventListener("hashchange", handleHash);
  $("unsubscribe-button").addEventListener("click", async () => {
    const button = $("unsubscribe-button");
    button.disabled = true;
    $("unsubscribe-result").textContent = "Updating your preference…";
    try {
      await post("/unsubscribe", { token: unsubscribeToken });
      $("unsubscribe-result").textContent = "If this link matches a signup, it is now unsubscribed. You won't receive further launch-list emails for that signup.";
      button.textContent = "Preference saved";
    } catch (error) {
      $("unsubscribe-result").textContent = message(error);
      button.disabled = false;
    }
  });
})();
