const $ = (id) => document.getElementById(id);
const POLL_MS = 1000;
let state = null;
let session = load("session"); // { code, token } of the lobby we're in
let pollTimer = null;
let lastNotice = null;

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

function flash(el, msg, ms = 3500) {
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), ms);
}

function playerList(ul, players, s) {
  ul.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="avatar"></span><span class="pname"></span>`;
    li.querySelector(".avatar").textContent = p.avatar;
    li.querySelector(".pname").textContent =
      p.name + (p.id === s.you ? " (you)" : "") + (p.id === s.hostId ? " ★" : "");
    ul.appendChild(li);
  }
}

function goHome(msg) {
  session = null;
  save("session", null);
  state = null;
  lastNotice = null;
  clearTimeout(pollTimer);
  show("home");
  if (msg) flash($("error"), msg);
}

// Handle any server response: { state } | { gone } | { error }.
function handle(res) {
  if (res.error) return flash($("error"), res.error);
  if (res.gone) return goHome(session ? "You're no longer in that lobby." : null);
  if (res.token) {
    session = { code: res.state.code, token: res.token };
    save("session", session);
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
    flash($("error"), "Couldn't reach the server.");
  }
}

async function poll() {
  if (!session) return;
  const mine = session;
  try {
    const r = await fetch(`/api/state?code=${encodeURIComponent(mine.code)}&token=${encodeURIComponent(mine.token)}`);
    if (session === mine) handle(await r.json());
  } catch {
    // network blip: just try again next tick
  }
  if (session === mine) schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, POLL_MS);
}

$("createBtn").onclick = () => send("create", info());
$("joinBtn").onclick = () => send("join", { ...info(), code: $("codeInput").value });
$("codeInput").addEventListener("keydown", (e) => e.key === "Enter" && $("joinBtn").click());
$("startBtn").onclick = () => send("start");
$("leaveBtn").onclick = () => send("leave");
$("refreshBtn").onclick = () => send("refresh");
$("nextBtn").onclick = () => send("nextRound", { round: state?.game?.round });
$("endBtn").onclick = () => send("endGame");
$("rounds").onchange = (e) => send("setRounds", { rounds: e.target.value });
// Check in right away when the tab comes back into view.
document.addEventListener("visibilitychange", () => !document.hidden && session && poll());

function render(s) {
  if (s.notice && s.notice.id !== lastNotice) {
    if (lastNotice !== null || state) flash($("notice"), s.notice.text, 5000);
  }
  lastNotice = s.notice ? s.notice.id : "";
  const prevVersion = state?.game ? `${state.game.round}-${state.game.wordVersion}` : null;
  state = s;
  const isHost = s.you === s.hostId;
  const full = s.players.length === s.maxPlayers;

  if (!s.game) {
    show("lobby");
    $("lobbyCode").textContent = s.code;
    playerList($("players"), s.players, s);

    const me = s.players.find((p) => p.id === s.you);
    const taken = new Set(s.players.filter((p) => p.id !== s.you).map((p) => p.avatar));
    const box = $("avatars");
    box.innerHTML = "";
    for (const a of s.avatars) {
      const b = document.createElement("button");
      b.textContent = a;
      b.className = "avatar-btn" + (a === me.avatar ? " selected" : "");
      b.disabled = taken.has(a);
      b.onclick = () => send("setAvatar", { avatar: a });
      box.appendChild(b);
    }

    const rounds = $("rounds");
    rounds.disabled = !isHost;
    if (document.activeElement !== rounds) rounds.value = s.rounds;
    $("roundsHint").textContent = isHost ? "" : "Only the host (★) can change the rounds.";

    $("startBtn").hidden = !isHost;
    $("startBtn").disabled = !full;
    $("startHint").textContent = full
      ? isHost ? "Everyone's here!" : "Waiting for the host to start…"
      : `Waiting for players (${s.players.length}/${s.maxPlayers})…`;
    return;
  }

  show("game");
  $("round").textContent = s.game.round;
  $("totalRounds").textContent = s.game.totalRounds;
  const card = $("card");
  card.textContent = s.card.text;
  card.className = "card " + s.card.type;
  if (prevVersion !== `${s.game.round}-${s.game.wordVersion}`) {
    void card.offsetWidth; // restart the flip animation
    card.classList.add("flip");
  }
  playerList($("gamePlayers"), s.players, s);
  $("nextBtn").textContent = s.game.round >= s.game.totalRounds ? "Finish game" : "Next round";
  $("endBtn").hidden = !isHost;
}

// Rejoin the lobby we were in if the page was reloaded.
if (session) poll();
else show("home");
