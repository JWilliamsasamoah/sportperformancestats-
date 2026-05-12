// ================================================
//  SPORT PERFORMANCE STATS · TEAMS SCRIPT
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc,
  updateDoc, deleteDoc, doc
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
const COL = collection(db, "teams");

let teams            = [];
let currentTeamIndex = null;
let currentTeamId    = null;

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  loadTeams();
  document.getElementById("add-team-btn").addEventListener("click", addTeam);
});

// ── Load ──
async function loadTeams() {
  const snap = await getDocs(COL);
  teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  syncSession();
  renderTeams();
}

function syncSession() {
  sessionStorage.setItem("firebaseTeams", JSON.stringify(teams));
}

// ── Render ──
function renderTeams() {
  const tbody = document.getElementById("teams-container");
  tbody.innerHTML = "";

  // Sort by win % descending
  const sorted = [...teams].sort((a, b) => {
    const pa = a.wins / Math.max(1, a.wins + a.losses);
    const pb = b.wins / Math.max(1, b.wins + b.losses);
    return pb - pa;
  });

  sorted.forEach((team, rank) => {
    const origIdx = teams.indexOf(team);
    const total   = team.wins + team.losses;
    const pct     = total > 0 ? ((team.wins / total) * 100).toFixed(1) + "%" : "—";
    const rClass  = rank === 0 ? "r1" : rank === 1 ? "r2" : rank === 2 ? "r3" : "";
    const medal   = rank === 0 ? " 🥇" : rank === 1 ? " 🥈" : rank === 2 ? " 🥉" : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="rank ${rClass}">${rank + 1}</span></td>
      <td class="tname">${team.name}${medal}</td>
      <td class="tw">${team.wins}</td>
      <td class="tl">${team.losses}</td>
      <td>${pct}</td>
      <td>
        <div class="actions">
          <button class="abtn roster" onclick="editRoster(${origIdx})">Roster</button>
          <button class="abtn win"    onclick="addWin(${origIdx})">+W</button>
          <button class="abtn loss"   onclick="addLoss(${origIdx})">+L</button>
          <button class="abtn del"    onclick="deleteTeam(${origIdx})">Delete</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

// ── Add Team ──
async function addTeam() {
  const name = prompt("Team name:")?.trim();
  if (!name) return;
  const data = { name, wins: 0, losses: 0, roster: [] };
  const ref  = await addDoc(COL, data);
  teams.push({ id: ref.id, ...data });
  syncSession();
  renderTeams();
}

// ── Delete ──
window.deleteTeam = async function(idx) {
  const team = teams[idx];
  if (!team?.id) { alert("Team not found."); return; }
  if (!confirm(`Delete "${team.name}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, "teams", team.id));
    teams.splice(idx, 1);
    syncSession();
    renderTeams();
  } catch(e) { alert("Delete failed: " + e.message); }
};

// ── Win / Loss ──
window.addWin = async function(idx) {
  teams[idx].wins++;
  try {
    await updateDoc(doc(db, "teams", teams[idx].id), { wins: teams[idx].wins });
    syncSession(); renderTeams();
  } catch(e) { teams[idx].wins--; alert("Failed: " + e.message); }
};

window.addLoss = async function(idx) {
  teams[idx].losses++;
  try {
    await updateDoc(doc(db, "teams", teams[idx].id), { losses: teams[idx].losses });
    syncSession(); renderTeams();
  } catch(e) { teams[idx].losses--; alert("Failed: " + e.message); }
};

// ── Roster ──
window.editRoster = function(idx) {
  currentTeamIndex = idx;
  currentTeamId    = teams[idx].id;
  document.getElementById("team-roster-title").textContent = `Roster — ${teams[idx].name}`;
  renderRoster();
  document.getElementById("roster-modal").classList.add("open");
};

function renderRoster() {
  const ul      = document.getElementById("player-list");
  const roster  = teams[currentTeamIndex]?.roster || [];
  ul.innerHTML  = "";
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
    syncSession();
    nameEl.value = ""; numEl.value = "";
    renderRoster();
  } catch(e) { roster.pop(); alert("Failed: " + e.message); }
};

window.removePlayer = async function(idx) {
  if (!confirm("Remove this player?")) return;
  const [removed] = teams[currentTeamIndex].roster.splice(idx, 1);
  try {
    await updateDoc(doc(db, "teams", currentTeamId), { roster: teams[currentTeamIndex].roster });
    syncSession(); renderRoster();
  } catch(e) {
    teams[currentTeamIndex].roster.splice(idx, 0, removed);
    alert("Failed: " + e.message);
  }
};

window.saveRoster = async function() {
  try {
    await updateDoc(doc(db, "teams", currentTeamId), { roster: teams[currentTeamIndex].roster });
    syncSession();
    closeRosterModal();
  } catch(e) { alert("Save failed: " + e.message); }
};

window.closeRosterModal = function() {
  document.getElementById("roster-modal").classList.remove("open");
};
