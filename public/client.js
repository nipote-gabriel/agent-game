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
  for (const v of ["home", "lobby", "game"]) $(v).hidden = v !== view;
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

async function send(action, extra = {}) {
  try {
    const r = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...session, ...extra }),
    });
    const res = await r.json();
    if (action === "leave") return goHome();
    handle(res);
  } catch {
    toast("Couldn't reach the server.", { error: true });
  }
}

async function poll() {
  if (!session) return;
  const mine = session;
  const ping = document.hidden || pollCount++ % PING_EVERY === 0 ? "&ping=1" : "";
  try {
    const q = `code=${encodeURIComponent(mine.code)}&token=${encodeURIComponent(mine.token)}${ping}`;
    const r = await fetch(`/api/state?${q}`, { cache: "no-store" });
    if (session === mine) handle(await r.json());
  } catch {
    // network blip: just try again next tick
  }
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
$("createBtn").onclick = () => send("create", info());
$("joinBtn").onclick = () => {
  if (!$("codeInput").value.trim()) return $("codeInput").focus();
  send("join", { ...info(), code: $("codeInput").value });
};
$("codeInput").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "")));
$("codeInput").addEventListener("keydown", (e) => e.key === "Enter" && $("joinBtn").click());
nameInput.addEventListener("keydown", (e) => e.key === "Enter" && nameInput.blur());

// --- Lobby ---
$("leaveBtn").onclick = () => send("leave");
$("startBtn").onclick = () => send("start");
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
$("refreshBtn").onclick = () => send("refresh");
$("nextBtn").onclick = () => send("nextRound", { round: state?.game?.round });
$("endBtn").onclick = () => {
  if (confirm("End the game for everyone?")) send("endGame");
};

function renderPlayers(ul, s, { showEmpty = false } = {}) {
  ul.innerHTML = "";
  for (const p of s.players) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="avatar"></span><span class="pname"></span>`;
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
  const prevVersion = state?.game ? `${state.game.round}-${state.game.wordVersion}` : null;
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

  show("game");
  $("round").textContent = s.game.round;
  $("totalRounds").textContent = s.game.totalRounds;
  const changed = prevVersion !== `${s.game.round}-${s.game.wordVersion}`;
  if (changed) {
    cardCovered = false;
    navigator.vibrate?.(40);
  }
  renderCard(changed);
  renderPlayers($("gamePlayers"), s);
  $("nextBtn").textContent = s.game.round >= s.game.totalRounds ? "Finish" : "Next round";
  $("endBtn").style.visibility = isHost ? "visible" : "hidden";
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
