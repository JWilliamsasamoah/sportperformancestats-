// ================================================
//  SPORT PERFORMANCE STATS · TEAMS & PLAYERS
//  Merged page: accordion teams, player profiles,
//  Boys/Girls divisions, coach auth (Firebase Auth)
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy,
  where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { requireAuth, buildNavAuth } from "./auth-guard.js";

const FB = {
  apiKey: "AIzaSyCaUc9WOOBcvSinLVpxwbdojXvbuSMQBBM",
  authDomain: "statsapp-a199b.firebaseapp.com",
  projectId: "statsapp-a199b",
  storageBucket: "statsapp-a199b.appspot.com",
  messagingSenderId: "695414880372",
  appId: "1:695414880372:web:bd07071a02390219bd3921"
};

const app      = initializeApp(FB);
const db       = getFirestore(app);
const auth     = getAuth(app);
const TEAMS    = collection(db, "teams");
const ROOMS    = collection(db, "gameRooms");
const NOTIFS   = collection(db, "notifications");
const USERS    = collection(db, "users");

// ── Avatar colors & chart colors ──
const AV_COLORS = ["av-blue","av-gold","av-green","av-purple","av-teal","av-red","av-orange"];
const C = {
  gold:"#f5c518", blue:"#3b82f6", teal:"#14b8a6",
  grn:"#22c55e",  red:"#ef4444",  purple:"#a855f7",
  line:"#2e3550", t2:"#8b95b0",   t3:"#4d5470"
};

// ── Division config ──
const DIVISIONS = [
  { key: "boy11-14",  label: "Boys 11–14"  },
  { key: "boy15-18",  label: "Boys 15–18"  },
  { key: "girl11-18", label: "Girls 11–18" },
];
const DEFAULT_DIVISION = "boy11-14";

// ── State ──
let teams          = [];
let allGames       = [];
let allPlayers     = [];
let userProfile    = null;   // { name, email, role, teamId, division }
let activeDivision = DEFAULT_DIVISION;
let currentPlayer  = null;

// Roster modal state
let currentTeamIndex = null;
let currentTeamId    = null;

// Chart instances (destroyed/recreated per player)
let chartShot = null, chartRadar = null, chartDonut = null, chartHistory = null;

// Trade state
let tradePlayer = null;

// ── Boot ──
document.addEventListener("DOMContentLoaded", async () => {
  const { user, profile } = await requireAuth(auth, db);
  userProfile = { ...profile, uid: user.uid };
  buildNavAuth(profile, auth);
  await loadAllData();
  renderAll();
  if (userProfile.role === "admin") {
    addAdminUsersButton();
  }
  if (userProfile.role === "coach") {
    // Show assigned team name in the nav role badge
    const assignedTeam = teams.find(t => t.id === userProfile.teamId);
    const roleEl = document.querySelector(".nav-user-role");
    if (roleEl && assignedTeam) roleEl.textContent = `Coach · ${assignedTeam.name}`;
    addNotifBell();
    loadNotifications();
  }
});

// ── Load data ──
async function loadAllData() {
  document.getElementById("tp-loading").style.display = "block";

  // Load teams
  const tSnap = await getDocs(TEAMS);
  teams = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (userProfile?.role === "coach") {
    teams = teams.filter(t => t.id === userProfile.teamId);
  }

  // Load ALL game rooms (archived rooms kept for stat history)
  let allRooms = [];
  try {
    allRooms = (await getDocs(query(ROOMS, orderBy("createdAt", "desc"))))
      .docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {
    allRooms = (await getDocs(ROOMS)).docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // Player stats: any room that recorded stats (including archived — preserves history)
  allGames = allRooms.filter(g => g.playerStats && Object.keys(g.playerStats).length > 0);

  // W/L records: only rooms where the game completed (status set by game scoreboard)
  const doneGames = allRooms.filter(g => g.status === "done");

  buildAllPlayers();
  calculateRecords(doneGames);

  document.getElementById("tp-loading").style.display = "none";
}

// Auto-calculate wins/losses from completed game rooms
function calculateRecords(doneGames) {
  teams.forEach(t => { t.wins = 0; t.losses = 0; });

  doneGames.forEach(g => {
    if (g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) return;
    const home = teams.find(t => t.id === g.homeTeam?.id);
    const away = teams.find(t => t.id === g.awayTeam?.id);
    if (g.homeScore > g.awayScore) {
      if (home) home.wins++;
      if (away) away.losses++;
    } else {
      if (away) away.wins++;
      if (home) home.losses++;
    }
  });
}

function buildAllPlayers() {
  allPlayers = [];
  const seen = new Set();

  teams.forEach((team, ti) => {
    (team.roster || []).forEach((player, pi) => {
      const uid = `${player.name}__${player.number}`;
      if (seen.has(uid)) return;
      seen.add(uid);

      const avColor  = AV_COLORS[(ti + pi) % AV_COLORS.length];
      const initials = player.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
      const { aggregated, gameLog } = aggregatePlayerStats(player.name, player.number, allGames);

      allPlayers.push({
        name:     player.name,
        number:   player.number,
        teamId:   team.id,
        teamName: team.name,
        division: team.division || DEFAULT_DIVISION,
        avColor,
        initials,
        stats:   aggregated,
        gameLog,
      });
    });
  });
}

// ── Render all ──
function renderAll() {
  const role = userProfile?.role;
  const isAdmin = role === "admin";
  const isCoach = role === "coach";

  // Hide admin-only controls for non-admins
  if (!isAdmin) {
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
  }

  // Coach: lock to their division only
  if (isCoach) {
    document.getElementById("division-toggle").style.display = "none";
    // Derive division from the loaded team if the profile field is missing/null
    const coachTeam = teams.find(t => t.id === userProfile.teamId);
    const coachDiv  = userProfile.division || coachTeam?.division;
    document.querySelectorAll(".division-section").forEach(sec => {
      sec.style.display = (!coachDiv || sec.dataset.div === coachDiv) ? "block" : "none";
    });
  }

  DIVISIONS.forEach(d => renderDivision(d.key));

  // Auto-expand coach's team
  if (isCoach) {
    requestAnimationFrame(() => {
      const body = document.getElementById(`ta-body-${userProfile.teamId}`);
      if (body && !body.classList.contains("open")) {
        toggleTeam(userProfile.teamId);
      }
    });
  }
}

// ── Division filter ──
window.setDivision = function(divKey) {
  activeDivision = divKey;
  document.querySelectorAll(".div-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.div === divKey);
  });
  document.querySelectorAll(".division-section").forEach(sec => {
    sec.style.display = sec.dataset.div === divKey ? "block" : "none";
  });
};

// ── Render a division ──
function renderDivision(divKey) {
  const container = document.getElementById(`teams-${divKey}`);
  if (!container) return;
  container.innerHTML = "";

  const divConfig = DIVISIONS.find(d => d.key === divKey);
  const divTeams  = teams.filter(t => (t.division || DEFAULT_DIVISION) === divKey);
  const sorted    = [...divTeams].sort((a, b) => {
    const pa = a.wins / Math.max(1, a.wins + a.losses);
    const pb = b.wins / Math.max(1, b.wins + b.losses);
    return pb - pa;
  });

  if (!sorted.length) {
    container.innerHTML = `<div class="tp-empty-division">No ${divConfig?.label || divKey} teams yet. Click "+ Add Team" to get started.</div>`;
    return;
  }

  sorted.forEach((team, rank) => {
    const origIdx = teams.indexOf(team);
    container.appendChild(buildTeamAccordion(team, origIdx, rank));
  });
}

// ── Build accordion row ──
function buildTeamAccordion(team, origIdx, rank) {
  const total  = (team.wins || 0) + (team.losses || 0);
  const pct    = total > 0 ? ((team.wins / total) * 100).toFixed(1) + "%" : "—";
  const rClass = rank === 0 ? "r1" : rank === 1 ? "r2" : rank === 2 ? "r3" : "";
  const medal  = rank === 0 ? " 🥇" : rank === 1 ? " 🥈" : rank === 2 ? " 🥉" : "";

  const wrapper = document.createElement("div");
  wrapper.className = "team-accordion";
  wrapper.dataset.teamId = team.id;

  wrapper.innerHTML = `
    <div class="ta-header" onclick="toggleTeam('${team.id}')">
      <span class="rank ${rClass}">${rank + 1}</span>
      <span class="ta-name">${team.name}${medal}</span>
      <div class="ta-record">
        <span class="tw">${team.wins || 0}W</span>
        <span class="tl">${team.losses || 0}L</span>
        <span class="ta-pct">${pct}</span>
      </div>
      <div class="ta-actions">
        <div class="ta-admin-acts admin-only" style="display:flex;gap:6px">
          <button class="abtn del" onclick="event.stopPropagation();deleteTeam('${team.id}')">Delete</button>
        </div>
        <button class="abtn roster ta-roster-btn" onclick="event.stopPropagation();openRosterModal(${origIdx})">Roster</button>
      </div>
      <span class="ta-chevron">▼</span>
    </div>
    <div class="ta-body" id="ta-body-${team.id}">
      <div class="ta-body-inner" id="ta-inner-${team.id}">
        <div style="padding:16px;color:var(--t3);font-size:13px">Loading players…</div>
      </div>
    </div>`;

  const role = userProfile?.role;
  // Hide +W / +L / Delete for non-admins
  if (role !== "admin") {
    wrapper.querySelector(".admin-only")?.style.setProperty("display", "none");
  }
  // Roster button: hide for stats; coaches only see it on their own team
  const rosterBtn = wrapper.querySelector(".ta-roster-btn");
  if (role === "stats") {
    rosterBtn.style.display = "none";
  } else if (role === "coach" && team.id !== userProfile.teamId) {
    rosterBtn.style.display = "none";
  }

  return wrapper;
}

// ── Toggle accordion ──
window.toggleTeam = function(teamId) {
  const body    = document.getElementById(`ta-body-${teamId}`);
  const inner   = document.getElementById(`ta-inner-${teamId}`);
  const chevron = body?.previousElementSibling?.querySelector(".ta-chevron");
  if (!body) return;

  const isOpen = body.classList.contains("open");
  body.classList.toggle("open");
  if (chevron) chevron.style.transform = isOpen ? "" : "rotate(180deg)";

  // Lazy-load player cards on first open
  if (!isOpen && !body.dataset.loaded) {
    body.dataset.loaded = "true";
    populateTeamBody(teamId, inner);
  }
};

function populateTeamBody(teamId, container) {
  const teamPlayers = allPlayers.filter(p => p.teamId === teamId);

  if (!teamPlayers.length) {
    const canManage = userProfile?.role === "admin" || userProfile?.role === "coach";
    const hint = canManage ? " Use the Roster button to add players." : "";
    container.innerHTML = `<div class="ta-empty">No players on this roster yet.${hint}</div>`;
    return;
  }

  const sorted = [...teamPlayers].sort((a, b) => (b.stats?.points || 0) - (a.stats?.points || 0));
  const grid   = document.createElement("div");
  grid.className = "player-grid";

  sorted.forEach(p => {
    const card = document.createElement("div");
    card.className = "player-card";
    card.innerHTML = `
      <div class="pc-avatar ${p.avColor}">${p.initials}</div>
      <div class="pc-number">#${p.number}</div>
      <div class="pc-name">${p.name}</div>
      <div class="pc-stats">
        <span class="pc-pts">${p.stats?.points || 0} PTS</span>
        <span class="pc-sep">·</span>
        <span>${p.stats?.rebounds || 0} REB</span>
      </div>`;
    card.onclick = () => openPlayerPanel(p);
    grid.appendChild(card);
  });

  container.innerHTML = "";
  container.appendChild(grid);
}

// ── Add Team Modal ──
window.openAddTeamModal = function(preselectedDiv) {
  const sel = document.getElementById("new-team-division");
  if (preselectedDiv) sel.value = preselectedDiv;
  document.getElementById("new-team-name").value = "";
  document.getElementById("add-team-modal").classList.add("open");
  document.getElementById("new-team-name").focus();
};

window.closeAddTeamModal = function() {
  document.getElementById("add-team-modal").classList.remove("open");
};

window.submitAddTeam = async function() {
  const nameEl = document.getElementById("new-team-name");
  const divEl  = document.getElementById("new-team-division");
  const name   = nameEl.value.trim();
  const division = divEl.value;
  if (!name) { nameEl.focus(); return; }

  const data = { name, wins: 0, losses: 0, roster: [], division };
  try {
    const ref = await addDoc(TEAMS, data);
    teams.push({ id: ref.id, ...data });
    buildAllPlayers();
    renderDivision(division);
    closeAddTeamModal();
    // Switch to the division tab we just added to
    setDivision(division);
  } catch (e) {
    alert("Failed to add team: " + e.message);
  }
};

// ── Admin: Delete Team ──
window.deleteTeam = async function(teamId) {
  const team = teams.find(t => t.id === teamId);
  if (!team) return;
  if (!confirm(`Delete "${team.name}"? This cannot be undone.`)) return;
  const division = team.division || DEFAULT_DIVISION;
  try {
    await deleteDoc(doc(db, "teams", teamId));
    teams.splice(teams.indexOf(team), 1);
    buildAllPlayers();
    renderDivision(division);
  } catch (e) {
    alert("Delete failed: " + e.message);
  }
};

// ── Roster Modal ──
window.openRosterModal = function(origIdx) {
  currentTeamIndex = origIdx;
  currentTeamId    = teams[origIdx].id;
  document.getElementById("team-roster-title").textContent = `Roster — ${teams[origIdx].name}`;
  renderRoster();
  document.getElementById("roster-modal").classList.add("open");
};

function renderRoster() {
  const ul     = document.getElementById("player-list");
  const roster = teams[currentTeamIndex]?.roster || [];
  ul.innerHTML = "";
  if (!roster.length) {
    ul.innerHTML = `<li style="justify-content:center;color:var(--t3)">No players yet. Add one above.</li>`;
    return;
  }
  roster.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>#${p.number} — ${p.name}</span><button onclick="removePlayer(${i})">Remove</button>`;
    ul.appendChild(li);
  });
}

window.addPlayerToRoster = async function() {
  const nameEl = document.getElementById("player-name");
  const numEl  = document.getElementById("player-number");
  const name   = nameEl.value.trim();
  const number = numEl.value.trim();
  if (!name || !number) { alert("Enter both a name and jersey number."); return; }

  const roster = teams[currentTeamIndex].roster;
  if (roster.some(p => p.number === number)) {
    alert(`Jersey #${number} is already taken on this team.`); return;
  }

  roster.push({ name, number });
  try {
    await updateDoc(doc(db, "teams", currentTeamId), { roster });
    nameEl.value = ""; numEl.value = "";
    renderRoster();
  } catch (e) { roster.pop(); alert("Failed: " + e.message); }
};

window.removePlayer = async function(idx) {
  if (!confirm("Remove this player?")) return;
  const [removed] = teams[currentTeamIndex].roster.splice(idx, 1);
  try {
    await updateDoc(doc(db, "teams", currentTeamId), { roster: teams[currentTeamIndex].roster });
    renderRoster();
  } catch (e) {
    teams[currentTeamIndex].roster.splice(idx, 0, removed);
    alert("Failed: " + e.message);
  }
};

window.saveRoster = async function() {
  try {
    await updateDoc(doc(db, "teams", currentTeamId), { roster: teams[currentTeamIndex].roster });
    buildAllPlayers();
    // Force re-populate the team's player grid
    const inner = document.getElementById(`ta-inner-${currentTeamId}`);
    const body  = document.getElementById(`ta-body-${currentTeamId}`);
    if (inner) {
      body.dataset.loaded = "";
      populateTeamBody(currentTeamId, inner);
    }
    closeRosterModal();
  } catch (e) { alert("Save failed: " + e.message); }
};

window.closeRosterModal = function() {
  document.getElementById("roster-modal").classList.remove("open");
};

// ── Player Panel ──
function openPlayerPanel(player, gameFilter = null) {
  currentPlayer = player;

  document.getElementById("player-panel").classList.add("open");
  document.getElementById("panel-backdrop").classList.add("open");
  document.body.style.overflow = "hidden";

  // Show Trade button only for admins (need 2+ teams to trade between)
  const tradeBtn = document.getElementById("panel-trade-btn");
  if (tradeBtn) {
    tradeBtn.style.display = userProfile?.role === "admin" && teams.length > 1 ? "inline-flex" : "none";
  }

  const displayStats = gameFilter ? gameFilter.stats : player.stats;
  const viewLabel    = gameFilter ? `Game: ${gameFilter.gameName}` : "Season Totals";

  renderHero(player, displayStats, viewLabel);
  renderStatCards(displayStats);
  renderCharts(player, displayStats);
  renderGameHistory(player, gameFilter?.gameId || null);
  renderTimeline(displayStats);

  // Scroll panel to top
  document.getElementById("panel-body").scrollTop = 0;
}

window.closePlayerPanel = function() {
  document.getElementById("player-panel").classList.remove("open");
  document.getElementById("panel-backdrop").classList.remove("open");
  document.body.style.overflow = "";
  currentPlayer = null;
};

// ── Stat Aggregation ──
function findStatKey(name, number, playerStats) {
  if (!playerStats) return null;
  for (const prefix of ["home", "away"]) {
    const k = `${prefix} - ${name} #${number}`;
    if (playerStats[k]) return k;
  }
  for (const k of Object.keys(playerStats)) {
    if (k.includes(`${name} #${number}`)) return k;
  }
  return null;
}

function aggregatePlayerStats(name, number, games) {
  const zero = () => ({
    points: 0, freeThrows: 0, assists: 0, rebounds: 0,
    blocks: 0, steals: 0, turnovers: 0, fouls: 0,
    shotsMade:     { twoPoint: 0, threePoint: 0, freeThrow: 0 },
    shotsAttempted:{ twoPoint: 0, threePoint: 0, freeThrow: 0 },
    timestamps: [],
  });

  const aggregated = zero();
  const gameLog    = [];

  games.forEach(game => {
    const key = findStatKey(name, number, game.playerStats);
    if (!key) return;

    const s = game.playerStats[key];
    aggregated.points     += s.points     || 0;
    aggregated.freeThrows += s.freeThrows || 0;
    aggregated.assists    += s.assists    || 0;
    aggregated.rebounds   += s.rebounds   || 0;
    aggregated.blocks     += s.blocks     || 0;
    aggregated.steals     += s.steals     || 0;
    aggregated.turnovers  += s.turnovers  || 0;
    aggregated.fouls      += s.fouls      || 0;

    aggregated.shotsMade.twoPoint      += s.shotsMade?.twoPoint      || 0;
    aggregated.shotsMade.threePoint    += s.shotsMade?.threePoint    || 0;
    aggregated.shotsMade.freeThrow     += s.shotsMade?.freeThrow     || 0;
    aggregated.shotsAttempted.twoPoint += s.shotsAttempted?.twoPoint || 0;
    aggregated.shotsAttempted.threePoint += s.shotsAttempted?.threePoint || 0;
    aggregated.shotsAttempted.freeThrow  += s.shotsAttempted?.freeThrow  || 0;

    if (s.timestamps?.length) aggregated.timestamps.push(...s.timestamps);

    gameLog.push({
      gameId:   game.id,
      gameName: game.name || `Room ${game.code || game.id}`,
      date:     game.createdAt?.toDate?.()?.toISOString() || game.date || new Date().toISOString(),
      stats:    s,
    });
  });

  return { aggregated, gameLog };
}

// ── Profile Render Functions ──
function el(id) { return document.getElementById(id); }

function renderHero(p, s, viewLabel) {
  s = s || {};
  const pct = (m, a) => a > 0 ? ((m / a) * 100).toFixed(1) + "%" : "—";
  const fg  = pct(
    (s.shotsMade?.twoPoint || 0) + (s.shotsMade?.threePoint || 0),
    (s.shotsAttempted?.twoPoint || 0) + (s.shotsAttempted?.threePoint || 0)
  );

  el("profile-avatar").className   = `profile-avatar ${p.avColor}`;
  el("profile-avatar").textContent = p.initials;
  el("profile-number").textContent = `#${p.number}`;
  el("profile-name").textContent   = p.name;
  el("profile-team").innerHTML     = `${p.teamName} <span style="color:var(--t3);font-size:12px;margin-left:8px">${viewLabel}</span>`;
  el("profile-badges").innerHTML   = getBadges(s).map(b =>
    `<span class="badge badge-${b.color}">${b.label}</span>`
  ).join("");

  el("profile-headline-stats").innerHTML = `
    <div class="hs-stat"><div class="hs-val">${s.points || 0}</div><div class="hs-lbl">PTS</div></div>
    <div class="hs-stat"><div class="hs-val">${s.rebounds || 0}</div><div class="hs-lbl">REB</div></div>
    <div class="hs-stat"><div class="hs-val">${s.assists || 0}</div><div class="hs-lbl">AST</div></div>
    <div class="hs-stat"><div class="hs-val">${fg}</div><div class="hs-lbl">FG%</div></div>
  `;
}

function getBadges(s) {
  s = s || {};
  const badges = [];
  if ((s.points || 0) >= 20)      badges.push({ label: "20+ PTS",      color: "gold" });
  else if ((s.points || 0) >= 10) badges.push({ label: "10+ PTS",      color: "blue" });
  if ((s.rebounds || 0) >= 10)    badges.push({ label: "10+ REB",      color: "green" });
  if ((s.assists || 0) >= 5)      badges.push({ label: "5+ AST",       color: "purple" });
  if ((s.blocks || 0) >= 3)       badges.push({ label: "3+ BLK",       color: "blue" });
  if ((s.steals || 0) >= 3)       badges.push({ label: "3+ STL",       color: "green" });
  const made = (s.shotsMade?.twoPoint || 0) + (s.shotsMade?.threePoint || 0);
  const att  = (s.shotsAttempted?.twoPoint || 0) + (s.shotsAttempted?.threePoint || 0);
  if (att > 0 && made / att > 0.5) badges.push({ label: "50%+ FG", color: "gold" });
  if ((s.points || 0) >= 10 && (s.rebounds || 0) >= 10) badges.push({ label: "Double-Double", color: "gold" });
  if (!badges.length) badges.push({ label: "On Roster", color: "blue" });
  return badges;
}

function renderStatCards(s) {
  s = s || {};
  const cards = [
    { val: s.points || 0,    lbl: "Points" },
    { val: s.rebounds || 0,  lbl: "Rebounds" },
    { val: s.assists || 0,   lbl: "Assists" },
    { val: s.steals || 0,    lbl: "Steals" },
    { val: s.blocks || 0,    lbl: "Blocks" },
    { val: s.turnovers || 0, lbl: "Turnovers" },
  ];
  el("stat-cards-row").innerHTML = cards.map(c => `
    <div class="sc-card">
      <div class="sc-card-val">${c.val}</div>
      <div class="sc-card-lbl">${c.lbl}</div>
    </div>`).join("");
}

function renderCharts(player, s) {
  s = s || {};
  [chartShot, chartRadar, chartDonut, chartHistory].forEach(c => c?.destroy());
  chartShot = chartRadar = chartDonut = chartHistory = null;

  const pct = (m, a) => a > 0 ? parseFloat(((m / a) * 100).toFixed(1)) : 0;

  // Shot efficiency bar
  chartShot = new Chart(el("playerShotChart"), {
    type: "bar",
    data: {
      labels: ["2PT%", "3PT%", "FT%"],
      datasets: [{
        data: [
          pct(s.shotsMade?.twoPoint || 0,   s.shotsAttempted?.twoPoint || 0),
          pct(s.shotsMade?.threePoint || 0, s.shotsAttempted?.threePoint || 0),
          pct(s.freeThrows || 0,            s.shotsAttempted?.freeThrow || 0),
        ],
        backgroundColor: [C.gold, C.blue, C.teal],
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: C.line }, ticks: { color: C.t2 } },
        y: { grid: { color: C.line }, ticks: { color: C.t2, callback: v => v + "%" }, beginAtZero: true, max: 100 },
      }
    }
  });

  // Radar chart
  const maxRef = Math.max(20, s.points || 0);
  const norm   = v => Math.min(10, parseFloat(((v / maxRef) * 10).toFixed(1)));
  const fgEff  = pct(
    (s.shotsMade?.twoPoint || 0) + (s.shotsMade?.threePoint || 0),
    (s.shotsAttempted?.twoPoint || 0) + (s.shotsAttempted?.threePoint || 0)
  ) / 10;

  chartRadar = new Chart(el("playerRadarProfile"), {
    type: "radar",
    data: {
      labels: ["Scoring", "Rebounding", "Playmaking", "Defense", "Efficiency", "FT"],
      datasets: [{
        data: [
          norm(s.points || 0),
          norm((s.rebounds || 0) * 2),
          norm((s.assists || 0) * 3),
          norm(((s.steals || 0) + (s.blocks || 0)) * 4),
          parseFloat(fgEff.toFixed(1)),
          norm((s.freeThrows || 0) * 3),
        ],
        borderColor: C.gold, backgroundColor: C.gold + "22",
        pointBackgroundColor: C.gold, pointRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { r: { backgroundColor: "transparent", grid: { color: C.line }, pointLabels: { color: C.t2, font: { size: 10 } }, ticks: { display: false }, angleLines: { color: C.line }, min: 0, max: 10 } }
    }
  });

  // Scoring donut
  const pts2  = (s.shotsMade?.twoPoint || 0) * 2;
  const pts3  = (s.shotsMade?.threePoint || 0) * 3;
  const ptsFT = s.freeThrows || 0;
  const has   = pts2 + pts3 + ptsFT > 0;

  chartDonut = new Chart(el("playerDonutChart"), {
    type: "doughnut",
    data: {
      labels: ["2PT", "3PT", "FT"],
      datasets: [{
        data: has ? [pts2, pts3, ptsFT] : [1, 1, 1],
        backgroundColor: has ? [C.gold, C.blue, C.teal] : [C.line, C.line, C.line],
        borderColor: "#12151e", borderWidth: 2,
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "65%", plugins: { legend: { display: false }, tooltip: { enabled: has } } }
  });

  const donutCard = el("playerDonutChart").closest(".profile-chart-card");
  donutCard.querySelector(".donut-leg")?.remove();
  donutCard.insertAdjacentHTML("beforeend", `
    <div class="donut-leg" style="display:flex;justify-content:center;gap:12px;margin-top:8px;font-size:11px;color:${C.t2}">
      <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:${C.gold}"></span>2PT ${pts2}pts</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:${C.blue}"></span>3PT ${pts3}pts</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:${C.teal}"></span>FT ${ptsFT}pts</span>
    </div>`);

  // History line chart
  renderHistoryChart(player);
}

function renderHistoryChart(player) {
  const histEl = el("playerHistoryChart");
  if (!histEl || !player.gameLog.length) return;

  const labels = player.gameLog.map((g, i) => g.gameName || `Game ${i + 1}`);
  const pts    = player.gameLog.map(g => g.stats?.points   || 0);
  const reb    = player.gameLog.map(g => g.stats?.rebounds || 0);
  const ast    = player.gameLog.map(g => g.stats?.assists  || 0);

  chartHistory = new Chart(histEl, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "PTS", data: pts, borderColor: C.gold,   backgroundColor: C.gold + "22",   tension: .35, pointRadius: 5, pointBackgroundColor: C.gold,   fill: false },
        { label: "REB", data: reb, borderColor: C.teal,   backgroundColor: C.teal + "22",   tension: .35, pointRadius: 4, pointBackgroundColor: C.teal,   fill: false },
        { label: "AST", data: ast, borderColor: C.blue,   backgroundColor: C.blue + "22",   tension: .35, pointRadius: 4, pointBackgroundColor: C.blue,   fill: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: C.line }, ticks: { color: C.t2, maxRotation: 40 } },
        y: { grid: { color: C.line }, ticks: { color: C.t2 }, beginAtZero: true },
      }
    }
  });
}

function renderGameHistory(player, activeGameId) {
  const cont = el("game-history-list");
  if (!cont) return;
  cont.innerHTML = "";

  if (!player.gameLog.length) {
    cont.innerHTML = `<div style="padding:14px;color:var(--t3);font-size:13px;text-align:center">No game history yet.<br><small>Play a game and it will appear here.</small></div>`;
    return;
  }

  const pill = (val, lbl, color) =>
    `<div class="gh-pill" style="--pill-color:${color}">
      <span class="gh-pill-val">${val}</span>
      <span class="gh-pill-lbl">${lbl}</span>
    </div>`;

  // Season totals card
  const ts = player.stats || {};
  const totalCard = document.createElement("div");
  totalCard.className = `gh-card-row${!activeGameId ? " active" : ""}`;
  totalCard.innerHTML = `
    <div class="gh-card-top">
      <div class="gh-card-left">
        <div class="gh-card-badge season">SEASON</div>
        <div class="gh-card-title">All Games</div>
        <div class="gh-card-sub">${player.gameLog.length} game${player.gameLog.length !== 1 ? "s" : ""} played</div>
      </div>
      <div class="gh-card-score">${ts.points || 0}<span>PTS</span></div>
    </div>
    <div class="gh-card-pills">
      ${pill(ts.rebounds || 0,  "REB", C.teal)}
      ${pill(ts.assists || 0,   "AST", C.blue)}
      ${pill(ts.steals || 0,    "STL", C.grn)}
      ${pill(ts.blocks || 0,    "BLK", C.purple)}
      ${pill(ts.turnovers || 0, "TOV", C.red)}
      ${pill(ts.freeThrows || 0,"FT",  C.gold)}
    </div>`;
  totalCard.onclick = () => openPlayerPanel(player, null);
  cont.appendChild(totalCard);

  cont.insertAdjacentHTML("beforeend", `<div class="gh-divider">Individual Games</div>`);

  player.gameLog.forEach(g => {
    const s      = g.stats || {};
    const isActive = g.gameId === activeGameId;
    const d = g.date
      ? new Date(g.date).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
      : "";
    const fgMade = (s.shotsMade?.twoPoint || 0) + (s.shotsMade?.threePoint || 0);
    const fgAtt  = (s.shotsAttempted?.twoPoint || 0) + (s.shotsAttempted?.threePoint || 0);
    const fg     = fgAtt > 0 ? ((fgMade / fgAtt) * 100).toFixed(0) + "%" : "—";

    const card = document.createElement("div");
    card.className = `gh-card-row${isActive ? " active" : ""}`;
    card.innerHTML = `
      <div class="gh-card-top">
        <div class="gh-card-left">
          <div class="gh-card-badge game">GAME</div>
          <div class="gh-card-title">${g.gameName}</div>
          <div class="gh-card-sub">${d} &nbsp;·&nbsp; FG ${fg}</div>
        </div>
        <div class="gh-card-score">${s.points || 0}<span>PTS</span></div>
      </div>
      <div class="gh-card-pills">
        ${pill(s.rebounds || 0,  "REB", C.teal)}
        ${pill(s.assists || 0,   "AST", C.blue)}
        ${pill(s.steals || 0,    "STL", C.grn)}
        ${pill(s.blocks || 0,    "BLK", C.purple)}
        ${pill(s.turnovers || 0, "TOV", C.red)}
        ${pill(s.freeThrows || 0,"FT",  C.gold)}
      </div>`;
    card.onclick = () => openPlayerPanel(player, g);
    cont.appendChild(card);
  });
}

// ── Admin: Manage Users ──
let allUsers    = [];
let activeUmTab = "coaches";

function addAdminUsersButton() {
  const navUser = document.querySelector(".nav-user");
  if (!navUser) return;
  const btn = document.createElement("button");
  btn.className = "nav-usermgr-btn";
  btn.textContent = "Users";
  btn.onclick = openUserMgr;
  navUser.insertBefore(btn, navUser.firstChild);
}

window.openUserMgr = async function() {
  document.getElementById("usermgr-modal").classList.add("open");
  activeUmTab = "coaches";
  switchUmTab("coaches");
  await loadUserMgr();
};

window.closeUserMgr = function() {
  document.getElementById("usermgr-modal").classList.remove("open");
};

async function loadUserMgr() {
  document.getElementById("usermgr-list").innerHTML =
    `<div class="usermgr-loading">Loading users…</div>`;
  try {
    const snap = await getDocs(USERS);
    allUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    renderUmTab();
  } catch (e) {
    document.getElementById("usermgr-list").innerHTML =
      `<div class="usermgr-loading" style="color:var(--red)">Failed to load: ${e.message}</div>`;
  }
}

window.switchUmTab = function(tab) {
  activeUmTab = tab;
  document.querySelectorAll(".umtab").forEach(b => b.classList.remove("active"));
  document.getElementById(`umtab-${tab}`)?.classList.add("active");
  renderUmTab();
};

const DIVISION_LABELS_UM = {
  "boy11-14": "Boys 11–14", "boy15-18": "Boys 15–18", "girl11-18": "Girls 11–18",
};

function teamOptionsHtml(selectedId) {
  return `<option value="">— Unassigned —</option>` +
    teams.map(t =>
      `<option value="${t.id}" ${t.id === selectedId ? "selected" : ""}>
        ${t.name} (${DIVISION_LABELS_UM[t.division] || t.division})
      </option>`
    ).join("");
}

function renderUmTab() {
  const list = document.getElementById("usermgr-list");
  const roleMap = { coaches: "coach", stats: "stats", admin: "admin" };
  const subset  = allUsers.filter(u => u.role === roleMap[activeUmTab]);

  if (!subset.length) {
    const labels = { coaches: "coaches", stats: "scorekeepers", admin: "admins" };
    list.innerHTML = `<div class="usermgr-empty">No ${labels[activeUmTab]} have signed up yet.</div>`;
    return;
  }

  list.innerHTML = "";
  subset.forEach(u => {
    const initials = (u.name || u.email || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const avClass  = AV_COLORS[Math.abs((u.uid?.charCodeAt(0) || 0)) % AV_COLORS.length];
    const isCoach  = u.role === "coach";
    const curTeam  = teams.find(t => t.id === u.teamId);

    const row = document.createElement("div");
    row.className = "usermgr-row";
    row.id = `umrow-${u.uid}`;
    row.innerHTML = `
      <div class="pc-avatar ${avClass}" style="width:40px;height:40px;font-size:16px;flex-shrink:0">${initials}</div>
      <div class="usermgr-info">
        <div class="usermgr-name">${u.name || "—"}</div>
        <div class="usermgr-sub">@${u.username || "—"} &nbsp;·&nbsp; ${u.email}</div>
        ${curTeam ? `<div class="usermgr-cur-team">Team: <strong>${curTeam.name}</strong></div>` : ""}
      </div>
      <div class="usermgr-actions">
        <select class="division-select usermgr-role-sel" id="urole-${u.uid}"
                onchange="onUmRoleChange('${u.uid}')">
          <option value="coach" ${u.role === "coach" ? "selected" : ""}>Coach</option>
          <option value="stats" ${u.role === "stats" ? "selected" : ""}>Scorekeeper</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
        <select class="division-select usermgr-team-sel" id="usel-${u.uid}"
                style="display:${isCoach ? "block" : "none"}">
          ${teamOptionsHtml(u.teamId)}
        </select>
        <button class="pbtn save usermgr-save-btn" onclick="saveUser('${u.uid}')">Save</button>
      </div>`;
    list.appendChild(row);
  });
}

window.onUmRoleChange = function(uid) {
  const role    = document.getElementById(`urole-${uid}`)?.value;
  const teamSel = document.getElementById(`usel-${uid}`);
  if (teamSel) teamSel.style.display = role === "coach" ? "block" : "none";
};

window.saveUser = async function(uid) {
  const roleSel = document.getElementById(`urole-${uid}`);
  const teamSel = document.getElementById(`usel-${uid}`);
  const newRole = roleSel?.value;
  const teamId  = newRole === "coach" ? (teamSel?.value || null) : null;
  const team    = teams.find(t => t.id === teamId) || null;

  const btn = document.querySelector(`#umrow-${uid} .usermgr-save-btn`);
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    await updateDoc(doc(db, "users", uid), {
      role:     newRole,
      teamId:   teamId,
      division: team?.division || null,
    });
    const u = allUsers.find(x => x.uid === uid);
    if (u) { u.role = newRole; u.teamId = teamId; u.division = team?.division || null; }

    const roleLabel = { coach: "Coach", stats: "Scorekeeper", admin: "Admin" }[newRole] || newRole;
    showToast(team ? `Saved — ${roleLabel} · ${team.name}` : `Saved — ${roleLabel}`);
    renderUmTab();
  } catch (e) {
    showToast("Save failed: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
};

// ── Player Search ──
window.searchPlayers = function(raw) {
  const q        = raw.trim().toLowerCase();
  const results  = document.getElementById("search-results");
  const tpPage   = document.getElementById("tp-page");
  const clearBtn = document.getElementById("search-clear");

  clearBtn.style.display = q ? "flex" : "none";

  if (!q) {
    results.style.display = "none";
    tpPage.style.display  = "block";
    return;
  }

  tpPage.style.display   = "none";
  results.style.display  = "block";

  const matches = allPlayers.filter(p =>
    p.name.toLowerCase().includes(q) ||
    String(p.number).includes(q) ||
    p.teamName.toLowerCase().includes(q)
  );

  if (!matches.length) {
    results.innerHTML = `<div class="tp-empty-division">No players match "${raw}"</div>`;
    return;
  }

  // Group by team for context
  const byTeam = {};
  matches.forEach(p => {
    if (!byTeam[p.teamName]) byTeam[p.teamName] = [];
    byTeam[p.teamName].push(p);
  });

  results.innerHTML = "";
  Object.entries(byTeam).forEach(([teamName, players]) => {
    const section = document.createElement("div");
    section.className = "search-group";
    section.innerHTML = `<div class="search-group-label">${teamName}</div>`;

    const grid = document.createElement("div");
    grid.className = "player-grid";
    players.forEach(p => {
      const card = document.createElement("div");
      card.className = "player-card";
      card.innerHTML = `
        <div class="pc-avatar ${p.avColor}">${p.initials}</div>
        <div class="pc-number">#${p.number}</div>
        <div class="pc-name">${p.name}</div>
        <div class="pc-stats">
          <span class="pc-pts">${p.stats?.points || 0} PTS</span>
          <span class="pc-sep">·</span>
          <span>${p.stats?.rebounds || 0} REB</span>
        </div>`;
      card.onclick = () => openPlayerPanel(p);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    results.appendChild(section);
  });
};

window.clearSearch = function() {
  const input = document.getElementById("player-search");
  if (input) input.value = "";
  window.searchPlayers("");
};

// ── Toast ──
function showToast(msg) {
  let t = document.querySelector(".tp-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "tp-toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove("show"), 3000);
}

// ── Trade Modal ──
window.openTradeModal = function() {
  const player = currentPlayer;
  if (!player) return;
  tradePlayer = player;

  // Populate player info card
  document.getElementById("trade-player-info").innerHTML = `
    <div class="trade-player-card">
      <div class="pc-avatar ${player.avColor}" style="width:44px;height:44px;font-size:18px">${player.initials}</div>
      <div>
        <div style="font-size:16px;font-weight:700;color:var(--t1)">${player.name}</div>
        <div style="font-size:12px;color:var(--t3)">#${player.number} &nbsp;·&nbsp; ${player.teamName}</div>
      </div>
    </div>`;

  // Populate destination team dropdown (exclude current team)
  const sel = document.getElementById("trade-dest");
  sel.innerHTML = `<option value="">— Select destination team —</option>`;

  const DIVISION_LABELS = { "boy11-14": "Boys 11–14", "boy15-18": "Boys 15–18", "girl11-18": "Girls 11–18" };
  const grouped = {};
  teams.filter(t => t.id !== player.teamId).forEach(t => {
    const div = t.division || DEFAULT_DIVISION;
    if (!grouped[div]) grouped[div] = [];
    grouped[div].push(t);
  });
  Object.entries(grouped).forEach(([div, ts]) => {
    const grp = document.createElement("optgroup");
    grp.label = DIVISION_LABELS[div] || div;
    ts.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });

  document.getElementById("trade-modal").classList.add("open");
};

window.closeTradeModal = function() {
  document.getElementById("trade-modal").classList.remove("open");
  tradePlayer = null;
};

window.executeTrade = async function() {
  const toTeamId = document.getElementById("trade-dest").value;
  if (!toTeamId || !tradePlayer) return;

  const fromTeam = teams.find(t => t.id === tradePlayer.teamId);
  const toTeam   = teams.find(t => t.id === toTeamId);
  if (!fromTeam || !toTeam) return;

  const btn = document.getElementById("trade-submit-btn");
  btn.disabled = true;
  btn.textContent = "Trading…";

  try {
    // 1. Move player between roster arrays
    const newFromRoster = (fromTeam.roster || []).filter(
      p => !(p.name === tradePlayer.name && p.number === tradePlayer.number)
    );
    const newToRoster = [...(toTeam.roster || []), { name: tradePlayer.name, number: tradePlayer.number }];

    await updateDoc(doc(db, "teams", fromTeam.id), { roster: newFromRoster });
    await updateDoc(doc(db, "teams", toTeam.id),   { roster: newToRoster });

    // 2. Find coaches for both teams and create notifications
    const coachSnap = await getDocs(query(USERS, where("role", "==", "coach")));
    const affectedCoaches = coachSnap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.teamId === fromTeam.id || u.teamId === toTeamId);

    for (const coach of affectedCoaches) {
      const receiving = coach.teamId === toTeamId;
      await addDoc(NOTIFS, {
        toUid:        coach.uid,
        message:      receiving
          ? `${tradePlayer.name} (#${tradePlayer.number}) has been traded TO your team (${toTeam.name}) from ${fromTeam.name}.`
          : `${tradePlayer.name} (#${tradePlayer.number}) has been traded FROM your team (${fromTeam.name}) to ${toTeam.name}.`,
        playerName:   tradePlayer.name,
        playerNumber: tradePlayer.number,
        fromTeamId:   fromTeam.id,
        fromTeamName: fromTeam.name,
        toTeamId,
        toTeamName:   toTeam.name,
        read:         false,
        createdAt:    serverTimestamp(),
      });
    }

    // 3. Update local state and re-render affected team bodies
    fromTeam.roster = newFromRoster;
    toTeam.roster   = newToRoster;
    buildAllPlayers();

    [fromTeam.id, toTeamId].forEach(id => {
      const inner = document.getElementById(`ta-inner-${id}`);
      const body  = document.getElementById(`ta-body-${id}`);
      if (inner && body) { body.dataset.loaded = ""; populateTeamBody(id, inner); }
    });

    closeTradeModal();
    closePlayerPanel();
    showToast(`${tradePlayer.name} traded to ${toTeam.name}`);
  } catch (e) {
    showToast("Trade failed: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm Trade";
  }
};

// ── Notification Bell (coaches only) ──
function addNotifBell() {
  const navUser = document.querySelector(".nav-user");
  if (!navUser) return;
  const bell = document.createElement("button");
  bell.className = "notif-bell";
  bell.id        = "notif-bell";
  bell.title     = "Notifications";
  bell.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
    <span class="notif-badge" id="notif-badge" style="display:none">0</span>`;
  bell.onclick = toggleNotifPanel;
  navUser.insertBefore(bell, navUser.firstChild);
}

let cachedNotifs = [];

async function loadNotifications() {
  try {
    const snap = await getDocs(query(NOTIFS, where("toUid", "==", userProfile.uid)));
    cachedNotifs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    const unread = cachedNotifs.filter(n => !n.read).length;
    const badge  = document.getElementById("notif-badge");
    if (badge) {
      badge.textContent    = unread > 9 ? "9+" : unread;
      badge.style.display  = unread > 0 ? "flex" : "none";
    }
    renderNotifications();
  } catch (e) {
    console.warn("Notifications load failed:", e.message);
  }
}

function renderNotifications() {
  const list = document.getElementById("notif-list");
  if (!list) return;
  if (!cachedNotifs.length) {
    list.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
    return;
  }
  list.innerHTML = "";
  cachedNotifs.forEach(n => {
    const date = n.createdAt?.toDate?.()
      ? n.createdAt.toDate().toLocaleDateString("en-CA", { month: "short", day: "numeric" })
      : "";
    const item = document.createElement("div");
    item.className = `notif-item${n.read ? " read" : ""}`;
    item.innerHTML = `
      <div class="notif-dot"></div>
      <div class="notif-content">
        <div class="notif-msg">${n.message}</div>
        <div class="notif-date">${date}</div>
      </div>`;
    if (!n.read) item.onclick = () => markNotifRead(n.id, item);
    list.appendChild(item);
  });
}

async function markNotifRead(notifId, itemEl) {
  try {
    await updateDoc(doc(db, "notifications", notifId), { read: true });
    const n = cachedNotifs.find(x => x.id === notifId);
    if (n) n.read = true;
    itemEl?.classList.add("read");
    // Re-count badge
    const unread = cachedNotifs.filter(x => !x.read).length;
    const badge  = document.getElementById("notif-badge");
    if (badge) {
      badge.textContent   = unread > 9 ? "9+" : unread;
      badge.style.display = unread > 0 ? "flex" : "none";
    }
  } catch (e) { console.warn("Mark-read failed:", e.message); }
}

window.markAllNotifsRead = async function() {
  const unread = cachedNotifs.filter(n => !n.read);
  for (const n of unread) {
    try {
      await updateDoc(doc(db, "notifications", n.id), { read: true });
      n.read = true;
    } catch (_) {}
  }
  const badge = document.getElementById("notif-badge");
  if (badge) badge.style.display = "none";
  renderNotifications();
};

window.toggleNotifPanel = function() {
  const panel   = document.getElementById("notif-panel");
  const overlay = document.getElementById("notif-overlay");
  const isOpen  = panel.classList.contains("open");
  panel.classList.toggle("open", !isOpen);
  overlay.classList.toggle("open", !isOpen);
  // Reload on open to catch new notifications
  if (!isOpen) loadNotifications();
};

window.closeNotifPanel = function() {
  document.getElementById("notif-panel")?.classList.remove("open");
  document.getElementById("notif-overlay")?.classList.remove("open");
};

function renderTimeline(s) {
  s = s || {};
  const cont       = el("timeline-log");
  const timestamps = s.timestamps || [];

  if (!timestamps.length) {
    cont.innerHTML = `<p style="color:var(--t3);font-size:13px;padding:12px">No play log yet.</p>`;
    return;
  }

  const dotColor = ts => {
    if (/2 Points|3 Points|Free Throw/.test(ts) && !ts.includes("Missed")) return C.gold;
    if (ts.includes("Missed"))   return C.red;
    if (ts.includes("Rebound"))  return C.teal;
    if (ts.includes("Assist"))   return C.blue;
    if (ts.includes("Steal") || ts.includes("Block")) return C.grn;
    if (ts.includes("Turnover")) return C.red;
    return C.t2;
  };

  cont.innerHTML = [...timestamps].reverse().map(ts => {
    const [action, time] = ts.split(" at ");
    return `<div class="tl-entry">
      <span class="tl-time">${time || ""}</span>
      <span class="tl-dot" style="background:${dotColor(ts)}"></span>
      <span class="tl-text"><strong>${action || ts}</strong></span>
    </div>`;
  }).join("");
}
