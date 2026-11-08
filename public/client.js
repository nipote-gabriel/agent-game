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

// Only touch the DOM when a value actually changes, so nothing flickers on each poll.
function setText(el, text) {
  text = String(text);
  if (el.textContent !== text) el.textContent = text;
}
function setHidden(el, hidden) {
  hidden = Boolean(hidden);
  if (el.hidden !== hidden) el.hidden = hidden;
}

function show(view) {
  for (const v of ["home", "lobby", "game", "over"]) $(v).hidden = v !== view;
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
$("gameLeaveBtn").onclick = () => {
  if (confirm("Leave the game?\n\nThis ends the game for everyone.")) send("leave");
};
$("endBtn").onclick = () => {
  if (confirm("End the game for everyone?")) send("endGame");
};

// Player name tags. In a game they double as the lock-in buttons: tap someone to
// lock them in as the Agent (only you can see your own lock).
function renderPlayers(ul, s, { showEmpty = false, votes = null, judgeId = null, lockable = false, figures = false } = {}) {
  const myLock = s.game?.myLock;
  // Only rebuild when something visible changed, so the tags don't flicker each poll.
  const key = JSON.stringify([s.players, s.you, s.hostId, showEmpty, votes, judgeId, lockable && myLock, lockable, figures]);
  if (ul._key === key) return;
  ul._key = key;
  ul.innerHTML = "";
  for (const p of s.players) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="avatar"></span><span class="pname"></span>`;
    li.querySelector(".avatar").textContent = p.avatar;
    li.querySelector(".pname").textContent = p.name + (p.id === s.you ? " (you)" : "");
    if (figures && p.figure) {
      const fig = document.createElement("span");
      fig.className = "figure";
      fig.textContent = p.figure;
      li.querySelector(".pname").appendChild(fig);
    }
    if (votes?.includes(p.id)) {
      li.classList.add("voted");
      li.insertAdjacentHTML("beforeend", `<span class="check" aria-label="voted">✓</span>`);
    }
    if (lockable && p.id === myLock) {
      li.classList.add("locked");
      li.insertAdjacentHTML("beforeend", `<span class="lock" aria-label="locked in">🔒</span>`);
    }
    if (p.id === judgeId) {
      li.classList.add("judge");
      const tag = document.createElement("span");
      tag.className = "tag judge-tag";
      tag.textContent = "⚖️ Judge";
      li.appendChild(tag);
    } else if (p.id === s.hostId) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "host";
      li.appendChild(tag);
    }
    if (lockable && p.id !== s.you) {
      li.classList.add("lockable");
      li.setAttribute("role", "button");
      li.onclick = () => toggleLock(p);
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

function toggleLock(p) {
  const g = state?.game;
  if (!g || g.phase !== "play") return;
  if (g.myLock === p.id) {
    if (confirm(`Unlock ${p.name}?`)) send("lock", { target: null });
  } else if (confirm(`Lock in ${p.name} as the Agent?\n\nIf both Citizens are locked in at the same time, the game ends.`)) {
    send("lock", { target: p.id });
  }
}

// --- Agent's guess ---
$("guessForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("guessInput").value.trim();
  if (!text) return $("guessInput").focus();
  if (!confirm(`Guess "${text}"?\n\nYou get one guess per round.`)) return;
  $("guessInput").blur();
  await send("guess", { text }, $("guessBtn"));
  if (state?.card?.lastGuessWrong) $("guessInput").value = "";
});

// The Agent's mask from the previous round, to highlight newly revealed letters.
let prevRoundMask = null;
let lastMask = null;
let cardKey = null;
function renderCard(animate = false) {
  const card = $("card");
  const c = state?.card;
  if (!c) return;
  // Only rebuild when something changed, so animations don't replay every poll.
  const key = [cardCovered, c.type, c.mask, c.text].join("|");
  if (key === cardKey && !animate) return;
  cardKey = key;
  card.className = "card " + (cardCovered ? "covered" : c.type);
  card.innerHTML = "";
  if (cardCovered) {
    card.textContent = "Tap to reveal";
  } else if (c.type === "agent") {
    // Hangman blanks; letters revealed since last time get a highlight.
    const label = document.createElement("span");
    label.className = "card-label";
    label.textContent = "🕵️ You're the Agent";
    const mask = document.createElement("span");
    mask.className = "phrase mask" + (c.mask.replace(/[^a-z0-9_]/gi, "").length > 20 ? " long" : "");
    let i = 0;
    for (const word of c.mask.split(" ")) {
      const w = document.createElement("span");
      w.className = "word";
      for (const ch of word) {
        const span = document.createElement("span");
        const isBlank = ch === "_";
        span.className = "ch" + (/[a-z0-9_]/i.test(ch) ? "" : " punct");
        if (!isBlank && prevRoundMask && prevRoundMask[i] === "_") span.classList.add("new");
        span.textContent = isBlank ? "\u00a0" : ch.toUpperCase();
        w.appendChild(span);
        i++;
      }
      i++; // the space
      mask.appendChild(w);
    }
    let hint = null;
    if (c.hint) {
      hint = document.createElement("span");
      hint.className = "hint";
      hint.innerHTML = `<span class="hint-label">Hint</span><span class="hint-word"></span>`;
      hint.lastChild.textContent = c.hint;
    }
    const blanks = (c.mask.match(/_/g) || []).length;
    const total = (c.mask.match(/[a-z0-9_]/gi) || []).length;
    const letters = document.createElement("span");
    letters.className = "letters";
    letters.textContent = `${total - blanks} of ${total} letters shown`;
    card.append(...[label, mask, hint, letters].filter(Boolean));
  } else {
    const label = document.createElement("span");
    label.className = "card-label";
    label.textContent = "Citizen · the phrase is";
    const phrase = document.createElement("span");
    phrase.className = "phrase" + (c.text.length > 24 ? " long" : "");
    phrase.textContent = c.text;
    card.append(label, phrase);
  }
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
    renderPlayers($("players"), s, { showEmpty: true, figures: true });

    const me = s.players.find((p) => p.id === s.you);
    const taken = new Set(s.players.filter((p) => p.id !== s.you).map((p) => p.avatar));
    const box = $("avatars");
    const avKey = JSON.stringify([me.avatar, [...taken]]);
    if (box._key !== avKey) {
      box._key = avKey;
      box.innerHTML = "";
      for (const f of s.avatars) {
        const b = document.createElement("button");
        b.className = "avatar-btn" + (f.emoji === me.avatar ? " selected" : "");
        b.innerHTML = `<span class="av-emoji"></span><span class="av-name"></span>`;
        b.firstChild.textContent = f.emoji;
        b.lastChild.textContent = f.name;
        b.disabled = taken.has(f.emoji);
        b.setAttribute("aria-label", f.name);
        b.onclick = () => send("setAvatar", { avatar: f.emoji });
        box.appendChild(b);
      }
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

  if (s.game.phase === "result") return renderResult(s);

  show("game");
  const g = s.game;
  setText($("round"), g.round);
  setText($("totalRounds"), g.totalRounds);
  $("endBtn").style.visibility = isHost ? "visible" : "hidden";
  const last = g.round >= g.totalRounds;
  setText($("lockHint"), g.myLock
    ? "🔒 You're locked in. Tap the name again to unlock."
    : "Think you know the Agent? Tap their name to lock in.");

  // New round: the Agent gets a new letter (highlighted). Cards don't animate, so
  // the Citizens' screens stay still. A hidden card stays hidden until you tap it.
  const changed = prevRound !== g.round;
  if (changed) {
    if (prevRound === null) cardCovered = false; // a new game starts face up
    navigator.vibrate?.(40);
    if (s.card.type === "agent") {
      prevRoundMask = lastMask;
      lastMask = s.card.mask;
    }
  }
  renderCard();

  // The Agent's guess box (one guess per round).
  const isAgent = s.card.type === "agent";
  setHidden($("guessForm"), !isAgent || !s.card.canGuess);
  const hint = $("guessHint");
  setHidden(hint, !isAgent);
  hint.classList.toggle("wrong", Boolean(s.card.lastGuessWrong));
  if (isAgent) {
    setText(hint, s.card.canGuess
      ? "Guess the phrase to win. One guess per round."
      : s.card.lastGuessWrong
        ? `"${s.card.lastGuessWrong}" was wrong. You can guess again next round.`
        : "You've guessed this round.");
  }

  renderPlayers($("gamePlayers"), s, { votes: g.votes, judgeId: g.judgeId, lockable: true });
  const btn = $("nextBtn");
  setHidden(btn, last);
  if (last) {
    setText($("voteHint"), "Final round: the Citizens must lock in (or the Agent guesses).");
    return;
  }
  const iVoted = g.votes.includes(s.you);
  setText(btn, iVoted ? "✓ Voted · tap to undo" : "Next round");
  btn.classList.toggle("voted", iVoted);
  btn.classList.toggle("primary", !iVoted);
  setText($("voteHint"), `${g.votes.length}/${g.votesNeeded} votes to move on`);
}

const REASONS = {
  locked: "Both Citizens locked in on the Agent.",
  split: "The Citizens locked in on different players.",
  framed: "The Agent and a Citizen locked in on the same player.",
  guessed: "The Agent guessed the phrase.",
};

function renderResult(s) {
  const firstShow = $("over").hidden;
  show("over");
  lastMask = prevRoundMask = cardKey = null;
  const r = s.game.result;
  const byId = Object.fromEntries(r.roster.map((p) => [p.id, p]));
  const iAmAgent = s.you === r.agentId;
  const iWon = (r.outcome === "agent") === iAmAgent;

  $("banner").className = "banner " + r.outcome;
  $("bannerEmoji").textContent = r.outcome === "citizens" ? "🎉" : "🕵️";
  $("bannerTitle").textContent = r.outcome === "citizens" ? "Citizens win!" : "The Agent wins!";
  $("bannerSub").textContent = iWon ? "You won! 🏆" : "You lost.";
  $("bannerReason").textContent =
    r.reason === "guessed" ? `The Agent guessed "${r.winningGuess}".` : REASONS[r.reason];
  if (firstShow) navigator.vibrate?.(iWon ? [60, 60, 120] : 60);

  const agent = byId[r.agentId];
  $("agentReveal").innerHTML = `<span class="avatar"></span><span></span>`;
  $("agentReveal").firstChild.textContent = agent.avatar;
  $("agentReveal").lastChild.textContent = agent.name + (iAmAgent ? " (you)" : "");

  $("phraseReveal").textContent = r.phrase;
  $("hintReveal").textContent = r.hint ? `The Agent's hint: ${r.hint}` : "";
  const total = (r.phrase.match(/[a-z0-9]/gi) || []).length;
  const n = s.game.round;
  $("lettersShown").textContent =
    `Ended in round ${n} · the Agent had ${r.lettersShown} of ${total} letters`;

  // Everyone's lock-in. Citizens get ✓/✗; the Agent's row is labelled.
  const list = $("voteList");
  list.innerHTML = "";
  const order = [...r.roster].sort((x, y) => (x.id === r.agentId) - (y.id === r.agentId));
  for (const p of order) {
    const target = byId[r.locks[p.id]];
    const li = document.createElement("li");
    const who = p.id === s.you ? "You" : p.name;
    if (!target) {
      li.innerHTML = `<span class="avatar"></span><span class="pname"></span><span class="mark muted">not locked</span>`;
      li.children[0].textContent = p.avatar;
      li.children[1].textContent = who;
    } else {
      li.innerHTML = `<span class="avatar"></span><span class="pname"></span><span class="arrow">🔒</span><span class="avatar"></span><span class="pname"></span><span class="mark"></span>`;
      const [a1, n1, , a2, n2, mark] = li.children;
      a1.textContent = p.avatar;
      n1.textContent = who;
      a2.textContent = target.avatar;
      n2.textContent = target.id === s.you ? "you" : target.name;
      if (p.id === r.agentId) {
        mark.textContent = "Agent";
        mark.classList.add("muted");
      } else {
        const right = target.id === r.agentId;
        mark.textContent = right ? "✓" : "✗";
        mark.classList.add(right ? "right" : "wrong");
      }
    }
    list.appendChild(li);
  }

  const guesses = $("wordList");
  guesses.innerHTML = "";
  for (const text of r.guesses) {
    const li = document.createElement("li");
    li.textContent = text;
    guesses.appendChild(li);
  }
  $("guessesBox").hidden = !r.guesses.length;
  $("overSummary").textContent = "";
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
