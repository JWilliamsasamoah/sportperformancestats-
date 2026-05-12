// ================================================
//  SPORT PERFORMANCE STATS — PLAYER PROFILES
//  Fixed:
//  1. Players always show from roster (not gated by stats)
//  2. Clicking a player shows ALL their game history
//     aggregated across every saved game
//  3. Game history list — click any game to see
//     that game's individual stats
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, orderBy, query
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
// ── FIXED: now reads from gameRooms (new architecture) ──
const ROOMS_COL = collection(db, "gameRooms");
const TEAMS_COL = collection(db, "teams");

const AV_COLORS = ["av-blue","av-gold","av-green","av-purple","av-teal","av-red","av-orange"];
const C = {
  gold:"#f5c518", blue:"#3b82f6", teal:"#14b8a6",
  grn:"#22c55e",  red:"#ef4444",  purple:"#a855f7",
  line:"#2e3550", t2:"#8b95b0",   t3:"#4d5470"
};

// ── Data ──
let allPlayers  = [];  // built from rosters — always populated
let allGames    = [];  // all saved games from Firestore
let teams       = [];
let currentPlayer = null;

// Charts (destroyed/recreated on each profile open)
let chartShot = null, chartRadar = null, chartDonut = null, chartHistory = null;

// ── Boot ──
document.addEventListener("DOMContentLoaded", async () => {
  showLoading(true);
  try {
    await loadAllData();
    setupSearch();
    setupTeamFilter();
    renderSidebar(allPlayers);
  } catch(e) {
    console.error("Load error:", e);
  }
  showLoading(false);
});

function showLoading(on) {
  const es = document.getElementById("empty-state");
  if (es) es.querySelector("p").textContent = on
    ? "Loading players…"
    : "Choose a player from the sidebar to view their full profile and stats.";
}

// ── Load everything from Firebase ──
async function loadAllData() {
  // 1. All teams + rosters
  const tSnap = await getDocs(TEAMS_COL);
  teams = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 2. Load from gameRooms (new architecture — replaces old savedGames)
  let gSnap;
  try {
    gSnap = await getDocs(query(ROOMS_COL, orderBy("createdAt", "desc")));
  } catch(e) {
    // createdAt index may not exist yet — fallback without ordering
    gSnap = await getDocs(ROOMS_COL);
  }
  allGames = gSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(g => g.playerStats && Object.keys(g.playerStats).length > 0);

  // 3. Build player list from rosters — ALWAYS show even if no stats yet
  allPlayers = [];
  const seen = new Set(); // avoid duplicates across teams

  teams.forEach((team, ti) => {
    (team.roster || []).forEach((player, pi) => {
      const uid = `${player.name}__${player.number}`;
      if (seen.has(uid)) return; // skip if same player on multiple teams somehow
      seen.add(uid);

      const avColor = AV_COLORS[(ti + pi) % AV_COLORS.length];
      const initials = player.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0,2) || "?";

      // Aggregate stats across ALL games for this player
      const { aggregated, gameLog } = aggregatePlayerStats(player.name, player.number, allGames);

      allPlayers.push({
        name:     player.name,
        number:   player.number,
        teamId:   team.id,
        teamName: team.name,
        avColor,
        initials,
        stats:    aggregated,   // season totals
        gameLog,                // [{gameId, gameName, date, stats}]
      });
    });
  });

  // 4. Build team filter buttons
  const tfDiv = document.getElementById("team-filter-btns");
  if (tfDiv) {
    tfDiv.innerHTML = "";
    teams.forEach(t => {
      const btn = document.createElement("button");
      btn.className = "tfbtn";
      btn.textContent = t.name;
      btn.dataset.team = t.id;
      btn.onclick = () => {
        document.querySelectorAll(".tfbtn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderSidebar(allPlayers.filter(p => p.teamId === t.id));
      };
      tfDiv.appendChild(btn);
    });
  }
}

// ── Stat aggregation ──
// Look up a player across all games by trying both "home" and "away" prefix
function findStatKey(name, number, playerStats) {
  if (!playerStats) return null;
  // Exact key match first
  for (const prefix of ["home","away"]) {
    const k = `${prefix} - ${name} #${number}`;
    if (playerStats[k]) return k;
  }
  // Fuzzy: match by name + number anywhere in key
  for (const k of Object.keys(playerStats)) {
    if (k.includes(`${name} #${number}`)) return k;
  }
  return null;
}

function aggregatePlayerStats(name, number, games) {
  const zero = () => ({
    points:0, freeThrows:0, assists:0, rebounds:0,
    blocks:0, steals:0, turnovers:0, fouls:0,
    shotsMade:{ twoPoint:0, threePoint:0, freeThrow:0 },
    shotsAttempted:{ twoPoint:0, threePoint:0, freeThrow:0 },
    timestamps:[],
  });

  const aggregated = zero();
  const gameLog = [];

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

    if (s.timestamps?.length) {
      aggregated.timestamps.push(...s.timestamps);
    }

    gameLog.push({
      gameId:   game.id,
      gameName: game.name || `Room ${game.code || game.id}`,
      // handle both ISO string date and Firestore Timestamp
      date:     game.createdAt?.toDate?.()?.toISOString() || game.date || new Date().toISOString(),
      stats:    s,
    });
  });

  return { aggregated, gameLog };
}

// ── Sidebar ──
function renderSidebar(players) {
  const ul = document.getElementById("player-sidebar-list");
  ul.innerHTML = "";

  if (!players.length) {
    ul.innerHTML = `<li style="padding:16px;color:var(--t3);font-size:13px">No players found.<br><small>Add players on the Teams page first.</small></li>`;
    return;
  }

  // Sort by season total points desc
  const sorted = [...players].sort((a,b) => (b.stats?.points||0) - (a.stats?.points||0));

  sorted.forEach(p => {
    const isActive = currentPlayer?.name === p.name && currentPlayer?.teamId === p.teamId;
    const li = document.createElement("li");
    li.className = `psl-item${isActive ? " active" : ""}`;
    li.innerHTML = `
      <span class="psl-num">${p.number}</span>
      <div class="psl-avatar ${p.avColor}">${p.initials}</div>
      <div class="psl-info">
        <div class="psl-name">${p.name}</div>
        <div class="psl-team">${p.teamName} · ${p.gameLog.length} game${p.gameLog.length !== 1 ? "s" : ""}</div>
      </div>
      <span class="psl-pts">${p.stats?.points||0}</span>`;
    li.onclick = () => openProfile(p);
    ul.appendChild(li);
  });
}

// ── Search ──
function setupSearch() {
  document.getElementById("player-search").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    renderSidebar(allPlayers.filter(p =>
      p.name.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q)
    ));
  });
}

// ── Team filter ──
function setupTeamFilter() {
  const allBtn = document.querySelector(".tfbtn[data-team='all']");
  if (allBtn) {
    allBtn.onclick = function() {
      document.querySelectorAll(".tfbtn").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      renderSidebar(allPlayers);
    };
  }
}

// ── Open Profile ──
function openProfile(player, gameFilter = null) {
  currentPlayer = player;

  document.getElementById("empty-state").style.display   = "none";
  document.getElementById("profile-view").style.display  = "flex";
  document.getElementById("profile-view").style.flexDirection = "column";

  // Highlight sidebar item
  document.querySelectorAll(".psl-item").forEach(li => {
    li.classList.toggle("active",
      li.querySelector(".psl-name")?.textContent === player.name
    );
  });

  // Use either filtered game stats or full season aggregated
  const displayStats = gameFilter ? gameFilter.stats : player.stats;
  const viewLabel    = gameFilter ? `Game: ${gameFilter.gameName}` : "Season Totals";

  renderHero(player, displayStats, viewLabel);
  renderStatCards(displayStats);
  renderCharts(player, displayStats);
  renderGameHistory(player, gameFilter?.gameId || null);
  renderTimeline(displayStats);
}

// ── Hero ──
function renderHero(p, s, viewLabel) {
  s = s || {};
  const pct = (m, a) => a > 0 ? ((m/a)*100).toFixed(1)+"%" : "—";
  const fg = pct(
    (s.shotsMade?.twoPoint||0)+(s.shotsMade?.threePoint||0),
    (s.shotsAttempted?.twoPoint||0)+(s.shotsAttempted?.threePoint||0)
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
    <div class="hs-stat"><div class="hs-val">${s.points||0}</div><div class="hs-lbl">PTS</div></div>
    <div class="hs-stat"><div class="hs-val">${s.rebounds||0}</div><div class="hs-lbl">REB</div></div>
    <div class="hs-stat"><div class="hs-val">${s.assists||0}</div><div class="hs-lbl">AST</div></div>
    <div class="hs-stat"><div class="hs-val">${fg}</div><div class="hs-lbl">FG%</div></div>
  `;
}

function el(id) { return document.getElementById(id); }

// ── Badges ──
function getBadges(s) {
  s = s || {};
  const badges = [];
  if ((s.points||0) >= 20)      badges.push({ label:"20+ PTS",      color:"gold" });
  else if ((s.points||0) >= 10) badges.push({ label:"10+ PTS",      color:"blue" });
  if ((s.rebounds||0) >= 10)    badges.push({ label:"10+ REB",      color:"green" });
  if ((s.assists||0) >= 5)      badges.push({ label:"5+ AST",       color:"purple" });
  if ((s.blocks||0) >= 3)       badges.push({ label:"3+ BLK",       color:"blue" });
  if ((s.steals||0) >= 3)       badges.push({ label:"3+ STL",       color:"green" });
  const made = (s.shotsMade?.twoPoint||0)+(s.shotsMade?.threePoint||0);
  const att  = (s.shotsAttempted?.twoPoint||0)+(s.shotsAttempted?.threePoint||0);
  if (att > 0 && made/att > 0.5) badges.push({ label:"50%+ FG",    color:"gold" });
  if ((s.points||0)>=10 && (s.rebounds||0)>=10) badges.push({ label:"Double-Double", color:"gold" });
  if (!badges.length) badges.push({ label:"On Roster", color:"blue" });
  return badges;
}

// ── Stat Cards ──
function renderStatCards(s) {
  s = s || {};
  const pct = (m, a) => a > 0 ? ((m/a)*100).toFixed(1)+"%" : "—";
  const cards = [
    { val: s.points||0,    lbl: "Points" },
    { val: s.rebounds||0,  lbl: "Rebounds" },
    { val: s.assists||0,   lbl: "Assists" },
    { val: s.steals||0,    lbl: "Steals" },
    { val: s.blocks||0,    lbl: "Blocks" },
    { val: s.turnovers||0, lbl: "Turnovers" },
  ];
  el("stat-cards-row").innerHTML = cards.map(c => `
    <div class="sc-card">
      <div class="sc-card-val">${c.val}</div>
      <div class="sc-card-lbl">${c.lbl}</div>
    </div>`).join("");
}

// ── Charts ──
function renderCharts(player, s) {
  s = s || {};
  [chartShot, chartRadar, chartDonut, chartHistory].forEach(c => c?.destroy());
  chartShot = chartRadar = chartDonut = chartHistory = null;

  const pct = (m, a) => a > 0 ? parseFloat(((m/a)*100).toFixed(1)) : 0;

  // 1. Shot efficiency
  chartShot = new Chart(el("playerShotChart"), {
    type: "bar",
    data: {
      labels: ["2PT%","3PT%","FT%"],
      datasets: [{
        data: [
          pct(s.shotsMade?.twoPoint||0,   s.shotsAttempted?.twoPoint||0),
          pct(s.shotsMade?.threePoint||0, s.shotsAttempted?.threePoint||0),
          pct(s.freeThrows||0,            s.shotsAttempted?.freeThrow||0),
        ],
        backgroundColor: [C.gold, C.blue, C.teal],
        borderRadius: 6,
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ grid:{color:C.line}, ticks:{color:C.t2} },
        y:{ grid:{color:C.line}, ticks:{color:C.t2, callback:v=>v+"%"}, beginAtZero:true, max:100 },
      }
    }
  });

  // 2. Radar
  const maxRef = Math.max(20, s.points||0);
  const norm   = v => Math.min(10, parseFloat(((v/maxRef)*10).toFixed(1)));
  const fgEff  = pct(
    (s.shotsMade?.twoPoint||0)+(s.shotsMade?.threePoint||0),
    (s.shotsAttempted?.twoPoint||0)+(s.shotsAttempted?.threePoint||0)
  ) / 10;

  chartRadar = new Chart(el("playerRadarProfile"), {
    type: "radar",
    data: {
      labels: ["Scoring","Rebounding","Playmaking","Defense","Efficiency","FT"],
      datasets: [{
        data: [
          norm(s.points||0),
          norm((s.rebounds||0)*2),
          norm((s.assists||0)*3),
          norm(((s.steals||0)+(s.blocks||0))*4),
          parseFloat(fgEff.toFixed(1)),
          norm((s.freeThrows||0)*3),
        ],
        borderColor: C.gold, backgroundColor: C.gold+"22", pointBackgroundColor: C.gold, pointRadius:4,
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ r:{ backgroundColor:"transparent", grid:{color:C.line}, pointLabels:{color:C.t2, font:{size:11}}, ticks:{display:false}, angleLines:{color:C.line}, min:0, max:10 } }
    }
  });

  // 3. Scoring donut
  const pts2  = (s.shotsMade?.twoPoint||0)*2;
  const pts3  = (s.shotsMade?.threePoint||0)*3;
  const ptsFT = s.freeThrows||0;
  const hasData = pts2+pts3+ptsFT > 0;

  chartDonut = new Chart(el("playerDonutChart"), {
    type: "doughnut",
    data: {
      labels: ["2PT","3PT","FT"],
      datasets:[{
        data: hasData ? [pts2,pts3,ptsFT] : [1,1,1],
        backgroundColor: hasData ? [C.gold,C.blue,C.teal] : [C.line,C.line,C.line],
        borderColor:"#12151e", borderWidth:2,
      }]
    },
    options:{ responsive:true, maintainAspectRatio:false, cutout:"65%", plugins:{ legend:{display:false}, tooltip:{enabled:hasData} } }
  });
  // Replace donut legend
  const donutCard = el("playerDonutChart").closest(".profile-chart-card");
  donutCard.querySelector(".donut-leg")?.remove();
  donutCard.insertAdjacentHTML("beforeend",`
    <div class="donut-leg" style="display:flex;justify-content:center;gap:14px;margin-top:10px;font-size:12px;color:${C.t2}">
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:${C.gold}"></span>2PT ${pts2}pts</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:${C.blue}"></span>3PT ${pts3}pts</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:${C.teal}"></span>FT ${ptsFT}pts</span>
    </div>`);

  // 4. Points-per-game history line chart
  renderHistoryChart(player);
}

function renderHistoryChart(player) {
  const histEl = el("playerHistoryChart");
  if (!histEl || !player.gameLog.length) return;

  const labels = player.gameLog.map((g, i) => g.gameName || `Game ${i+1}`);
  const pts    = player.gameLog.map(g => g.stats?.points || 0);
  const reb    = player.gameLog.map(g => g.stats?.rebounds || 0);
  const ast    = player.gameLog.map(g => g.stats?.assists || 0);

  chartHistory = new Chart(histEl, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label:"PTS", data:pts, borderColor:C.gold,   backgroundColor:C.gold+"22",   tension:.35, pointRadius:5, pointBackgroundColor:C.gold,   fill:false },
        { label:"REB", data:reb, borderColor:C.teal,   backgroundColor:C.teal+"22",   tension:.35, pointRadius:4, pointBackgroundColor:C.teal,   fill:false },
        { label:"AST", data:ast, borderColor:C.blue,   backgroundColor:C.blue+"22",   tension:.35, pointRadius:4, pointBackgroundColor:C.blue,   fill:false },
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{
        x:{ grid:{color:C.line}, ticks:{color:C.t2, maxRotation:40} },
        y:{ grid:{color:C.line}, ticks:{color:C.t2}, beginAtZero:true },
      }
    }
  });
}

// ── Game History List ──
function renderGameHistory(player, activeGameId) {
  const cont = el("game-history-list");
  if (!cont) return;
  cont.innerHTML = "";

  if (!player.gameLog.length) {
    cont.innerHTML = `<div style="padding:16px;color:var(--t3);font-size:13px;text-align:center">No game history yet.<br><small>Play a game and save it to see history here.</small></div>`;
    return;
  }

  // Helper: build a stat pill
  const pill = (val, lbl, color) =>
    `<div class="gh-pill" style="--pill-color:${color}">
      <span class="gh-pill-val">${val}</span>
      <span class="gh-pill-lbl">${lbl}</span>
    </div>`;

  // Season Totals card
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
      ${pill(ts.rebounds||0,  "REB", C.teal)}
      ${pill(ts.assists||0,   "AST", C.blue)}
      ${pill(ts.steals||0,    "STL", C.grn)}
      ${pill(ts.blocks||0,    "BLK", C.purple)}
      ${pill(ts.turnovers||0, "TOV", C.red)}
      ${pill(ts.freeThrows||0,"FT",  C.gold)}
    </div>`;
  totalCard.onclick = () => openProfile(player, null);
  cont.appendChild(totalCard);

  // Divider
  cont.insertAdjacentHTML("beforeend", `<div class="gh-divider">Individual Games</div>`);

  // Individual game cards
  player.gameLog.forEach(g => {
    const s = g.stats || {};
    const isActive = g.gameId === activeGameId;
    const d = g.date
      ? new Date(g.date).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
      : "";
    const fg = (() => {
      const made = (s.shotsMade?.twoPoint||0) + (s.shotsMade?.threePoint||0);
      const att  = (s.shotsAttempted?.twoPoint||0) + (s.shotsAttempted?.threePoint||0);
      return att > 0 ? ((made / att) * 100).toFixed(0) + "%" : "—";
    })();

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
        ${pill(s.rebounds||0,  "REB", C.teal)}
        ${pill(s.assists||0,   "AST", C.blue)}
        ${pill(s.steals||0,    "STL", C.grn)}
        ${pill(s.blocks||0,    "BLK", C.purple)}
        ${pill(s.turnovers||0, "TOV", C.red)}
        ${pill(s.freeThrows||0,"FT",  C.gold)}
      </div>`;
    card.onclick = () => openProfile(player, g);
    cont.appendChild(card);
  });
}

// ── Timeline ──
function renderTimeline(s) {
  s = s || {};
  const cont = el("timeline-log");
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
      <span class="tl-time">${time||""}</span>
      <span class="tl-dot" style="background:${dotColor(ts)}"></span>
      <span class="tl-text"><strong>${action||ts}</strong></span>
    </div>`;
  }).join("");
}