// ================================================
//  SPORT PERFORMANCE STATS — COACH VIEW (READ-ONLY)
//  Listens to gameRooms/{code} via onSnapshot
//  Shows live score, roster, player stats, charts
//  No write access — purely observational
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FB = {
  apiKey: "AIzaSyCaUc9WOOBcvSinLVpxwbdojXvbuSMQBBM",
  authDomain: "statsapp-a199b.firebaseapp.com",
  projectId: "statsapp-a199b",
  storageBucket: "statsapp-a199b.appspot.com",
  messagingSenderId: "695414880372",
  appId: "1:695414880372:web:bd07071a02390219bd3921"
};
const app = initializeApp(FB);
const db  = getFirestore(app);

// ── URL params ──
const params    = new URLSearchParams(window.location.search);
const ROOM_CODE = params.get("room")?.toUpperCase() || null;
const TEAM_SIDE = params.get("team")?.toLowerCase() || "home"; // "home" or "away"

// ── State ──
let gameData    = null;
let shootChart  = null;
let topChart    = null;

const C = {
  gold:"#f5c518", blue:"#3b82f6", teal:"#14b8a6",
  grn:"#22c55e",  red:"#ef4444",  purple:"#a855f7",
  line:"#2e3550", t2:"#8b95b0",   t3:"#4d5470"
};

// ── Boot ──
document.addEventListener("DOMContentLoaded", () => {
  if (!ROOM_CODE) {
    document.getElementById("no-room").style.display = "flex";
    return;
  }

  document.getElementById("coach-app").style.display = "block";
  document.getElementById("ch-room").textContent = `ROOM ${ROOM_CODE}`;
  document.title = `Coach · ${ROOM_CODE}`;

  initCharts();

  // Real-time listener — read only
  const roomRef = doc(db, "gameRooms", ROOM_CODE);
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      document.getElementById("ch-team-label").textContent = "Room not found";
      return;
    }
    gameData = snap.data();
    renderAll(gameData);
  }, (err) => {
    console.error("Snapshot error:", err);
    showToast("Connection error — retrying…");
  });
});

// ── Render everything ──
function renderAll(d) {
  if (!d) return;

  const myTeam    = TEAM_SIDE === "home" ? d.homeTeam : d.awayTeam;
  const myName    = myTeam?.name || (TEAM_SIDE === "home" ? "Home" : "Away");
  const myScore   = TEAM_SIDE === "home" ? (d.homeScore||0) : (d.awayScore||0);
  const oppScore  = TEAM_SIDE === "home" ? (d.awayScore||0) : (d.homeScore||0);
  const oppName   = (TEAM_SIDE === "home" ? d.awayTeam?.name : d.homeTeam?.name) || "Opponent";

  // Header
  el("ch-team-label").textContent = myName.toUpperCase();
  document.title = `${myName} Coach · ${ROOM_CODE}`;

  // Live indicator
  const liveEl = el("ch-live");
  if (d.status === "done") {
    liveEl.innerHTML = `<span style="color:var(--t3)">FINAL</span>`;
  }

  // Score strip
  if (TEAM_SIDE === "home") {
    el("ss-home-name").textContent  = myName.toUpperCase();
    el("ss-away-name").textContent  = oppName.toUpperCase();
    el("ss-home-score").textContent = myScore;
    el("ss-away-score").textContent = oppScore;
    el("ss-home-score").className   = "ss-score my-team";
  } else {
    el("ss-home-name").textContent  = oppName.toUpperCase();
    el("ss-away-name").textContent  = myName.toUpperCase();
    el("ss-home-score").textContent = oppScore;
    el("ss-away-score").textContent = myScore;
    el("ss-away-score").className   = "ss-score my-team";
  }

  // Clock + period
  const secs = d.clockSeconds ?? 420;
  el("ss-clock").textContent  = `${String(Math.floor(secs/60)).padStart(2,"0")}:${String(secs%60).padStart(2,"0")}`;
  el("ss-period").textContent = `P${d.period||1}`;

  // Status badge
  const statusEl = el("ss-status");
  const status = d.status || "active";
  statusEl.textContent = status === "active" ? "LIVE" : status === "done" ? "FINAL" : "PAUSED";
  statusEl.className   = `ss-status ${status === "active" ? "live" : status === "done" ? "done" : "paused"}`;

  // If game is over, show overlay at top of roster tab
  if (status === "done") renderGameOver(d, myName, oppName, myScore, oppScore);

  // Get this team's players and stats
  const roster    = myTeam?.roster || [];
  const activePl  = roster.slice(0, 5);
  const bench     = roster.slice(5);
  const pStats    = d.playerStats || {};
  const tStats    = (d.teamStats || {})[TEAM_SIDE] || {};

  renderRoster(activePl, bench, pStats);
  renderTeamStats(tStats, myScore);
  renderPlayerCards(roster, pStats);
  renderLog(pStats);
  updateCharts(roster, pStats, tStats);
}

// ── Game Over overlay ──
function renderGameOver(d, myName, oppName, myScore, oppScore) {
  const rosterTab = el("tab-roster");
  if (rosterTab.querySelector(".game-over-overlay")) return; // already added

  const won     = myScore > oppScore;
  const tied    = myScore === oppScore;
  const winner  = won ? myName : tied ? null : oppName;
  const msg     = won ? `🏆 ${myName} Wins!` : tied ? "🤝 It's a Tie!" : `${oppName} Wins`;

  const div = document.createElement("div");
  div.className = "game-over-overlay";
  div.innerHTML = `
    <div class="go-title">FINAL</div>
    <div class="go-score">${myScore} — ${oppScore}</div>
    <div class="go-winner">${msg}</div>`;
  rosterTab.insertAdjacentElement("afterbegin", div);
}

// ── Roster ──
function renderRoster(active, bench, pStats) {
  const courtUl = el("coach-on-court");
  const benchUl = el("coach-bench");
  courtUl.innerHTML = "";
  benchUl.innerHTML = "";

  const buildItem = (p) => {
    const key = findKey(p, pStats);
    const s   = key ? pStats[key] : null;
    const pts = s?.points || 0;
    const reb = s?.rebounds || 0;
    const ast = s?.assists  || 0;
    const li  = document.createElement("li");
    li.innerHTML = `
      <span class="pl-num">${p.number}</span>
      <div class="pl-info">
        <div class="pl-name">${p.name}</div>
        <div class="pl-sub">${reb} REB · ${ast} AST</div>
      </div>
      <div>
        <div class="pl-pts">${pts}</div>
        <div class="pl-pts-lbl">PTS</div>
      </div>`;
    return li;
  };

  active.forEach(p => courtUl.appendChild(buildItem(p)));
  if (!active.length) courtUl.innerHTML = `<li style="color:var(--t3);padding:12px;font-size:13px">No players on court yet.</li>`;

  bench.forEach(p => benchUl.appendChild(buildItem(p)));
  if (!bench.length) benchUl.innerHTML = `<li style="color:var(--t3);padding:12px;font-size:13px">No bench players.</li>`;
}

// ── Team Stats Pills ──
function renderTeamStats(ts, score) {
  const pct = (m, a) => a > 0 ? ((m/a)*100).toFixed(0)+"%" : "—";
  const made = (ts.shotsMade?.twoPoint||0) + (ts.shotsMade?.threePoint||0);
  const att  = (ts.shotsAttempted?.twoPoint||0) + (ts.shotsAttempted?.threePoint||0);
  const pills = [
    { val: score,          lbl: "PTS" },
    { val: pct(made, att), lbl: "FG%" },
    { val: ts.rebounds||0, lbl: "REB" },
    { val: ts.assists||0,  lbl: "AST" },
    { val: ts.steals||0,   lbl: "STL" },
    { val: ts.turnovers||0,lbl: "TOV" },
  ];
  el("coach-team-pills").innerHTML = pills.map(p => `
    <div class="tsp">
      <div class="tsp-val">${p.val}</div>
      <div class="tsp-lbl">${p.lbl}</div>
    </div>`).join("");
}

// ── Player Stat Cards ──
function renderPlayerCards(roster, pStats) {
  const cont = el("coach-player-cards");
  cont.innerHTML = "";
  const pct = (m, a) => a > 0 ? ((m/a)*100).toFixed(0)+"%" : "—";

  // Sort roster by points desc
  const sorted = [...roster].sort((a, b) => {
    const ka = findKey(a, pStats), kb = findKey(b, pStats);
    return (pStats[kb]?.points||0) - (pStats[ka]?.points||0);
  });

  sorted.forEach(p => {
    const key = findKey(p, pStats);
    const s   = key ? pStats[key] : {};
    const twoPct = pct(s.shotsMade?.twoPoint||0,  s.shotsAttempted?.twoPoint||0);
    const thrPct = pct(s.shotsMade?.threePoint||0, s.shotsAttempted?.threePoint||0);
    const ftPct  = pct(s.freeThrows||0,            s.shotsAttempted?.freeThrow||0);

    const card = document.createElement("div");
    card.className = "psc";
    card.innerHTML = `
      <div class="psc-header">
        <span class="psc-name">${p.name}</span>
        <span class="psc-num">#${p.number}</span>
      </div>
      <div class="psc-body">
        <div class="psc-stat">
          <div class="psc-stat-val highlight">${s.points||0}</div>
          <div class="psc-stat-lbl">PTS</div>
        </div>
        <div class="psc-stat">
          <div class="psc-stat-val">${s.rebounds||0}</div>
          <div class="psc-stat-lbl">REB</div>
        </div>
        <div class="psc-stat">
          <div class="psc-stat-val">${s.assists||0}</div>
          <div class="psc-stat-lbl">AST</div>
        </div>
        <div class="psc-stat">
          <div class="psc-stat-val">${s.steals||0}</div>
          <div class="psc-stat-lbl">STL</div>
        </div>
        <div class="psc-stat">
          <div class="psc-stat-val">${s.blocks||0}</div>
          <div class="psc-stat-lbl">BLK</div>
        </div>
        <div class="psc-stat">
          <div class="psc-stat-val">${s.turnovers||0}</div>
          <div class="psc-stat-lbl">TOV</div>
        </div>
        <div class="psc-stat">
          <div class="psc-stat-val">${s.freeThrows||0}</div>
          <div class="psc-stat-lbl">FT</div>
        </div>
        <div class="psc-stat">
          <div class="psc-stat-val">${s.fouls||0}</div>
          <div class="psc-stat-lbl">PF</div>
        </div>
      </div>
      <div class="psc-footer">
        <span class="psc-pct">2PT ${twoPct}</span>
        <span class="psc-pct">3PT ${thrPct}</span>
        <span class="psc-pct">FT ${ftPct}</span>
      </div>`;
    cont.appendChild(card);
  });

  if (!sorted.length) cont.innerHTML = `<p style="color:var(--t3);font-size:13px;padding:12px">No player data yet.</p>`;
}

// ── Live Log ──
function renderLog(pStats) {
  const cont = el("coach-log");
  const entries = [];

  for (const key in pStats) {
    if (!key.startsWith(TEAM_SIDE)) continue;
    const name = key.split(" - ")[1]?.split(" #")[0] || key;
    (pStats[key].timestamps || []).forEach(ts => entries.push({ name, ts }));
  }

  if (!entries.length) {
    cont.innerHTML = `<p style="color:var(--t3);font-size:13px;padding:12px">No plays recorded yet.</p>`;
    return;
  }

  entries.reverse();
  cont.innerHTML = entries.map(e => {
    const [action, time] = e.ts.split(" at ");
    const color = dotColor(e.ts);
    return `<div class="cl-entry">
      <span class="cl-time">${time||""}</span>
      <span class="cl-dot" style="background:${color}"></span>
      <span class="cl-text"><strong>${e.name}</strong> — ${action}</span>
    </div>`;
  }).join("");
}

function dotColor(ts) {
  if (/2 Points|3 Points|Free Throw/.test(ts) && !ts.includes("Missed")) return C.gold;
  if (ts.includes("Missed"))   return C.red;
  if (ts.includes("Rebound"))  return C.teal;
  if (ts.includes("Assist"))   return C.blue;
  if (ts.includes("Steal") || ts.includes("Block")) return C.grn;
  if (ts.includes("Turnover")) return C.red;
  return C.t2;
}

// ── Charts ──
function initCharts() {
  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
  };

  // Shooting % bar
  shootChart = new Chart(el("coach-shooting-chart"), {
    type: "bar",
    data: {
      labels: ["2PT%", "3PT%", "FT%"],
      datasets: [{
        data: [0, 0, 0],
        backgroundColor: [C.gold, C.blue, C.teal],
        borderRadius: 6,
      }]
    },
    options: {
      ...baseOpts,
      scales: {
        x: { grid: { color: C.line }, ticks: { color: C.t2 } },
        y: { grid: { color: C.line }, ticks: { color: C.t2, callback: v => v+"%" }, beginAtZero: true, min: 0, max: 100 }
      }
    }
  });

  // Top players horizontal bar
  topChart = new Chart(el("coach-top-chart"), {
    type: "bar",
    data: {
      labels: ["—"],
      datasets: [{ data: [0], backgroundColor: C.gold, borderRadius: 4, barPercentage: 0.6 }]
    },
    options: {
      ...baseOpts,
      indexAxis: "y",
      scales: {
        x: { grid: { color: C.line }, ticks: { color: C.t2, precision: 0, stepSize: 1 }, beginAtZero: true },
        y: { grid: { color: "transparent" }, ticks: { color: C.t2, font: { size: 12 } } }
      }
    }
  });
}

function updateCharts(roster, pStats, tStats) {
  if (!shootChart || !topChart) return;

  // Shooting %
  const pct = (m, a) => a > 0 ? parseFloat(((m/a)*100).toFixed(1)) : 0;
  shootChart.data.datasets[0].data = [
    pct(tStats.shotsMade?.twoPoint||0,   tStats.shotsAttempted?.twoPoint||0),
    pct(tStats.shotsMade?.threePoint||0, tStats.shotsAttempted?.threePoint||0),
    pct(tStats.shotsMade?.freeThrow||0,  tStats.shotsAttempted?.freeThrow||0),
  ];
  shootChart.update("none");

  // Top scorers
  const players = roster.map(p => {
    const key = findKey(p, pStats);
    return { name: p.name, pts: key ? (pStats[key]?.points||0) : 0 };
  }).sort((a, b) => b.pts - a.pts).slice(0, 6);

  topChart.data.labels               = players.map(p => p.name);
  topChart.data.datasets[0].data     = players.map(p => p.pts);
  topChart.update("none");
}

// ── Helpers ──
function findKey(player, pStats) {
  // Try both home and away prefix since we only know the team side
  for (const prefix of [TEAM_SIDE, TEAM_SIDE === "home" ? "away" : "home"]) {
    const k = `${prefix} - ${player.name} #${player.number}`;
    if (pStats[k]) return k;
  }
  // Fuzzy fallback
  return Object.keys(pStats).find(k => k.includes(`${player.name} #${player.number}`)) || null;
}

function switchTab(tab) {
  document.querySelectorAll(".ctab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".ctab-content").forEach(c => c.classList.remove("active"));
  el(`tab-${tab}`).classList.add("active");
  el(`tab-${tab}-btn`).classList.add("active");
}

function el(id) { return document.getElementById(id); }

function showToast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = "0", 2500);
}

window.switchTab = switchTab;