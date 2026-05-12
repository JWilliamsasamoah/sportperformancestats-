// ================================================
//  SPORT PERFORMANCE STATS — GAME LOBBY
//  Creates isolated game rooms, each with a unique
//  6-char code. All games stored under games/{code}
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDocs, getDoc,
  setDoc, deleteDoc, query, orderBy, serverTimestamp
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
const GAMES_COL  = collection(db, "gameRooms");
const TEAMS_COL  = collection(db, "teams");

let teams = [];

// ── Boot ──
document.addEventListener("DOMContentLoaded", async () => {
  await loadTeams();
  await loadActiveGames();

  // Auto-uppercase room code input
  document.getElementById("join-code").addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  document.getElementById("join-code").addEventListener("keydown", e => {
    if (e.key === "Enter") joinGame();
  });
});

// ── Load Teams into dropdowns ──
async function loadTeams() {
  const snap = await getDocs(TEAMS_COL);
  teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const homeSelect = document.getElementById("new-home-team");
  const awaySelect = document.getElementById("new-away-team");

  teams.forEach(t => {
    homeSelect.insertAdjacentHTML("beforeend", `<option value="${t.id}">${t.name}</option>`);
    awaySelect.insertAdjacentHTML("beforeend", `<option value="${t.id}">${t.name}</option>`);
  });
}

// ── Generate 6-char room code ──
function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0,O,1,I)
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

  // Generate unique code
  let code, exists = true;
  while (exists) {
    code = generateCode();
    const snap = await getDoc(doc(db, "gameRooms", code));
    exists = snap.exists();
  }

  const btn = document.querySelector(".lbtn.primary");
  btn.textContent = "Creating…"; btn.disabled = true;

  try {
    await setDoc(doc(db, "gameRooms", code), {
      code,
      homeTeam,
      awayTeam,
      homeScore: 0,
      awayScore: 0,
      homeFouls: 0,
      awayFouls: 0,
      homeTimeouts: 0,
      awayTimeouts: 0,
      period: 1,
      clockSeconds: 420,
      clockRunning: false,
      playerStats: {},
      teamStats: {},
      log: "",
      status: "active",   // active | paused | done
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    showToast(`Game created! Room: ${code}`);
    // Open the game scoreboard in this tab
    setTimeout(() => { window.location.href = `game.html?room=${code}`; }, 800);
  } catch(e) {
    showToast("Failed to create game: " + e.message);
    btn.textContent = "+ Create Game"; btn.disabled = false;
  }
}

// ── Join Game ──
async function joinGame() {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (code.length !== 6) { showToast("Enter a 6-character room code"); return; }

  const snap = await getDoc(doc(db, "gameRooms", code));
  if (!snap.exists()) { showToast(`Room "${code}" not found`); return; }

  window.location.href = `game.html?room=${code}`;
}

// ── Load Active Games ──
async function loadActiveGames() {
  const grid = document.getElementById("active-games-grid");
  grid.innerHTML = `<div class="ag-loading">Loading…</div>`;

  try {
    const snap = await getDocs(query(GAMES_COL, orderBy("createdAt", "desc")));
    const games = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!games.length) {
      grid.innerHTML = `<div class="ag-empty"><strong>No Active Games</strong>Create a game above to get started.</div>`;
      return;
    }

    grid.innerHTML = "";
    games.forEach(g => grid.appendChild(buildGameCard(g)));
  } catch(e) {
    grid.innerHTML = `<div class="ag-loading" style="color:#ef4444">Failed to load games: ${e.message}</div>`;
  }
}

function buildGameCard(g) {
  const homeName = g.homeTeam?.name || "Home";
  const awayName = g.awayTeam?.name || "Away";
  const created = g.createdAt?.toDate?.() || new Date();
  const timeAgo = formatTimeAgo(created);

  const status = g.status || "active";
  const statusLabel = status === "active" ? "Live" : status === "paused" ? "Paused" : "Done";

  const card = document.createElement("div");
  card.className = "game-card";
  card.innerHTML = `
    <div class="gc-top">
      <span class="gc-code">${g.code}</span>
      <span class="gc-status ${status}">${statusLabel}</span>
    </div>
    <div class="gc-matchup">${homeName} vs ${awayName}</div>
    <div class="gc-score">
      <span class="gc-pts">${g.homeScore || 0}</span>
      <span class="gc-sep">—</span>
      <span class="gc-pts">${g.awayScore || 0}</span>
    </div>
    <div class="gc-meta">
      <span>Period ${g.period || 1}</span>
      <span>${timeAgo}</span>
    </div>
    <div class="gc-actions">
      <button class="gc-btn open"   onclick="openGame('${g.code}')">▶ Open</button>
      <button class="gc-btn delete" onclick="deleteGame(event, '${g.code}')">🗑 Delete</button>
    </div>`;

  // Clicking the card also opens it (except the buttons)
  card.addEventListener("click", e => {
    if (!e.target.closest(".gc-btn")) openGame(g.code);
  });

  return card;
}

function formatTimeAgo(date) {
  const secs = Math.floor((Date.now() - date) / 1000);
  if (secs < 60)   return "Just now";
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function openGame(code) {
  window.location.href = `game.html?room=${code}`;
}

async function deleteGame(e, code) {
  e.stopPropagation();
  if (!confirm(`Delete game room ${code}? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, "gameRooms", code));
    showToast(`Room ${code} deleted`);
    loadActiveGames();
  } catch(err) {
    showToast("Failed to delete: " + err.message);
  }
}

function showToast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = "0", 2500);
}

// Expose for onclick
window.createGame       = createGame;
window.joinGame         = joinGame;
window.loadActiveGames  = loadActiveGames;
window.openGame         = openGame;
window.deleteGame       = deleteGame;