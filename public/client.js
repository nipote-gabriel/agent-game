const $ = (id) => document.getElementById(id);

// Polling: a cheap state read every second while the page is visible, plus a
// "still here" ping every few seconds. Slower while the tab is in the background.
// This keeps Redis usage low (about 1.4 commands per player per second).
const POLL_MS = 1000;
const HIDDEN_POLL_MS = 5000;
const PING_EVERY = 5;

let state = null;
let session = load("session"); // { code, token } of the lobby we're in
let pollTimer = null;
let pollCount = 0;
let lastNotice = null;
let cardCovered = false;
let roundsTimer = null;
let pendingRounds = null;

function load(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

const nameInput = $("name");
nameInput.value = load("name") || "";
const info = () => {
  save("name", nameInput.value.trim());
  return { name: nameInput.value };
};

function show(view) {
  for (const v of ["home", "lobby", "game", "accuse", "over"]) $(v).hidden = v !== view;
}

function toast(msg, { error = false, ms = 3000 } = {}) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast" + (error ? " error" : "");
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), ms);
}

function goHome(msg) {
  session = null;
  save("session", null);
  state = null;
  lastNotice = null;
  clearTimeout(pollTimer);
  show("home");
  if (msg) toast(msg, { error: true });
  prefillInvite();
}

// Handle any server response: { state } | { gone } | { error }.
function handle(res) {
  if (res.error) return toast(res.error, { error: true });
  if (res.gone) return goHome(session ? "You're no longer in that lobby." : null);
  if (res.token) {
    session = { code: res.state.code, token: res.token };
    save("session", session);
    history.replaceState(null, "", location.pathname); // drop ?code= from the URL
    schedulePoll();
  }
  if (res.state) render(res.state);
}

// Fetch JSON with a timeout; turns non-JSON responses (e.g. a crashed function) into readable errors.
async function api(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" });
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: `Server error (${r.status}). Check /api/health.` };
    }
  } catch (e) {
    return { error: e.name === "AbortError" ? "The server took too long to respond." : "Couldn't reach the server.", network: true };
  } finally {
    clearTimeout(timer);
  }
}

let busy = false;
async function send(action, extra = {}, button) {
  // Buttons ignore taps while their request is in flight.
  if (button && busy) return;
  if (button) busy = true;
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    if (action === "create" || action === "join") button.textContent = action === "create" ? "Creating…" : "Joining…";
  }
  const res = await api("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...session, ...extra }),
  });
  if (button) {
    busy = false;
    button.disabled = false;
    if (label) button.textContent = label;
  }
  if (action === "leave" && !res.error) return goHome();
  handle(res);
}

async function poll() {
  if (!session) return;
  const mine = session;
  const ping = document.hidden || pollCount++ % PING_EVERY === 0 ? "&ping=1" : "";
  const q = `code=${encodeURIComponent(mine.code)}&token=${encodeURIComponent(mine.token)}${ping}`;
  const res = await api(`/api/state?${q}`);
  // Ignore network blips while polling; just try again next tick.
  if (session === mine && !res.network) handle(res);
  if (session === mine) schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && session) {
    pollCount = 0; // ping right away when coming back
    poll();
  }
});

// --- Home ---
$("createBtn").onclick = (e) => send("create", info(), e.currentTarget);
$("joinBtn").onclick = () => {
  if (!$("codeInput").value.trim()) return $("codeInput").focus();
  send("join", { ...info(), code: $("codeInput").value }, $("joinBtn"));
};
$("codeInput").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "")));
$("codeInput").addEventListener("keydown", (e) => e.key === "Enter" && $("joinBtn").click());
nameInput.addEventListener("keydown", (e) => e.key === "Enter" && nameInput.blur());

// --- Lobby ---
$("leaveBtn").onclick = () => send("leave");
$("startBtn").onclick = (e) => send("start", {}, e.currentTarget);
$("shareBtn").onclick = async () => {
  if (!state) return;
  const url = `${location.origin}/?code=${state.code}`;
  const text = `Join my Agent Game lobby: ${state.code}`;
  try {
    if (navigator.share) return await navigator.share({ title: "Agent Game", text, url });
    await navigator.clipboard.writeText(url);
    toast("Invite link copied!");
  } catch (e) {
    if (e?.name !== "AbortError") toast(`Code: ${state.code}`);
  }
};
function bumpRounds(delta) {
  if (!state || state.you !== state.hostId) return;
  pendingRounds = Math.max(1, Math.min(50, (pendingRounds ?? state.rounds) + delta));
  $("rounds").textContent = pendingRounds;
  updateStepper(pendingRounds, true);
  clearTimeout(roundsTimer);
  roundsTimer = setTimeout(async () => {
    const n = pendingRounds;
    await send("setRounds", { rounds: n });
    if (pendingRounds === n) pendingRounds = null;
  }, 350);
}
$("roundsDown").onclick = () => bumpRounds(-1);
$("roundsUp").onclick = () => bumpRounds(1);
function updateStepper(n, isHost) {
  $("roundsDown").disabled = !isHost || n <= 1;
  $("roundsUp").disabled = !isHost || n >= 50;
}

// --- Game ---
$("card").onclick = () => {
  cardCovered = !cardCovered;
  renderCard();
};
$("nextBtn").onclick = (e) => {
  const g = state?.game;
  if (!g) return;
  send("vote", { round: g.round, on: !g.votes.includes(state.you) }, e.currentTarget);
};
$("newGameBtn").onclick = (e) => send("newGame", {}, e.currentTarget);
$("homeBtn").onclick = () => send("leave");
$("endBtn").onclick = () => {
  if (confirm("End the game for everyone?")) send("endGame");
};

function renderPlayers(ul, s, { showEmpty = false, votes = null } = {}) {
  ul.innerHTML = "";
  for (const p of s.players) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="avatar"></span><span class="pname"></span>`;
    if (votes?.includes(p.id)) {
      li.classList.add("voted");
      li.insertAdjacentHTML("beforeend", `<span class="check" aria-label="voted">✓</span>`);
    }
    li.querySelector(".avatar").textContent = p.avatar;
    li.querySelector(".pname").textContent = p.name + (p.id === s.you ? " (you)" : "");
    if (p.id === s.hostId) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "host";
      li.appendChild(tag);
    }
    ul.appendChild(li);
  }
  if (showEmpty) {
    for (let i = s.players.length; i < s.maxPlayers; i++) {
      const li = document.createElement("li");
      li.className = "empty";
      li.innerHTML = `<span class="avatar">·</span><span class="pname">Waiting for player…</span>`;
      ul.appendChild(li);
    }
  }
}

function renderCard(animate = false) {
  const card = $("card");
  if (!state?.card) return;
  card.className = "card " + (cardCovered ? "covered" : state.card.type);
  card.textContent = cardCovered ? "Tap to reveal" : state.card.text;
  $("cardHint").textContent = cardCovered ? "Card hidden" : "Tap the card to hide it";
  if (animate) {
    void card.offsetWidth; // restart the flip animation
    card.classList.add("flip");
  }
}

function render(s) {
  if (s.notice && s.notice.id !== lastNotice && (lastNotice !== null || state)) toast(s.notice.text, { ms: 4000 });
  lastNotice = s.notice ? s.notice.id : "";
  const prevRound = state?.game?.phase === "play" ? state.game.round : null;
  state = s;
  const isHost = s.you === s.hostId;
  const full = s.players.length === s.maxPlayers;

  if (!s.game) {
    show("lobby");
    $("lobbyCode").textContent = s.code;
    $("playerCount").textContent = `${s.players.length}/${s.maxPlayers}`;
    renderPlayers($("players"), s, { showEmpty: true });

    const me = s.players.find((p) => p.id === s.you);
    const taken = new Set(s.players.filter((p) => p.id !== s.you).map((p) => p.avatar));
    const box = $("avatars");
    box.innerHTML = "";
    for (const a of s.avatars) {
      const b = document.createElement("button");
      b.textContent = a;
      b.className = "avatar-btn" + (a === me.avatar ? " selected" : "");
      b.disabled = taken.has(a);
      b.setAttribute("aria-label", `Avatar ${a}`);
      b.onclick = () => send("setAvatar", { avatar: a });
      box.appendChild(b);
    }

    const rounds = pendingRounds ?? s.rounds;
    $("rounds").textContent = rounds;
    updateStepper(rounds, isHost);
    $("roundsHint").textContent = isHost ? "" : "The host picks the number of rounds.";

    $("startBtn").hidden = !isHost;
    $("startBtn").disabled = !full;
    $("startHint").textContent = full
      ? isHost ? "Everyone's here!" : "Waiting for the host to start…"
      : `Waiting for ${s.maxPlayers - s.players.length} more player${s.maxPlayers - s.players.length > 1 ? "s" : ""}…`;
    return;
  }

  if (s.game.phase === "accuse") return renderAccuse(s);
  if (s.game.phase === "result") return renderResult(s);

  show("game");
  $("round").textContent = s.game.round;
  $("totalRounds").textContent = s.game.totalRounds;
  const changed = prevRound !== s.game.round;
  if (changed) {
    cardCovered = false;
    navigator.vibrate?.(40);
  }
  renderCard(changed);
  const { votes, votesNeeded } = s.game;
  renderPlayers($("gamePlayers"), s, { votes });
  const iVoted = votes.includes(s.you);
  const last = s.game.round >= s.game.totalRounds;
  const btn = $("nextBtn");
  btn.textContent = iVoted ? "✓ Voted · tap to undo" : last ? "Vote for the Agent" : "Next round";
  btn.classList.toggle("voted", iVoted);
  btn.classList.toggle("primary", !iVoted);
  $("voteHint").textContent = `${votes.length}/${votesNeeded} votes to ${last ? "start the final vote" : "move on"}`;
  $("endBtn").style.visibility = isHost ? "visible" : "hidden";
}

function renderAccuse(s) {
  show("accuse");
  const { accused, myAccusation } = s.game;
  const box = $("suspects");
  box.innerHTML = "";
  for (const p of s.players.filter((p) => p.id !== s.you)) {
    const b = document.createElement("button");
    b.className = "suspect" + (p.id === myAccusation ? " selected" : "");
    b.innerHTML = `<span class="big-avatar"></span><span class="sname"></span><span class="pick"></span>`;
    b.querySelector(".big-avatar").textContent = p.avatar;
    b.querySelector(".sname").textContent = p.name;
    b.querySelector(".pick").textContent = p.id === myAccusation ? "🕵️ Your pick" : "Tap to accuse";
    b.onclick = () => p.id !== myAccusation && send("accuse", { target: p.id }, b);
    box.appendChild(b);
  }
  const waiting = s.players.length - accused.length;
  $("accuseHint").textContent = myAccusation
    ? `Waiting for ${waiting} more vote${waiting === 1 ? "" : "s"}…`
    : `${accused.length}/${s.players.length} have voted`;
  renderPlayers($("accusePlayers"), s, { votes: accused });
}

const OUTCOMES = {
  citizens: { emoji: "🎉", title: "Citizens win!" },
  agent: { emoji: "🕵️", title: "The Agent wins!" },
  stalemate: { emoji: "🤝", title: "Stalemate" },
};

function renderResult(s) {
  const firstShow = $("over").hidden;
  show("over");
  const { outcome, agentId, accusations, roster, words } = s.game.result;
  const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
  const iAmAgent = s.you === agentId;

  const o = OUTCOMES[outcome];
  $("banner").className = "banner " + outcome;
  $("bannerEmoji").textContent = o.emoji;
  $("bannerTitle").textContent = o.title;
  $("bannerSub").textContent =
    outcome === "stalemate"
      ? "Everyone voted differently. Nobody wins."
      : (outcome === "agent") === iAmAgent
        ? "You won! 🏆"
        : "You lost.";
  if (firstShow) navigator.vibrate?.(outcome === "stalemate" ? 60 : [60, 60, 120]);

  const agent = byId[agentId];
  $("agentReveal").innerHTML = `<span class="avatar"></span><span></span>`;
  $("agentReveal").firstChild.textContent = agent.avatar;
  $("agentReveal").lastChild.textContent = agent.name + (iAmAgent ? " (you)" : "");

  const list = $("voteList");
  list.innerHTML = "";
  for (const p of [...roster].sort((x, y) => (x.id === agentId) - (y.id === agentId))) {
    const target = byId[accusations[p.id]];
    const right = target.id === agentId;
    const li = document.createElement("li");
    li.innerHTML = `<span class="avatar"></span><span class="pname"></span><span class="arrow">→</span><span class="avatar"></span><span class="pname"></span><span class="mark"></span>`;
    const [a1, n1, , a2, n2, mark] = li.children;
    a1.textContent = p.avatar;
    n1.textContent = p.id === s.you ? "You" : p.name;
    a2.textContent = target.avatar;
    n2.textContent = target.id === s.you ? "you" : target.name;
    if (p.id !== agentId) {
      mark.textContent = right ? "✓" : "✗";
      mark.classList.add(right ? "right" : "wrong");
    } else {
      mark.textContent = "Agent";
      mark.classList.add("muted");
    }
    list.appendChild(li);
  }
  const wordList = $("wordList");
  wordList.innerHTML = "";
  words.forEach((w, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rnum"></span><span class="w"></span>`;
    li.firstChild.textContent = words.length > 1 ? `R${i + 1}` : "";
    li.lastChild.textContent = w;
    wordList.appendChild(li);
  });

  const n = s.game.totalRounds;
  $("overSummary").textContent = `${n} round${n > 1 ? "s" : ""} played`;
}

// Start: rejoin our lobby after a reload, or prefill a code from an invite link.
function prefillInvite() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return;
  $("codeInput").value = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (!nameInput.value) nameInput.focus();
}
if (session) {
  poll();
} else {
  show("home");
  prefillInvite();
}
