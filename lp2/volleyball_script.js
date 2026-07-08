import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, updateDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FB = {
  apiKey: "AIzaSyCaUc9WOOBcvSinLVpxwbdojXvbuSMQBBM",
  authDomain: "statsapp-a199b.firebaseapp.com",
  projectId: "statsapp-a199b",
  storageBucket: "statsapp-a199b.appspot.com",
  messagingSenderId: "695414880372",
  appId: "1:695414880372:web:bd07071a02390219bd3921"
};
const app  = initializeApp(FB);
const auth = getAuth(app);
const db   = getFirestore(app);

const params    = new URLSearchParams(window.location.search);
const ROOM_CODE = params.get("room")?.toUpperCase() || null;
let roomRef     = null;
let unsubscribe = null;

// ── Local state ──
let homeSets = 0, awaySets = 0;
let homeSetScore = 0, awaySetScore = 0;
let currentSet = 1;
let setScores  = [];
let homeTeam   = null, awayTeam = null;
let currentRoster  = { home: [], away: [] };
let activePlayers  = { home: [], away: [] };
let selectedPlayer = null;
let selectedTeam   = "";
let playerStats    = {};
let undoStack      = [];
const UNDO_LIMIT   = 30;
let saveTimer       = null;
let localChangeAt   = 0;   // timestamp of last local change — blocks Firestore echo for 1.5s
let subModal_side   = null;
let boxGrid         = { home: null, away: null };
let setTarget       = 25;  // points needed to win a set (editable by scorekeeper)

// ── Helpers ──
function el(id)      { return document.getElementById(id); }
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

function freshPlayerStat() {
  return { kills:0, aces:0, blocks:0, digs:0, assists:0, attackErrors:0, serviceErrors:0, timestamps:[] };
}

function showToast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(t._timer); t._timer = setTimeout(() => t.style.opacity = "0", 2200);
}

// ── Undo ──
function pushUndo() {
  undoStack.push({
    playerStats: deepClone(playerStats),
    homeSetScore, awaySetScore, homeSets, awaySets,
    currentSet, setScores: deepClone(setScores),
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

window.undoLastStat = function() {
  if (!undoStack.length) { showToast("Nothing to undo"); return; }
  const prev = undoStack.pop();
  playerStats  = prev.playerStats;
  homeSetScore = prev.homeSetScore;
  awaySetScore = prev.awaySetScore;
  homeSets     = prev.homeSets;
  awaySets     = prev.awaySets;
  currentSet   = prev.currentSet;
  setScores    = prev.setScores;
  localChangeAt = Date.now();
  renderScoreboard();
  scheduleSave();
};

// ── Auth + boot ──
onAuthStateChanged(auth, async user => {
  if (!ROOM_CODE) {
    el("no-room-view").style.display = "block";
    return;
  }
  if (user) {
    try {
      const uSnap = await getDoc(doc(db, "users", user.uid));
      if (uSnap.exists()) {
        const profile = uSnap.data();
        buildVBNav(profile, auth);
        if (profile.role === "admin" || profile.role === "stats") {
          applyScorekeeper();
        }
        if (profile.role === "coach") {
          el("nav-live-badge").style.display = "list-item";
        }
      }
    } catch (e) {
      console.error("Auth load failed:", e);
    }
  }
  subscribeToRoom();
});

function buildVBNav(profile, auth) {
  const container = document.getElementById("vb-nav-right");
  if (!container) return;
  const displayName = profile.username ? `@${profile.username}` : profile.name;
  const roleMap = { admin: "Admin", stats: "Scorekeeper", coach: "Coach" };
  container.innerHTML = `
    <div class="nav-user">
      <span class="nav-user-name" style="font-size:13px">${displayName}</span>
      <span class="nav-user-role nav-role-${profile.role}" style="font-size:10px">${roleMap[profile.role] || profile.role}</span>
      <button class="nav-logout-btn" id="nav-logout" style="font-size:12px;padding:5px 10px">Logout</button>
    </div>`;
  document.getElementById("nav-logout").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}

function applyScorekeeper() {
  document.querySelectorAll(".scorekeeper-only").forEach(node => node.style.display = "");
  el("scorekeeper-controls").style.display       = "block";
  el("scorekeeper-stats-controls").style.display = "block";

  // Wire target score input
  const targetInput = el("set-target-input");
  if (targetInput) {
    targetInput.value = setTarget;
    targetInput.addEventListener("change", () => {
      const v = parseInt(targetInput.value);
      if (v >= 1 && v <= 99) {
        setTarget = v;
        renderScoreboard();
        scheduleSave();
      }
    });
  }
}

// ── Subscribe to room ──
function subscribeToRoom() {
  roomRef = doc(db, "gameRooms", ROOM_CODE);
  unsubscribe = onSnapshot(roomRef, snap => {
    if (!snap.exists()) {
      el("no-room-view").style.display = "block";
      el("app-view").style.display     = "none";
      return;
    }
    el("app-view").style.display     = "block";
    el("no-room-view").style.display = "none";
    el("room-badge").textContent = ROOM_CODE;

    const data = snap.data();
    // Don't let Firestore echo overwrite local changes within 1.5s of a user action
    if (Date.now() - localChangeAt < 1500) return;

    homeTeam = data.homeTeam || { name:"Home", roster:[] };
    awayTeam = data.awayTeam || { name:"Away", roster:[] };

    homeSets     = data.homeSets     || 0;
    awaySets     = data.awaySets     || 0;
    homeSetScore = data.homeSetScore || 0;
    awaySetScore = data.awaySetScore || 0;
    currentSet   = data.currentSet   || 1;
    setScores    = data.setScores    || [];
    playerStats  = data.playerStats  || {};
    if (data.setTarget) {
      setTarget = data.setTarget;
      const inp = el("set-target-input");
      if (inp) inp.value = setTarget;
    }

    if (!currentRoster.home.length && !currentRoster.away.length) {
      currentRoster.home = homeTeam.roster || [];
      currentRoster.away = awayTeam.roster || [];
      activePlayers.home = currentRoster.home.slice(0, 6);
      activePlayers.away = currentRoster.away.slice(0, 6);
    }

    renderScoreboard();
    renderRosters();

    if (data.log) el("player-log").innerHTML = data.log;
    if (data.status === "done") showMatchOverModal();
  });
}

// ── Scoreboard render ──
function renderScoreboard() {
  el("home-team-name").textContent = homeTeam?.name || "HOME";
  el("away-team-name").textContent = awayTeam?.name || "AWAY";
  el("home-set-score").textContent = homeSetScore;
  el("away-set-score").textContent = awaySetScore;
  el("home-sets").textContent      = homeSets;
  el("away-sets").textContent      = awaySets;
  el("vb-home-set-pts").textContent = homeSetScore;
  el("vb-away-set-pts").textContent = awaySetScore;
  el("vb-set-num").textContent     = `SET ${currentSet}`;

  el("vb-target").textContent = `First to ${setTarget} (win by 2)`;

  // Sets-won dots
  const dotsEl = el("vb-sets-won");
  dotsEl.innerHTML = `
    <div class="vb-sets-dots">
      ${[...Array(3)].map((_, i) => `<div class="vb-dot${i < homeSets ? " won" : ""}"></div>`).join("")}
    </div>
    <span style="font-size:11px;color:var(--t3)">${homeTeam?.name || "HOME"} sets</span>
    <span style="font-size:11px;color:var(--t3)">—</span>
    <span style="font-size:11px;color:var(--t3)">${awayTeam?.name || "AWAY"} sets</span>
    <div class="vb-sets-dots">
      ${[...Array(3)].map((_, i) => `<div class="vb-dot${i < awaySets ? " won" : ""}"></div>`).join("")}
    </div>`;

  renderBoxScore();
}

// ── Roster rendering ──
function renderRosters() {
  renderTeamRoster("home");
  renderTeamRoster("away");
}

function renderTeamRoster(side) {
  const ul      = el(`${side}-roster`);
  const players = activePlayers[side];
  ul.innerHTML  = "";
  players.forEach((p, i) => {
    const li = document.createElement("li");
    const isSelected = selectedPlayer?.side === side && selectedPlayer?.index === i;
    li.className = isSelected ? "selected" : "";
    li.innerHTML = `<span class="pnum">#${p.number}</span><span class="pname">${p.name}</span>`;
    li.onclick = () => selectPlayer(side, i);
    ul.appendChild(li);
  });
}

function selectPlayer(side, index) {
  if (selectedPlayer?.side === side && selectedPlayer?.index === index) {
    selectedPlayer = null;
    selectedTeam   = "";
  } else {
    selectedPlayer = { side, index };
    selectedTeam   = side;
  }
  updateSelIndicator();
  renderRosters();
}

function updateSelIndicator() {
  const dot  = el("sel-indicator").querySelector(".si-dot");
  const lbl  = el("sel-label");
  if (!selectedPlayer) {
    dot.className = "si-dot off"; lbl.textContent = "No player selected"; return;
  }
  const p = activePlayers[selectedPlayer.side][selectedPlayer.index];
  dot.className = "si-dot on";
  lbl.textContent = `#${p.number} ${p.name} (${selectedPlayer.side === "home" ? homeTeam?.name : awayTeam?.name})`;
}

// ── Stat handling ──
window.handleStat = function(stat, label) {
  if (!selectedPlayer) { showToast("Tap a player first"); return; }

  pushUndo();
  localChangeAt = Date.now();

  const side = selectedPlayer.side;
  const p    = activePlayers[side][selectedPlayer.index];
  const key  = `${p.name}_${p.number}_${side}`;

  if (!playerStats[key]) playerStats[key] = freshPlayerStat();
  playerStats[key][stat] = (playerStats[key][stat] || 0) + 1;
  playerStats[key].timestamps.push(Date.now());

  const scoringStats = ["kills", "aces", "blocks"];
  const errorStats   = ["attackErrors", "serviceErrors"];

  if (scoringStats.includes(stat)) {
    awardPointInternal(side);
  } else if (errorStats.includes(stat)) {
    awardPointInternal(side === "home" ? "away" : "home");
  }

  appendLog(`${p.name} — ${label}`);
  renderScoreboard();
  scheduleSave();
};

window.awardPoint = function(side) {
  pushUndo();
  localChangeAt = Date.now();
  awardPointInternal(side);
  renderScoreboard();
  scheduleSave();
};

function awardPointInternal(side) {
  if (side === "home") homeSetScore++;
  else                 awaySetScore++;
  checkSetEnd();
};

function checkSetEnd() {
  if (homeSetScore >= setTarget && homeSetScore - awaySetScore >= 2) {
    endSet("home");
  } else if (awaySetScore >= setTarget && awaySetScore - homeSetScore >= 2) {
    endSet("away");
  }
}

function endSet(winner) {
  setScores.push({ home: homeSetScore, away: awaySetScore });
  appendLog(`--- Set ${currentSet} ended: ${homeTeam?.name || "Home"} ${homeSetScore} – ${awaySetScore} ${awayTeam?.name || "Away"} ---`);

  if (winner === "home") homeSets++;
  else                   awaySets++;

  homeSetScore = 0;
  awaySetScore = 0;
  currentSet++;

  if (homeSets >= 3 || awaySets >= 3) {
    endMatch();
  }
}

async function endMatch() {
  try {
    await updateDoc(roomRef, {
      homeSets, awaySets, homeSetScore, awaySetScore,
      homeScore: homeSets, awayScore: awaySets,
      currentSet, setScores, setTarget, playerStats,
      status: "done", updatedAt: serverTimestamp(),
    });
  } catch (e) { console.error("endMatch save:", e); }
  showMatchOverModal();
}

function showMatchOverModal() {
  const homeWon = homeSets > awaySets;
  const winner  = homeWon ? (homeTeam?.name || "Home") : (awayTeam?.name || "Away");
  el("match-over-display").innerHTML = `
    <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--gold);margin-bottom:8px">${winner} Wins!</div>
    <div style="font-size:36px;font-family:'Bebas Neue',sans-serif">${homeSets} — ${awaySets}</div>
    <div style="font-size:12px;color:var(--t3);margin-top:4px">Sets won</div>`;
  el("set-scores-display").innerHTML = setScores.map((s, i) =>
    `<span style="margin:0 6px">Set ${i+1}: ${s.home}–${s.away}</span>`
  ).join(" · ");
  el("match-over-modal").style.display = "flex";
}

// ── End match confirmation ──
window.confirmEndMatch = function() {
  const homeN = homeTeam?.name || "Home";
  const awayN = awayTeam?.name || "Away";
  el("end-score-display").innerHTML = `
    <div style="text-align:center">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;margin-bottom:6px">${homeN} ${homeSets} — ${awaySets} ${awayN}</div>
      <div style="font-size:12px;color:var(--t3)">Current set: ${homeSetScore}–${awaySetScore}</div>
    </div>`;
  const modal = el("end-match-modal");
  modal.style.display = "flex";
  el("end-match-confirm-btn").onclick = async () => {
    modal.style.display = "none";
    await endMatch();
  };
  el("end-match-cancel-btn").onclick = () => { modal.style.display = "none"; };
};

// ── View toggle ──
window.toggleView = function(view) {
  ["scoreboard","stats"].forEach(v => {
    el(`${v}-view`).classList.toggle("active", v === view);
    el(`${v}-toggle`).classList.toggle("active", v === view);
  });
  if (view === "stats") renderBoxScore();
};

window.showTab = function(tab) {
  ["home","away","log"].forEach(t => {
    el(`${t}-stats-tab`).classList.toggle("active", t === tab);
    el(`${t}-tab`).classList.toggle("active", t === tab);
  });
};

// ── Box score ──
function renderBoxScore() {
  renderTeamBox("home");
  renderTeamBox("away");
}

function renderTeamBox(side) {
  const container = el(`${side}-stats`);
  const teamName  = side === "home" ? (homeTeam?.name || "Home") : (awayTeam?.name || "Away");
  const players   = currentRoster[side];

  if (!players.length) { container.innerHTML = `<p style="color:var(--t3);padding:20px">No roster loaded.</p>`; return; }

  const rows = players.map(p => {
    const key  = `${p.name}_${p.number}_${side}`;
    const s    = playerStats[key] || freshPlayerStat();
    return [p.number, p.name, s.kills, s.attackErrors, s.assists, s.digs, s.aces, s.blocks];
  });

  if (boxGrid[side]) { boxGrid[side].destroy(); }

  boxGrid[side] = new gridjs.Grid({
    columns: ["#","Name","K","E","AST","DIG","ACE","BLK"],
    data: rows,
    sort: false,
    style: {
      table: { background:"var(--bg1)", border:"none" },
      th:    { background:"var(--bg2)", color:"var(--t3)", fontSize:"11px", fontWeight:"700", letterSpacing:".5px", padding:"8px 12px", border:"none", borderBottom:"1px solid var(--line)" },
      td:    { color:"var(--t1)", fontSize:"14px", padding:"10px 12px", border:"none", borderBottom:"1px solid var(--line)" },
    }
  }).render(container);
}

// ── Export ──
window.exportStats = function() {
  ["home","away"].forEach(side => {
    const players = currentRoster[side];
    const rows = players.map(p => {
      const key = `${p.name}_${p.number}_${side}`;
      const s   = playerStats[key] || freshPlayerStat();
      return { "#": p.number, Name: p.name, K: s.kills, E: s.attackErrors, AST: s.assists, DIG: s.digs, ACE: s.aces, BLK: s.blocks };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, side === "home" ? homeTeam?.name || "Home" : awayTeam?.name || "Away");
    XLSX.writeFile(wb, `${ROOM_CODE}_${side}_volleyball_stats.xlsx`);
  });
};

// ── Substitution modal ──
window.openSubstitutionModal = function(side) {
  subModal_side = side;
  const onCourt  = activePlayers[side];
  const allRoster = currentRoster[side];
  const offBench = allRoster.filter(p => !onCourt.some(a => a.name === p.name && a.number === p.number));

  const onSel  = el("players-on-court");
  const offSel = el("players-off-court");
  onSel.innerHTML  = onCourt.map( p => `<option value="${p.number}|${p.name}">#${p.number} ${p.name}</option>`).join("");
  offSel.innerHTML = offBench.map(p => `<option value="${p.number}|${p.name}">#${p.number} ${p.name}</option>`).join("");
  el("substitution-modal").style.display = "flex";
};

window.closeSubstitutionModal = function() {
  el("substitution-modal").style.display = "none";
};

window.performSubstitution = function() {
  const side    = subModal_side;
  const outVal  = el("players-on-court").value;
  const inVal   = el("players-off-court").value;
  if (!outVal || !inVal) { showToast("Select both players"); return; }

  const [outNum, outName] = outVal.split("|");
  const [inNum,  inName ] = inVal.split("|");

  const outP = currentRoster[side].find(p => String(p.number) === outNum && p.name === outName);
  const inP  = currentRoster[side].find(p => String(p.number) === inNum  && p.name === inName);
  if (!outP || !inP) return;

  const idx = activePlayers[side].findIndex(p => p.name === outName && String(p.number) === outNum);
  if (idx !== -1) activePlayers[side][idx] = inP;

  appendLog(`Sub: ${inName} in for ${outName} (${side})`);
  closeSubstitutionModal();
  renderRosters();
  if (selectedPlayer?.side === side) { selectedPlayer = null; selectedTeam = ""; updateSelIndicator(); }
};

// ── Log ──
function appendLog(line) {
  const logEl = el("player-log");
  const set   = `Set ${currentSet}`;
  logEl.innerHTML = `<div class="log-entry"><span class="log-time">${set}</span> ${line}</div>` + logEl.innerHTML;
}

// ── Debounced save ──
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToFirestore, 400);
}

async function saveToFirestore() {
  if (!roomRef) return;
  const logEl = el("player-log");
  try {
    await updateDoc(roomRef, {
      homeSets, awaySets, homeSetScore, awaySetScore,
      homeScore: homeSets, awayScore: awaySets,
      currentSet, setScores, setTarget, playerStats,
      log: logEl ? logEl.innerHTML : "",
      updatedAt: serverTimestamp(),
    });
  } catch (e) { console.error("saveToFirestore:", e); }
}
