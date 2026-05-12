// ================================================
//  SPORT PERFORMANCE STATS — GAME SCRIPT (ROOM-SCOPED)
//  Each game is isolated under gameRooms/{roomCode}
//  Real-time sync via onSnapshot
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, updateDoc, onSnapshot,
  collection, addDoc, getDocs, deleteDoc, serverTimestamp
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

// ── Room ──
const params   = new URLSearchParams(window.location.search);
const ROOM_CODE = params.get("room")?.toUpperCase() || null;
let roomRef    = null;     // doc ref for this game room
let unsubscribe = null;    // onSnapshot cleanup

// ── Local state (synced to/from Firebase) ──
let homeScore = 0, awayScore = 0;
let homeFouls = 0, awayFouls = 0;
let homeTimeouts = 0, awayTimeouts = 0;
let gameClock = 420, clockRunning = false, clockInterval = null;
let period = 1;
const MAX_PERIODS = 4;
let homeTeam = null, awayTeam = null;
let currentRoster  = { home: [], away: [] };
let activePlayers  = { home: [], away: [] };
let selectedPlayer = null;
let playerStats = {}, teamStats = freshTeamStats();
let selectedTeam = "";
let undoStack = [];
const UNDO_LIMIT = 30;
let saveTimer = null;       // debounce writes
let isApplyingRemote = false; // prevent echo loops

// Charts / Grids
let scoreBreakdownChart, teamStatsChart, shootingPctChart, shotVolumeChart;
let playerCompareChart, playerRadarChart, topScorersChart, topAllAroundChart;
let homeGrid, awayGrid;

// ── Helpers ──
function freshTeamStats() {
  const s = () => ({
    points: { twoPoint:0, threePoint:0, freeThrow:0 },
    shotsMade: { twoPoint:0, threePoint:0, freeThrow:0 },
    shotsAttempted: { twoPoint:0, threePoint:0, freeThrow:0 },
    rebounds:0, turnovers:0, assists:0, blocks:0, steals:0, fouls:0,
  });
  return { home: s(), away: s() };
}
function freshPlayerStat() {
  return {
    points:0, freeThrows:0, assists:0, rebounds:0,
    blocks:0, steals:0, turnovers:0, fouls:0, timestamps:[],
    shotsMade:{ twoPoint:0, threePoint:0, freeThrow:0 },
    shotsAttempted:{ twoPoint:0, threePoint:0, freeThrow:0 },
  };
}
function deepClone(o)  { return JSON.parse(JSON.stringify(o)); }
function el(id)        { return document.getElementById(id); }
function getTime()     {
  return `${String(Math.floor(gameClock/60)).padStart(2,"0")}:${String(gameClock%60).padStart(2,"0")}`;
}

// ── Toast ──
function showToast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(t._timer); t._timer = setTimeout(() => t.style.opacity = "0", 2200);
}

// ── Undo ──
function pushUndo() {
  undoStack.push({ playerStats: deepClone(playerStats), teamStats: deepClone(teamStats), homeScore, awayScore });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}
function undoLastStat() {
  if (!undoStack.length) { showToast("Nothing to undo"); return; }
  const prev = undoStack.pop();
  playerStats = prev.playerStats; teamStats = prev.teamStats;
  homeScore = prev.homeScore; awayScore = prev.awayScore;
  el("home-score").textContent = homeScore;
  el("away-score").textContent = awayScore;
  updateGrids(); updateSummaryCards(); updateAllCharts(); updateLiveLog();
  scheduleSave(); showToast("Last stat undone");
}

// ── Init ──
document.addEventListener("DOMContentLoaded", async () => {
  if (!ROOM_CODE) {
    el("no-room-view").style.display = "flex";
    document.title = "Sport Performance Stats · No Room";
    return;
  }

  // Show app, update badge
  el("app-view").style.display = "block";
  el("room-badge").textContent = `Room: ${ROOM_CODE}`;
  document.title = `Sport Performance Stats · ${ROOM_CODE}`;

  // Check room exists
  roomRef = doc(db, "gameRooms", ROOM_CODE);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) {
    showToast(`Room ${ROOM_CODE} not found`);
    el("room-badge").textContent = "Room not found";
    el("room-badge").style.color = "var(--red)";
    return;
  }

  // Boot UI
  updateClockDisplay(); initCharts(); initGrids();
  toggleView("scoreboard"); showTab("home");

  // Apply initial data
  applyRemoteData(snap.data());

  // Subscribe to real-time updates
  unsubscribe = onSnapshot(roomRef, (docSnap) => {
    if (!docSnap.exists()) return;
    applyRemoteData(docSnap.data());
  });
});

// ── Apply data from Firebase → local state + UI ──
function applyRemoteData(data) {
  if (!data) return;
  isApplyingRemote = true;

  homeTeam     = data.homeTeam  || homeTeam;
  awayTeam     = data.awayTeam  || awayTeam;
  homeScore    = data.homeScore ?? homeScore;
  awayScore    = data.awayScore ?? awayScore;
  homeFouls    = data.homeFouls ?? homeFouls;
  awayFouls    = data.awayFouls ?? awayFouls;
  homeTimeouts = data.homeTimeouts ?? homeTimeouts;
  awayTimeouts = data.awayTimeouts ?? awayTimeouts;
  period       = data.period    ?? period;
  playerStats  = data.playerStats || playerStats;
  teamStats    = data.teamStats   || teamStats;

  // Restore clock (but don't restart it from remote — clock runs locally)
  if (!clockRunning) {
    gameClock = data.clockSeconds ?? gameClock;
    updateClockDisplay();
  }

  // Update team name displays
  if (homeTeam?.name) {
    el("home-team-name").textContent = homeTeam.name.toUpperCase();
    document.title = `${homeTeam.name} vs ${awayTeam?.name || "Away"} · ${ROOM_CODE}`;
  }
  if (awayTeam?.name) el("away-team-name").textContent = awayTeam.name.toUpperCase();

  // Update scores + counters
  el("home-score").textContent    = homeScore;
  el("away-score").textContent    = awayScore;
  el("home-fouls").textContent    = homeFouls;
  el("away-fouls").textContent    = awayFouls;
  el("home-timeouts").textContent = homeTimeouts;
  el("away-timeouts").textContent = awayTimeouts;
  el("period-display").textContent = `PERIOD ${period} / ${MAX_PERIODS}`;

  // Load rosters if we have them
  if (homeTeam?.roster) loadRoster("home", homeTeam.roster);
  if (awayTeam?.roster) loadRoster("away", awayTeam.roster);

  // Refresh UI
  updateGrids(); updateSummaryCards(); updateAllCharts(); updateLiveLog();
  populateCompareDropdowns();

  isApplyingRemote = false;
}

// ── Save to Firebase (debounced) ──
function scheduleSave() {
  if (isApplyingRemote) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToFirebase, 800);
}

async function saveToFirebase() {
  if (!roomRef) return;
  try {
    await updateDoc(roomRef, {
      homeScore, awayScore,
      homeFouls, awayFouls,
      homeTimeouts, awayTimeouts,
      period, clockSeconds: gameClock,
      playerStats, teamStats,
      log: el("player-log")?.innerHTML || "",
      updatedAt: serverTimestamp(),
    });
  } catch(e) { console.warn("Save failed:", e); }
}

// ── Roster ──
function loadRoster(side, roster) {
  currentRoster[side] = Array.isArray(roster) ? roster : [];
  activePlayers[side] = currentRoster[side].slice(0, 5);
  renderRoster(side);
}
function renderRoster(side) {
  const ul = el(`${side}-roster`); ul.innerHTML = "";
  activePlayers[side].forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rnum">${p.number}</span> ${p.name}`;
    li.onclick = () => selectPlayer(side, i);
    ul.appendChild(li);
  });
}
function selectPlayer(side, idx) {
  document.querySelectorAll(".roster li").forEach(li => li.classList.remove("active"));
  document.querySelectorAll(`#${side}-roster li`)[idx]?.classList.add("active");
  selectedPlayer = { team: side, player: activePlayers[side][idx] };
  el("sel-label").textContent = `${selectedPlayer.player.name}  #${selectedPlayer.player.number}  (${side})`;
  const dot = document.querySelector(".si-dot");
  if (dot) { dot.classList.remove("off"); dot.classList.add("on"); }
}
function initActivePlayers() {
  ["home","away"].forEach(s => { activePlayers[s] = currentRoster[s].slice(0, 5); });
}

// ── Substitution ──
function openSubstitutionModal(side) {
  if (!activePlayers[side]?.length) { showToast("No team loaded yet"); return; }
  const bench = currentRoster[side].filter(
    p => !activePlayers[side].some(a => a.name===p.name && a.number===p.number)
  );
  if (!bench.length) { showToast("No bench players available"); return; }

  selectedTeam = side;
  const onSel = el("players-on-court"), offSel = el("players-off-court");
  onSel.innerHTML = ""; offSel.innerHTML = "";
  activePlayers[side].forEach((p, i) => {
    onSel.insertAdjacentHTML("beforeend", `<option value="${i}">#${p.number} ${p.name}</option>`);
  });
  bench.forEach((p, i) => {
    offSel.insertAdjacentHTML("beforeend", `<option value="${i}">#${p.number} ${p.name}</option>`);
  });
  el("substitution-modal").style.display = "flex";
}
function performSubstitution() {
  const onSel = el("players-on-court"), offSel = el("players-off-court");
  if (onSel.selectedIndex < 0 || offSel.selectedIndex < 0) { alert("Select one from each list."); return; }
  const outIdx = parseInt(onSel.value);
  const bench  = currentRoster[selectedTeam].filter(
    p => !activePlayers[selectedTeam].some(a => a.name===p.name && a.number===p.number)
  );
  const playerIn = bench[parseInt(offSel.value)];
  if (!playerIn) { alert("Invalid selection."); return; }
  const key = `${selectedTeam} - ${playerIn.name} #${playerIn.number}`;
  if (!playerStats[key]) playerStats[key] = freshPlayerStat();
  activePlayers[selectedTeam][outIdx] = playerIn;
  renderRoster(selectedTeam); updateGrids(); closeSubstitutionModal();
  showToast("Substitution complete");
}
function closeSubstitutionModal() { el("substitution-modal").style.display = "none"; }

// ── Clock ──
function startStopClock() {
  const btn = el("start-stop-btn");
  if (clockRunning) {
    clearInterval(clockInterval); clockRunning = false;
    btn.textContent = "▶ START";
    saveToFirebase(); // save clock position when paused
  } else {
    clockInterval = setInterval(() => {
      if (gameClock <= 0) {
        clearInterval(clockInterval); clockRunning = false;
        btn.textContent = "▶ START"; advancePeriod();
      } else { gameClock--; updateClockDisplay(); }
    }, 1000);
    clockRunning = true; btn.textContent = "⏸ PAUSE";
  }
}
function updateClockDisplay() {
  el("game-clock").textContent = `${String(Math.floor(gameClock/60)).padStart(2,"0")}:${String(gameClock%60).padStart(2,"0")}`;
}
function setCustomTime() {
  const parts = (el("time-input").value||"").trim().split(":");
  if (parts.length !== 2) { alert("Use MM:SS format"); return; }
  const m = parseInt(parts[0]), s = parseInt(parts[1]);
  if (isNaN(m)||isNaN(s)||s>59||m<0) { alert("Invalid time"); return; }
  gameClock = m*60+s; updateClockDisplay(); scheduleSave();
}
function confirmReset() {
  el("confirm-modal").style.display = "flex";
  el("confirm-yes").onclick = () => { el("confirm-modal").style.display = "none"; resetClock(); };
  el("confirm-no").onclick  = () => {  el("confirm-modal").style.display = "none"; };
}
function resetClock() {
  if (clockRunning) { clearInterval(clockInterval); clockRunning = false; }
  el("start-stop-btn").textContent = "▶ START";
  gameClock = 420; updateClockDisplay(); scheduleSave();
}
function advancePeriod() {
  if (period < MAX_PERIODS) {
    period++; gameClock = 420; updateClockDisplay();
    el("period-display").textContent = `PERIOD ${period} / ${MAX_PERIODS}`;
    showToast(`Period ${period} started!`);
  } else {
    el("period-display").textContent = "GAME OVER";
    showToast("Game Over!");
    // Mark game as done
    if (roomRef) updateDoc(roomRef, { status: "done" });
  }
  scheduleSave();
}

// ── Fouls & Timeouts ──
function updateFouls(side) {
  if (side==="home") { homeFouls++; el("home-fouls").textContent = homeFouls; }
  else               { awayFouls++; el("away-fouls").textContent = awayFouls; }
  scheduleSave();
}
function updateTimeout(side) {
  if (side==="home") { homeTimeouts++; el("home-timeouts").textContent = homeTimeouts; }
  else               { awayTimeouts++; el("away-timeouts").textContent = awayTimeouts; }
  scheduleSave();
}

// ── Stats ──
function ensurePlayerStat(key) {
  if (!playerStats[key]) playerStats[key] = freshPlayerStat();
  const p = playerStats[key];
  if (!p.shotsMade)      p.shotsMade      = { twoPoint:0, threePoint:0, freeThrow:0 };
  if (!p.shotsAttempted) p.shotsAttempted = { twoPoint:0, threePoint:0, freeThrow:0 };
}
function ensureTeamStat(side) {
  if (!teamStats[side]) teamStats[side] = freshTeamStats()[side];
  const t = teamStats[side];
  if (!t.points)         t.points         = { twoPoint:0, threePoint:0, freeThrow:0 };
  if (!t.shotsMade)      t.shotsMade      = { twoPoint:0, threePoint:0, freeThrow:0 };
  if (!t.shotsAttempted) t.shotsAttempted = { twoPoint:0, threePoint:0, freeThrow:0 };
}

function handleStat(pts, stat) {
  if (!selectedPlayer?.player) { showToast("Tap a player first!"); return; }
  pushUndo();
  const { team, player } = selectedPlayer;
  const key = `${team} - ${player.name} #${player.number}`;
  ensurePlayerStat(key); ensureTeamStat(team);
  const ps = playerStats[key], ts = teamStats[team];

  switch(stat) {
    case "2 Points":    ps.points+=2; ps.shotsMade.twoPoint++; ps.shotsAttempted.twoPoint++; ts.points.twoPoint+=2; ts.shotsMade.twoPoint++; ts.shotsAttempted.twoPoint++; break;
    case "3 Points":    ps.points+=3; ps.shotsMade.threePoint++; ps.shotsAttempted.threePoint++; ts.points.threePoint+=3; ts.shotsMade.threePoint++; ts.shotsAttempted.threePoint++; break;
    case "Free Throw":  ps.points+=1; ps.freeThrows++; ps.shotsAttempted.freeThrow++; ts.points.freeThrow+=1; ts.shotsMade.freeThrow++; ts.shotsAttempted.freeThrow++; break;
    case "Rebound":     ps.rebounds++;  ts.rebounds++;  break;
    case "Turnover":    ps.turnovers++; ts.turnovers++; break;
    case "Assist":      ps.assists++;   ts.assists++;   break;
    case "Block":       ps.blocks++;    ts.blocks++;    break;
    case "Steal":       ps.steals++;    ts.steals++;    break;
    case "Foul":        ps.fouls++;     ts.fouls++;     break;
    default: undoStack.pop(); return;
  }
  ps.timestamps.push(`${stat} at ${getTime()}`);

  if (["2 Points","3 Points","Free Throw"].includes(stat)) {
    if (team==="home") { homeScore+=pts; const e=el("home-score"); e.textContent=homeScore; bumpScore(e); }
    else               { awayScore+=pts; const e=el("away-score"); e.textContent=awayScore; bumpScore(e); }
  }
  updateGrids(); updateSummaryCards(); updateAllCharts(); updateLiveLog();
  scheduleSave();
}

function bumpScore(scoreEl) {
  scoreEl.classList.remove("bump"); void scoreEl.offsetWidth; scoreEl.classList.add("bump");
  setTimeout(() => scoreEl.classList.remove("bump"), 200);
}

function recordShotAttempt(stat) {
  if (!selectedPlayer?.player) { showToast("Tap a player first!"); return; }
  pushUndo();
  const { team, player } = selectedPlayer;
  const key = `${team} - ${player.name} #${player.number}`;
  ensurePlayerStat(key); ensureTeamStat(team);
  switch(stat) {
    case "2 Points":   playerStats[key].shotsAttempted.twoPoint++;  teamStats[team].shotsAttempted.twoPoint++;  break;
    case "3 Points":   playerStats[key].shotsAttempted.threePoint++; teamStats[team].shotsAttempted.threePoint++; break;
    case "Free Throw": playerStats[key].shotsAttempted.freeThrow++;  teamStats[team].shotsAttempted.freeThrow++;  break;
  }
  playerStats[key].timestamps.push(`Missed ${stat} at ${getTime()}`);
  updateAllCharts(); updateGrids(); updateLiveLog(); scheduleSave();
}

// ── Summary Cards ──
function updateSummaryCards() {
  ["home","away"].forEach(side => {
    const cont = el(`${side}-summary-row`); if (!cont) return;
    const ts = teamStats[side] || {};
    const made = (ts.shotsMade?.twoPoint||0)+(ts.shotsMade?.threePoint||0);
    const att  = (ts.shotsAttempted?.twoPoint||0)+(ts.shotsAttempted?.threePoint||0);
    const fg   = att > 0 ? ((made/att)*100).toFixed(1)+"%" : "0%";
    const ft   = (ts.shotsAttempted?.freeThrow||0) > 0 ? (((ts.shotsMade?.freeThrow||0)/ts.shotsAttempted.freeThrow)*100).toFixed(1)+"%" : "0%";
    const cards = [
      { val: side==="home" ? homeScore : awayScore, lbl: "PTS" },
      { val: fg,              lbl: "FG%" },
      { val: ft,              lbl: "FT%" },
      { val: ts.rebounds||0,  lbl: "REB" },
      { val: ts.assists||0,   lbl: "AST" },
      { val: ts.turnovers||0, lbl: "TOV" },
    ];
    cont.innerHTML = cards.map(c => `<div class="tscard"><div class="tscard-val">${c.val}</div><div class="tscard-lbl">${c.lbl}</div></div>`).join("");
  });
}

// ── Grids ──
const COLS = ["Player","PTS","FT","AST","REB","BLK","STL","TOV","PF","2PT%","3PT%","FT%"];
function prepStats(side) {
  return Object.entries(playerStats).filter(([k]) => k.startsWith(side)).map(([k, s]) => {
    const pct = (m, a) => a > 0 ? ((m/a)*100).toFixed(1)+"%" : "—";
    return [
      k.split(" - ")[1]?.split(" #")[0] || k,
      s.points, s.freeThrows, s.assists, s.rebounds,
      s.blocks, s.steals, s.turnovers, s.fouls,
      pct(s.shotsMade?.twoPoint||0,   s.shotsAttempted?.twoPoint||0),
      pct(s.shotsMade?.threePoint||0, s.shotsAttempted?.threePoint||0),
      pct(s.freeThrows||0,            s.shotsAttempted?.freeThrow||0),
    ];
  });
}
function initGrids() {
  ["home","away"].forEach(side => {
    const cont = el(`${side}-stats`); if (!cont) return;
    cont.innerHTML = "";
    const g = new gridjs.Grid({ columns: COLS, data: prepStats(side), pagination: true, search: true, sort: true }).render(cont);
    if (side==="home") homeGrid = g; else awayGrid = g;
  });
}
function updateGrids() {
  homeGrid?.updateConfig({ data: prepStats("home") }).forceRender();
  awayGrid?.updateConfig({ data: prepStats("away") }).forceRender();
}

// ── Charts ──
const C = { gold:"#f5c518", blue:"#3b82f6", teal:"#14b8a6", grn:"#22c55e", red:"#ef4444", purple:"#a855f7", line:"#2e3550", t2:"#8b95b0" };
const intYAxis = { grid:{color:C.line}, ticks:{color:C.t2,font:{size:11},precision:0,stepSize:1}, beginAtZero:true, min:0 };
const intXAxis = { grid:{color:C.line}, ticks:{color:C.t2,font:{size:11},precision:0,stepSize:1}, beginAtZero:true, min:0 };
const catAxis  = { grid:{color:C.line}, ticks:{color:C.t2,font:{size:11}} };
const catAxisY = { grid:{color:"transparent"}, ticks:{color:C.t2,font:{size:12}} };
function setH(ctx, h) { if (ctx?.parentElement) ctx.parentElement.style.height = h; }
function makeLegend(items) {
  return `<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:10px;font-size:12px;color:${C.t2}">
    ${items.map(i=>`<span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${i.color}"></span>${i.label}</span>`).join("")}
  </div>`;
}

function initCharts() {
  const mk = (id, cfg) => { const ctx = el(id); if (ctx) return new Chart(ctx, cfg); };

  scoreBreakdownChart = mk("scoreBreakdownChart", { type:"bar", data:{ labels:["2-Pointers","3-Pointers","Free Throws"], datasets:[{label:"Home",data:[0,0,0],backgroundColor:C.gold,borderRadius:5,barPercentage:.6},{label:"Away",data:[0,0,0],backgroundColor:C.blue,borderRadius:5,barPercentage:.6}] }, options:{ responsive:true,maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:catAxis,y:{...intYAxis,suggestedMax:10}} } });
  el("scoreBreakdownChart")?.parentElement.insertAdjacentHTML("afterbegin", makeLegend([{color:C.gold,label:"Home"},{color:C.blue,label:"Away"}]));

  teamStatsChart = mk("teamStatsChart", { type:"bar", data:{ labels:["Rebounds","Assists","Steals","Blocks","Turnovers","Fouls"], datasets:[{label:"Home",data:[0,0,0,0,0,0],backgroundColor:C.gold,borderRadius:4,barPercentage:.6},{label:"Away",data:[0,0,0,0,0,0],backgroundColor:C.blue,borderRadius:4,barPercentage:.6}] }, options:{ indexAxis:"y",responsive:true,maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{...intXAxis,suggestedMax:10},y:catAxisY} } });
  el("teamStatsChart")?.parentElement.insertAdjacentHTML("afterbegin", makeLegend([{color:C.gold,label:"Home"},{color:C.blue,label:"Away"}]));

  shootingPctChart = mk("shootingPctChart", { type:"bar", data:{ labels:["2PT%","3PT%","FT%"], datasets:[{label:"Home",data:[0,0,0],backgroundColor:C.gold,borderRadius:5,barPercentage:.6},{label:"Away",data:[0,0,0],backgroundColor:C.blue,borderRadius:5,barPercentage:.6}] }, options:{ responsive:true,maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:catAxis,y:{grid:{color:C.line},ticks:{color:C.t2,callback:v=>v+"%"},beginAtZero:true,min:0,max:100}} } });
  el("shootingPctChart")?.parentElement.insertAdjacentHTML("afterbegin", makeLegend([{color:C.gold,label:"Home"},{color:C.blue,label:"Away"}]));

  shotVolumeChart = mk("shotVolumeChart", { type:"bar", data:{ labels:["2PT Made","2PT Att","3PT Made","3PT Att","FT Made","FT Att"], datasets:[{label:"Home",data:[0,0,0,0,0,0],backgroundColor:C.gold+"cc",borderRadius:4,barPercentage:.6},{label:"Away",data:[0,0,0,0,0,0],backgroundColor:C.blue+"cc",borderRadius:4,barPercentage:.6}] }, options:{ responsive:true,maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:catAxis,y:{...intYAxis,suggestedMax:10}} } });
  el("shotVolumeChart")?.parentElement.insertAdjacentHTML("afterbegin", makeLegend([{color:C.gold,label:"Home"},{color:C.blue,label:"Away"}]));

  playerCompareChart = mk("playerCompareChart", { type:"bar", data:{ labels:["PTS","REB","AST","STL","BLK","TOV"], datasets:[{label:"P1",data:[0,0,0,0,0,0],backgroundColor:C.gold,borderRadius:4,barPercentage:.65},{label:"P2",data:[0,0,0,0,0,0],backgroundColor:C.purple,borderRadius:4,barPercentage:.65}] }, options:{ responsive:true,maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:catAxis,y:{...intYAxis,suggestedMax:10}} } });

  playerRadarChart = mk("playerRadarChart", { type:"radar", data:{ labels:["Scoring","Rebounding","Playmaking","Defense","Efficiency","Hustle"], datasets:[{label:"P1",data:[0,0,0,0,0,0],borderColor:C.gold,backgroundColor:C.gold+"22",pointBackgroundColor:C.gold,pointRadius:3},{label:"P2",data:[0,0,0,0,0,0],borderColor:C.purple,backgroundColor:C.purple+"22",pointBackgroundColor:C.purple,pointRadius:3}] }, options:{ responsive:true,maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{r:{backgroundColor:"transparent",grid:{color:C.line},pointLabels:{color:C.t2,font:{size:11}},ticks:{display:false},angleLines:{color:C.line}}} } });

  topScorersChart = mk("topScorersChart", { type:"bar", data:{ labels:["—"], datasets:[{data:[0],backgroundColor:C.gold,borderRadius:4,barPercentage:.6}] }, options:{ indexAxis:"y",responsive:true,maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{...intXAxis,suggestedMax:10},y:catAxisY} } });

  topAllAroundChart = mk("topAllAroundChart", { type:"bar", data:{ labels:["—"], datasets:[{label:"PTS",data:[0],backgroundColor:C.gold,borderRadius:0},{label:"REB",data:[0],backgroundColor:C.teal},{label:"AST",data:[0],backgroundColor:C.blue}] }, options:{ indexAxis:"y",responsive:true,maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{stacked:true,...intXAxis,suggestedMax:10},y:{stacked:true,...catAxisY}} } });
  el("topAllAroundChart")?.parentElement.insertAdjacentHTML("afterbegin", makeLegend([{color:C.gold,label:"PTS"},{color:C.teal,label:"REB"},{color:C.blue,label:"AST"}]));
}

function updateAllCharts() {
  if (!scoreBreakdownChart) return;
  const h = teamStats.home||{}, a = teamStats.away||{};
  const pct = (m,att) => att>0 ? parseFloat(((m/att)*100).toFixed(1)) : 0;

  scoreBreakdownChart.data.datasets[0].data = [h.points?.twoPoint||0,h.points?.threePoint||0,h.points?.freeThrow||0];
  scoreBreakdownChart.data.datasets[1].data = [a.points?.twoPoint||0,a.points?.threePoint||0,a.points?.freeThrow||0];
  scoreBreakdownChart.update("none");

  teamStatsChart.data.datasets[0].data = [h.rebounds||0,h.assists||0,h.steals||0,h.blocks||0,h.turnovers||0,h.fouls||0];
  teamStatsChart.data.datasets[1].data = [a.rebounds||0,a.assists||0,a.steals||0,a.blocks||0,a.turnovers||0,a.fouls||0];
  teamStatsChart.update("none");

  shootingPctChart.data.datasets[0].data = [pct(h.shotsMade?.twoPoint||0,h.shotsAttempted?.twoPoint||0),pct(h.shotsMade?.threePoint||0,h.shotsAttempted?.threePoint||0),pct(h.shotsMade?.freeThrow||0,h.shotsAttempted?.freeThrow||0)];
  shootingPctChart.data.datasets[1].data = [pct(a.shotsMade?.twoPoint||0,a.shotsAttempted?.twoPoint||0),pct(a.shotsMade?.threePoint||0,a.shotsAttempted?.threePoint||0),pct(a.shotsMade?.freeThrow||0,a.shotsAttempted?.freeThrow||0)];
  shootingPctChart.update("none");

  shotVolumeChart.data.datasets[0].data = [h.shotsMade?.twoPoint||0,h.shotsAttempted?.twoPoint||0,h.shotsMade?.threePoint||0,h.shotsAttempted?.threePoint||0,h.shotsMade?.freeThrow||0,h.shotsAttempted?.freeThrow||0];
  shotVolumeChart.data.datasets[1].data = [a.shotsMade?.twoPoint||0,a.shotsAttempted?.twoPoint||0,a.shotsMade?.threePoint||0,a.shotsAttempted?.threePoint||0,a.shotsMade?.freeThrow||0,a.shotsAttempted?.freeThrow||0];
  shotVolumeChart.update("none");

  const allP = Object.entries(playerStats).map(([k,s]) => ({ name: k.split(" - ")[1]?.split(" #")[0]||k, pts:s.points||0, reb:s.rebounds||0, ast:s.assists||0 }));
  const topPts = [...allP].sort((a,b)=>b.pts-a.pts).slice(0,8);
  topScorersChart.data.labels = topPts.map(p=>p.name);
  topScorersChart.data.datasets[0].data = topPts.map(p=>p.pts);
  topScorersChart.update("none");

  const topAA = [...allP].sort((a,b)=>(b.pts+b.reb+b.ast)-(a.pts+a.reb+a.ast)).slice(0,8);
  topAllAroundChart.data.labels = topAA.map(p=>p.name);
  topAllAroundChart.data.datasets[0].data = topAA.map(p=>p.pts);
  topAllAroundChart.data.datasets[1].data = topAA.map(p=>p.reb);
  topAllAroundChart.data.datasets[2].data = topAA.map(p=>p.ast);
  topAllAroundChart.update("none");

  updatePlayerComparison();
}

function populateCompareDropdowns() {
  const saved1 = el("compare-p1")?.value, saved2 = el("compare-p2")?.value;
  ["compare-p1","compare-p2"].forEach(id => {
    const sel = el(id); if (!sel) return;
    sel.innerHTML = `<option value="">Select Player</option>`;
    Object.keys(playerStats).forEach(key => {
      const name = key.split(" - ")[1] || key;
      sel.insertAdjacentHTML("beforeend", `<option value="${key}">${name}</option>`);
    });
  });
  if (saved1) el("compare-p1").value = saved1;
  if (saved2) el("compare-p2").value = saved2;
}

function updatePlayerComparison() {
  if (!playerCompareChart || !playerRadarChart) return;
  const k1 = el("compare-p1")?.value, k2 = el("compare-p2")?.value;
  const s1 = k1 ? (playerStats[k1]||{}) : {};
  const s2 = k2 ? (playerStats[k2]||{}) : {};
  const n1 = k1 ? (k1.split(" - ")[1]?.split(" #")[0]||"P1") : "Player 1";
  const n2 = k2 ? (k2.split(" - ")[1]?.split(" #")[0]||"P2") : "Player 2";
  playerCompareChart.data.datasets[0].label = n1;
  playerCompareChart.data.datasets[1].label = n2;
  playerCompareChart.data.datasets[0].data = [s1.points||0,s1.rebounds||0,s1.assists||0,s1.steals||0,s1.blocks||0,s1.turnovers||0];
  playerCompareChart.data.datasets[1].data = [s2.points||0,s2.rebounds||0,s2.assists||0,s2.steals||0,s2.blocks||0,s2.turnovers||0];
  playerCompareChart.update("none");
  const norm = (v,max) => max>0 ? Math.min(10,parseFloat(((v/max)*10).toFixed(1))) : 0;
  const mp = Math.max(1,s1.points||0,s2.points||0);
  const mr = Math.max(1,s1.rebounds||0,s2.rebounds||0);
  const ma = Math.max(1,s1.assists||0,s2.assists||0);
  playerRadarChart.data.datasets[0].data = [norm(s1.points||0,mp),norm(s1.rebounds||0,mr),norm(s1.assists||0,ma),norm((s1.steals||0)+(s1.blocks||0),Math.max(1,(s1.steals||0)+(s1.blocks||0),(s2.steals||0)+(s2.blocks||0))),(()=>{const m=(s1.shotsMade?.twoPoint||0)+(s1.shotsMade?.threePoint||0),a=(s1.shotsAttempted?.twoPoint||0)+(s1.shotsAttempted?.threePoint||0);return a>0?(m/a)*10:0;})(),norm(s1.assists||0,ma)];
  playerRadarChart.data.datasets[1].data = [norm(s2.points||0,mp),norm(s2.rebounds||0,mr),norm(s2.assists||0,ma),norm((s2.steals||0)+(s2.blocks||0),Math.max(1,(s1.steals||0)+(s1.blocks||0),(s2.steals||0)+(s2.blocks||0))),(()=>{const m=(s2.shotsMade?.twoPoint||0)+(s2.shotsMade?.threePoint||0),a=(s2.shotsAttempted?.twoPoint||0)+(s2.shotsAttempted?.threePoint||0);return a>0?(m/a)*10:0;})(),norm(s2.assists||0,ma)];
  playerRadarChart.update("none");
}

// ── Live Log ──
function updateLiveLog() {
  const cont = el("player-log"); if (!cont) return;
  const entries = [];
  for (const key in playerStats) {
    const [,name] = key.split(" - ");
    const side = key.split(" - ")[0];
    (playerStats[key].timestamps||[]).forEach(ts => entries.push({ name, side, ts }));
  }
  entries.reverse();
  cont.innerHTML = entries.map(e =>
    `<div class="log-entry"><strong>${e.name}</strong> <span style="color:var(--t3);font-size:11px">(${e.side})</span> — ${e.ts}</div>`
  ).join("");
}

// ── View / Tab ──
function toggleView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".vbtn").forEach(b => b.classList.remove("active"));
  el(`${view}-view`)?.classList.add("active");
  el(`${view}-toggle`)?.classList.add("active");

  // Sync mobile nav active state
  document.querySelectorAll(".mobile-nav .mn-item").forEach(b => b.classList.remove("active"));
  const mobileMap = { scoreboard: 1, stats: 2, charts: 3 };
  const mobileItems = document.querySelectorAll(".mobile-nav .mn-item");
  if (mobileMap[view] && mobileItems[mobileMap[view]]) {
    mobileItems[mobileMap[view]].classList.add("active");
  }

  if (view==="charts") setTimeout(() => updateAllCharts(), 60);
  if (view==="stats")  updateSummaryCards();
}
function showTab(tab) {
  document.querySelectorAll(".sc").forEach(c => c.classList.remove("active"));
  document.querySelectorAll(".stab").forEach(b => b.classList.remove("active"));
  el(`${tab}-stats-tab`)?.classList.add("active");
  el(`${tab}-tab`)?.classList.add("active");
  if (tab==="home"||tab==="away") updateSummaryCards();
  if (tab==="log") { loadSnapshots(); updateLiveLog(); }
}

// ── Export ──
function generateStats() {
  if (!Object.keys(playerStats).length) { showToast("No stats to export yet"); return; }
  const wb = XLSX.utils.book_new();
  const hdr = ["Player","PTS","FT","AST","REB","BLK","STL","TOV","PF","2PT%","3PT%","FT%","Log"];
  ["home","away"].forEach(side => {
    const pct = (m,a) => a>0?((m/a)*100).toFixed(1)+"%":"0%";
    const rows = [hdr,...Object.entries(playerStats).filter(([k])=>k.startsWith(side)).map(([k,s])=>[
      k.split(" - ")[1]?.trim()||k, s.points, s.freeThrows, s.assists, s.rebounds,
      s.blocks, s.steals, s.turnovers, s.fouls,
      pct(s.shotsMade?.twoPoint||0,s.shotsAttempted?.twoPoint||0),
      pct(s.shotsMade?.threePoint||0,s.shotsAttempted?.threePoint||0),
      pct(s.freeThrows||0,s.shotsAttempted?.freeThrow||0),
      (s.timestamps||[]).join("; "),
    ])];
    if (rows.length>1) XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),`${side.charAt(0).toUpperCase()+side.slice(1)} Team`);
  });
  XLSX.writeFile(wb,`${ROOM_CODE}_stats_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── Snapshots (per-room sub-collection) ──
async function saveSnapshot() {
  if (!roomRef) return;
  const name = prompt("Name this snapshot:");
  if (!name) return;
  const snapCol = collection(db, "gameRooms", ROOM_CODE, "snapshots");
  await addDoc(snapCol, { name, date: new Date().toISOString(), playerStats, teamStats, finalScore:{home:homeScore,away:awayScore}, log: el("player-log")?.innerHTML||"" });
  showToast("Snapshot saved!"); loadSnapshots();
}

async function loadSnapshots() {
  if (!roomRef) return;
  const snapCol = collection(db, "gameRooms", ROOM_CODE, "snapshots");
  const snap = await getDocs(snapCol);
  const list = el("saved-games-list"); list.innerHTML = "";
  const items = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>new Date(b.date)-new Date(a.date));
  if (!items.length) { list.innerHTML=`<li style="color:var(--t3);padding:10px">No snapshots saved.</li>`; return; }
  items.forEach(g => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span><strong>${g.name||"Snapshot"}</strong><br><small style="color:var(--t3)">${new Date(g.date).toLocaleString()}</small></span>
      <span style="display:flex;gap:6px">
        <button class="ctrl-btn red" style="flex:none;padding:7px 14px;font-size:12px" onclick="deleteSnapshot('${g.id}')">🗑</button>
      </span>`;
    list.appendChild(li);
  });
}

async function deleteSnapshot(id) {
  if (!confirm("Delete this snapshot?")) return;
  await deleteDoc(doc(db,"gameRooms",ROOM_CODE,"snapshots",id));
  loadSnapshots();
}

async function clearAllSnapshots() {
  if (!roomRef) return;
  const snapCol = collection(db,"gameRooms",ROOM_CODE,"snapshots");
  const snap = await getDocs(snapCol);
  if (!snap.size) { showToast("No snapshots to clear"); return; }
  if (!confirm(`Delete all ${snap.size} snapshot${snap.size!==1?"s":""}?`)) return;
  await Promise.all(snap.docs.map(d=>deleteDoc(doc(db,"gameRooms",ROOM_CODE,"snapshots",d.id))));
  showToast("Snapshots cleared"); loadSnapshots();
}

// Globals
window.toggleView=toggleView; window.showTab=showTab;
window.selectPlayer=selectPlayer; window.handleStat=handleStat;
window.recordShotAttempt=recordShotAttempt; window.undoLastStat=undoLastStat;
window.startStopClock=startStopClock; window.setCustomTime=setCustomTime;
window.confirmReset=confirmReset; window.updateFouls=updateFouls;
window.updateTimeout=updateTimeout; window.openSubstitutionModal=openSubstitutionModal;
window.performSubstitution=performSubstitution; window.closeSubstitutionModal=closeSubstitutionModal;
window.generateStats=generateStats; window.saveSnapshot=saveSnapshot;
window.loadSnapshots=loadSnapshots; window.deleteSnapshot=deleteSnapshot;
window.clearAllSnapshots=clearAllSnapshots; window.updatePlayerComparison=updatePlayerComparison;

// ── End Game ──
function confirmEndGame() {
  const modal = el("end-game-modal");
  if (!modal) return;

  // Show the current score in the modal
  const homeName = homeTeam?.name || "Home";
  const awayName = awayTeam?.name || "Away";
  const homeWins = homeScore > awayScore;
  const awayWins = awayScore > homeScore;

  el("end-score-display").innerHTML = `
    <div class="es-team">
      <div class="es-name">${homeName}</div>
      <div class="es-score ${homeWins ? "winner" : ""}">${homeScore}</div>
    </div>
    <div class="es-sep">—</div>
    <div class="es-team">
      <div class="es-name">${awayName}</div>
      <div class="es-score ${awayWins ? "winner" : ""}">${awayScore}</div>
    </div>`;

  modal.style.display = "flex";

  el("end-game-confirm-btn").onclick = () => { modal.style.display = "none"; endGame(); };
  el("end-game-cancel-btn").onclick  = () => { modal.style.display = "none"; };
}

async function endGame() {
  // Stop the clock
  if (clockRunning) {
    clearInterval(clockInterval); clockRunning = false;
    el("start-stop-btn").textContent = "▶ START";
  }

  // Final save to Firebase with status = done
  if (roomRef) {
    await updateDoc(roomRef, {
      homeScore, awayScore,
      homeFouls, awayFouls,
      homeTimeouts, awayTimeouts,
      period, clockSeconds: gameClock,
      playerStats, teamStats,
      log: el("player-log")?.innerHTML || "",
      status: "done",
      endedAt: serverTimestamp(),
      finalScore: { home: homeScore, away: awayScore },
    });
  }

  // Show game-over banner in the UI
  const clockBlock = document.querySelector(".clock-block");
  if (clockBlock) {
    const existing = clockBlock.querySelector(".game-over-banner");
    if (!existing) {
      const winner = homeScore > awayScore
        ? (homeTeam?.name || "Home")
        : awayScore > homeScore
        ? (awayTeam?.name || "Away")
        : null;
      const msg = winner ? `🏆 ${winner} wins!` : "🤝 Final Score — Tie!";
      clockBlock.insertAdjacentHTML("beforeend", `
        <div class="game-over-banner">
          <span>${msg}  ${homeScore} — ${awayScore}</span>
          <a href="lobby.html">← Back to Lobby</a>
        </div>`);
    }
  }

  // Disable all stat buttons so nothing can be recorded after game ends
  document.querySelectorAll(".sb, .sub-btn, #start-stop-btn, .end-game-btn").forEach(btn => {
    btn.disabled = true;
    btn.style.opacity = "0.4";
    btn.style.cursor  = "not-allowed";
  });

  showToast("Game ended. Stats saved!");
}

window.confirmEndGame = confirmEndGame;
window.endGame = endGame;

// ── Share Coach Links ──
function openShareModal() {
  if (!ROOM_CODE) { showToast("No active room"); return; }

  const base = window.location.href.split("game.html")[0];
  const homeUrl = `${base}coach.html?room=${ROOM_CODE}&team=home`;
  const awayUrl = `${base}coach.html?room=${ROOM_CODE}&team=away`;

  el("share-home-name").textContent = homeTeam?.name || "Home Team";
  el("share-away-name").textContent = awayTeam?.name || "Away Team";
  el("share-home-url").textContent  = homeUrl;
  el("share-away-url").textContent  = awayUrl;

  el("share-modal").style.display = "flex";
}

function closeShareModal() {
  el("share-modal").style.display = "none";
}

function copyLink(side) {
  const urlEl = el(`share-${side}-url`);
  if (!urlEl) return;
  navigator.clipboard.writeText(urlEl.textContent).then(() => {
    showToast(`${side === "home" ? "Home" : "Away"} coach link copied!`);
  }).catch(() => {
    // fallback for non-https
    const ta = document.createElement("textarea");
    ta.value = urlEl.textContent;
    document.body.appendChild(ta);
    ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Link copied!");
  });
}

function openLink(side) {
  const urlEl = el(`share-${side}-url`);
  if (urlEl) window.open(urlEl.textContent, "_blank");
}

window.openShareModal  = openShareModal;
window.closeShareModal = closeShareModal;
window.copyLink        = copyLink;
window.openLink        = openLink;