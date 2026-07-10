// ================================================
//  SPORT PERFORMANCE STATS · TEAMS & PLAYERS
//  Merged page: accordion teams, player profiles,
//  Boys/Girls divisions, coach auth (Firebase Auth)
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy,
  where, serverTimestamp, onSnapshot
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
const VB_TEAMS = collection(db, "volleyballTeams");
const ROOMS    = collection(db, "gameRooms");
const NOTIFS   = collection(db, "notifications");
const USERS    = collection(db, "users");

// ── Current sport ──
let activeSport = "basketball";
let vbTeams     = [];
let vbLoaded    = false;

// ── Avatar colors & chart colors ──
const AV_COLORS = ["av-blue","av-gold","av-green","av-purple","av-teal","av-red","av-orange"];
const C = {
  gold:"#f5c518", blue:"#3b82f6", teal:"#14b8a6",
  grn:"#22c55e",  red:"#ef4444",  purple:"#a855f7",
  org:"#f97316",  line:"#2e3550", t2:"#8b95b0",   t3:"#4d5470"
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

// VB player state
let allVBGames      = [];
let vbAllPlayers    = [];
let currentVBPlayer = null;
let vbChartAttack   = null, vbChartRadar = null, vbChartDonut = null, vbChartHistory = null;
let vbRoomsUnsub    = null;

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

// Auto-calculate wins/losses from completed game rooms (add on top of any manual offset)
function calculateRecords(doneGames) {
  teams.forEach(t => { t.wins = t.winsOffset || 0; t.losses = t.lossesOffset || 0; });

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

// ── Sport tab ──
window.setSportTab = function(sport) {
  activeSport = sport;
  document.getElementById("tab-basketball").classList.toggle("active", sport === "basketball");
  document.getElementById("tab-volleyball").classList.toggle("active", sport === "volleyball");

  const bbPage = document.getElementById("tp-page");
  const vbPage = document.getElementById("vb-page");
  const divToggle = document.getElementById("division-toggle");
  const searchResults = document.getElementById("search-results");

  if (sport === "volleyball") {
    bbPage.style.display  = "none";
    vbPage.style.display  = "block";
    divToggle.style.display = "none";
    if (searchResults) searchResults.style.display = "none";
    if (!vbLoaded) loadVBTeams();
  } else {
    bbPage.style.display  = "block";
    vbPage.style.display  = "none";
    divToggle.style.display = "";
  }
};

async function loadVBTeams() {
  const loadingEl = document.getElementById("vb-loading");
  const container = document.getElementById("teams-volleyball");
  if (loadingEl) loadingEl.style.display = "block";

  try {
    const snap = await getDocs(VB_TEAMS);
    vbTeams    = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    vbLoaded   = true;

    renderVBTeams();

    // Live listener for VB game rooms — updates stats & W/L whenever Firestore changes
    if (vbRoomsUnsub) vbRoomsUnsub();
    vbRoomsUnsub = onSnapshot(
      query(ROOMS, where("sport", "==", "volleyball")),
      snap => {
        const allVBRooms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        allVBGames = allVBRooms.filter(g => g.playerStats && Object.keys(g.playerStats).length > 0);

        // Recompute W/L (add game results on top of any manual offset)
        vbTeams.forEach(t => { t.wins = t.winsOffset || 0; t.losses = t.lossesOffset || 0; });
        allVBRooms.filter(g => g.status === "done").forEach(g => {
          if (g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) return;
          const home = vbTeams.find(t => t.id === g.homeTeam?.id);
          const away = vbTeams.find(t => t.id === g.awayTeam?.id);
          if (g.homeScore > g.awayScore) { if (home) home.wins++; if (away) away.losses++; }
          else { if (away) away.wins++; if (home) home.losses++; }
        });

        buildVBAllPlayers();
        renderVBTeams();

        // Refresh open player panel live
        if (currentVBPlayer) {
          const fresh = vbAllPlayers.find(
            p => p.name === currentVBPlayer.name && p.number === currentVBPlayer.number
          );
          if (fresh) {
            currentVBPlayer = fresh;
            renderVBHero(fresh, fresh.stats, "Season Totals");
            renderVBStatCards(fresh.stats);
            renderVBCharts(fresh, fresh.stats);
            renderVBGameHistory(fresh, null);
          }
        }
      },
      () => {} // ignore errors silently
    );
  } catch (e) {
    if (container) container.innerHTML = `<div class="tp-empty-division">Failed to load volleyball teams.</div>`;
  }
  if (loadingEl) loadingEl.style.display = "none";
}

function renderVBTeams() {
  const container = document.getElementById("teams-volleyball");
  if (!container) return;
  container.innerHTML = "";

  if (!vbTeams.length) {
    container.innerHTML = `<div class="tp-empty-division">No volleyball teams yet. Click "+ Add Team" to get started.</div>`;
    return;
  }

  const sorted = [...vbTeams].sort((a, b) => {
    const pa = (a.wins || 0) / Math.max(1, (a.wins || 0) + (a.losses || 0));
    const pb = (b.wins || 0) / Math.max(1, (b.wins || 0) + (b.losses || 0));
    return pb - pa;
  });

  sorted.forEach((team, rank) => {
    const origIdx = vbTeams.indexOf(team);
    container.appendChild(buildVBTeamAccordion(team, origIdx, rank));
  });
}

function buildVBTeamAccordion(team, origIdx, rank) {
  const total  = (team.wins || 0) + (team.losses || 0);
  const pct    = total > 0 ? ((team.wins / total) * 100).toFixed(1) + "%" : "—";
  const rClass = rank === 0 ? "r1" : rank === 1 ? "r2" : rank === 2 ? "r3" : "";
  const medal  = rank === 0 ? " 🥇" : rank === 1 ? " 🥈" : rank === 2 ? " 🥉" : "";

  const wrapper = document.createElement("div");
  wrapper.className = "team-accordion";
  wrapper.dataset.teamId = team.id;

  wrapper.innerHTML = `
    <div class="ta-header" onclick="toggleVBTeam('${team.id}')">
      <span class="rank ${rClass}">${rank + 1}</span>
      <span class="ta-name">${team.name}${medal}</span>
      <div class="ta-record" id="ta-record-${team.id}">
        <span class="tw">${team.wins || 0}W</span>
        <span class="tl">${team.losses || 0}L</span>
        <span class="ta-pct">${pct}</span>
        <button class="abtn record-edit-btn admin-only" onclick="event.stopPropagation();openEditRecord('${team.id}','vb')" title="Edit record">✏</button>
      </div>
      <div class="ta-actions">
        <div class="ta-admin-acts admin-only" style="display:flex;gap:6px">
          <button class="abtn rename" onclick="event.stopPropagation();startRenameVBTeam('${team.id}')">Rename</button>
          <button class="abtn del"    onclick="event.stopPropagation();deleteVBTeam('${team.id}')">Delete</button>
        </div>
        <button class="abtn roster" onclick="event.stopPropagation();openVBRosterModal(${origIdx})">Roster</button>
      </div>
      <span class="ta-chevron">▼</span>
    </div>
    <div class="ta-body" id="vb-body-${team.id}">
      <div class="ta-body-inner" id="vb-inner-${team.id}">
        <div style="padding:16px;color:var(--t3);font-size:13px">${team.roster?.length ? `${team.roster.length} player(s) on roster.` : "No players yet — add via Roster."}</div>
      </div>
    </div>`;

  if (userProfile?.role !== "admin") {
    wrapper.querySelectorAll(".admin-only").forEach(el => el.style.setProperty("display", "none"));
  }
  return wrapper;
}

window.toggleVBTeam = function(teamId) {
  const body    = document.getElementById(`vb-body-${teamId}`);
  const inner   = document.getElementById(`vb-inner-${teamId}`);
  const chevron = body?.previousElementSibling?.querySelector(".ta-chevron");
  if (!body) return;
  const isOpen = body.classList.contains("open");
  body.classList.toggle("open");
  if (chevron) chevron.style.transform = isOpen ? "" : "rotate(180deg)";
  if (!isOpen && inner && !body.dataset.loaded) {
    body.dataset.loaded = "1";
    populateVBTeamBody(teamId, inner);
  }
};

// ── VB Roster Modal ──
let vbCurrentTeamIdx = null;

window.openVBRosterModal = function(idx) {
  vbCurrentTeamIdx = idx;
  const team = vbTeams[idx];
  if (!team) return;

  document.getElementById("team-roster-title").textContent = `${team.name} — Roster`;
  document.getElementById("player-name").value   = "";
  document.getElementById("player-number").value = "";
  window._activeRosterSport = "volleyball";
  renderVBRoster(team.roster || []);
  document.getElementById("roster-modal").classList.add("open");
};

function renderVBRoster(roster) {
  const ul = document.getElementById("player-list");
  if (!ul) return;
  ul.innerHTML = "";
  if (!roster.length) {
    ul.innerHTML = `<li style="justify-content:center;color:var(--t3)">No players yet. Add one above.</li>`;
    return;
  }
  roster.forEach((p, i) => {
    const li = document.createElement("li");
    li.dataset.idx = i;
    li.innerHTML = `
      <span>#${p.number} — ${p.name}</span>
      <div style="display:flex;gap:6px">
        <button onclick="removeVBPlayer(${i})">Remove</button>
      </div>`;
    ul.appendChild(li);
  });
}

window.startEditVBNumber = function(idx) {
  const team = vbTeams[vbCurrentTeamIdx];
  const p    = team.roster[idx];
  const li = document.querySelector(`#player-list li[data-idx="${idx}"]`);
  if (!li) return;
  li.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span>${p.name}</span>
      <input class="num-edit-input" id="vb-num-edit-${idx}" type="number" value="${p.number}" min="0" max="99">
    </div>
    <div style="display:flex;gap:6px">
      <button class="plist-btn-save" id="vb-num-edit-save-${idx}">Save</button>
      <button class="plist-btn-cancel" id="vb-num-edit-cancel-${idx}">Cancel</button>
    </div>`;
  const inp = document.getElementById(`vb-num-edit-${idx}`);
  inp.focus(); inp.select();
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter")  window.saveEditVBNumber(idx);
    if (e.key === "Escape") renderVBRoster(vbTeams[vbCurrentTeamIdx].roster);
  });
  document.getElementById(`vb-num-edit-save-${idx}`)?.addEventListener("click", () => window.saveEditVBNumber(idx));
  document.getElementById(`vb-num-edit-cancel-${idx}`)?.addEventListener("click", () => renderVBRoster(vbTeams[vbCurrentTeamIdx].roster));
};

window.saveEditVBNumber = async function(idx) {
  const team    = vbTeams[vbCurrentTeamIdx];
  const newNum  = parseInt(document.getElementById(`vb-num-edit-${idx}`)?.value);
  if (isNaN(newNum)) return;
  team.roster[idx].number = String(newNum);
  await updateDoc(doc(db, "volleyballTeams", team.id), { roster: team.roster });
  renderVBRoster(team.roster);
};

window.removeVBPlayer = async function(idx) {
  if (!confirm("Remove this player from the roster?")) return;
  const team = vbTeams[vbCurrentTeamIdx];
  team.roster.splice(idx, 1);
  await updateDoc(doc(db, "volleyballTeams", team.id), { roster: team.roster });
  renderVBRoster(team.roster);
};

// ── VB Add Team modal ──
window.openAddVBTeamModal = function() {
  window._activeAddSport = "volleyball";
  document.getElementById("new-team-name").value = "";
  const divRow = document.getElementById("new-team-division")?.closest(".add-team-fields")?.querySelector("label:last-of-type");
  const divSel = document.getElementById("new-team-division");
  if (divSel) divSel.style.display = "none";
  const divLabel = divSel?.previousElementSibling;
  if (divLabel) divLabel.style.display = "none";
  document.getElementById("add-team-modal").classList.add("open");
  document.getElementById("new-team-name").focus();
};

// ── VB Rename / Delete ──
window.startRenameVBTeam = function(teamId) {
  const team = vbTeams.find(t => t.id === teamId);
  if (!team) return;
  const nameEl = document.querySelector(`.team-accordion[data-team-id="${teamId}"] .ta-name`);
  if (!nameEl) return;
  const orig = team.name;
  nameEl.innerHTML = `
    <input class="rename-team-input" id="vbrename-${teamId}" value="${orig}"
           onclick="event.stopPropagation()" onkeydown="handleVBRenameKey(event,'${teamId}')">
    <button class="abtn rename-save"   onclick="event.stopPropagation();saveRenameVBTeam('${teamId}')">Save</button>
    <button class="abtn rename-cancel" onclick="event.stopPropagation();cancelRenameVBTeam('${teamId}','${orig}')">Cancel</button>`;
  document.getElementById(`vbrename-${teamId}`)?.focus();
};

window.handleVBRenameKey = function(e, teamId) {
  if (e.key === "Enter")  saveRenameVBTeam(teamId);
  if (e.key === "Escape") {
    const team = vbTeams.find(t => t.id === teamId);
    if (team) cancelRenameVBTeam(teamId, team.name);
  }
};

window.saveRenameVBTeam = async function(teamId) {
  const inp  = document.getElementById(`vbrename-${teamId}`);
  const name = inp?.value.trim();
  if (!name) return;
  const team = vbTeams.find(t => t.id === teamId);
  if (!team) return;
  team.name = name;
  await updateDoc(doc(db, "volleyballTeams", teamId), { name });
  renderVBTeams();
};

window.cancelRenameVBTeam = function(teamId, orig) {
  const nameEl = document.querySelector(`.team-accordion[data-team-id="${teamId}"] .ta-name`);
  if (nameEl) nameEl.textContent = orig;
};

window.deleteVBTeam = async function(teamId) {
  const team = vbTeams.find(t => t.id === teamId);
  if (!team) return;
  if (!confirm(`Delete "${team.name}"? This cannot be undone.`)) return;
  await deleteDoc(doc(db, "volleyballTeams", teamId));
  vbTeams = vbTeams.filter(t => t.id !== teamId);
  renderVBTeams();
};

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
      <div class="ta-record" id="ta-record-${team.id}">
        <span class="tw">${team.wins || 0}W</span>
        <span class="tl">${team.losses || 0}L</span>
        <span class="ta-pct">${pct}</span>
        <button class="abtn record-edit-btn admin-only" onclick="event.stopPropagation();openEditRecord('${team.id}','bb')" title="Edit record">✏</button>
      </div>
      <div class="ta-actions">
        <div class="ta-admin-acts admin-only" style="display:flex;gap:6px">
          <button class="abtn rename" onclick="event.stopPropagation();startRenameTeam('${team.id}')">Rename</button>
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
  if (role !== "admin") {
    wrapper.querySelectorAll(".admin-only").forEach(el => el.style.setProperty("display", "none"));
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
  // Restore division fields if they were hidden for volleyball
  const divSel = document.getElementById("new-team-division");
  if (divSel) divSel.style.display = "";
  const divLabel = divSel?.previousElementSibling;
  if (divLabel) divLabel.style.display = "";
  window._activeAddSport = null;
};

window.submitAddTeam = async function() {
  const nameEl = document.getElementById("new-team-name");
  const name   = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }

  if (window._activeAddSport === "volleyball") {
    const data = { name, wins: 0, losses: 0, roster: [] };
    try {
      const ref = await addDoc(VB_TEAMS, data);
      vbTeams.push({ id: ref.id, ...data });
      renderVBTeams();
      closeAddTeamModal();
    } catch (e) { alert("Failed to add team: " + e.message); }
    window._activeAddSport = null;
    return;
  }

  const divEl    = document.getElementById("new-team-division");
  const division = divEl.value;
  const data     = { name, wins: 0, losses: 0, roster: [], division };
  try {
    const ref = await addDoc(TEAMS, data);
    teams.push({ id: ref.id, ...data });
    buildAllPlayers();
    renderDivision(division);
    closeAddTeamModal();
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

// ── Rename Team ──
window.startRenameTeam = function(teamId) {
  const team    = teams.find(t => t.id === teamId);
  const nameEl  = document.querySelector(`[data-team-id="${teamId}"] .ta-name`);
  if (!team || !nameEl) return;

  const oldName = team.name;
  nameEl.innerHTML = `
    <input id="rename-input-${teamId}" class="rename-team-input"
           value="${oldName}" maxlength="40"
           onclick="event.stopPropagation()"
           onkeydown="handleRenameKey(event,'${teamId}')">
    <button class="abtn rename-save" onclick="event.stopPropagation();saveRenameTeam('${teamId}')">Save</button>
    <button class="abtn rename-cancel" onclick="event.stopPropagation();cancelRenameTeam('${teamId}','${oldName}')">Cancel</button>`;

  const input = document.getElementById(`rename-input-${teamId}`);
  input?.focus();
  input?.select();
};

window.handleRenameKey = function(e, teamId) {
  if (e.key === "Enter")  { e.preventDefault(); window.saveRenameTeam(teamId); }
  if (e.key === "Escape") { e.stopPropagation(); window.cancelRenameTeam(teamId, teams.find(t => t.id === teamId)?.name || ""); }
};

window.saveRenameTeam = async function(teamId) {
  const input   = document.getElementById(`rename-input-${teamId}`);
  const newName = input?.value.trim();
  const team    = teams.find(t => t.id === teamId);
  if (!newName || !team) return;
  if (newName === team.name) { window.cancelRenameTeam(teamId, team.name); return; }

  input.disabled = true;
  try {
    await updateDoc(doc(db, "teams", teamId), { name: newName });
    const oldName = team.name;
    team.name = newName;
    buildAllPlayers();
    renderDivision(team.division || DEFAULT_DIVISION);
    showToast(`Renamed "${oldName}" → "${newName}"`);
  } catch (e) {
    input.disabled = false;
    showToast("Rename failed: " + e.message);
  }
};

window.cancelRenameTeam = function(teamId, originalName) {
  const nameEl = document.querySelector(`[data-team-id="${teamId}"] .ta-name`);
  if (nameEl) nameEl.textContent = originalName;
};

// ── Roster Modal ──
window.openRosterModal = function(origIdx) {
  currentTeamIndex = origIdx;
  currentTeamId    = teams[origIdx].id;
  window._activeRosterSport = null;
  document.getElementById("team-roster-title").textContent = `Roster — ${teams[origIdx].name}`;
  document.getElementById("player-name").value   = "";
  document.getElementById("player-number").value = "";
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
    li.dataset.idx = i;
    li.innerHTML = `
      <span>#${p.number} — ${p.name}</span>
      <div style="display:flex;gap:6px">
        <button onclick="removePlayer(${i})">Remove</button>
      </div>`;
    ul.appendChild(li);
  });
}

window.startEditNumber = function(idx) {
  const li     = document.querySelector(`#player-list li[data-idx="${idx}"]`);
  const player = teams[currentTeamIndex]?.roster[idx];
  if (!li || !player) return;
  li.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex:1">
      <span style="color:var(--t3);font-weight:700">#</span>
      <input type="number" id="num-edit-${idx}" class="num-edit-input"
             value="${player.number}" min="0" max="99">
      <span style="color:var(--t2);font-size:13px">— ${player.name}</span>
    </div>
    <div style="display:flex;gap:6px">
      <button class="plist-btn-save" onclick="saveEditNumber(${idx})">Save</button>
      <button class="plist-btn-cancel" onclick="renderRoster()">Cancel</button>
    </div>`;
  const input = document.getElementById(`num-edit-${idx}`);
  if (input) {
    input.focus();
    input.select();
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") window.saveEditNumber(idx);
      if (e.key === "Escape") renderRoster();
    });
  }
};

window.saveEditNumber = async function(idx) {
  const input  = document.getElementById(`num-edit-${idx}`);
  const newNum = input?.value.trim();
  if (!newNum) { showToast("Enter a jersey number."); return; }

  const roster = teams[currentTeamIndex].roster;
  if (roster.some((p, i) => i !== idx && p.number === newNum)) {
    showToast(`Jersey #${newNum} is already taken on this team.`); return;
  }

  const oldNum    = roster[idx].number;
  const oldRoster = roster.map(p => ({ ...p }));
  roster[idx]     = { ...roster[idx], number: newNum };

  try {
    await updateDoc(doc(db, "teams", currentTeamId), { roster });
    showToast(`#${oldNum} → #${newNum} for ${roster[idx].name}`);
    renderRoster();
  } catch (e) {
    teams[currentTeamIndex].roster = oldRoster;
    showToast("Failed: " + e.message);
    renderRoster();
  }
};

// ── BB jersey # edit from player panel ──
window.openBBEditNumber = function() {
  const p = currentPlayer;
  if (!p) return;
  const numEl = document.getElementById("profile-number");
  numEl.innerHTML = `<span class="vb-num-edit">
    #<input type="number" id="bb-num-inp" value="${p.number}" min="0" max="99">
    <button class="inline-save" id="bb-num-save-btn">✓</button>
    <button class="inline-cancel" id="bb-num-cancel-btn">✕</button>
  </span>`;
  const inp = document.getElementById("bb-num-inp");
  if (inp) { inp.focus(); inp.select(); }
  inp?.addEventListener("keydown", e => { if (e.key === "Enter") saveBBEditNumber(); });
  document.getElementById("bb-num-save-btn")?.addEventListener("click", saveBBEditNumber);
  document.getElementById("bb-num-cancel-btn")?.addEventListener("click", () => {
    document.getElementById("profile-number").textContent = `#${p.number}`;
  });
};

window.saveBBEditNumber = async function() {
  const p      = currentPlayer;
  if (!p) return;
  const newNum = document.getElementById("bb-num-inp")?.value.trim();
  if (!newNum) { showToast("Enter a jersey number."); return; }

  const team = teams.find(t => t.id === p.teamId);
  if (!team) return;
  if (team.roster.some(r => r.name !== p.name && r.number === newNum)) {
    showToast(`Jersey #${newNum} is already taken on this team.`); return;
  }

  const oldNum = p.number;
  const roster = team.roster.map(r =>
    r.name === p.name && r.number === oldNum ? { ...r, number: newNum } : r
  );
  try {
    await updateDoc(doc(db, "teams", team.id), { roster });
    p.number = newNum;
    document.getElementById("profile-number").textContent = `#${newNum}`;
    showToast(`#${oldNum} → #${newNum} for ${p.name}`);
  } catch (e) {
    showToast("Failed: " + e.message);
    document.getElementById("profile-number").textContent = `#${oldNum}`;
  }
};

window.addPlayerToRoster = async function() {
  const nameEl = document.getElementById("player-name");
  const numEl  = document.getElementById("player-number");
  const name   = nameEl.value.trim();
  const number = numEl.value.trim();
  if (!name || !number) { alert("Enter both a name and jersey number."); return; }

  if (window._activeRosterSport === "volleyball") {
    const team = vbTeams[vbCurrentTeamIdx];
    if (!team) return;
    if (!team.roster) team.roster = [];
    if (team.roster.some(p => p.number === number)) {
      alert(`Jersey #${number} is already taken on this team.`); return;
    }
    team.roster.push({ name, number });
    try {
      await updateDoc(doc(db, "volleyballTeams", team.id), { roster: team.roster });
      nameEl.value = ""; numEl.value = "";
      renderVBRoster(team.roster);
    } catch (e) { team.roster.pop(); alert("Failed: " + e.message); }
    return;
  }

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
  if (window._activeRosterSport === "volleyball") {
    const team = vbTeams[vbCurrentTeamIdx];
    if (!team) return;
    try {
      await updateDoc(doc(db, "volleyballTeams", team.id), { roster: team.roster });
      renderVBTeams();
      closeRosterModal();
    } catch (e) { alert("Save failed: " + e.message); }
    window._activeRosterSport = null;
    return;
  }
  try {
    await updateDoc(doc(db, "teams", currentTeamId), { roster: teams[currentTeamIndex].roster });
    buildAllPlayers();
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

// ══════════════════════════════════════════════
//  VOLLEYBALL PLAYER PROFILE
// ══════════════════════════════════════════════

function findVBStatKey(name, number, playerStats) {
  if (!playerStats) return null;
  for (const side of ["home", "away"]) {
    const k = `${name}_${number}_${side}`;
    if (playerStats[k]) return k;
  }
  return null;
}

function aggregateVBStats(name, number, games) {
  const totals = { kills:0, aces:0, blocks:0, digs:0, assists:0, attackErrors:0, serviceErrors:0 };
  const gameLog = [];

  games.forEach(g => {
    const key = findVBStatKey(name, number, g.playerStats);
    if (!key) return;
    const s = g.playerStats[key];
    totals.kills         += s.kills         || 0;
    totals.aces          += s.aces          || 0;
    totals.blocks        += s.blocks        || 0;
    totals.digs          += s.digs          || 0;
    totals.assists       += s.assists       || 0;
    totals.attackErrors  += s.attackErrors  || 0;
    totals.serviceErrors += s.serviceErrors || 0;
    gameLog.push({
      gameId:   g.id,
      code:     g.code || g.id?.slice(0, 6),
      date:     g.createdAt?.toDate?.() || new Date(),
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      stats:    s,
    });
  });

  return { totals, gameLog };
}

function buildVBAllPlayers() {
  vbAllPlayers = [];
  const seen = new Set();

  vbTeams.forEach((team, ti) => {
    (team.roster || []).forEach((player, pi) => {
      const uid = `${player.name}__${player.number}`;
      if (seen.has(uid)) return;
      seen.add(uid);

      const avColor  = AV_COLORS[(ti + pi) % AV_COLORS.length];
      const initials = player.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
      const { totals, gameLog } = aggregateVBStats(player.name, player.number, allVBGames);

      vbAllPlayers.push({ name: player.name, number: player.number, teamId: team.id, teamName: team.name, avColor, initials, stats: totals, gameLog });
    });
  });
}

function populateVBTeamBody(teamId, inner) {
  const team = vbTeams.find(t => t.id === teamId);
  if (!team || !team.roster?.length) {
    inner.innerHTML = `<div style="padding:16px;color:var(--t3);font-size:13px">No players yet — add via Roster.</div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "player-grid";

  team.roster.forEach(p => {
    const vbp = vbAllPlayers.find(x => x.name === p.name && String(x.number) === String(p.number));
    if (!vbp) return;
    const s = vbp.stats;

    const card = document.createElement("div");
    card.className = "player-card";
    card.innerHTML = `
      <div class="pc-avatar ${vbp.avColor}">${vbp.initials}</div>
      <div class="pc-number">#${p.number}</div>
      <div class="pc-name">${p.name}</div>
      <div class="pc-stats">${s.kills||0}K · ${s.digs||0}DIG · ${s.aces||0}ACE · ${s.blocks||0}BLK</div>`;
    card.onclick = () => openVBPlayerPanel(vbp);
    grid.appendChild(card);
  });

  inner.innerHTML = "";
  inner.appendChild(grid);
}

function openVBPlayerPanel(player, gameFilter = null) {
  currentVBPlayer = player;
  document.getElementById("vb-player-panel").classList.add("open");
  document.getElementById("vb-panel-backdrop").classList.add("open");
  document.body.style.overflow = "hidden";

  const isAdmin = userProfile?.role === "admin";
  ["vb-panel-trade-btn", "vb-panel-num-btn"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? "" : "none";
  });

  const stats = gameFilter ? gameFilter.stats : player.stats;
  const label = gameFilter
    ? `${gameFilter.homeTeam?.name || "Home"} vs ${gameFilter.awayTeam?.name || "Away"}`
    : "Season Totals";

  renderVBHero(player, stats, label);
  renderVBStatCards(stats);
  renderVBCharts(player, stats);
  renderVBGameHistory(player, gameFilter?.gameId || null);
  document.getElementById("vb-panel-body").scrollTop = 0;
}

window.closeVBPlayerPanel = function() {
  document.getElementById("vb-player-panel").classList.remove("open");
  document.getElementById("vb-panel-backdrop").classList.remove("open");
  document.body.style.overflow = "";
  currentVBPlayer = null;
};

// ── Jersey # inline edit ──
window.openVBEditNumber = function() {
  const p = currentVBPlayer;
  if (!p) return;
  const el = document.getElementById("vb-profile-number");
  el.innerHTML = `<span class="vb-num-edit">
    #<input type="number" id="vb-num-inp" value="${p.number}" min="0" max="99">
    <button class="inline-save" id="vb-num-save-btn">✓</button>
    <button class="inline-cancel" id="vb-num-cancel-btn">✕</button>
  </span>`;
  const inp = document.getElementById("vb-num-inp");
  if (inp) { inp.focus(); inp.select(); }
  inp?.addEventListener("keydown", e => { if (e.key === "Enter") saveVBEditNumber(); });
  document.getElementById("vb-num-save-btn")?.addEventListener("click", saveVBEditNumber);
  document.getElementById("vb-num-cancel-btn")?.addEventListener("click", () => renderVBHero(currentVBPlayer, currentVBPlayer.stats, "Season Totals"));
};

window.saveVBEditNumber = async function() {
  const p = currentVBPlayer;
  if (!p) return;
  const newNum = parseInt(document.getElementById("vb-num-inp")?.value, 10);
  if (isNaN(newNum) || newNum < 0 || newNum > 99) return;

  const team = vbTeams.find(t => t.id === p.teamId);
  if (!team) return;
  const roster = (team.roster || []).map(r =>
    (r.name === p.name && String(r.number) === String(p.number))
      ? { ...r, number: String(newNum) }
      : r
  );
  await updateDoc(doc(db, "volleyballTeams", p.teamId), { roster });
  p.number = String(newNum);
  renderVBHero(p, p.stats, "Season Totals");
};


// ── VB Trade Modal ──
window.openVBTradeModal = function() {
  const player = currentVBPlayer;
  if (!player) return;
  tradePlayer = player;

  document.getElementById("trade-player-info").innerHTML = `
    <div class="trade-player-card">
      <div class="pc-avatar ${player.avColor}" style="width:44px;height:44px;font-size:18px">${player.initials}</div>
      <div>
        <div style="font-size:16px;font-weight:700;color:var(--t1)">${player.name}</div>
        <div style="font-size:12px;color:var(--t3)">#${player.number} &nbsp;·&nbsp; ${player.teamName}</div>
      </div>
    </div>`;

  const sel = document.getElementById("trade-dest");
  sel.innerHTML = `<option value="">— Select destination team —</option>`;
  vbTeams.filter(t => t.id !== player.teamId).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });

  const noteEl = document.querySelector("#trade-modal .trade-note");
  if (noteEl) noteEl.textContent = "This will move the player to the selected volleyball team.";

  const submitBtn = document.getElementById("trade-submit-btn");
  submitBtn.onclick = executeVBTrade;
  document.getElementById("trade-modal").classList.add("open");
};

async function executeVBTrade() {
  const toTeamId = document.getElementById("trade-dest").value;
  if (!toTeamId || !tradePlayer) return;

  const fromTeam = vbTeams.find(t => t.id === tradePlayer.teamId);
  const toTeam   = vbTeams.find(t => t.id === toTeamId);
  if (!fromTeam || !toTeam) return;

  const btn = document.getElementById("trade-submit-btn");
  btn.disabled = true;
  btn.textContent = "Trading…";

  try {
    const newFrom = (fromTeam.roster || []).filter(
      r => !(r.name === tradePlayer.name && String(r.number) === String(tradePlayer.number))
    );
    const newTo = [...(toTeam.roster || []), { name: tradePlayer.name, number: tradePlayer.number }];
    await updateDoc(doc(db, "volleyballTeams", fromTeam.id), { roster: newFrom });
    await updateDoc(doc(db, "volleyballTeams", toTeam.id),   { roster: newTo });
    const tradedName = tradePlayer.name;
    const toTeamName = toTeam.name;
    closeTradeModal();
    closeVBPlayerPanel();
    showToast(`${tradedName} traded to ${toTeamName}`);
  } catch (e) {
    showToast("Trade failed: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm Trade";
    btn.onclick = executeVBTrade;
  }
}

function renderVBHero(p, s, label) {
  s = s || {};
  const killAtt = (s.kills || 0) + (s.attackErrors || 0);
  const killPct = killAtt > 0 ? (((s.kills || 0) / killAtt) * 100).toFixed(1) + "%" : "—";

  document.getElementById("vb-profile-avatar").className   = `profile-avatar ${p.avColor}`;
  document.getElementById("vb-profile-avatar").textContent = p.initials;
  document.getElementById("vb-profile-number").textContent = `#${p.number}`;
  document.getElementById("vb-profile-name").textContent   = p.name;
  document.getElementById("vb-profile-team").innerHTML =
    `${p.teamName}` +
    ` <span style="color:var(--t3);font-size:12px;margin-left:6px">${label}</span>` +
    ` <button id="vb-view-team-btn" style="background:none;border:none;color:var(--purple);font-size:12px;cursor:pointer;margin-left:10px;font-weight:700;padding:0;">View Team →</button>`;

  document.getElementById("vb-view-team-btn")?.addEventListener("click", () => {
    closeVBPlayerPanel();
    setTimeout(() => {
      const accordion = document.querySelector(`[data-team-id="${p.teamId}"]`);
      if (accordion) {
        accordion.scrollIntoView({ behavior: "smooth", block: "start" });
        const body = document.getElementById(`vb-body-${p.teamId}`);
        if (body && !body.classList.contains("open")) toggleVBTeam(p.teamId);
      }
    }, 350);
  });

  const badges = [];
  if ((s.kills  || 0) >= 10) badges.push({ label: "10+ Kills",  color: "gold"   });
  if ((s.aces   || 0) >= 3)  badges.push({ label: "3+ Aces",    color: "blue"   });
  if ((s.digs   || 0) >= 15) badges.push({ label: "15+ Digs",   color: "green"  });
  if ((s.blocks || 0) >= 5)  badges.push({ label: "5+ Blocks",  color: "purple" });
  if (!badges.length)         badges.push({ label: "On Roster",  color: "blue"   });
  document.getElementById("vb-profile-badges").innerHTML = badges.map(b =>
    `<span class="badge badge-${b.color}">${b.label}</span>`
  ).join("");

  document.getElementById("vb-profile-headline-stats").innerHTML = `
    <div class="hs-stat"><div class="hs-val">${s.kills||0}</div><div class="hs-lbl">Kills</div></div>
    <div class="hs-stat"><div class="hs-val">${s.digs||0}</div><div class="hs-lbl">Digs</div></div>
    <div class="hs-stat"><div class="hs-val">${s.aces||0}</div><div class="hs-lbl">Aces</div></div>
    <div class="hs-stat"><div class="hs-val">${killPct}</div><div class="hs-lbl">Kill%</div></div>`;
}

function renderVBStatCards(s) {
  s = s || {};
  const cards = [
    { val: s.kills         || 0, lbl: "Kills"      },
    { val: s.digs          || 0, lbl: "Digs"       },
    { val: s.aces          || 0, lbl: "Aces"       },
    { val: s.assists       || 0, lbl: "Assists"     },
    { val: s.blocks        || 0, lbl: "Blocks"      },
    { val: s.attackErrors  || 0, lbl: "Atk Errors"  },
    { val: s.serviceErrors || 0, lbl: "Svc Errors"  },
  ];
  document.getElementById("vb-stat-cards-row").innerHTML = cards.map(c => `
    <div class="sc-card">
      <div class="sc-card-val">${c.val}</div>
      <div class="sc-card-lbl">${c.lbl}</div>
    </div>`).join("");
}

function renderVBCharts(player, s) {
  s = s || {};
  [vbChartAttack, vbChartRadar, vbChartDonut, vbChartHistory].forEach(c => c?.destroy());
  vbChartAttack = vbChartRadar = vbChartDonut = vbChartHistory = null;

  // Stat breakdown bar
  vbChartAttack = new Chart(document.getElementById("vbAttackChart"), {
    type: "bar",
    data: {
      labels: ["Kills", "Digs", "Aces", "Assists", "Blocks", "Atk Err", "Svc Err"],
      datasets: [{ data: [s.kills||0, s.digs||0, s.aces||0, s.assists||0, s.blocks||0, s.attackErrors||0, s.serviceErrors||0],
        backgroundColor: [C.gold, C.teal, C.blue, C.grn, C.purple, C.red, C.org], borderRadius: 6 }]
    },
    options: { responsive:true, maintainAspectRatio:false,
      plugins: { legend:{ display:false } },
      scales: { x:{ grid:{color:C.line}, ticks:{color:C.t2,font:{size:11}} }, y:{ grid:{color:C.line}, ticks:{color:C.t2}, beginAtZero:true } }
    }
  });

  // Radar
  const maxVal = Math.max(5, s.kills||0, s.digs||0, s.aces||0, s.assists||0, s.blocks||0);
  const norm   = v => parseFloat(((v / maxVal) * 10).toFixed(1));
  vbChartRadar = new Chart(document.getElementById("vbRadarChart"), {
    type: "radar",
    data: {
      labels: ["Kills", "Digs", "Aces", "Assists", "Blocks"],
      datasets: [{ data: [norm(s.kills||0), norm(s.digs||0), norm(s.aces||0), norm(s.assists||0), norm(s.blocks||0)],
        borderColor: C.gold, backgroundColor: "rgba(245,197,24,0.15)", borderWidth: 2, pointBackgroundColor: C.gold }]
    },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ r:{ grid:{color:C.line}, ticks:{display:false}, pointLabels:{color:C.t2,font:{size:12}} } }
    }
  });

  // Donut — positive contributions only
  const vals   = [s.kills||0, s.digs||0, s.aces||0, s.assists||0, s.blocks||0];
  const lbls   = ["Kills","Digs","Aces","Assists","Blocks"];
  const colors = [C.gold, C.teal, C.blue, C.grn, C.purple];
  const active = vals.map((v, i) => ({ v, l: lbls[i], c: colors[i] })).filter(x => x.v > 0);
  vbChartDonut = new Chart(document.getElementById("vbDonutChart"), {
    type: "doughnut",
    data: { labels: active.map(x => x.l),
      datasets: [{ data: active.map(x => x.v), backgroundColor: active.map(x => x.c), borderWidth: 0 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:"65%",
      plugins:{ legend:{ position:"bottom", labels:{color:C.t2,font:{size:12},padding:12} } } }
  });
}

function renderVBGameHistory(player, filterGameId = null) {
  const listEl = document.getElementById("vb-game-history-list");
  const { gameLog } = player;

  if (!gameLog.length) {
    listEl.innerHTML = `<div style="color:var(--t3);padding:12px;font-size:13px">No games recorded yet.</div>`;
    return;
  }

  const sorted = [...gameLog].sort((a, b) => new Date(b.date) - new Date(a.date));
  listEl.innerHTML = "";
  sorted.forEach(g => {
    const s       = g.stats;
    const isActive = filterGameId === g.gameId;
    const dateStr  = (g.date instanceof Date ? g.date : new Date(g.date))
      .toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    const row = document.createElement("div");
    row.className = `gh-card-row${isActive ? " active" : ""}`;
    row.innerHTML = `
      <div class="gh-card-top">
        <div class="gh-card-left">
          <span class="gh-card-badge game">${dateStr}</span>
          <div class="gh-card-title">${g.homeTeam?.name||"Home"} vs ${g.awayTeam?.name||"Away"}</div>
        </div>
        <div class="gh-card-pills">
          <span class="gh-pill"><span class="gh-pill-val">${s.kills||0}</span><span class="gh-pill-lbl">K</span></span>
          <span class="gh-pill"><span class="gh-pill-val">${s.digs||0}</span><span class="gh-pill-lbl">DIG</span></span>
          <span class="gh-pill"><span class="gh-pill-val">${s.aces||0}</span><span class="gh-pill-lbl">ACE</span></span>
          <span class="gh-pill"><span class="gh-pill-val">${s.blocks||0}</span><span class="gh-pill-lbl">BLK</span></span>
        </div>
      </div>`;
    row.addEventListener("click", () => openVBPlayerPanel(player, isActive ? null : g));
    listEl.appendChild(row);
  });

  // Per-game trend chart
  if (vbChartHistory) { vbChartHistory.destroy(); vbChartHistory = null; }
  const chartEl = document.getElementById("vbHistoryChart");
  if (!chartEl) return;

  const rev = [...sorted].reverse();
  vbChartHistory = new Chart(chartEl, {
    type: "line",
    data: {
      labels: rev.map((_, i) => `G${i + 1}`),
      datasets: [
        { label:"Kills", data: rev.map(g => g.stats.kills||0),  borderColor:C.gold, backgroundColor:"rgba(245,197,24,.08)", tension:.3, pointRadius:4, pointBackgroundColor:C.gold },
        { label:"Digs",  data: rev.map(g => g.stats.digs||0),   borderColor:C.teal, backgroundColor:"rgba(20,184,166,.08)",  tension:.3, pointRadius:4, pointBackgroundColor:C.teal },
        { label:"Aces",  data: rev.map(g => g.stats.aces||0),   borderColor:C.blue, backgroundColor:"rgba(59,130,246,.08)", tension:.3, pointRadius:4, pointBackgroundColor:C.blue },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ x:{grid:{color:C.line},ticks:{color:C.t2}}, y:{grid:{color:C.line},ticks:{color:C.t2},beginAtZero:true} }
    }
  });
}

// ── Player Panel ──
function openPlayerPanel(player, gameFilter = null) {
  currentPlayer = player;

  document.getElementById("player-panel").classList.add("open");
  document.getElementById("panel-backdrop").classList.add("open");
  document.body.style.overflow = "hidden";

  const isAdmin = userProfile?.role === "admin";
  const tradeBtn = document.getElementById("panel-trade-btn");
  if (tradeBtn) tradeBtn.style.display = isAdmin && teams.length > 1 ? "inline-flex" : "none";
  const numBtn = document.getElementById("panel-num-btn");
  if (numBtn) numBtn.style.display = isAdmin ? "" : "none";

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
  el("profile-team").innerHTML =
    `${p.teamName}` +
    ` <span style="color:var(--t3);font-size:12px;margin-left:8px">${viewLabel}</span>` +
    ` <button id="bb-view-team-btn" style="background:none;border:none;color:var(--gold);font-size:12px;cursor:pointer;margin-left:10px;font-weight:700;padding:0">View Team →</button>`;
  document.getElementById("bb-view-team-btn")?.addEventListener("click", () => {
    closePlayerPanel();
    setTimeout(() => {
      const div   = p.division || DEFAULT_DIVISION;
      setDivision(div);
      const accordion = document.querySelector(`.team-accordion[data-team-id="${p.teamId}"]`);
      if (accordion) {
        accordion.scrollIntoView({ behavior: "smooth", block: "start" });
        const body = document.getElementById(`ta-body-${p.teamId}`);
        if (body && !body.classList.contains("open")) toggleTeam(p.teamId);
      }
    }, 350);
  });
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
  const noteEl = document.querySelector("#trade-modal .trade-note");
  if (noteEl) noteEl.textContent = "Both coaches will receive an in-app notification about this trade.";
  document.getElementById("trade-submit-btn").onclick = window.executeTrade;

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

// ── Edit W/L Record ──
window.openEditRecord = function(teamId, sport) {
  const recEl = document.getElementById(`ta-record-${teamId}`);
  if (!recEl) return;
  const team = sport === "vb" ? vbTeams.find(t => t.id === teamId) : teams.find(t => t.id === teamId);
  if (!team) return;

  recEl.innerHTML = `
    <input type="number" id="rec-w-${teamId}" value="${team.wins || 0}" min="0"
      style="width:46px;padding:2px 5px;font-size:13px;background:var(--bg3);color:var(--t1);border:1px solid var(--line);border-radius:4px;text-align:center"
      onclick="event.stopPropagation()">
    <span style="color:var(--t3);font-size:12px;margin:0 1px">W</span>
    <input type="number" id="rec-l-${teamId}" value="${team.losses || 0}" min="0"
      style="width:46px;padding:2px 5px;font-size:13px;background:var(--bg3);color:var(--t1);border:1px solid var(--line);border-radius:4px;text-align:center"
      onclick="event.stopPropagation()">
    <span style="color:var(--t3);font-size:12px;margin:0 1px">L</span>
    <button class="inline-save" style="padding:2px 7px">✓</button>
    <button class="inline-cancel" style="padding:2px 7px">✕</button>
  `;
  const saveBtn   = recEl.querySelector(".inline-save");
  const cancelBtn = recEl.querySelector(".inline-cancel");
  saveBtn.addEventListener("click",   e => { e.stopPropagation(); saveEditRecord(teamId, sport); });
  cancelBtn.addEventListener("click", e => { e.stopPropagation(); cancelEditRecord(teamId, sport); });
  recEl.querySelector(`#rec-w-${teamId}`)?.select();
};

async function saveEditRecord(teamId, sport) {
  const wInput = document.getElementById(`rec-w-${teamId}`);
  const lInput = document.getElementById(`rec-l-${teamId}`);
  if (!wInput || !lInput) return;

  const newW = Math.max(0, parseInt(wInput.value) || 0);
  const newL = Math.max(0, parseInt(lInput.value) || 0);

  const team = sport === "vb" ? vbTeams.find(t => t.id === teamId) : teams.find(t => t.id === teamId);
  if (!team) return;

  // game-calculated portion = current total − current offset
  const gameW = (team.wins   || 0) - (team.winsOffset   || 0);
  const gameL = (team.losses || 0) - (team.lossesOffset || 0);
  const newWinsOffset   = newW - gameW;
  const newLossesOffset = newL - gameL;

  const coll = sport === "vb" ? "volleyballTeams" : "teams";
  try {
    await updateDoc(doc(db, coll, teamId), { winsOffset: newWinsOffset, lossesOffset: newLossesOffset });
    team.winsOffset   = newWinsOffset;
    team.lossesOffset = newLossesOffset;
    team.wins   = newW;
    team.losses = newL;
    // Re-render so rankings re-sort
    if (sport === "vb") {
      renderVBTeams();
    } else {
      renderDivision(team.division || DEFAULT_DIVISION);
    }
    showToast("Record updated");
  } catch (e) {
    showToast("Failed: " + e.message);
    cancelEditRecord(teamId, sport);
  }
}

function cancelEditRecord(teamId, sport) {
  const recEl = document.getElementById(`ta-record-${teamId}`);
  if (!recEl) return;
  const team = sport === "vb" ? vbTeams.find(t => t.id === teamId) : teams.find(t => t.id === teamId);
  if (!team) return;
  const total = (team.wins || 0) + (team.losses || 0);
  const pct   = total > 0 ? ((team.wins / total) * 100).toFixed(1) + "%" : "—";
  recEl.innerHTML = `
    <span class="tw">${team.wins || 0}W</span>
    <span class="tl">${team.losses || 0}L</span>
    <span class="ta-pct">${pct}</span>
    <button class="abtn record-edit-btn" onclick="event.stopPropagation();openEditRecord('${teamId}','${sport}')" title="Edit record">✏</button>
  `;
}

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

    const tradedName = tradePlayer.name;
    const toTeamName = toTeam.name;
    closeTradeModal();
    closePlayerPanel();
    showToast(`${tradedName} traded to ${toTeamName}`);
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
