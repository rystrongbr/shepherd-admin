// ─────────────────────────────────────────────────────────────────────────────
//  My Shepherd — Main App
//  All state is kept in memory (no localStorage — blocked in iframe).
// ─────────────────────────────────────────────────────────────────────────────

// ── Backend URL ────────────────────────────────────────────────────────────
// Always-on Railway backend — live 24/7
// API_BASE: prefer same-origin when the page is served from a web host
// (Railway preview, production, etc.) so backend calls go to the same
// deployment. Falls back to the production host only when loaded via
// file:// (rare local dev case). This lets PR previews actually exercise
// the new server code instead of always hitting production.
const API_BASE = (typeof window !== "undefined" && window.location && window.location.protocol !== "file:")
  ? window.location.origin
  : "https://app.myshepherdapp.church";

// ── Feature flags ──────────────────────────────────────────────────────────
// Church matching (the original first-visit "which church do you attend?"
// search/affiliation flow) is OFF for launch because no churches have signed
// up yet. While off, the first-visit modal shows the "Stay connected" email +
// ZIP capture instead. Flip to true to re-enable church matching once churches
// join — all the church-search code below is preserved and only runs when true.
const FEATURE_CHURCH_MATCHING = false;

// ── localStorage helpers ────────────────────────────────────────────────────
// Wrapped in try/catch: this app historically ran inside a sandboxed iframe
// where storage was blocked. It now ships at app.myshepherdapp.church (a real
// origin) where localStorage works, but the guards keep it safe either way.
function lsGet(key) {
  try { return window.localStorage.getItem(key); } catch (_e) { return null; }
}
function lsSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (_e) { /* storage blocked */ }
}
function lsRemove(key) {
  try { window.localStorage.removeItem(key); } catch (_e) { /* storage blocked */ }
}
function ssGet(key) {
  try { return window.sessionStorage.getItem(key); } catch (_e) { return null; }
}
function ssSet(key, value) {
  try { window.sessionStorage.setItem(key, value); } catch (_e) { /* storage blocked */ }
}
function ssRemove(key) {
  try { window.sessionStorage.removeItem(key); } catch (_e) { /* storage blocked */ }
}

// ── AI version flag ────────────────────────────────────────────────────────
// Stage A soft launch: Sonnet 4.5 question-led multi-citation is the default.
// If the v2 endpoint errors, code falls back automatically to the legacy
// /api/ai/scripture endpoint. To force the legacy path for testing, append
// #v=1 to the URL.
const USE_AI_V2 = !window.location.hash.includes("v=1");

// ── Session ID ────────────────────────────────────────────────────────────
// Strategy: embed ?sid=<uuid> in the URL hash so it survives reloads
// (localStorage/sessionStorage are blocked in sandboxed iframes).

// In-memory chat history shim. Several call sites (v1 and v2 paths)
// invoke saveChatToHistory(...) to persist a turn. There is no
// persistent store on this client (iframe blocks localStorage), so
// historically this function did not exist and calls threw
// ReferenceError, silently corrupting the response render. Define it
// as an in-memory log so all call sites succeed. If we add real
// persistence later, swap the body — call signature stays the same.
const _chatHistoryLog = [];
function saveChatToHistory(topic, question, verseOrCitation, reflectionOrAnswer) {
  try {
    _chatHistoryLog.push({
      ts: Date.now(),
      topic: topic || null,
      question: question || "",
      verse: verseOrCitation || null,
      reflection: reflectionOrAnswer || ""
    });
    // Keep memory bounded
    if (_chatHistoryLog.length > 50) _chatHistoryLog.shift();
  } catch (e) {
    // never let history persistence break the response render
    console.warn("saveChatToHistory failed:", e?.message);
  }

  // If signed in, ALSO persist to server so it appears in 'Search Chats' tab
  // and so reactions have a real chat row to attach to.
  // Fire-and-forget — must never block the response render or throw uncaught.
  if (currentUser && currentUser.id) {
    const verseRef = (verseOrCitation && verseOrCitation.ref) || "";
    const verseText = (verseOrCitation && verseOrCitation.text) || "";
    fetch(`${API_BASE}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        topic: topic || "General",
        question: question || "",
        verseRef,
        verseText,
        reflection: reflectionOrAnswer || "",
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(chat => {
        if (chat && chat.id) {
          currentChatId = chat.id;
          currentChatReaction = null;
          // If reaction buttons are already rendered for this response, enable them
          enableReactionButtons();
        }
      })
      .catch(err => console.warn("persist chat failed:", err?.message));
  }
}

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getOrCreateSessionId() {
  const hash = window.location.hash || "";
  const match = hash.match(/[?&]sid=([^&]+)/);
  if (match) return decodeURIComponent(match[1]);
  const id = uuidv4();
  const newHash = hash.includes("?") ? hash + "&sid=" + id : "#?sid=" + id;
  window.history.replaceState(null, "", newHash);
  return id;
}

const SESSION_ID = getOrCreateSessionId();

// ── App state ─────────────────────────────────────────────────────────────
let churchId   = null;   // set after affiliation
let churchName = null;
let currentTopic = null;
let isLoading  = false;
let currentVerse = null;  // legacy v1 state — used by share button when on v1 path

// v2 state — the user's most recent ask + its citations. Used by drill-down
// and the share button. Null when on v1 path or before first ask.
let v2LastQuestion  = null;
let v2LastResponse  = null;  // shape: { answer, citations: [...], followUps: [...] }

// ── Auth + engagement state (donations v1) ─────────────────────────────────
// currentUser is hydrated from an httpOnly JWT cookie. Identity is never
// persisted in the URL hash; the legacy u/e hash is removed on first load.
let currentUser = null;
// Why the Sign Up modal was opened. null | "donate". When "donate", we show a
// context banner in the modal and auto-open the donation modal after sign-in.
// Mirrored to localStorage (SIGNUP_RETURN_INTENT_KEY) so it survives the
// magic-link email round-trip (which lands on a fresh page load).
let signupReturnIntent = null;
const SIGNUP_RETURN_INTENT_KEY = "signup_return_intent";
// Most recently saved server-side chat row id (returned by POST /api/chats).
// Reactions attach to this id. Reset when a chat starts.
let currentChatId = null;
// Count of asks this session — triggers the soft signup modal after Q3.
let questionCount = 0;
// Index of question at which we last showed the signup modal (0 = never).
// We re-prompt every +5 questions if user dismissed.
let lastSignupPromptedAt = 0;
// User clicked 'opt out' on the donation prompt — never show again this session
// (server enforces persistent opt-out via donation_prompts).
let sessionDonationOptedOut = false;
// Avoid double-firing donation modal from multiple eligibility checks.
let donationModalShowing = false;
// Avoid double-posting reactions for the same chat.
let currentChatReaction = null; // 'helped' | 'not_helpful' | null

// ── Analytics (PostHog) ───────────────────────────────────────────────────
// Thin, no-throw wrappers so analytics never break the app if posthog fails
// to load (ad-blockers, offline, etc.). PostHog itself is initialized in
// index.html with capture_pageview:true so visits + UTM params are
// auto-captured. These helpers add the high-signal product events.
function track(event, props) {
  try {
    if (typeof window !== "undefined" && window.posthog && typeof window.posthog.capture === "function") {
      window.posthog.capture(event, props || {});
    }
  } catch (_e) { /* swallow */ }
}
function identifyUser(user) {
  try {
    if (!user || !user.id) return;
    if (typeof window !== "undefined" && window.posthog && typeof window.posthog.identify === "function") {
      window.posthog.identify(String(user.id), {
        email: user.email || undefined,
        name: user.name || undefined,
        church_id: user.churchId || undefined,
      });
    }
  } catch (_e) { /* swallow */ }
}
function resetAnalytics() {
  try {
    if (typeof window !== "undefined" && window.posthog && typeof window.posthog.reset === "function") {
      window.posthog.reset();
    }
  } catch (_e) { /* swallow */ }
}

// ── Topics ────────────────────────────────────────────────────────────────
const TOPICS = [
  { label: "Anxiety",     emoji: "🕊️" },
  { label: "Forgiveness", emoji: "🤝" },
  { label: "Faith",       emoji: "✝️" },
  { label: "Prayer",      emoji: "🙏" },
  { label: "Peace",       emoji: "☮️" },
  { label: "Love",        emoji: "❤️" },
  { label: "Hope",        emoji: "🌅" },
  { label: "Temptation",  emoji: "⚔️" },
  { label: "Suffering",   emoji: "🕯️" },
  { label: "Salvation",   emoji: "💫" },
  { label: "Anger",       emoji: "🌊" },
  { label: "Wisdom",      emoji: "📖" },
];

// ── KJV scripture + reflections per topic ─────────────────────────────────
const SCRIPTURE = {
  "Anxiety": [
    { ref: "Philippians 4:6-7", text: "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus." },
    { ref: "1 Peter 5:7", text: "Casting all your care upon him; for he careth for you." },
    { ref: "Psalm 46:1", text: "God is our refuge and strength, a very present help in trouble." },
  ],
  "Forgiveness": [
    { ref: "Colossians 3:13", text: "Forbearing one another, and forgiving one another, if any man have a quarrel against any: even as Christ forgave you, so also do ye." },
    { ref: "Ephesians 4:32", text: "And be ye kind one to another, tenderhearted, forgiving one another, even as God for Christ's sake hath forgiven you." },
    { ref: "Matthew 6:14", text: "For if ye forgive men their trespasses, your heavenly Father will also forgive you." },
  ],
  "Faith": [
    { ref: "Hebrews 11:1", text: "Now faith is the substance of things hoped for, the evidence of things not seen." },
    { ref: "Romans 10:17", text: "So then faith cometh by hearing, and hearing by the word of God." },
    { ref: "James 2:17", text: "Even so faith, if it hath not works, is dead, being alone." },
  ],
  "Prayer": [
    { ref: "Matthew 6:6", text: "But thou, when thou prayest, enter into thy closet, and when thou hast shut thy door, pray to thy Father which is in secret; and thy Father which seeth in secret shall reward thee openly." },
    { ref: "Jeremiah 29:12", text: "Then shall ye call upon me, and ye shall go and pray unto me, and I will hearken unto you." },
    { ref: "1 Thessalonians 5:17", text: "Pray without ceasing." },
  ],
  "Peace": [
    { ref: "John 14:27", text: "Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid." },
    { ref: "Isaiah 26:3", text: "Thou wilt keep him in perfect peace, whose mind is stayed on thee: because he trusteth in thee." },
    { ref: "Romans 8:6", text: "For to be carnally minded is death; but to be spiritually minded is life and peace." },
  ],
  "Love": [
    { ref: "1 Corinthians 13:4-5", text: "Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up, doth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil." },
    { ref: "John 3:16", text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
    { ref: "1 John 4:7", text: "Beloved, let us love one another: for love is of God; and every one that loveth is born of God, and knoweth God." },
  ],
  "Hope": [
    { ref: "Romans 15:13", text: "Now the God of hope fill you with all joy and peace in believing, that ye may abound in hope, through the power of the Holy Ghost." },
    { ref: "Lamentations 3:22-23", text: "It is of the LORD's mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness." },
    { ref: "Jeremiah 29:11", text: "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end." },
  ],
  "Temptation": [
    { ref: "1 Corinthians 10:13", text: "There hath no temptation taken you but such as is common to man: but God is faithful, who will not suffer you to be tempted above that ye are able; but will with the temptation also make a way to escape, that ye may be able to bear it." },
    { ref: "James 4:7", text: "Submit yourselves therefore to God. Resist the devil, and he will flee from you." },
    { ref: "Matthew 26:41", text: "Watch and pray, that ye enter not into temptation: the spirit indeed is willing, but the flesh is weak." },
  ],
  "Suffering": [
    { ref: "Romans 8:28", text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose." },
    { ref: "2 Corinthians 12:9", text: "And he said unto me, My grace is sufficient for thee: for my strength is made perfect in weakness." },
    { ref: "Psalm 34:18", text: "The LORD is nigh unto them that are of a broken heart; and saveth such as be of a contrite spirit." },
  ],
  "Salvation": [
    { ref: "John 3:16", text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
    { ref: "Romans 10:9", text: "That if thou shalt confess with thy mouth the Lord Jesus, and shalt believe in thine heart that God hath raised him from the dead, thou shalt be saved." },
    { ref: "Ephesians 2:8-9", text: "For by grace are ye saved through faith; and that not of yourselves: it is the gift of God: Not of works, lest any man should boast." },
  ],
  "Anger": [
    { ref: "Ephesians 4:26-27", text: "Be ye angry, and sin not: let not the sun go down upon your wrath: Neither give place to the devil." },
    { ref: "James 1:19-20", text: "Wherefore, my beloved brethren, let every man be swift to hear, slow to speak, slow to wrath: For the wrath of man worketh not the righteousness of God." },
    { ref: "Proverbs 15:1", text: "A soft answer turneth away wrath: but grievous words stir up anger." },
  ],
  "Wisdom": [
    { ref: "Proverbs 3:5-6", text: "Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths." },
    { ref: "James 1:5", text: "If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him." },
    { ref: "Proverbs 2:6", text: "For the LORD giveth wisdom: out of his mouth cometh knowledge and understanding." },
  ],
};

const REFLECTIONS = {
  "Anxiety":     "Anxiety reminds us of our own limits — and that is not a weakness. When we bring our worries to God in prayer, we are not burdening Him; we are trusting Him. Rest in the knowledge that He holds tomorrow.",
  "Forgiveness": "Forgiveness is not excusing what was done — it is releasing the weight it places on your soul. As you have been forgiven, so you are called to forgive. This is the path to wholeness.",
  "Faith":       "Faith is not the absence of doubt; it is choosing to trust even when the path is unclear. Every step taken in faith, however small, draws you nearer to the God who goes before you.",
  "Prayer":      "Prayer is simply talking with God — no special words required. He already knows your heart. Open it to Him honestly, and allow His peace to meet you in that quiet place.",
  "Peace":       "The peace God offers is not the absence of storms — it is an anchor that holds through them. When the world is turbulent, His peace becomes the steady ground beneath your feet.",
  "Love":        "Love in its purest form is not a feeling alone, but a choice made daily. The love God asks of us mirrors the love He first showed us — patient, kind, and without condition.",
  "Hope":        "Hope in God is not wishful thinking — it is confident expectation rooted in His faithfulness. His mercies are new every morning. Whatever yesterday held, today is a fresh beginning.",
  "Temptation":  "Every temptation carries the lie that there is no other way. God promises there is always a way out. Turn to Him in that moment — He has already prepared your escape.",
  "Suffering":   "Suffering is not a sign that God is distant. Often it is the very place He is most near — refining, sustaining, and revealing His strength made perfect in your weakness.",
  "Salvation":   "Salvation is a gift — fully given, never earned. You don't have to be worthy of it; no one is. You simply have to receive it. That is the wonder of grace.",
  "Anger":       "Anger is not always wrong — but it can lead us wrong. Bring it honestly before God. Let Him show you what is underneath it: often grief, fear, or unmet longing that He longs to heal.",
  "Wisdom":      "Wisdom begins when we acknowledge we don't have all the answers. Ask God for it openly, and lean not on your own understanding. He guides those who trust Him.",
};

const FOLLOW_UP = {
  "Anxiety":     ["Dealing with worry",  "Finding rest",     "Trusting God's plan"],
  "Forgiveness": ["Letting go of hurt",  "Self-forgiveness", "Reconciliation"],
  "Faith":       ["When doubt comes",    "Walking in faith", "Trusting God"],
  "Prayer":      ["How to pray",         "Hearing from God", "Intercession"],
  "Peace":       ["Rest in God",         "Quieting fear",    "Peace in trials"],
  "Love":        ["Loving enemies",      "God's love",       "Loving yourself"],
  "Hope":        ["Waiting on God",      "Finding purpose",  "New beginnings"],
  "Temptation":  ["Spiritual warfare",   "Staying strong",   "God's protection"],
  "Suffering":   ["God in pain",         "Finding meaning",  "Grief and loss"],
  "Salvation":   ["Assurance",           "God's grace",      "New life in Christ"],
  "Anger":       ["Managing anger",      "Conflict healing", "Emotional freedom"],
  "Wisdom":      ["Discernment",         "Guidance",         "Making decisions"],
};

// ── Helpers ───────────────────────────────────────────────────────────────
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildResponseHTML(topic, question, verse, reflection) {
  currentVerse = verse;   // store for share button
  return `
    <div class="response-text">
      ${question ? `<p style="margin-bottom:12px;color:var(--text-mid);font-style:italic;font-size:0.85rem;">"${question}"</p>` : ""}
      <div class="verse-block">
        <div class="verse-ref">${verse.ref}</div>
        <div class="verse-text">${verse.text}</div>
      </div>
      <div class="reflection">
        <div class="reflection-label">Reflection</div>
        <div class="reflection-body">${reflection}</div>
      </div>
    </div>
  `;
}

// Fallback static data (used if AI call fails)
function getFallbackResponse(topic) {
  const verses = SCRIPTURE[topic] || SCRIPTURE["Faith"];
  const verse = pick(verses);
  const reflection = REFLECTIONS[topic] || REFLECTIONS["Faith"];
  return { verse, reflection, followUpTopics: FOLLOW_UP[topic] || [] };
}

// AI calls go to Railway via GET (Perplexity iframe allows GET to external domains).
// POST is blocked by sandbox but GET requests work fine.
// Identity params attached to every AI call. They let the server's crisis-safety
// middleware attribute an anonymous signal to a user/session (category only —
// never message content). Safe to send on every request.
function identityParams() {
  const p = { sessionId: SESSION_ID };
  if (currentUser && currentUser.id) p.userId = String(currentUser.id);
  return p;
}

async function fetchAIResponse(topic, question) {
  const params = new URLSearchParams({ topic, question: question || "", ...identityParams() });
  const res = await fetch(`${API_BASE}/api/ai/scripture?${params.toString()}`);
  if (!res.ok) throw new Error("AI request failed: " + res.status);
  return res.json();
}

async function fetchDeeperResponse(topic, question, prevRef) {
  const params = new URLSearchParams({ topic, question: question || "", prevRef: prevRef || "", ...identityParams() });
  const res = await fetch(`${API_BASE}/api/ai/deeper?${params.toString()}`);
  if (!res.ok) throw new Error("Deeper request failed: " + res.status);
  return res.json();
}

// ── v2 fetchers (Sonnet, question-led, multi-citation) ───────────────────────
async function fetchV2Ask(question, topicHint) {
  const params = new URLSearchParams({ question, topicHint: topicHint || "", ...identityParams() });
  const res = await fetch(`${API_BASE}/api/ai/ask?${params.toString()}`);
  if (!res.ok) throw new Error("AI v2 request failed: " + res.status);
  return res.json();
}

async function fetchV2Passage(originalQuestion, passageRef) {
  const params = new URLSearchParams({ originalQuestion, passageRef });
  const res = await fetch(`${API_BASE}/api/ai/passage?${params.toString()}`);
  if (!res.ok) throw new Error("AI v2 passage request failed: " + res.status);
  return res.json();
}

// HTML-escape user-controlled and model-returned strings before injecting
// into innerHTML. Cheap and effective; keeps rendering simple.
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Render a v2 response: pastoral answer first, then expandable citation
// cards (each with relevance + KJV text + drill-down button), then follow-ups.
function buildV2ResponseHTML(question, data) {
  const citationsHTML = (data.citations || []).map((c, idx) => `
    <details class="citation-card" data-idx="${idx}">
      <summary class="citation-summary">
        <span class="citation-ref">${esc(c.ref)}</span>
        <span class="citation-relevance">${esc(c.relevance)}</span>
      </summary>
      <div class="citation-body">
        <div class="citation-text">${esc(c.text)}</div>
        <button class="btn-drill-down" data-ref="${esc(c.ref)}" data-testid="button-drill-${idx}">
          Explore ${esc(c.ref)} further
        </button>
      </div>
    </details>
  `).join("");

  return `
    <div class="response-text v2">
      ${question ? `<p class="v2-question">“${esc(question)}”</p>` : ""}
      <div class="v2-answer">${esc(data.answer)}</div>
      <div class="v2-citations-label">Drawn from</div>
      <div class="v2-citations">${citationsHTML}</div>
    </div>
  `;
}

// ── Crisis safety card ───────────────────────────────────────────────────────
// When the server intercepts crisis language it returns a payload shaped
// { type: 'crisis_safety', ... } from ANY of the AI endpoints instead of the
// normal answer. We render a distinct, warm-cream card (no marketing chrome,
// prominent call buttons). The user is NOT locked out — they can keep chatting.
function buildCrisisResponseHTML(r) {
  const isUrgent = r.urgency === "IMMEDIATE" || r.urgency === "HIGH";

  const scriptureBlock = (s) => s ? `
    <blockquote class="crisis-scripture">
      <span class="crisis-scripture-text">“${esc(s.text)}”</span>
      <cite class="crisis-scripture-ref">— ${esc(s.reference)} (KJV)</cite>
    </blockquote>` : "";

  const primary = r.resources && r.resources.primary;
  const secondary = r.resources && r.resources.secondary;
  const telHref = (num) => `tel:${String(num || "").replace(/\D/g, "")}`;
  const secondaryHref = secondary
    ? (/^\d{5,6}$/.test(secondary.number) ? `sms:${secondary.number}` : telHref(secondary.number))
    : "";

  const primaryBtn = primary ? `
    <a class="crisis-btn crisis-btn-primary" href="${telHref(primary.number)}" data-testid="crisis-call-primary">
      Call ${esc(primary.number)} — ${esc(primary.name)}
    </a>` : "";

  const secondaryBtn = secondary ? `
    <a class="crisis-btn crisis-btn-secondary" href="${secondaryHref}" data-testid="crisis-call-secondary">
      ${esc(secondary.text_action || `Contact ${secondary.name} (${secondary.number})`)}
    </a>` : "";

  return `
    <div class="crisis-card${isUrgent ? " crisis-card-urgent" : ""}" role="alert">
      ${isUrgent ? `<div class="crisis-urgent-banner">Please read this before anything else</div>` : ""}
      <p class="crisis-ack">${esc(r.acknowledgment)}</p>
      ${scriptureBlock(r.scripture_primary)}
      ${scriptureBlock(r.scripture_secondary)}
      <div class="crisis-resources">
        <p class="crisis-resources-title">Please reach out — right now.</p>
        ${primaryBtn}
        ${secondaryBtn}
      </div>
      <p class="crisis-nudge">${esc(r.trusted_adult_nudge)}</p>
      <p class="crisis-footer">${esc(r.footer)}</p>
    </div>
  `;
}

// If a fetched AI payload is a crisis interception, render the card and return
// true (caller must stop its normal render + skip any content persistence).
// NOTHING about the user's message is saved on this path.
function renderCrisisIfPresent(data) {
  if (!data || data.type !== "crisis_safety") return false;
  const content = document.getElementById("response-content");
  const chips   = document.getElementById("follow-up-chips");
  document.getElementById("action-btn-row")?.remove();
  document.getElementById("btn-share-verse")?.remove();
  if (chips) chips.style.display = "none";
  content.innerHTML = buildCrisisResponseHTML(data);
  document.getElementById("response-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

// Wire drill-down buttons after a v2 response is inserted into the DOM.
function wireV2DrillDowns() {
  document.querySelectorAll(".btn-drill-down").forEach(btn => {
    btn.addEventListener("click", () => drillDownOnPassage(btn.dataset.ref));
  });
}

async function drillDownOnPassage(passageRef) {
  if (isLoading || !v2LastQuestion || !passageRef) return;
  isLoading = true;

  const content = document.getElementById("response-content");
  const chips   = document.getElementById("follow-up-chips");
  document.getElementById("action-btn-row")?.remove();
  document.getElementById("btn-share-verse")?.remove();
  chips.style.display = "none";

  content.innerHTML = `<div class="response-loading"><div class="dot-flashing"><span></span><span></span><span></span></div><p>Exploring ${esc(passageRef)}…</p></div>`;
  document.getElementById("response-section").scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const data = await fetchV2Passage(v2LastQuestion, passageRef);
    v2LastResponse = data;
    content.innerHTML = buildV2ResponseHTML(v2LastQuestion, data);
    wireV2DrillDowns();
    renderFollowUpChipsFromList(data.followUps || []);
    renderShareButton();
  } catch (err) {
    console.error("v2 passage drill error:", err.message);
    content.innerHTML = `<div class="response-error">Sorry, that passage couldn't be loaded right now. Please try again.</div>`;
  }

  isLoading = false;
  renderActionButtons();
}

async function goDeeperOnCurrent() {
  if (isLoading || !currentTopic) return;
  const prevRef = currentVerse?.ref || "";
  const question = document.getElementById("question-input").value.trim();

  // Show active/loading state on button
  const deeperBtn = document.getElementById("btn-go-deeper");
  if (deeperBtn) {
    deeperBtn.disabled = true;
    deeperBtn.innerHTML = `<div class="dot-flashing" style="display:inline-flex;gap:4px;"><span></span><span></span><span></span></div> Going deeper…`;
    deeperBtn.style.opacity = "0.85";
  }

  isLoading = true;
  const content  = document.getElementById("response-content");
  const chips    = document.getElementById("follow-up-chips");
  const existing = document.getElementById("btn-share-verse");
  if (existing) existing.remove();
  document.getElementById("action-btn-row")?.remove();
  chips.style.display = "none";

  content.innerHTML = `<div class="response-loading"><div class="dot-flashing"><span></span><span></span><span></span></div><p>Going deeper…</p></div>`;
  document.getElementById("response-section").scrollIntoView({ behavior: "smooth", block: "start" });

  // v2 path: re-ask the same question with a deeper framing, biased away
  // from the passages we already showed. Falls back to v1 if v2 errors.
  if (USE_AI_V2 && v2LastQuestion) {
    try {
      const priorRefs = (v2LastResponse?.citations || []).map(c => c.ref).join(", ");
      const deeperQuestion = priorRefs
        ? `${v2LastQuestion} — go deeper. Beyond ${priorRefs}, what else does scripture say?`
        : `${v2LastQuestion} — go deeper. What else does scripture say?`;
      const data = await fetchV2Ask(deeperQuestion, currentTopic);
      if (renderCrisisIfPresent(data)) { isLoading = false; return; }
      v2LastQuestion = deeperQuestion;
      v2LastResponse = data;
      currentVerse = data.citations[0] ? { ref: data.citations[0].ref, text: data.citations[0].text } : null;
      content.innerHTML = buildV2ResponseHTML(v2LastQuestion, data);
      wireV2DrillDowns();
      renderFollowUpChipsFromList(data.followUps || []);
      renderShareButton();
      if (currentVerse) saveChatToHistory(currentTopic, deeperQuestion, currentVerse, data.answer);
      isLoading = false;
      renderActionButtons();
      incrementPositive("go_deeper");
      return;
    } catch (err) {
      console.warn("v2 deeper failed, falling back to v1:", err.message);
    }
  }

  try {
    const aiData = await fetchDeeperResponse(currentTopic, question, prevRef);
    if (renderCrisisIfPresent(aiData)) { isLoading = false; return; }
    const verse      = aiData.verse      || getFallbackResponse(currentTopic).verse;
    const reflection = aiData.reflection || getFallbackResponse(currentTopic).reflection;
    const followUps  = aiData.followUpTopics || FOLLOW_UP[currentTopic] || [];
    content.innerHTML = buildResponseHTML(currentTopic, question, verse, reflection);
    renderFollowUpChipsFromList(followUps);
    renderShareButton();
    saveChatToHistory(currentTopic, question, verse, reflection);
    incrementPositive("go_deeper");
  } catch(err) {
    const fallback = getFallbackResponse(currentTopic);
    content.innerHTML = buildResponseHTML(currentTopic, question, fallback.verse, fallback.reflection);
    renderFollowUpChips(currentTopic);
    renderShareButton();
  }
  isLoading = false;
  renderActionButtons();
}

function renderActionButtons() {
  document.getElementById("action-btn-row")?.remove();
  document.getElementById("reaction-btn-row")?.remove();

  const card = document.getElementById("response-card");

  // ── Reaction row (above action buttons) ────────────────────────────────
  // Shown to everyone; if not signed in, click triggers signup prompt first.
  const reactionRow = document.createElement("div");
  reactionRow.id = "reaction-btn-row";
  reactionRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:18px;align-items:center;";

  const reactionLabel = document.createElement("span");
  reactionLabel.style.cssText = "font-size:0.82rem;color:var(--text-light, #9A8A7A);font-family:Inter,sans-serif;margin-right:4px;";
  reactionLabel.textContent = "Was this helpful?";
  reactionRow.appendChild(reactionLabel);

  const helpedBtn = document.createElement("button");
  helpedBtn.id = "btn-reaction-helped";
  helpedBtn.className = "btn-reaction";
  helpedBtn.setAttribute("data-testid", "button-reaction-helped");
  helpedBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> This helped`;
  helpedBtn.addEventListener("click", () => onReactionClick("helped"));

  const notForMeBtn = document.createElement("button");
  notForMeBtn.id = "btn-reaction-not-helpful";
  notForMeBtn.className = "btn-reaction btn-reaction-secondary";
  notForMeBtn.setAttribute("data-testid", "button-reaction-not-helpful");
  notForMeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg> Not for me`;
  notForMeBtn.addEventListener("click", () => onReactionClick("not_helpful"));

  reactionRow.appendChild(helpedBtn);
  reactionRow.appendChild(notForMeBtn);
  card.appendChild(reactionRow);

  // ── Existing action row ────────────────────────────────────────────────
  const row  = document.createElement("div");
  row.id = "action-btn-row";
  row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;";

  const deeperBtn = document.createElement("button");
  deeperBtn.id = "btn-go-deeper";
  deeperBtn.className = "btn-go-deeper";
  deeperBtn.setAttribute("data-testid", "button-go-deeper");
  deeperBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg> Go Deeper`;
  deeperBtn.addEventListener("click", goDeeperOnCurrent);

  const nextBtn = document.createElement("button");
  nextBtn.id = "btn-next-question";
  nextBtn.className = "btn-next-question";
  nextBtn.setAttribute("data-testid", "button-next-question");
  nextBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg> Next Question`;
  nextBtn.addEventListener("click", handleNextQuestion);

  row.appendChild(deeperBtn);
  row.appendChild(nextBtn);
  card.appendChild(row);
}

// ── Reaction handling ─────────────────────────────────────────────────────
// When the user is signed in AND we have a chatId, POST the reaction.
// When not signed in (no chatId yet), still capture the intent so we can
// nudge signup, and lock the buttons so they can't double-click.
function enableReactionButtons() {
  // No-op: buttons are always enabled. Function exists so saveChatToHistory
  // can call it after chat is persisted (in case we want to do something
  // visual later, like fade in the buttons).
}

async function onReactionClick(reaction) {
  // De-bounce: already reacted to this chat
  if (currentChatReaction) return;
  currentChatReaction = reaction;

  // Visual feedback — highlight the chosen button, dim the other
  const helpedBtn = document.getElementById("btn-reaction-helped");
  const notForMeBtn = document.getElementById("btn-reaction-not-helpful");
  if (reaction === "helped") {
    helpedBtn?.classList.add("btn-reaction-selected");
    notForMeBtn?.style.setProperty("opacity", "0.4");
  } else {
    notForMeBtn?.classList.add("btn-reaction-selected");
    helpedBtn?.style.setProperty("opacity", "0.4");
  }
  if (helpedBtn) helpedBtn.disabled = true;
  if (notForMeBtn) notForMeBtn.disabled = true;

  // Count "This helped" toward the 3-positive-actions donation trigger. Done
  // here (before the not-signed-in early return below) so the counter is
  // accurate pre-auth too. The 30s reaction_helped timeout below remains a
  // separate, independent trigger — both can fire; the donationModalShowing /
  // sessionDonationOptedOut guards prevent a double-show.
  if (reaction === "helped") incrementPositive("helped");

  // If not signed in, this is a great moment to ask for signup
  if (!currentUser || !currentUser.id) {
    // Show a small thank-you nudge first
    showInlineToast(reaction === "helped" ? "Thanks for the feedback. Save your chats?" : "Got it — thanks for the feedback.");
    if (reaction === "helped") {
      // Trigger signup modal after a short pause so the toast is read first
      setTimeout(() => openSignupModal("reaction"), 900);
    }
    return;
  }

  // Signed in but chat not yet persisted — wait briefly for chatId
  if (!currentChatId) {
    // Poll for chatId (saveChatToHistory is in flight)
    for (let i = 0; i < 20 && !currentChatId; i++) {
      await new Promise(r => setTimeout(r, 150));
    }
  }
  if (!currentChatId) {
    // Persist failed — silently bail
    console.warn("reaction click but no chatId");
    return;
  }

  // Fire the reaction to the server
  try {
    await fetch(`${API_BASE}/api/chats/${currentChatId}/reaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ reaction }),
    });
  } catch (e) {
    console.warn("reaction post failed:", e?.message);
  }

  // On 'helped', schedule a donation prompt eligibility check after 30s
  if (reaction === "helped" && !sessionDonationOptedOut) {
    showInlineToast("Thanks for letting us know — glad it helped.");
    setTimeout(() => maybeShowDonationPrompt("reaction_helped"), 30 * 1000);
  } else if (reaction === "not_helpful") {
    showInlineToast("Thanks for the feedback. We'll keep improving.");
  }
}

// Lightweight inline toast — appears at the bottom of the response card.
function showInlineToast(message) {
  // Remove any existing toast first
  document.getElementById("inline-toast")?.remove();
  const card = document.getElementById("response-card");
  if (!card) return;
  const toast = document.createElement("div");
  toast.id = "inline-toast";
  toast.style.cssText = "margin-top:10px;padding:10px 14px;background:#f5f0eb;border-left:3px solid #7B4A1E;color:#5A4A3A;font-size:0.84rem;font-family:Inter,sans-serif;border-radius:6px;animation:fadeIn 0.3s ease;";
  toast.textContent = message;
  card.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.5s";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

// Full-page fallback shown when a phone user tapped the magic link but the
// native app isn't installed (or the OS didn't route the custom scheme).
// The token is still valid for the remaining ~15 min TTL, so we give them
// both an "Open in app" retry AND a plain "Continue in browser" link that
// verifies the token here on the web — nothing gets stranded.
function showMobileMagicLinkFallback(rawToken) {
  // Only render once, even if called multiple times.
  if (document.getElementById("mobile-magic-fallback")) return;

  const appUrl = `myshepherd://verify?token=${encodeURIComponent(rawToken)}`;
  const webUrl = `${window.location.pathname}#?magic=${encodeURIComponent(rawToken)}&web=1`;

  const overlay = document.createElement("div");
  overlay.id = "mobile-magic-fallback";
  overlay.style.cssText =
    "position:fixed;inset:0;background:#F4EFE6;z-index:9999;display:flex;flex-direction:column;" +
    "align-items:center;justify-content:center;padding:32px;font-family:Georgia,serif;text-align:center;";
  overlay.innerHTML = `
    <h2 style="color:#5A3210;margin:0 0 12px;font-size:1.6rem;">Open My Shepherd</h2>
    <p style="color:#7A6A5A;max-width:320px;line-height:1.5;margin:0 0 24px;font-size:0.98rem;">
      If the app didn't open automatically, tap below. This sign-in link is
      valid for 15 minutes.
    </p>
    <a href="${appUrl}" style="display:inline-block;background:#7B4A1E;color:#fff;padding:14px 28px;
       border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;font-weight:600;font-size:1rem;
       margin-bottom:16px;min-width:220px;">Open in the app</a>
    <a href="${webUrl}" style="color:#7B4A1E;text-decoration:underline;font-family:Arial,sans-serif;font-size:0.9rem;">
      Continue in this browser instead
    </a>
  `;
  document.body.appendChild(overlay);
}

function handleNextQuestion() {
  // Reset all state
  isLoading = false;
  currentTopic = null;
  currentVerse = null;
  v2LastQuestion = null;
  v2LastResponse = null;
  currentChatId = null;
  currentChatReaction = null;

  // Hide response area + remove buttons
  document.getElementById("response-section").style.display = "none";
  document.getElementById("action-btn-row")?.remove();
  document.getElementById("reaction-btn-row")?.remove();
  document.getElementById("inline-toast")?.remove();
  document.getElementById("btn-share-verse")?.remove();
  document.getElementById("follow-up-chips").style.display = "none";
  document.getElementById("btn-ask-another").style.display = "none";

  // Clear topic active states
  document.querySelectorAll(".topic-btn").forEach(b => {
    b.classList.remove("active");
    b.disabled = false;
  });

  // Clear input
  const input = document.getElementById("question-input");
  input.value = "";
  input.disabled = false;
  document.getElementById("char-hint").textContent = "";
  document.getElementById("btn-ask").disabled = true;

  // Scroll to top and focus
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => input.focus(), 300);

  // We deliberately do NOT auto-open the signup modal here. Cadence is
  // handled by maybeShowSignupModal() called from handleAsk() based on
  // questionCount, so users get a smooth read-flow on response #1-2.
}

// ── Insight Logging ───────────────────────────────────────────────────────
// Logs a topic tap or a Q&A pair to the admin insights table. The optional
// payload (verseRef / verseText / reflection) lets the /questions admin
// dashboard show the full response for anonymous traffic — not just the
// ~30% of signed-in chats. Empty values are fine; they preserve the
// existing topic-tap-only telemetry.
async function logInsight(topic, question = "", payload = {}) {
  try {
    // Tag signed-in traffic so the admin Q&A dashboard can split signed-in
    // vs anonymous totals without joining tables. Anonymous keeps the raw
    // session UUID; signed-in uses a `user-{id}` prefix.
    const sessionTag = (currentUser && currentUser.id)
      ? `user-${currentUser.id}`
      : SESSION_ID;
    await fetch(`${API_BASE}/api/insights/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        question,
        sessionId: sessionTag,
        churchId: churchId || null,
        location: "",
        verseRef:   payload.verseRef   || "",
        verseText:  payload.verseText  || "",
        reflection: payload.reflection || "",
      }),
    });
  } catch (e) {
    // Silently ignore — never block the user experience
  }
}

// ── Trending Strip ────────────────────────────────────────────────────────
async function loadTrending() {
  try {
    const url = churchId
      ? `${API_BASE}/api/insights/trending?churchId=${churchId}`
      : `${API_BASE}/api/insights/trending`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const trending = data.trending || [];
    if (!trending.length) return;

    const section = document.getElementById("trending-section");
    const chipsEl = document.getElementById("trending-chips");
    chipsEl.innerHTML = trending.map(t =>
      `<button class="trending-chip" data-topic="${t.topic}">${t.topic} <span style="opacity:0.6;font-size:0.72rem;">(${t.count})</span></button>`
    ).join("");
    section.style.display = "block";

    chipsEl.querySelectorAll(".trending-chip").forEach(btn => {
      btn.addEventListener("click", () => selectTopic(btn.dataset.topic));
    });
  } catch (e) {}
}

// ── Church Affiliation ────────────────────────────────────────────────────
let selectedChurch = null;
let searchDebounce = null;

// Open the first-visit modal in whichever state the feature flag selects.
// State A (flag off): "Stay connected" email+ZIP. State B (flag on): church search.
//
// Guard: never open on top of a signed-in user. The modal is a "first-visit
// signup nudge"; showing it after auth is a race-condition regression (a
// scheduled setTimeout in restoreAffiliation() firing after initAuth() has
// completed a magic-link verify). Since restoreAffiliation() runs in parallel
// with initAuth() and can't await it, we belt-and-suspenders here.
function openAffiliationModal() {
  if (currentUser && currentUser.id) {
    // Signed-in user — skip. Not a bug, just a race we lost cleanly.
    return;
  }
  const modal = document.getElementById("affiliation-modal");
  const stayConnected = document.getElementById("first-visit-stay-connected");
  const churchMatching = document.getElementById("first-visit-church-matching");
  if (FEATURE_CHURCH_MATCHING) {
    if (stayConnected) stayConnected.style.display = "none";
    if (churchMatching) churchMatching.style.display = "";
  } else {
    if (churchMatching) churchMatching.style.display = "none";
    const success = document.getElementById("stay-connected-success");
    if (success) success.style.display = "none";
    if (stayConnected) stayConnected.style.display = "";
    track("signup_modal_viewed", {});
  }
  modal.style.display = "flex";
}

function closeAffiliationModal() {
  document.getElementById("affiliation-modal").style.display = "none";
}

// ── Stay-connected (email + ZIP) modal ──────────────────────────────────────
const SIGNUP_COMPLETED_KEY = "signup_modal_completed";
const SIGNUP_DISMISSED_KEY = "signup_modal_dismissed_until";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}$/;

// Whether the stay-connected modal should be shown this visit. Suppressed
// permanently once completed, or temporarily until the dismissed-until time.
function shouldShowStayConnectedModal() {
  if (lsGet(SIGNUP_COMPLETED_KEY) === "1") return false;
  const until = lsGet(SIGNUP_DISMISSED_KEY);
  if (until) {
    const t = Date.parse(until);
    if (!isNaN(t) && Date.now() < t) return false;
  }
  return true;
}

function isoFromNow(ms) {
  return new Date(Date.now() + ms).toISOString();
}

async function submitStayConnected() {
  const emailEl = document.getElementById("stay-connected-email");
  const zipEl = document.getElementById("stay-connected-zip");
  const errEl = document.getElementById("stay-connected-error");
  const submitBtn = document.getElementById("btn-stay-connected-submit");
  const churchEl = document.getElementById("signup-home-church-input");
  const email = (emailEl?.value || "").trim();
  const zip = (zipEl?.value || "").trim();
  const homeChurch = (churchEl?.value || "").trim().slice(0, 200);

  const showErr = (msg) => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; }
  };

  if (!EMAIL_RE.test(email)) return showErr("Please enter a valid email address.");
  if (!ZIP_RE.test(zip)) return showErr("Please enter a 5-digit ZIP code.");
  if (errEl) errEl.style.display = "none";

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

  try {
    const body = { email, zip };
    if (currentUser && currentUser.id) body.userId = currentUser.id;
    if (homeChurch) body.homeChurchName = homeChurch;
    const res = await fetch(`${API_BASE}/api/member-signups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lsSet(SIGNUP_COMPLETED_KEY, "1");
    // Don't send the church name itself to analytics — privacy. Just whether one was given.
    track("signup_modal_submitted", { has_user: !!(currentUser && currentUser.id), has_home_church: !!homeChurch });
    loadTrending();
    // The signup is saved. Now also fire a magic-link sign-in email so this form
    // double-purposes as account creation (same endpoint Sign Up uses, which
    // persists the profile). If this part fails the signup still stands, so we
    // show success with fallback copy rather than erroring the whole flow.
    const magicSent = await sendStayConnectedMagicLink(email, homeChurch, zip);
    showStayConnectedSuccess(email, magicSent);
  } catch (e) {
    console.warn("member signup failed:", e?.message);
    showErr("Something went wrong. Please try again.");
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save my spot"; }
  }
}

// Fires the magic-link sign-in email for the stay-connected flow. Returns true
// on success, false on any failure (caller falls back to "couldn't send" copy).
// Separate from handleSendMagicLink (which reads the Sign Up modal's inputs).
async function sendStayConnectedMagicLink(email, homeChurch, zip) {
  try {
    const body = { email };
    if (homeChurch) body.homeChurchName = homeChurch;
    if (zip) body.zipCode = zip;
    const res = await fetch(`${API_BASE}/api/user/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    track("stay_connected_magic_link_sent", { has_home_church: !!homeChurch });
    return true;
  } catch (e) {
    console.warn("stay-connected magic link failed:", e?.message);
    return false;
  }
}

// Swaps the stay-connected form out for an in-modal "You're on the list" panel.
// Replaces the old toast, which silently no-op'd on first visit (the toast
// target #response-card doesn't exist before the user asks a question).
// `magicSent` toggles between the sign-in-link copy (with a "Send again" resend)
// and the fallback copy shown when the magic-link email couldn't be sent.
function showStayConnectedSuccess(email, magicSent) {
  const form = document.getElementById("first-visit-stay-connected");
  if (form) form.style.display = "none";
  const emailEl = document.getElementById("stay-connected-success-email");
  if (emailEl) emailEl.textContent = email;
  const sentCopy = document.getElementById("stay-connected-success-sent");
  const fallbackCopy = document.getElementById("stay-connected-success-fallback");
  const resend = document.getElementById("stay-connected-resend");
  if (magicSent) {
    if (sentCopy) sentCopy.style.display = "";
    if (fallbackCopy) fallbackCopy.style.display = "none";
    if (resend) resend.style.display = "";
    startStayConnectedResendCooldown();
  } else {
    // Couldn't send the sign-in link — keep success (signup is saved) but hide
    // the resend affordance, since there's nothing to resend.
    if (sentCopy) sentCopy.style.display = "none";
    if (fallbackCopy) fallbackCopy.style.display = "";
    if (resend) resend.style.display = "none";
  }
  const panel = document.getElementById("stay-connected-success");
  if (panel) panel.style.display = "";
}

// Close button on the success panel: hide the modal and restore the form so a
// re-open (e.g. State B, or a future visit) starts clean.
function closeStayConnectedSuccess() {
  clearStayConnectedResendCooldown();
  const panel = document.getElementById("stay-connected-success");
  if (panel) panel.style.display = "none";
  const form = document.getElementById("first-visit-stay-connected");
  if (form) form.style.display = "";
  closeAffiliationModal();
}

// Resend cooldown for the stay-connected "Send again" link. Mirrors the magic-
// link modal's startResendCooldown (commit 5af9a72) but targets its own ids and
// timer, and re-fires ONLY the magic link (the member-signup is already saved).
let stayConnectedResendTimer = null;

function clearStayConnectedResendCooldown() {
  if (stayConnectedResendTimer) { clearInterval(stayConnectedResendTimer); stayConnectedResendTimer = null; }
}

function startStayConnectedResendCooldown() {
  const link = document.getElementById("btn-resend-stay-connected");
  const counter = document.getElementById("stay-connected-resend-countdown");
  clearStayConnectedResendCooldown();
  let remaining = RESEND_COOLDOWN_SECONDS;
  const render = () => {
    if (remaining > 0) {
      if (link) link.setAttribute("aria-disabled", "true");
      if (counter) counter.textContent = `(send again in ${remaining}s)`;
    } else {
      clearStayConnectedResendCooldown();
      if (link) link.removeAttribute("aria-disabled");
      if (counter) counter.textContent = "";
    }
  };
  render();
  stayConnectedResendTimer = setInterval(() => { remaining -= 1; render(); }, 1000);
}

// "Send again" on the stay-connected success panel — re-fires only the magic
// link (member-signup already saved) using the still-populated form inputs,
// then restarts the cooldown.
async function handleResendStayConnected(e) {
  if (e) e.preventDefault();
  const link = document.getElementById("btn-resend-stay-connected");
  if (link && link.getAttribute("aria-disabled") === "true") return;
  const emailEl = document.getElementById("stay-connected-email");
  const zipEl = document.getElementById("stay-connected-zip");
  const churchEl = document.getElementById("signup-home-church-input");
  const email = (emailEl?.value || "").trim();
  const zip = (zipEl?.value || "").trim();
  const homeChurch = (churchEl?.value || "").trim().slice(0, 200);
  if (!EMAIL_RE.test(email)) return;
  await sendStayConnectedMagicLink(email, homeChurch, zip);
  startStayConnectedResendCooldown();
}

// "Not now" — suppress for 7 days.
function dismissStayConnectedNotNow() {
  lsSet(SIGNUP_DISMISSED_KEY, isoFromNow(7 * 24 * 60 * 60 * 1000));
  track("signup_modal_dismissed_not_now", {});
  closeAffiliationModal();
  loadTrending();
}

// X close / outside click — suppress for 24 hours (shorter than "Not now").
function dismissStayConnectedX() {
  lsSet(SIGNUP_DISMISSED_KEY, isoFromNow(24 * 60 * 60 * 1000));
  track("signup_modal_dismissed_x", {});
  closeAffiliationModal();
  loadTrending();
}

function setSelectedChurch(church) {
  selectedChurch = church;
  const badge = document.getElementById("selected-church-badge");
  if (church) {
    badge.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      ${church.name}${church.location ? ` · ${church.location}` : ""}
      <span class="badge-clear" id="clear-church">Change</span>
    `;
    badge.style.display = "flex";
    document.getElementById("clear-church").addEventListener("click", () => {
      selectedChurch = null;
      badge.style.display = "none";
      document.getElementById("church-search-input").value = "";
      document.getElementById("btn-confirm-affiliation").disabled = true;
    });
    document.getElementById("btn-confirm-affiliation").disabled = false;
  } else {
    badge.style.display = "none";
    document.getElementById("btn-confirm-affiliation").disabled = true;
  }
}

async function searchChurches(q) {
  if (!q.trim()) {
    document.getElementById("church-search-results").style.display = "none";
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/churches/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const churches = await res.json();
    // Analytics: detect zip-code-style queries (5 digits) so we can already
    // start measuring location-based intent before the dedicated Find-a-Home-
    // Church (zip radius) feature ships. TODO: when zip search lands, fire a
    // dedicated `find_church_searched` event with { zip, radius_miles, results_count }.
    const trimmed = q.trim();
    const zipMatch = trimmed.match(/^\d{5}$/);
    track("church_searched", {
      query_length: trimmed.length,
      looks_like_zip: !!zipMatch,
      zip: zipMatch ? trimmed : undefined,
      results_count: Array.isArray(churches) ? churches.length : 0,
    });
    renderChurchResults(churches, document.getElementById("church-search-results"));
  } catch (e) {}
}

function renderChurchResults(churches, container) {
  if (!churches.length) {
    container.innerHTML = `<div class="church-results-empty">No churches found</div>`;
  } else {
    container.innerHTML = churches.map(c => `
      <div class="church-result-item" data-id="${c.id}" data-name="${c.name}" data-location="${c.location || ""}">
        <strong>${c.name}</strong>
        ${c.location ? `<span>${c.location}</span>` : ""}
      </div>
    `).join("");
    container.querySelectorAll(".church-result-item").forEach(item => {
      item.addEventListener("click", () => {
        setSelectedChurch({ id: Number(item.dataset.id), name: item.dataset.name, location: item.dataset.location });
        container.style.display = "none";
        document.getElementById("church-search-input").value = item.dataset.name;
      });
    });
  }
  container.style.display = "block";
}

async function findNearbyChurches() {
  const statusEl = document.getElementById("location-status");
  const nearbyEl = document.getElementById("nearby-churches-list");
  statusEl.textContent = "Requesting location…";
  if (!navigator.geolocation) {
    statusEl.textContent = "Geolocation not available";
    return;
  }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    statusEl.textContent = "Searching nearby…";
    try {
      const { latitude: lat, longitude: lng } = pos.coords;
      const res = await fetch(`${API_BASE}/api/churches/nearby?lat=${lat}&lng=${lng}`);
      if (!res.ok) throw new Error("Failed");
      const churches = await res.json();
      statusEl.textContent = churches.length ? `${churches.length} found` : "None nearby";
      if (churches.length) {
        nearbyEl.innerHTML = churches.slice(0, 5).map(c => `
          <div class="church-result-item" data-id="${c.id}" data-name="${c.name}" data-location="${c.location || ""}">
            <strong>${c.name}</strong>
            ${c.location ? `<span>${c.location}</span>` : ""}
          </div>
        `).join("");
        nearbyEl.style.display = "flex";
        nearbyEl.querySelectorAll(".church-result-item").forEach(item => {
          item.addEventListener("click", () => {
            setSelectedChurch({ id: Number(item.dataset.id), name: item.dataset.name, location: item.dataset.location });
            document.getElementById("church-search-input").value = item.dataset.name;
          });
        });
      }
    } catch (e) {
      statusEl.textContent = "Could not load churches";
    }
  }, () => { statusEl.textContent = "Location access denied"; });
}

async function confirmAffiliation() {
  if (!selectedChurch) return;
  try {
    await fetch(`${API_BASE}/api/affiliations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        churchId: selectedChurch.id,
        firstName: "",
        email: "",
        location: "",
      }),
    });
    churchId   = selectedChurch.id;
    churchName = selectedChurch.name;
    showChurchBadgeHeader();
    closeAffiliationModal();
    loadTrending();
  } catch (e) {
    closeAffiliationModal();
  }
}

function showChurchBadgeHeader() {
  const badge = document.getElementById("church-badge-header");
  if (churchName) {
    badge.textContent = "⛪ " + churchName;
    badge.style.display = "block";
  }
}

// ── Topic Selection ────────────────────────────────────────────────────────
// In v2 mode chips PRE-FILL the text input (the user clicks Ask to submit).
// This is the structural fix for the canned-response problem: chips become
// suggestions, not categories. In v1 (rollback) mode chips still submit
// directly, preserving the legacy UX in case we have to fall back.
async function selectTopic(topic) {
  if (isLoading) return;
  currentTopic = topic;

  // Highlight active button
  document.querySelectorAll(".topic-btn").forEach(b => b.classList.remove("active"));
  const activeBtn = document.querySelector(`[data-topic="${topic}"]`);
  if (activeBtn) activeBtn.classList.add("active");

  if (USE_AI_V2) {
    // Pre-fill the input with a question template; user edits + clicks Ask.
    const input = document.getElementById("question-input");
    const suggestion = topicQuestionSuggestion(topic);
    input.value = suggestion;
    input.focus();
    input.setSelectionRange(suggestion.length, suggestion.length);
    document.getElementById("btn-ask").disabled = false;
    document.getElementById("char-hint").textContent = `${suggestion.length} chars`;
    return;
  }

  // Legacy v1 path: chip click submits directly
  await showResponse(topic, "");
  logInsight(topic, "");
}

// Map a topic chip label to a suggested question the user might want to ask.
// Designed to feel like a real first-person question, not a category restatement.
function topicQuestionSuggestion(topic) {
  const map = {
    "Anxiety":     "I'm feeling anxious about something specific — ",
    "Forgiveness": "How do I forgive someone when ",
    "Faith":       "My faith feels shaky right now because ",
    "Prayer":      "I'm struggling with prayer because ",
    "Peace":       "How can I find peace when ",
    "Love":        "What does the Bible say about loving ",
    "Hope":        "I'm losing hope about ",
    "Temptation":  "I'm being tempted by ",
    "Suffering":   "I'm going through ",
    "Salvation":   "I have a question about salvation \u2014 ",
    "Anger":       "I'm angry about ",
    "Wisdom":      "I need wisdom about ",
  };
  return map[topic] || `Help me understand what the Bible says about ${topic.toLowerCase()} — `;
}

// ── Response Display ───────────────────────────────────────────────────────
async function showResponse(topic, question) {
  isLoading = true;
  // Reset reaction + chatId state for this new response. saveChatToHistory will
  // set a new currentChatId once the chat is persisted server-side.
  currentChatId = null;
  currentChatReaction = null;
  const section  = document.getElementById("response-section");
  const content  = document.getElementById("response-content");
  const topicTag = document.getElementById("response-topic-tag");
  const chips    = document.getElementById("follow-up-chips");
  const askBtn   = document.getElementById("btn-ask-another");

  topicTag.innerHTML = `<span>${TOPICS.find(t => t.label === topic)?.emoji || "✝️"}</span> ${topic}`;
  content.innerHTML = `<div class="response-loading"><div class="dot-flashing"><span></span><span></span><span></span></div><p>${USE_AI_V2 ? "Searching scripture…" : "Finding scripture…"}</p></div>`;
  chips.style.display = "none";
  askBtn.style.display = "none";
  section.style.display = "block";

  setTimeout(() => section.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

  // v2 path: question-led, multi-citation, Sonnet 4.5.
  // Only valid when there's actual question text — a topic with empty
  // question on the v1 path means "surprise me" which v2 doesn't support.
  if (USE_AI_V2 && question) {
    try {
      const data = await fetchV2Ask(question, topic);
      // Crisis interception: render the safety card and stop. Do NOT persist
      // the chat or log an insight — no message content is stored on this path.
      if (renderCrisisIfPresent(data)) {
        askBtn.style.display = "block";
        isLoading = false;
        return;
      }
      v2LastQuestion = question;
      v2LastResponse = data;
      // currentVerse points to citation[0] so the existing share button
      // shape still works for the most-relevant passage.
      currentVerse = data.citations[0] ? { ref: data.citations[0].ref, text: data.citations[0].text } : null;
      content.innerHTML = buildV2ResponseHTML(question, data);
      wireV2DrillDowns();
      renderFollowUpChipsFromList(data.followUps || []);
      renderShareButton();
      if (currentVerse) saveChatToHistory(topic, question, currentVerse, data.answer);
      // Admin Q&A dashboard — log the response payload for all traffic.
      logInsight(topic, question, {
        verseRef:   currentVerse ? currentVerse.ref  : "",
        verseText:  currentVerse ? currentVerse.text : "",
        reflection: data.answer || "",
      });
      askBtn.style.display = "block";
      isLoading = false;
      renderActionButtons();
      return;
    } catch (err) {
      // Fall through to legacy v1 path. Logged so we can spot regressions
      // in the soft-launch window.
      console.warn("v2 ask failed, falling back to v1:", err.message);
    }
  }

  try {
    const aiData = await fetchAIResponse(topic, question);
    // Crisis interception on the legacy path too. Stop before any persistence.
    if (renderCrisisIfPresent(aiData)) {
      askBtn.style.display = "block";
      isLoading = false;
      return;
    }
    const verse      = aiData.verse      || getFallbackResponse(topic).verse;
    const reflection = aiData.reflection || getFallbackResponse(topic).reflection;
    const followUps  = aiData.followUpTopics || FOLLOW_UP[topic] || [];
    content.innerHTML = buildResponseHTML(topic, question, verse, reflection);
    renderFollowUpChipsFromList(followUps);
    renderShareButton();
    saveChatToHistory(topic, question, verse, reflection);
    // Admin Q&A dashboard — log the response payload for all traffic.
    if (question) {
      logInsight(topic, question, {
        verseRef:   verse ? verse.ref  : "",
        verseText:  verse ? verse.text : "",
        reflection: reflection || "",
      });
    }
  } catch (err) {
    console.error("AI error, using fallback:", err.message);
    const fallback = getFallbackResponse(topic);
    content.innerHTML = buildResponseHTML(topic, question, fallback.verse, fallback.reflection);
    renderFollowUpChips(topic);
    renderShareButton();
    saveChatToHistory(topic, question, fallback.verse, fallback.reflection);
    if (question) {
      logInsight(topic, question, {
        verseRef:   fallback.verse ? fallback.verse.ref  : "",
        verseText:  fallback.verse ? fallback.verse.text : "",
        reflection: fallback.reflection || "",
      });
    }
  }

  askBtn.style.display = "block";
  isLoading = false;
  renderActionButtons();
}

function renderFollowUpChips(topic) {
  renderFollowUpChipsFromList(FOLLOW_UP[topic] || []);
}

function renderFollowUpChipsFromList(followUps) {
  const chips = document.getElementById("follow-up-chips");
  if (!followUps.length) return;
  chips.innerHTML = followUps.map(f =>
    `<button class="chip" data-topic="${f}">${f}</button>`
  ).join("");
  chips.style.display = "flex";
  chips.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const chipTopic = btn.dataset.topic;
      const match = TOPICS.find(t => t.label.toLowerCase() === chipTopic.toLowerCase());
      const finalTopic = match ? match.label : (currentTopic || "Faith");
      document.querySelectorAll(".topic-btn").forEach(b => b.classList.remove("active"));
      const activeBtn = document.querySelector(`[data-topic="${finalTopic}"]`);
      if (activeBtn) activeBtn.classList.add("active");
      currentTopic = finalTopic;
      // logInsight fires inside showResponse() once the response payload is ready.
      showResponse(finalTopic, chipTopic);
    });
  });
}

// ── Share Verse Button ───────────────────────────────────────────────────
function renderShareButton() {
  const existing = document.getElementById("btn-share-verse");
  if (existing) existing.remove();
  // v2: render whenever we have a response, even if citations are empty.
  // v1: require currentVerse (existing behavior).
  const hasV2 = USE_AI_V2 && v2LastResponse && v2LastResponse.answer;
  if (!hasV2 && !currentVerse) return;

  const btn = document.createElement("button");
  btn.id = "btn-share-verse";
  btn.className = "btn-share-verse";
  btn.setAttribute("data-testid", "button-share-verse");
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
    ${USE_AI_V2 && v2LastResponse ? "Share this answer" : "Share this verse"}
  `;
  btn.addEventListener("click", shareVerse);

  // Insert before the follow-up chips
  const chips = document.getElementById("follow-up-chips");
  chips.parentNode.insertBefore(btn, chips);
}

// Build the share payload. On v2, include the pastoral answer + top 2
// citations + link back to My Shepherd. On v1, keep the single-verse format.
function buildShareText() {
  const APP_URL = "https://www.myshepherdapp.church";
  if (USE_AI_V2 && v2LastResponse && v2LastResponse.answer) {
    const answer = v2LastResponse.answer.trim();
    const top = (v2LastResponse.citations || []).slice(0, 2);
    const citationLines = top.map(c => `"${c.text}" — ${c.ref}`).join("\n\n");
    return [
      answer,
      citationLines,
      `From My Shepherd: ${APP_URL}`
    ].filter(Boolean).join("\n\n");
  }
  if (!currentVerse) return "";
  return `"${currentVerse.text}" — ${currentVerse.ref}\n\nFrom My Shepherd: ${APP_URL}`;
}

async function shareVerse() {
  const text = buildShareText();
  if (!text) return;
  const title = (USE_AI_V2 && v2LastResponse) ? "My Shepherd — Answer & Scripture" : "My Shepherd — Scripture";

  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      incrementPositive("share");
      return;
    } catch (e) { /* fall through to clipboard */ }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    incrementPositive("share");
    const btn = document.getElementById("btn-share-verse");
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Copied to clipboard!
      `;
      btn.style.borderColor = "var(--brown)";
      btn.style.color = "var(--brown)";
      setTimeout(() => { btn.innerHTML = orig; btn.style.borderColor = ""; btn.style.color = ""; }, 2200);
    }
  } catch (e) {
    // Last resort: open a pre-filled share URL
    const tweetText = (USE_AI_V2 && v2LastResponse?.answer)
      ? v2LastResponse.answer.slice(0, 240) + " (via @MyShepherdApp)"
      : (currentVerse ? currentVerse.text.slice(0,200) + " — " + currentVerse.ref + " (via @MyShepherdApp)" : "");
    if (tweetText) window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`, "_blank", "noopener");
  }
}

// ── Topic Grid Render ──────────────────────────────────────────────────────
function renderTopicGrid() {
  const grid = document.getElementById("topics-grid");
  grid.innerHTML = TOPICS.map(t => `
    <button class="topic-btn" data-topic="${t.label}" data-testid="topic-${t.label.toLowerCase()}">
      <span class="topic-emoji">${t.emoji}</span>
      ${t.label}
    </button>
  `).join("");
  grid.querySelectorAll(".topic-btn").forEach(btn => {
    btn.addEventListener("click", () => selectTopic(btn.dataset.topic));
  });
}

// ── Ask question handler ───────────────────────────────────────────────────
async function handleAsk() {
  const input = document.getElementById("question-input");
  const q = input.value.trim();
  if (!q || isLoading) return;

  // Try to detect topic from question text
  const lq = q.toLowerCase();
  const detected = TOPICS.find(t => lq.includes(t.label.toLowerCase())) || null;
  const topic = detected ? detected.label : (currentTopic || "Faith");

  document.querySelectorAll(".topic-btn").forEach(b => b.classList.remove("active"));
  const activeBtn = document.querySelector(`[data-topic="${topic}"]`);
  if (activeBtn) activeBtn.classList.add("active");
  currentTopic = topic;

  questionCount++;
  // logInsight fires inside showResponse() once the response payload is ready,
  // so the admin Q&A dashboard captures the full Q+verse+reflection.
  await showResponse(topic, q);
  input.value = "";
  document.getElementById("char-hint").textContent = "";

  // Soft signup prompt: first show at Q3, then re-prompt every +5 if dismissed.
  maybeShowSignupModal();
}

// Decide whether to show the signup modal after this question.
// Rules:
//   - User is not signed in
//   - questionCount has hit 3, OR is >= lastSignupPromptedAt + 5 if previously dismissed
function maybeShowSignupModal() {
  if (currentUser && currentUser.id) return;
  if (questionCount < 3) return;
  if (lastSignupPromptedAt > 0 && questionCount < lastSignupPromptedAt + 5) return;
  if (questionCount === lastSignupPromptedAt) return;
  lastSignupPromptedAt = questionCount;
  // Delay so the response renders + user has time to read before modal appears
  setTimeout(() => openSignupModal("cadence"), 4500);
}

// ── Auth + Signup + Donations ──────────────────────────────────────────────
function parseHashParams() {
  const out = {};
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return out;
  const qs = hash.slice(qIdx + 1);
  qs.split("&").forEach(p => {
    const [k, v] = p.split("=");
    if (k) out[k] = decodeURIComponent(v || "");
  });
  return out;
}

function setHashParam(key, value) {
  const params = parseHashParams();
  if (value === null || value === undefined || value === "") {
    delete params[key];
  } else {
    params[key] = value;
  }
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const newHash = qs ? `#?${qs}` : "";
  window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
}

// Match mobile browsers so we can hand magic-link tokens to the native app
// instead of consuming them on the web. Ignores tablets (iPad Safari reports
// as "Macintosh" in modern iPadOS) — the current native app targets phones.
function isPhoneUserAgent() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPhone or iPod (never iPad — we ship iPhone-first for MVP)
  if (/iPhone|iPod/i.test(ua)) return true;
  // Android phones. "Mobile" in UA distinguishes phone from tablet.
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
  return false;
}

async function initAuth() {
  const params = parseHashParams();

  // Mobile magic-link handoff: if the user tapped the magic link on a phone,
  // deep-link the token into the native app instead of verifying it here.
  // The web verify endpoint consumes the token on success, so we MUST NOT
  // fetch it before the deep-link redirect. `?web=1` (or `&web=1`) is the
  // escape hatch our fallback UI uses to continue in the browser instead.
  if (params.magic && isPhoneUserAgent() && !params.web) {
    // Preserve the raw token to hand to the app.
    const rawToken = params.magic;
    // Strip the token from the web URL so a browser back-nav won't retry it.
    setHashParam("magic", null);
    // Replace location with the custom scheme. If the app is installed, the
    // OS opens it and this page unloads. If not, nothing happens visibly and
    // we fall through to a visible "Open in app / Install" panel.
    const appUrl = `myshepherd://verify?token=${encodeURIComponent(rawToken)}`;
    window.location.href = appUrl;
    // If the app isn't installed the OS silently swallows the scheme; give
    // the user a fallback UI after a beat so they aren't stuck on a blank
    // page holding a now-used-but-still-valid-for-15min token.
    setTimeout(() => {
      try { showMobileMagicLinkFallback(rawToken); } catch { /* no-op */ }
    }, 1200);
    return;
  }

  if (params.magic) {
    try {
      const res = await fetch(`${API_BASE}/api/user/verify?token=${encodeURIComponent(params.magic)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.user) {
          currentUser = data.user;
          mergePositiveCountOnSignIn(currentUser.id);
          setHashParam("magic", null);
          setHashParam("u", null);
          setHashParam("e", null);
          showSignedInUI();
          identifyUser(currentUser);
          track("signup_or_login", { method: "magic_link", user_id: currentUser.id });
          setTimeout(() => showInlineToast(`Signed in as ${currentUser.email}`), 600);
          resolveSignupReturnIntent();
          return;
        }
      }
      setHashParam("magic", null);
      console.warn("Magic link verification failed (invalid or expired)");
    } catch (e) {
      console.warn("Magic link verify request failed:", e?.message);
    }
  }

  // Existing URL-hash sessions are intentionally not trusted. They must
  // re-authenticate once, then receive the secure cookie-backed session.
  if (params.u || params.e) {
    setHashParam("u", null);
    setHashParam("e", null);
  }
  try {
    const res = await fetch(`${API_BASE}/api/user/me`, { credentials: "include" });
    if (res.ok) {
      const user = await res.json();
      if (user && user.id) {
        currentUser = user;
        mergePositiveCountOnSignIn(currentUser.id);
        showSignedInUI();
        identifyUser(currentUser);
        track("session_restored", { user_id: currentUser.id });
        return;
      }
    }
  } catch (e) {
    console.warn("Restore cookie session failed:", e?.message);
  }
  /*
  if (params.u && params.e) {
    try {
      const res = await fetch(`${API_BASE}/api/user/me?userId=${encodeURIComponent(params.u)}`);
      if (res.ok) {
        const user = await res.json();
        if (user && user.id) {
          currentUser = user;
          mergePositiveCountOnSignIn(currentUser.id);
          showSignedInUI();
          identifyUser(currentUser);
          track("session_restored", { user_id: currentUser.id });
          return;
        }
      }
      setHashParam("u", null);
      setHashParam("e", null);
    } catch (e) {
      console.warn("Restore user from hash failed:", e?.message);
    }
  }*/

  if (params.donation === "success") {
    setTimeout(showDonationThankYou, 500);
    setHashParam("donation", null);
    setHashParam("sid", null);
  } else if (params.donation === "cancel") {
    setHashParam("donation", null);
  }
}

// After a Donate-triggered Sign Up completes, resume the donation flow.
// The intent may live in memory (same-tab) or localStorage (magic-link email
// round-trip lands on a fresh page load). Consume it so it fires only once.
function resolveSignupReturnIntent() {
  if (!currentUser || !currentUser.id) return;
  const intent = signupReturnIntent || lsGet(SIGNUP_RETURN_INTENT_KEY);
  if (intent !== "donate") return;
  signupReturnIntent = null;
  lsRemove(SIGNUP_RETURN_INTENT_KEY);
  track("signup_intent_resolved", { intent: "donate" });
  // Small delay so the "Signed in as…" toast and signed-in UI settle first.
  setTimeout(() => showDonationModal("post_signup_donate_intent"), 800);
}

function showSignedInUI() {
  const signInBtn = document.getElementById("btn-sign-in-header");
  if (signInBtn) signInBtn.style.display = "none";
  const signUpBtn = document.getElementById("btn-sign-up-header");
  if (signUpBtn) signUpBtn.style.display = "none";
  const menu = document.getElementById("user-avatar-menu");
  if (menu) menu.style.display = "";
  const avatarBtn = document.getElementById("btn-user-avatar");
  if (avatarBtn && currentUser?.email) {
    avatarBtn.textContent = currentUser.email.charAt(0).toUpperCase();
  }
  const emailLbl = document.getElementById("user-dropdown-email");
  if (emailLbl && currentUser?.email) emailLbl.textContent = currentUser.email;
  const heart = document.getElementById("btn-donate-heart");
  if (heart) heart.style.display = "";
}

function showSignedOutUI() {
  const signInBtn = document.getElementById("btn-sign-in-header");
  if (signInBtn) signInBtn.style.display = "";
  const signUpBtn = document.getElementById("btn-sign-up-header");
  if (signUpBtn) signUpBtn.style.display = "";
  const menu = document.getElementById("user-avatar-menu");
  if (menu) menu.style.display = "none";
  const heart = document.getElementById("btn-donate-heart");
  if (heart) heart.style.display = "none";
}

function signOut() {
  track("sign_out");
  resetAnalytics();
  currentUser = null;
  setHashParam("u", null);
  setHashParam("e", null);
  showSignedOutUI();
  const dd = document.getElementById("user-dropdown");
  if (dd) dd.style.display = "none";
  // If History tab is currently visible, refresh it to show the signed-out state
  const histTab = document.getElementById("tab-history");
  if (histTab && histTab.style.display !== "none") renderHistoryTab();
}

// Mode: 'signin' (returning user) or 'signup' (new user).
// Affects modal title, subtitle, button label, and toggle link copy.
let currentAuthMode = "signin";

// Once the magic link is sent we show the "Check your inbox" state. It is
// sticky — mode toggling is suppressed until the user closes / reopens.
let inSuccessState = false;
const RESEND_COOLDOWN_SECONDS = 30;
let resendTimer = null;

function setAuthMode(mode) {
  // The success state has no form to re-style; don't let a stray toggle reset it.
  if (inSuccessState) return;
  currentAuthMode = mode === "signup" ? "signup" : "signin";
  const title = document.getElementById("login-modal-title");
  const subtitle = document.querySelector("#login-modal .modal-subtitle");
  const sendBtn = document.getElementById("btn-send-magic-link");
  const toggleText = document.getElementById("login-modal-mode-toggle-text");
  const toggleLink = document.getElementById("login-modal-mode-toggle-link");
  const homeChurchWrap = document.getElementById("signup-home-church-modal-wrap");
  const zipWrap = document.getElementById("signup-zip-modal-wrap");
  const intentBanner = document.getElementById("signup-intent-banner");
  const isSignup = currentAuthMode === "signup";
  // ZIP + home church capture (input + helper copy) only appear when creating an account.
  if (zipWrap) zipWrap.style.display = isSignup ? "" : "none";
  if (homeChurchWrap) homeChurchWrap.style.display = isSignup ? "" : "none";
  // Donate-intent banner: only in Sign Up mode, and only when that intent is set.
  if (intentBanner) intentBanner.style.display = (isSignup && signupReturnIntent === "donate") ? "block" : "none";
  if (currentAuthMode === "signup") {
    if (title) title.textContent = "Create your My Shepherd account";
    if (subtitle) subtitle.textContent = "Save your scripture history and pick up where you left off on any device.";
    if (sendBtn) sendBtn.textContent = "Send Sign-Up Link";
    if (toggleText) toggleText.textContent = "Already have an account?";
    if (toggleLink) toggleLink.textContent = "Sign in here";
  } else {
    if (title) title.textContent = "Sign in to My Shepherd";
    if (subtitle) subtitle.textContent = "Welcome back \u2014 enter your email and we\u2019ll send a one-tap sign-in link.";
    if (sendBtn) sendBtn.textContent = "Send Sign-In Link";
    if (toggleText) toggleText.textContent = "New to My Shepherd?";
    if (toggleLink) toggleLink.textContent = "Sign up here";
  }
}

function openLoginModal() {
  setAuthMode("signin");
  openSignupModal("manual_signin");
}

function openSignupFlow() {
  setAuthMode("signup");
  openSignupModal("manual_signup");
}

function openSignupModal(trigger) {
  if (currentUser && currentUser.id) return;
  const modal = document.getElementById("login-modal");
  if (!modal) return;

  const subtitle = modal.querySelector(".modal-subtitle");
  // For manual_signin / manual_signup, setAuthMode() owns the title + subtitle copy.
  // For automatic triggers (reaction, cadence), use the contextual nudge copy.
  if (subtitle && trigger !== "manual_signin" && trigger !== "manual_signup") {
    if (trigger === "reaction") {
      subtitle.textContent = "Save this scripture and all your future chats — we'll send a one-tap sign-in link to your email.";
    } else if (trigger === "cadence") {
      subtitle.textContent = "You've been exploring a lot. Save your scripture history so you can come back to it anytime.";
    } else {
      subtitle.textContent = "Save your scripture history and pick up where you left off on any device.";
    }
  }

  resetMagicLinkState();

  modal.style.display = "flex";
}

// Resets the modal from the "Check your inbox" success state back to the form,
// restoring the mode toggle + skip button and clearing any resend cooldown.
function resetMagicLinkState() {
  inSuccessState = false;
  clearResendCooldown();
  const sentEl = document.getElementById("magic-link-sent");
  if (sentEl) sentEl.style.display = "none";
  const form = document.getElementById("magic-link-form");
  if (form) form.style.display = "";
  const toggle = document.getElementById("login-modal-mode-toggle");
  if (toggle) toggle.style.display = "";
  const skip = document.getElementById("btn-skip-login");
  if (skip) skip.style.display = "";
  const errEl = document.getElementById("signup-modal-error");
  if (errEl) errEl.style.display = "none";
  const sendBtn = document.getElementById("btn-send-magic-link");
  if (sendBtn) {
    sendBtn.disabled = false;
    // Respect the current auth mode so manual Sign-Up flow keeps its label.
    sendBtn.textContent = currentAuthMode === "signup" ? "Send Sign-Up Link" : "Send Sign-In Link";
  }
}

function closeLoginModal() {
  clearResendCooldown();
  // Clear the sticky flag so the next openLoginModal/openSignupFlow can set the
  // auth mode (setAuthMode early-returns while inSuccessState is true).
  inSuccessState = false;
  const modal = document.getElementById("login-modal");
  if (modal) modal.style.display = "none";
}

// Explicit cancel (user clicks "Continue without signing in"). Abandons any
// pending return-intent so we don't auto-open the donation modal later.
// NB: plain closeLoginModal() preserves the intent — sending the magic link
// closes the form but the intent must survive the email round-trip.
function cancelSignupFlow() {
  signupReturnIntent = null;
  lsRemove(SIGNUP_RETURN_INTENT_KEY);
  closeLoginModal();
}

async function handleSendMagicLink() {
  const input = document.getElementById("magic-email-input");
  const btn = document.getElementById("btn-send-magic-link");
  const errEl = document.getElementById("signup-modal-error");
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  if (errEl) errEl.style.display = "none";
  const email = (input?.value || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    input?.focus();
    return;
  }

  const body = { email };
  // Only carry ZIP + home church through the Sign Up flow; persisted on user creation.
  if (currentAuthMode === "signup") {
    const zipEl = document.getElementById("signup-zip-modal-input");
    const zip = (zipEl?.value || "").trim();
    // ZIP is optional, but if the user typed something it must be 5 digits
    // (same regex/UX as the stay-connected modal).
    if (zip && !ZIP_RE.test(zip)) {
      showErr("Please enter a 5-digit ZIP code, or leave it blank.");
      zipEl?.focus();
      return;
    }
    if (zip) body.zipCode = zip;
    const churchEl = document.getElementById("signup-home-church-modal-input");
    const homeChurch = (churchEl?.value || "").trim().slice(0, 200);
    if (homeChurch) body.homeChurchName = homeChurch;
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Sending…";
  try {
    const res = await fetch(`${API_BASE}/api/user/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    btn.textContent = originalText;
    btn.disabled = false;
    showMagicLinkSent(email);
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert("Sorry, we couldn't send your sign-in link. Please try again.");
    console.warn("magic link request failed:", e?.message);
  }
}

// Swaps the form out for the "Check your inbox" success panel and starts the
// resend cooldown. Sticky until the user clicks Close (or reopens the modal).
function showMagicLinkSent(email) {
  inSuccessState = true;
  const form = document.getElementById("magic-link-form");
  if (form) form.style.display = "none";
  const toggle = document.getElementById("login-modal-mode-toggle");
  if (toggle) toggle.style.display = "none";
  const skip = document.getElementById("btn-skip-login");
  if (skip) skip.style.display = "none";
  const emailEl = document.getElementById("magic-sent-email");
  if (emailEl) emailEl.textContent = email;
  const sentEl = document.getElementById("magic-link-sent");
  if (sentEl) sentEl.style.display = "";
  startResendCooldown();
}

function clearResendCooldown() {
  if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
}

// Disables "Send again" for RESEND_COOLDOWN_SECONDS, counting down each second,
// then re-enables it as a clickable link.
function startResendCooldown() {
  const link = document.getElementById("btn-resend-magic-link");
  const counter = document.getElementById("magic-resend-countdown");
  clearResendCooldown();
  let remaining = RESEND_COOLDOWN_SECONDS;
  const render = () => {
    if (remaining > 0) {
      if (link) link.setAttribute("aria-disabled", "true");
      if (counter) counter.textContent = `(send again in ${remaining}s)`;
    } else {
      clearResendCooldown();
      if (link) link.removeAttribute("aria-disabled");
      if (counter) counter.textContent = "";
    }
  };
  render();
  resendTimer = setInterval(() => { remaining -= 1; render(); }, 1000);
}

// "Send again" — re-fires the magic link for the same email (handleSendMagicLink
// reads the still-populated email input) and restarts the cooldown.
function handleResendMagicLink(e) {
  if (e) e.preventDefault();
  const link = document.getElementById("btn-resend-magic-link");
  if (link && link.getAttribute("aria-disabled") === "true") return;
  // The form is hidden but its inputs keep their values, so handleSendMagicLink
  // re-reads the same email and re-enters showMagicLinkSent on success.
  handleSendMagicLink();
}

const DONATION_AMOUNTS = [
  { cents: 300, label: "$3" },
  { cents: 500, label: "$5" },
  { cents: 1000, label: "$10" },
];
const DONATION_MIN_CENTS = 100;
const DONATION_MAX_CENTS = 50000;

// ── Positive-action donation trigger ────────────────────────────────────────
// Counts cumulative positive actions across {This helped, Go deeper, Share}.
// Every 3rd action fires the donation prompt and resets the counter (re-fires
// forever, no daily cap). Heart click is NOT counted — it's its own trigger.
//
// Scope: pre-auth uses sessionStorage (true session, clears on tab close);
// post-auth uses localStorage keyed by userId so it survives reloads. On
// sign-in we merge the session count into the user-keyed count.
const POSITIVE_THRESHOLD = 3;
const POSITIVE_SESSION_KEY = "positive_action_count";
function positiveLocalKey(userId) { return `positive_action_count_${userId}`; }

function getPositiveCount() {
  if (currentUser && currentUser.id) {
    return parseInt(lsGet(positiveLocalKey(currentUser.id)) || "0", 10) || 0;
  }
  return parseInt(ssGet(POSITIVE_SESSION_KEY) || "0", 10) || 0;
}

function setPositiveCount(n) {
  if (currentUser && currentUser.id) {
    lsSet(positiveLocalKey(currentUser.id), String(n));
  } else {
    ssSet(POSITIVE_SESSION_KEY, String(n));
  }
}

function resetPositiveCount() {
  setPositiveCount(0);
}

// +1, then fire + reset every Nth. `action` is for analytics only.
function incrementPositive(action) {
  const next = getPositiveCount() + 1;
  track("positive_action_incremented", { action: action || "unknown", new_count: next });
  if (next >= POSITIVE_THRESHOLD) {
    resetPositiveCount();
    // Route through maybeShowDonationPrompt so server eligibility + the
    // session opt-out / already-showing guards are all respected.
    maybeShowDonationPrompt("three_positive_actions");
  } else {
    setPositiveCount(next);
  }
}

// On sign-in, fold any pre-auth session count into the user-keyed local count,
// then clear the session count so it isn't double-counted.
function mergePositiveCountOnSignIn(userId) {
  if (!userId) return;
  const sessionCount = parseInt(ssGet(POSITIVE_SESSION_KEY) || "0", 10) || 0;
  if (sessionCount > 0) {
    const key = positiveLocalKey(userId);
    const userCount = parseInt(lsGet(key) || "0", 10) || 0;
    lsSet(key, String(userCount + sessionCount));
  }
  ssRemove(POSITIVE_SESSION_KEY);
}

async function maybeShowDonationPrompt(trigger) {
  if (donationModalShowing) return;
  if (sessionDonationOptedOut) return;
  if (!currentUser || !currentUser.id) return;
  try {
    const res = await fetch(`${API_BASE}/api/donations/eligibility`, { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.eligible) {
      console.log("[donation] not eligible:", data.reason);
      return;
    }
    showDonationModal(trigger);
  } catch (e) {
    console.warn("eligibility check failed:", e?.message);
  }
}

async function showDonationModal(trigger) {
  if (!currentUser || !currentUser.id) return;
  if (donationModalShowing) return;
  donationModalShowing = true;
  track("donate_modal_viewed", { trigger: trigger || "manual_button" });

  let promptId = null;
  try {
    const res = await fetch(`${API_BASE}/api/donations/prompt/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ trigger: trigger || "manual_button" }),
    });
    if (res.ok) {
      const data = await res.json();
      promptId = data.promptId;
    }
  } catch (e) {
    console.warn("log prompt failed:", e?.message);
  }

  const existing = document.getElementById("donation-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "donation-modal";
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText = "display:flex;";

  const amountButtons = DONATION_AMOUNTS.map(a =>
    `<button class="donation-amount-btn" data-cents="${a.cents}" data-testid="donation-amount-${a.cents}">${a.label}</button>`
  ).join("");

  overlay.innerHTML = `
    <div class="modal-card" style="max-width:440px;">
      <div class="modal-header">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="#7B4A1E" aria-hidden="true" style="margin:0 auto;display:block;">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <h2 class="modal-title">Support My Shepherd</h2>
        <p class="modal-subtitle">Your one-time contribution helps us keep scripture accessible to anyone, anywhere — with no paywalls.</p>
      </div>
      <div id="donation-amount-row" style="display:flex;gap:10px;justify-content:center;margin:18px 0 12px;">
        ${amountButtons}
      </div>
      <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:18px;">
        <span style="color:var(--text-light,#9A8A7A);font-size:0.85rem;">or</span>
        <input id="donation-custom-input" type="number" min="1" max="500" placeholder="Custom" inputmode="decimal" style="width:110px;padding:8px 10px;border:1px solid #D4B896;border-radius:6px;font-family:Inter,sans-serif;font-size:0.9rem;" data-testid="donation-custom-input" />
        <span style="color:var(--text-mid,#5A4A3A);font-size:0.85rem;">USD</span>
      </div>
      <button id="btn-donate-confirm" class="btn-primary" disabled data-testid="button-donate-confirm">Continue to secure checkout</button>
      <div style="display:flex;gap:8px;justify-content:space-between;margin-top:10px;">
        <button id="btn-donate-maybe-later" class="btn-ghost" data-testid="button-donate-maybe-later" style="flex:1;">Maybe later</button>
        <button id="btn-donate-opt-out" class="btn-ghost" data-testid="button-donate-opt-out" style="flex:1;font-size:0.78rem;color:var(--text-light,#9A8A7A);">Don't ask again</button>
      </div>
      <p style="text-align:center;color:var(--text-light,#9A8A7A);font-size:0.72rem;margin-top:14px;font-family:Inter,sans-serif;line-height:1.5;">Secured by Stripe · Receipt sent by email<br/><span style="font-size:0.68rem;">My Shepherd is operated by Bar Above LLC. Contributions are not tax-deductible.</span></p>
    </div>
  `;
  document.body.appendChild(overlay);

  let selectedCents = null;
  const confirmBtn = overlay.querySelector("#btn-donate-confirm");
  const customInput = overlay.querySelector("#donation-custom-input");

  function updateConfirm() {
    confirmBtn.disabled = !selectedCents || selectedCents < DONATION_MIN_CENTS || selectedCents > DONATION_MAX_CENTS;
  }

  overlay.querySelectorAll(".donation-amount-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".donation-amount-btn").forEach(b => b.classList.remove("donation-amount-selected"));
      btn.classList.add("donation-amount-selected");
      selectedCents = Number(btn.dataset.cents);
      customInput.value = "";
      updateConfirm();
    });
  });

  customInput.addEventListener("input", () => {
    overlay.querySelectorAll(".donation-amount-btn").forEach(b => b.classList.remove("donation-amount-selected"));
    const dollars = parseFloat(customInput.value);
    selectedCents = isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
    updateConfirm();
  });

  confirmBtn.addEventListener("click", () => handleDonateConfirm(selectedCents, promptId, overlay));

  overlay.querySelector("#btn-donate-maybe-later").addEventListener("click", () => {
    recordPromptOutcome(promptId, "maybe_later");
    closeDonationModal();
  });

  overlay.querySelector("#btn-donate-opt-out").addEventListener("click", () => {
    sessionDonationOptedOut = true;
    recordPromptOutcome(promptId, "opt_out");
    closeDonationModal();
  });
}

function closeDonationModal() {
  const m = document.getElementById("donation-modal");
  if (m) m.remove();
  donationModalShowing = false;
}

async function recordPromptOutcome(promptId, outcome) {
  if (!promptId) return;
  try {
    await fetch(`${API_BASE}/api/donations/prompt/${promptId}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ outcome }),
    });
  } catch (e) {
    console.warn("prompt outcome update failed:", e?.message);
  }
}

async function handleDonateConfirm(amountCents, promptId, overlay) {
  if (!amountCents || amountCents < DONATION_MIN_CENTS || amountCents > DONATION_MAX_CENTS) return;
  if (!currentUser || !currentUser.id) return;
  const confirmBtn = overlay.querySelector("#btn-donate-confirm");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Redirecting to checkout…";
  track("donate_checkout_started", { amount_cents: amountCents, prompt_id: promptId || null });
  try {
    const res = await fetch(`${API_BASE}/api/donations/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptId,
        amountCents,
      }),
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.url) throw new Error("No checkout URL");
    track("donate_checkout_redirected", { amount_cents: amountCents });
    window.location.assign(data.url);
  } catch (e) {
    console.warn("checkout failed:", e?.message);
    track("donate_checkout_failed", { amount_cents: amountCents, error: e?.message || "unknown" });
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Continue to secure checkout";
    alert(`Sorry, we couldn't start checkout: ${e?.message || "unknown error"}`);
  }
}

function showDonationThankYou() {
  const existing = document.getElementById("donation-thanks");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "donation-thanks";
  overlay.className = "modal-overlay";
  overlay.style.cssText = "display:flex;";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:400px;text-align:center;">
      <svg width="54" height="54" viewBox="0 0 24 24" fill="#7B4A1E" aria-hidden="true" style="margin:0 auto 12px;display:block;">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
      <h2 class="modal-title" style="margin-bottom:8px;">Thank you</h2>
      <p class="modal-subtitle" style="margin-bottom:20px;">Your support keeps My Shepherd free for everyone. We'll email your receipt shortly.</p>
      <button id="btn-thanks-close" class="btn-primary">Continue exploring</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#btn-thanks-close").addEventListener("click", () => overlay.remove());
}

// ── Init ───────────────────────────────────────────────────────────────────
// ── Tab switching (Explore / Search Chats) ──────────────────────────────
function switchTab(tabName) {
  // Toggle button active state
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  // Toggle tab content visibility
  document.querySelectorAll(".tab-content").forEach(el => {
    el.style.display = el.id === `tab-${tabName}` ? "" : "none";
  });
  // Lazy-load history when switching into it
  if (tabName === "history") {
    renderHistoryTab();
  }
}

function renderHistoryTab() {
  const loggedOut = document.getElementById("history-logged-out");
  const loggedIn = document.getElementById("history-logged-in");
  if (!loggedOut || !loggedIn) return;
  if (!currentUser || !currentUser.id) {
    loggedOut.style.display = "";
    loggedIn.style.display = "none";
    return;
  }
  loggedOut.style.display = "none";
  loggedIn.style.display = "";
  loadChatHistory("");
}

let historySearchDebounce = null;
async function loadChatHistory(query) {
  if (!currentUser || !currentUser.id) return;
  const listEl = document.getElementById("history-list");
  const emptyEl = document.getElementById("history-empty");
  if (!listEl) return;
  try {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const res = await fetch(`${API_BASE}/api/chats?${params.toString()}`, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const chats = await res.json();
    if (!Array.isArray(chats) || chats.length === 0) {
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";
    listEl.innerHTML = chats.map(renderHistoryItem).join("");
  } catch (err) {
    console.warn("loadChatHistory failed:", err?.message);
    listEl.innerHTML = `<p style="color:var(--text-light);font-size:0.85rem;text-align:center;padding:20px;">Couldn't load your chats. Please try again.</p>`;
  }
}

function renderHistoryItem(chat) {
  const topic = esc(chat.topic || "Question");
  const question = esc(chat.question || "");
  const verse = esc(chat.verse || chat.citation || "");
  const reflection = esc(chat.reflection || chat.answer || "");
  const date = chat.createdAt ? new Date(chat.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  const preview = reflection.length > 180 ? reflection.slice(0, 180) + "…" : reflection;
  return `
    <div class="history-item" data-testid="history-item">
      <div class="history-item-header">
        <span class="history-item-topic">${topic}</span>
        ${date ? `<span class="history-item-date">${date}</span>` : ""}
      </div>
      ${question ? `<p class="history-item-question">${question}</p>` : ""}
      ${verse ? `<p class="history-item-verse">${verse}</p>` : ""}
      ${preview ? `<p class="history-item-reflection">${preview}</p>` : ""}
    </div>`;
}

function setupTabs() {
  // Wire tab buttons
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab) switchTab(tab);
    });
  });
  // History search input (debounced)
  const searchInput = document.getElementById("history-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", e => {
      clearTimeout(historySearchDebounce);
      const q = e.target.value.trim();
      historySearchDebounce = setTimeout(() => loadChatHistory(q), 300);
    });
  }
}

function init() {
  renderTopicGrid();
  setupTabs();

  // Question input
  const input = document.getElementById("question-input");
  input.addEventListener("input", () => {
    const len = input.value.length;
    document.getElementById("char-hint").textContent = len > 0 ? `${len} chars` : "";
    document.getElementById("btn-ask").disabled = !input.value.trim();
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  });
  document.getElementById("btn-ask").addEventListener("click", handleAsk);
  document.getElementById("btn-ask").disabled = true;

  // Ask another
  document.getElementById("btn-ask-another").addEventListener("click", () => {
    document.getElementById("response-section").style.display = "none";
    document.querySelectorAll(".topic-btn").forEach(b => b.classList.remove("active"));
    currentTopic = null;
    input.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ── First-visit modal: Stay-connected (State A) wiring ────────────────
  const stayConnectedSubmit = document.getElementById("btn-stay-connected-submit");
  if (stayConnectedSubmit) stayConnectedSubmit.addEventListener("click", submitStayConnected);
  const stayConnectedNotNow = document.getElementById("btn-stay-connected-notnow");
  if (stayConnectedNotNow) stayConnectedNotNow.addEventListener("click", dismissStayConnectedNotNow);
  const stayConnectedClose = document.getElementById("btn-close-stay-connected");
  if (stayConnectedClose) stayConnectedClose.addEventListener("click", dismissStayConnectedX);
  const stayConnectedCloseSuccess = document.getElementById("btn-stay-connected-close-success");
  if (stayConnectedCloseSuccess) stayConnectedCloseSuccess.addEventListener("click", closeStayConnectedSuccess);
  const stayConnectedResend = document.getElementById("btn-resend-stay-connected");
  if (stayConnectedResend) stayConnectedResend.addEventListener("click", handleResendStayConnected);
  const zipInput = document.getElementById("stay-connected-zip");
  if (zipInput) {
    // Numeric-only ZIP input.
    zipInput.addEventListener("input", () => { zipInput.value = zipInput.value.replace(/\D/g, "").slice(0, 5); });
  }
  // Enter in either field submits.
  const submitOnEnter = e => { if (e.key === "Enter") { e.preventDefault(); submitStayConnected(); } };
  document.getElementById("stay-connected-email")?.addEventListener("keydown", submitOnEnter);
  zipInput?.addEventListener("keydown", submitOnEnter);
  // Outside-click on the overlay dismisses (X-equivalent, 24h) when in
  // stay-connected mode. Church-matching mode keeps its own skip button.
  const firstVisitOverlay = document.getElementById("affiliation-modal");
  if (firstVisitOverlay) {
    firstVisitOverlay.addEventListener("click", e => {
      if (e.target !== firstVisitOverlay) return; // only the backdrop, not the card
      if (FEATURE_CHURCH_MATCHING) return;
      dismissStayConnectedX();
    });
  }

  // ── First-visit modal: Church-matching (State B) wiring ───────────────
  // Preserved for when FEATURE_CHURCH_MATCHING is flipped on. These elements
  // exist in the DOM in both states (State B is just hidden), so wiring is safe.
  document.getElementById("btn-confirm-affiliation")?.addEventListener("click", confirmAffiliation);
  document.getElementById("btn-skip-affiliation")?.addEventListener("click", () => {
    closeAffiliationModal();
    loadTrending();
  });
  document.getElementById("btn-find-near-me")?.addEventListener("click", findNearbyChurches);

  // Church search debounce
  document.getElementById("church-search-input")?.addEventListener("input", e => {
    clearTimeout(searchDebounce);
    const v = e.target.value.trim();
    if (!v) {
      document.getElementById("church-search-results").style.display = "none";
      return;
    }
    searchDebounce = setTimeout(() => searchChurches(v), 350);
  });

  // Close results on click outside
  document.addEventListener("click", e => {
    const wrap = document.querySelector(".modal-search-wrap");
    if (wrap && !wrap.contains(e.target)) {
      const results = document.getElementById("church-search-results");
      if (results) results.style.display = "none";
    }
  });

  // ── Auth wiring (signup/login modal + header buttons) ─────────────────
  const magicBtn = document.getElementById("btn-send-magic-link");
  if (magicBtn) magicBtn.addEventListener("click", handleSendMagicLink);
  const magicInput = document.getElementById("magic-email-input");
  if (magicInput) {
    magicInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSendMagicLink();
      }
    });
  }
  const skipLoginBtn = document.getElementById("btn-skip-login");
  if (skipLoginBtn) skipLoginBtn.addEventListener("click", cancelSignupFlow);
  const resendLink = document.getElementById("btn-resend-magic-link");
  if (resendLink) resendLink.addEventListener("click", handleResendMagicLink);
  const closeSentBtn = document.getElementById("btn-close-magic-sent");
  if (closeSentBtn) closeSentBtn.addEventListener("click", closeLoginModal);
  const signInHeaderBtn = document.getElementById("btn-sign-in-header");
  if (signInHeaderBtn) signInHeaderBtn.addEventListener("click", openLoginModal);
  const signUpHeaderBtn = document.getElementById("btn-sign-up-header");
  if (signUpHeaderBtn) signUpHeaderBtn.addEventListener("click", openSignupFlow);
  const donateHeaderBtn = document.getElementById("btn-donate-header");
  if (donateHeaderBtn) donateHeaderBtn.addEventListener("click", onDonateHeaderClick);
  const modeToggleLink = document.getElementById("login-modal-mode-toggle-link");
  if (modeToggleLink) {
    modeToggleLink.addEventListener("click", (e) => {
      e.preventDefault();
      setAuthMode(currentAuthMode === "signup" ? "signin" : "signup");
    });
  }

  // Click avatar to toggle dropdown; click sign-out to clear state
  const avatarBtn = document.getElementById("btn-user-avatar");
  if (avatarBtn) {
    avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dd = document.getElementById("user-dropdown");
      if (dd) dd.style.display = dd.style.display === "none" || !dd.style.display ? "" : "none";
    });
  }
  const signOutBtn = document.getElementById("btn-sign-out");
  if (signOutBtn) signOutBtn.addEventListener("click", signOut);
  // Close avatar dropdown on outside click
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("user-avatar-menu");
    if (menu && !menu.contains(e.target)) {
      const dd = document.getElementById("user-dropdown");
      if (dd) dd.style.display = "none";
    }
  });

  // Donation heart in header (created dynamically; hidden until signed in)
  injectDonationHeart();

  // Run auth init: parses #?magic=, #?u=, #?donation= and sets currentUser
  initAuth().catch(err => console.warn("initAuth failed:", err?.message));

  // Restore affiliation from backend if this session was previously affiliated
  restoreAffiliation().then(() => {
    loadTrending();
  });
}

// Header "Donate" button click. This is an explicitly user-initiated donation,
// so we skip the server eligibility check (maybeShowDonationPrompt) — that gate
// is meant for AUTOMATIC prompts only. showDonationModal requires a signed-in
// user (donations attach to a user), so if anonymous we open the auth modal
// first; the user can donate after signing in.
function onDonateHeaderClick() {
  track("donate_button_clicked", { source: "header_button" });
  if (!currentUser || !currentUser.id) {
    // Remember the user wanted to donate so we can resume after sign-up,
    // including across the magic-link email round-trip (localStorage).
    signupReturnIntent = "donate";
    lsSet(SIGNUP_RETURN_INTENT_KEY, "donate");
    openSignupFlow();
    return;
  }
  showDonationModal("header_button");
}

// Add the donation heart icon to the header. Created in JS to keep the
// diff against index.html minimal.
function injectDonationHeart() {
  if (document.getElementById("btn-donate-heart")) return;
  const headerRight = document.querySelector(".header-right");
  if (!headerRight) return;
  const btn = document.createElement("button");
  btn.id = "btn-donate-heart";
  btn.className = "btn-donate-heart";
  btn.setAttribute("data-testid", "button-donate-heart");
  btn.setAttribute("aria-label", "Support My Shepherd");
  btn.setAttribute("title", "Support My Shepherd");
  btn.style.display = "none"; // shown only after sign-in
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7B4A1E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  btn.addEventListener("click", () => showDonationModal("manual_button"));
  // Insert before the user menu area so heart sits to the left of avatar
  const userMenu = document.getElementById("user-menu-area");
  if (userMenu) headerRight.insertBefore(btn, userMenu);
  else headerRight.appendChild(btn);
}

async function restoreAffiliation() {
  // Church-matching path (flag on): restore an existing affiliation from the
  // backend and skip the modal if already affiliated.
  if (FEATURE_CHURCH_MATCHING) {
    try {
      const res = await fetch(`${API_BASE}/api/affiliations/${encodeURIComponent(SESSION_ID)}`);
      if (res.ok) {
        const aff = await res.json();
        if (aff && aff.churchId) {
          // Fetch church name
          const cr = await fetch(`${API_BASE}/api/churches/${aff.churchId}`);
          if (cr.ok) {
            const church = await cr.json();
            churchId   = church.id;
            churchName = church.name;
            showChurchBadgeHeader();
            return; // skip modal
          }
        }
      }
    } catch (e) {}
    // HOTFIX 2026-08-17: temporarily disable auto-open of the first-visit
    // affiliation modal (church-matching path). A multi-panel show/hide bug
    // is stacking the stay-connected form, its success panel, and the church-
    // matching sub-panel in a single overflowing card. Pulling the auto-open
    // trigger restores a clean pre-sign-in experience. Manual re-enable
    // pending root-cause + repair (see follow-up task).
    // No existing affiliation found — show modal after short delay
    // setTimeout(() => openAffiliationModal(), 800);
    return;
  }

  // HOTFIX 2026-08-17: temporarily disable auto-open of the stay-connected
  // email+ZIP modal for the same reason as above. Waitlist capture pauses
  // until the multi-panel show/hide bug is repaired. Header "Sign In" and
  // "Sign Up" buttons remain fully functional — this only kills the
  // first-visit auto-nudge that overlaps with the sign-in modal.
  // if (shouldShowStayConnectedModal() && !isAuthInFlightOrDone()) {
  //   setTimeout(() => openAffiliationModal(), 800);
  // }
}

// True if the visitor is either already signed in OR arrived with a magic
// link that initAuth() is currently verifying. Prevents the first-visit
// modal from stacking on top of a signed-in UI when localStorage is empty
// (fresh install, private browsing, cleared cookies).
function isAuthInFlightOrDone() {
  if (currentUser && currentUser.id) return true;
  // parseHashParams may be defined further up; guard for safety.
  try {
    const params = parseHashParams();
    if (params && params.magic) return true;
  } catch { /* no-op */ }
  return false;
}

document.addEventListener("DOMContentLoaded", init);
