// ─────────────────────────────────────────────────────────────────────────────
//  My Shepherd — Main App
//  All state is kept in memory (no localStorage — blocked in iframe).
// ─────────────────────────────────────────────────────────────────────────────

// ── Backend URL ────────────────────────────────────────────────────────────
// Always-on Railway backend — live 24/7
const API_BASE = "https://app.myshepherdapp.church";

// ── Session ID ────────────────────────────────────────────────────────────
// Strategy: embed ?sid=<uuid> in the URL hash so it survives reloads
// (localStorage/sessionStorage are blocked in sandboxed iframes).
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
async function fetchAIResponse(topic, question) {
  const params = new URLSearchParams({ topic, question: question || "" });
  const res = await fetch(`${API_BASE}/api/ai/scripture?${params.toString()}`);
  if (!res.ok) throw new Error("AI request failed: " + res.status);
  return res.json();
}

async function fetchDeeperResponse(topic, question, prevRef) {
  const params = new URLSearchParams({ topic, question: question || "", prevRef: prevRef || "" });
  const res = await fetch(`${API_BASE}/api/ai/deeper?${params.toString()}`);
  if (!res.ok) throw new Error("Deeper request failed: " + res.status);
  return res.json();
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

  try {
    const aiData = await fetchDeeperResponse(currentTopic, question, prevRef);
    const verse      = aiData.verse      || getFallbackResponse(currentTopic).verse;
    const reflection = aiData.reflection || getFallbackResponse(currentTopic).reflection;
    const followUps  = aiData.followUpTopics || FOLLOW_UP[currentTopic] || [];
    content.innerHTML = buildResponseHTML(currentTopic, question, verse, reflection);
    renderFollowUpChipsFromList(followUps);
    renderShareButton();
    renderActionButtons();
    saveChatToHistory(currentTopic, question, verse, reflection);
  } catch(err) {
    const fallback = getFallbackResponse(currentTopic);
    content.innerHTML = buildResponseHTML(currentTopic, question, fallback.verse, fallback.reflection);
    renderFollowUpChips(currentTopic);
    renderShareButton();
    renderActionButtons();
  }
  isLoading = false;
  renderActionButtons();
}

function renderActionButtons() {
  document.getElementById("action-btn-row")?.remove();

  const card = document.getElementById("response-card");
  const row  = document.createElement("div");
  row.id = "action-btn-row";
  row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;";

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

function handleNextQuestion() {
  // Reset all state
  isLoading = false;
  currentTopic = null;
  currentVerse = null;

  // Hide response area + remove buttons
  document.getElementById("response-section").style.display = "none";
  document.getElementById("action-btn-row")?.remove();
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

  // Show sign-in prompt if not logged in
  if (!currentUser) {
    setTimeout(() => openLoginModal(), 600);
  }
}

// ── Insight Logging ───────────────────────────────────────────────────────
async function logInsight(topic, question = "") {
  try {
    await fetch(`${API_BASE}/api/insights/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        question,
        sessionId: SESSION_ID,
        churchId: churchId || null,
        location: "",
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

function openAffiliationModal() {
  const modal = document.getElementById("affiliation-modal");
  modal.style.display = "flex";
}

function closeAffiliationModal() {
  document.getElementById("affiliation-modal").style.display = "none";
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
async function selectTopic(topic) {
  if (isLoading) return;
  currentTopic = topic;

  // Highlight active button
  document.querySelectorAll(".topic-btn").forEach(b => b.classList.remove("active"));
  const activeBtn = document.querySelector(`[data-topic="${topic}"]`);
  if (activeBtn) activeBtn.classList.add("active");

  await showResponse(topic, "");
  logInsight(topic, "");
}

// ── Response Display ───────────────────────────────────────────────────────
async function showResponse(topic, question) {
  isLoading = true;
  const section  = document.getElementById("response-section");
  const content  = document.getElementById("response-content");
  const topicTag = document.getElementById("response-topic-tag");
  const chips    = document.getElementById("follow-up-chips");
  const askBtn   = document.getElementById("btn-ask-another");

  topicTag.innerHTML = `<span>${TOPICS.find(t => t.label === topic)?.emoji || "✝️"}</span> ${topic}`;
  content.innerHTML = `<div class="response-loading"><div class="dot-flashing"><span></span><span></span><span></span></div><p>Finding scripture…</p></div>`;
  chips.style.display = "none";
  askBtn.style.display = "none";
  section.style.display = "block";

  setTimeout(() => section.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

  try {
    const aiData = await fetchAIResponse(topic, question);
    const verse      = aiData.verse      || getFallbackResponse(topic).verse;
    const reflection = aiData.reflection || getFallbackResponse(topic).reflection;
    const followUps  = aiData.followUpTopics || FOLLOW_UP[topic] || [];
    content.innerHTML = buildResponseHTML(topic, question, verse, reflection);
    renderFollowUpChipsFromList(followUps);
    renderShareButton();
    renderActionButtons();
    saveChatToHistory(topic, question, verse, reflection);
  } catch (err) {
    console.error("AI error, using fallback:", err.message);
    const fallback = getFallbackResponse(topic);
    content.innerHTML = buildResponseHTML(topic, question, fallback.verse, fallback.reflection);
    renderFollowUpChips(topic);
    renderShareButton();
    renderActionButtons();
    saveChatToHistory(topic, question, fallback.verse, fallback.reflection);
  }

  askBtn.style.display = "block";
  isLoading = false;
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
      showResponse(finalTopic, chipTopic);
      logInsight(finalTopic, chipTopic);
    });
  });
}

// ── Share Verse Button ───────────────────────────────────────────────────
function renderShareButton() {
  const existing = document.getElementById("btn-share-verse");
  if (existing) existing.remove();
  if (!currentVerse) return;

  const btn = document.createElement("button");
  btn.id = "btn-share-verse";
  btn.className = "btn-share-verse";
  btn.setAttribute("data-testid", "button-share-verse");
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
    Share this verse
  `;
  btn.addEventListener("click", shareVerse);

  // Insert before the follow-up chips
  const chips = document.getElementById("follow-up-chips");
  chips.parentNode.insertBefore(btn, chips);
}

async function shareVerse() {
  if (!currentVerse) return;
  const text = `"${currentVerse.text}" — ${currentVerse.ref}

From My Shepherd: https://www.perplexity.ai/computer/a/my-shepherd-3ArzyJ0SRA25IpdOKoTgOA`;

  if (navigator.share) {
    try {
      await navigator.share({ title: "My Shepherd — Scripture", text });
      return;
    } catch (e) { /* fall through to clipboard */ }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
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
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(currentVerse.text.slice(0,200) + " — " + currentVerse.ref + " (via @MyShepherdApp)")}`, "_blank", "noopener");
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

  logInsight(topic, q);
  await showResponse(topic, q);
  input.value = "";
  document.getElementById("char-hint").textContent = "";
}

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  renderTopicGrid();

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

  // Modal
  document.getElementById("btn-confirm-affiliation").addEventListener("click", confirmAffiliation);
  document.getElementById("btn-skip-affiliation").addEventListener("click", () => {
    closeAffiliationModal();
    loadTrending();
  });
  document.getElementById("btn-find-near-me").addEventListener("click", findNearbyChurches);

  // Church search debounce
  document.getElementById("church-search-input").addEventListener("input", e => {
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
      document.getElementById("church-search-results").style.display = "none";
    }
  });

  // Restore affiliation from backend if this session was previously affiliated
  restoreAffiliation().then(() => {
    loadTrending();
  });
}

async function restoreAffiliation() {
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
  // No existing affiliation found — show modal after short delay
  setTimeout(() => openAffiliationModal(), 800);
}

document.addEventListener("DOMContentLoaded", init);
