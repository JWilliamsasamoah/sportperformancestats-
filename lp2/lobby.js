import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, getDoc,
  setDoc, updateDoc, onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { buildNavAuth } from "./auth-guard.js";

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
const GAMES_COL = collection(db, "gameRooms");
const TEAMS_COL = collection(db, "teams");

const DIV_LABELS = {
  "boy11-14": "Boys 11–14",
  "boy15-18": "Boys 15–18",
  "girl11-18": "Girls 11–18",
};

let teams       = [];
let userProfile = null;
let canManage   = false; // admin or stats
let unsubGames  = null;

// ── Boot ──
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }

    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) { await signOut(auth); window.location.href = "login.html"; return; }

    userProfile = { ...snap.data(), uid: user.uid };
    buildNavAuth(userProfile, auth);

    canManage = userProfile.role === "admin" || userProfile.role === "stats";

    // Show Create Game section only for admin/stats
    if (canManage) {
      document.getElementById("create-section").style.display = "block";
      await loadTeams();
    }

    // Input handlers for join code
    const joinInput = document.getElementById("join-code");
    joinInput.addEventListener("input", e => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    joinInput.addEventListener("keydown", e => {
      if (e.key === "Enter") joinGame();
    });

    // Real-time game list
    subscribeToGames();
  });
});

// ── Load teams into dropdowns, grouped by division ──
async function loadTeams() {
  try {
    const snap = await getDocs(TEAMS_COL);
    teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const homeSelect = document.getElementById("new-home-team");
    const awaySelect = document.getElementById("new-away-team");

    // Group by division
    const grouped = {};
    teams.forEach(t => {
      const div = t.division || "boy11-14";
      if (!grouped[div]) grouped[div] = [];
      grouped[div].push(t);
    });

    [homeSelect, awaySelect].forEach(sel => {
      sel.innerHTML = `<option value="">— Select team —</option>`;
      Object.entries(grouped).forEach(([div, ts]) => {
        const grp = document.createElement("optgroup");
        grp.label = DIV_LABELS[div] || div;
        ts.forEach(t => {
          const opt = document.createElement("option");
          opt.value = t.id;
          opt.textContent = `${t.name}`;
          grp.appendChild(opt);
        });
        sel.appendChild(grp);
      });
    });
  } catch (e) {
    showToast("Failed to load teams: " + e.message);
  }
}

// ── Real-time game subscription ──
function subscribeToGames() {
  const grid  = document.getElementById("active-games-grid");
  const badge = document.getElementById("game-count-badge");
  grid.innerHTML = `<div class="ag-loading">Loading games…</div>`;

  unsubGames = onSnapshot(
    query(GAMES_COL, orderBy("createdAt", "desc")),
    (snap) => {
      const games = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(g => !g.archived);

      if (badge) badge.textContent = games.filter(g => g.status !== "done").length || "";

      if (!games.length) {
        grid.innerHTML = `
          <div class="ag-empty">
            <span class="ag-empty-icon">🏀</span>
            <strong>No Active Games</strong>
            ${canManage ? "Use the form above to create a game." : "Ask your scorekeeper to start a game."}
          </div>`;
        return;
      }

      grid.innerHTML = "";
      games.forEach(g => grid.appendChild(buildGameCard(g)));
    },
    (err) => {
      grid.innerHTML = `<div class="ag-loading" style="color:var(--red)">Failed to load: ${err.message}</div>`;
    }
  );
}

// ── Build a game card ──
function buildGameCard(g) {
  const homeName = g.homeTeam?.name || "Home";
  const awayName = g.awayTeam?.name || "Away";
  const created  = g.createdAt?.toDate?.() || new Date();
  const status   = g.status || "active";
  const statusLabel = { active: "Live", paused: "Paused", done: "Final" }[status] || status;
  const div = g.homeTeam?.division || g.awayTeam?.division;

  const card = document.createElement("div");
  card.className = `game-card${status === "done" ? " done" : ""}`;

  card.innerHTML = `
    <div class="gc-top">
      <div class="gc-top-left">
        <span class="gc-code" title="Click to copy" onclick="copyCode(event,'${g.code}')">${g.code} <span class="gc-copy-icon">⎘</span></span>
        ${div ? `<span class="gc-div">${DIV_LABELS[div] || div}</span>` : ""}
      </div>
      <span class="gc-status ${status}">${status === "active" ? `<span class="gc-live-dot"></span>` : ""}${statusLabel}</span>
    </div>
    <div class="gc-matchup">
      <span class="gc-team home${g.homeScore > g.awayScore ? " winning" : ""}">${homeName}</span>
      <span class="gc-vs">vs</span>
      <span class="gc-team away${g.awayScore > g.homeScore ? " winning" : ""}">${awayName}</span>
    </div>
    <div class="gc-score">
      <span class="gc-pts${g.homeScore > g.awayScore ? " leading" : ""}">${g.homeScore || 0}</span>
      <span class="gc-sep">—</span>
      <span class="gc-pts${g.awayScore > g.homeScore ? " leading" : ""}">${g.awayScore || 0}</span>
    </div>
    <div class="gc-meta">
      <span>Period ${g.period || 1} of 4</span>
      <span>${formatTimeAgo(created)}</span>
    </div>
    <div class="gc-actions">
      <button class="gc-btn open" onclick="openGame('${g.code}')">▶ Open</button>
      ${canManage ? `<button class="gc-btn archive" onclick="archiveGame(event,'${g.code}')">Archive</button>` : ""}
    </div>`;

  card.addEventListener("click", e => {
    if (!e.target.closest(".gc-btn") && !e.target.closest(".gc-code")) openGame(g.code);
  });

  return card;
}

// ── Generate 6-char room code ──
function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ── Create Game ──
async function createGame() {
  const homeId = document.getElementById("new-home-team").value;
  const awayId = document.getElementById("new-away-team").value;

  if (!homeId || !awayId)  { showToast("Select both teams first"); return; }
  if (homeId === awayId)   { showToast("Home and Away must be different teams"); return; }

  const homeTeam = teams.find(t => t.id === homeId);
  const awayTeam = teams.find(t => t.id === awayId);
  if (!homeTeam || !awayTeam) { showToast("Team data not found"); return; }

  let code, exists = true;
  while (exists) {
    code = generateCode();
    const s = await getDoc(doc(db, "gameRooms", code));
    exists = s.exists();
  }

  const btn = document.getElementById("create-btn");
  btn.textContent = "Creating…"; btn.disabled = true;

  try {
    await setDoc(doc(db, "gameRooms", code), {
      code, homeTeam, awayTeam,
      homeScore: 0, awayScore: 0,
      homeFouls: 0, awayFouls: 0,
      homeTimeouts: 0, awayTimeouts: 0,
      period: 1, clockSeconds: 420, clockRunning: false,
      playerStats: {}, teamStats: {}, log: "",
      status: "active",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });

    showRoomCodeModal(code, homeTeam.name, awayTeam.name);
  } catch (e) {
    showToast("Failed to create game: " + e.message);
  } finally {
    btn.textContent = "+ Create Game"; btn.disabled = false;
  }
}

// ── Room code modal ──
function showRoomCodeModal(code, home, away) {
  document.getElementById("modal-code").textContent  = code;
  document.getElementById("modal-matchup").textContent = `${home} vs ${away}`;
  document.getElementById("room-modal").classList.add("open");
}

window.closeRoomModal = function() {
  document.getElementById("room-modal").classList.remove("open");
};

window.goToGame = function() {
  const code = document.getElementById("modal-code").textContent;
  window.location.href = `game.html?room=${code}`;
};

window.copyModalCode = function() {
  const code = document.getElementById("modal-code").textContent;
  navigator.clipboard.writeText(code).then(() => showToast("Room code copied!"));
};

// ── Copy room code from card ──
window.copyCode = function(e, code) {
  e.stopPropagation();
  navigator.clipboard.writeText(code)
    .then(() => showToast(`Code ${code} copied!`))
    .catch(() => showToast(code)); // fallback: just show it
};

// ── Join Game ──
async function joinGame() {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (code.length !== 6) { showToast("Enter a 6-character room code"); return; }

  const snap = await getDoc(doc(db, "gameRooms", code));
  if (!snap.exists()) { showToast(`Room "${code}" not found`); return; }
  if (snap.data().archived) { showToast("That game has been archived"); return; }

  window.location.href = `game.html?room=${code}`;
}

// ── Archive ──
async function archiveGame(e, code) {
  e.stopPropagation();
  if (!confirm(`Archive room ${code}? Stats are permanently preserved.`)) return;
  try {
    await updateDoc(doc(db, "gameRooms", code), { archived: true });
    showToast(`Room ${code} archived`);
  } catch (err) {
    showToast("Failed: " + err.message);
  }
}

function formatTimeAgo(date) {
  const secs = Math.floor((Date.now() - date) / 1000);
  if (secs < 60)    return "Just now";
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function openGame(code) {
  window.location.href = `game.html?room=${code}`;
}

function showToast(msg) {
  let t = document.querySelector(".lobby-toast");
  if (!t) { t = document.createElement("div"); t.className = "lobby-toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2800);
}

window.createGame   = createGame;
window.joinGame     = joinGame;
window.openGame     = openGame;
window.archiveGame  = archiveGame;
