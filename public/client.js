const socket = io();
const $ = (id) => document.getElementById(id);
let state = null;

const nameInput = $("name");
nameInput.value = localStorage.getItem("name") || "";
const info = () => {
  localStorage.setItem("name", nameInput.value.trim());
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

$("createBtn").onclick = () => socket.emit("create", info());
$("joinBtn").onclick = () => socket.emit("join", { ...info(), code: $("codeInput").value });
$("codeInput").addEventListener("keydown", (e) => e.key === "Enter" && $("joinBtn").click());
$("startBtn").onclick = () => socket.emit("start");
$("leaveBtn").onclick = () => socket.emit("leave");
$("refreshBtn").onclick = () => socket.emit("refresh");
$("nextBtn").onclick = () => socket.emit("nextRound");
$("endBtn").onclick = () => socket.emit("endGame");
$("rounds").onchange = (e) => socket.emit("setRounds", e.target.value);

socket.on("errorMsg", (msg) => flash($("error"), msg));
socket.on("notice", (msg) => flash($("notice"), msg, 5000));
socket.on("left", () => {
  state = null;
  show("home");
});
socket.on("disconnect", () => {
  state = null;
  show("home");
  flash($("error"), "Disconnected from server.");
});

socket.on("state", (s) => {
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
      b.onclick = () => socket.emit("setAvatar", a);
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
});
