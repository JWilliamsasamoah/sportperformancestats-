import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FB = {
  apiKey: "AIzaSyCaUc9WOOBcvSinLVpxwbdojXvbuSMQBBM",
  authDomain: "statsapp-a199b.firebaseapp.com",
  projectId: "statsapp-a199b",
  storageBucket: "statsapp-a199b.appspot.com",
  messagingSenderId: "695414880372",
  appId: "1:695414880372:web:bd07071a02390219bd3921"
};

const app = initializeApp(FB, "showcase");
const db  = getFirestore(app);

// ── Category definitions ──
const CATS = [
  { key: "points",     label: "Points Leaders",     icon: "PTS", color: "#f5c518", abbr: "PTS" },
  { key: "rebounds",   label: "Rebound Leaders",    icon: "REB", color: "#14b8a6", abbr: "REB" },
  { key: "assists",    label: "Assist Leaders",     icon: "AST", color: "#3b82f6", abbr: "AST" },
  { key: "steals",     label: "Steal Leaders",      icon: "STL", color: "#22c55e", abbr: "STL" },
  { key: "blocks",     label: "Block Leaders",      icon: "BLK", color: "#ef4444", abbr: "BLK" },
  { key: "freeThrows", label: "Free Throw Leaders", icon: "FT",  color: "#a855f7", abbr: "FT"  },
];

const SLIDE_MS  = 8000; // ms per slide
const TOP_N     = 10;

let slides      = [];     // slide DOM elements
let currentIdx  = 0;
let autoTimer   = null;
let initialized = false;
let allPlayers  = [];

// ── Aggregate player stats across all game rooms ──
function buildPlayers(games) {
  const map = {};

  games.forEach(g => {
    if (!g.playerStats) return;
    const sideTeam = { home: g.homeTeam, away: g.awayTeam };

    Object.entries(g.playerStats).forEach(([key, s]) => {
      const dash = key.indexOf(" - ");
      if (dash < 0) return;
      const side    = key.slice(0, dash);
      const nameNum = key.slice(dash + 3);
      const team    = sideTeam[side];
      if (!team) return;

      const pKey = `${team.id || team.name}::${nameNum}`;

      if (!map[pKey]) {
        map[pKey] = {
          name:       nameNum.split(" #")[0] || nameNum,
          number:     nameNum.split(" #")[1] || "",
          team:       team.name || side,
          points:     0, rebounds: 0, assists: 0,
          steals:     0, blocks:   0, freeThrows: 0,
        };
      }

      const p = map[pKey];
      p.points     += s.points     || 0;
      p.rebounds   += s.rebounds   || 0;
      p.assists    += s.assists    || 0;
      p.steals     += s.steals     || 0;
      p.blocks     += s.blocks     || 0;
      p.freeThrows += s.freeThrows || 0;
    });
  });

  return Object.values(map);
}

// ── Top N for a stat key ──
function top(players, key) {
  return [...players]
    .filter(p => (p[key] || 0) > 0)
    .sort((a, b) => b[key] - a[key])
    .slice(0, TOP_N);
}

// ── Build slide content HTML for a category ──
function buildContent(cat, players) {
  const ranked = top(players, cat.key);
  const c      = cat.color;
  const hex10  = c + "1a";  // 10% opacity bg
  const hex30  = c + "4d";  // 30% opacity border

  if (!ranked.length) {
    return `
      <div class="sl-header">
        <span class="sl-icon">${cat.icon}</span>
        <div class="sl-title-wrap">
          <div class="sl-eyebrow">Season</div>
          <div class="sl-title" style="color:${c}">${cat.label.toUpperCase()}</div>
        </div>
      </div>
      <div class="sl-divider" style="background:${c}"></div>
      <div class="sl-empty">
        <div class="sl-empty-icon">--</div>
        <div class="sl-empty-msg">No stats recorded yet</div>
        <div class="sl-empty-sub">Stats will appear here once games are played</div>
      </div>`;
  }

  const meta = p => `${p.team}${p.number ? ` · #${p.number}` : ""}`;

  // #1 hero
  const p1 = ranked[0];
  let html = `
    <div class="sl-header">
      <span class="sl-icon">${cat.icon}</span>
      <div class="sl-title-wrap">
        <div class="sl-eyebrow">Season</div>
        <div class="sl-title" style="color:${c}">${cat.label.toUpperCase()}</div>
      </div>
    </div>
    <div class="sl-divider" style="background:${c}"></div>
    <div class="hero-card" style="background:linear-gradient(135deg,${hex10} 0%,var(--bg1) 60%);border-color:${hex30}">
      <div class="hero-watermark" style="color:${c}">01</div>
      <div class="hero-badge" style="background:${hex10};color:${c};border:1.5px solid ${hex30}">1ST</div>
      <div class="hero-info">
        <div class="hero-name">${p1.name}</div>
        <div class="hero-meta">${meta(p1)}</div>
      </div>
      <div class="hero-stat">
        <div class="hero-stat-val" style="color:${c}">${p1[cat.key]}</div>
        <div class="hero-stat-lbl">${cat.abbr}</div>
      </div>
    </div>`;

  // #2–#3 podium
  if (ranked.length > 1) {
    const medals = ["2ND", "3RD"];
    const podiumColors = ["#c0c0c0", "#cd7f32"];
    html += `<div class="podium-row">`;
    ranked.slice(1, 3).forEach((p, i) => {
      const pc = podiumColors[i];
      html += `
        <div class="podium-card">
          <div class="podium-badge" style="background:${pc}22;color:${pc};border:1px solid ${pc}55">${medals[i]}</div>
          <div class="podium-info">
            <div class="podium-name">${p.name}</div>
            <div class="podium-team">${meta(p)}</div>
          </div>
          <div class="podium-val" style="color:${pc}">${p[cat.key]}</div>
        </div>`;
    });
    html += `</div>`;
  }

  // #4–#10 list
  if (ranked.length > 3) {
    html += `<div class="rank-list">`;
    ranked.slice(3).forEach((p, i) => {
      html += `
        <div class="rank-row">
          <div class="rank-num">${String(i + 4).padStart(2, "0")}</div>
          <div class="rank-name">${p.name} <span class="rank-team">${meta(p)}</span></div>
          <div class="rank-val" style="color:${c}">${p[cat.key]}</div>
        </div>`;
    });
    html += `</div>`;
  }

  return html;
}

// ── Initial build: create slide shells + dots ──
function initSlides() {
  const wrap  = document.getElementById("slides-wrap");
  const dotsEl = document.getElementById("sc-dots");
  wrap.innerHTML = "";
  dotsEl.innerHTML = "";
  slides = [];

  CATS.forEach((cat, i) => {
    const div = document.createElement("div");
    div.className = "slide";
    slides.push(div);
    wrap.appendChild(div);

    const dot = document.createElement("div");
    dot.className = "sc-dot";
    dot.style.setProperty("--dot-color", cat.color);
    dot.onclick = () => goTo(i);
    dotsEl.appendChild(dot);
  });
}

// ── Update content in all slides (preserves active/exit classes) ──
function updateContent(players) {
  CATS.forEach((cat, i) => {
    if (slides[i]) slides[i].innerHTML = buildContent(cat, players);
  });
}

// ── Dot highlight ──
function updateDots(idx) {
  document.querySelectorAll(".sc-dot").forEach((d, i) => {
    d.classList.toggle("active", i === idx);
    d.style.background = i === idx ? CATS[i].color : "var(--line)";
  });
}

// ── Go to slide ──
function goTo(idx, instant = false) {
  if (!slides.length) return;

  const prev = slides[currentIdx];
  if (prev) {
    prev.classList.remove("active");
    if (!instant) {
      prev.classList.add("exit");
      setTimeout(() => prev.classList.remove("exit"), 500);
    }
  }

  currentIdx = ((idx % slides.length) + slides.length) % slides.length;
  const next = slides[currentIdx];
  if (next) next.classList.add("active");

  updateDots(currentIdx);
  startProgress();
  resetTimer();
}

// ── Auto-advance ──
function resetTimer() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => goTo(currentIdx + 1), SLIDE_MS);
}

// ── Animated progress bar ──
function startProgress() {
  const bar = document.getElementById("progress-fill");
  if (!bar) return;
  bar.style.transition = "none";
  bar.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `width ${SLIDE_MS}ms linear`;
    bar.style.width = "100%";
  }));
}

// ── Keyboard navigation ──
document.addEventListener("keydown", e => {
  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goTo(currentIdx + 1); }
  if (e.key === "ArrowLeft")                   { e.preventDefault(); goTo(currentIdx - 1); }
});

// ── Touch swipe ──
let touchX = null;
document.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
document.addEventListener("touchend", e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) dx < 0 ? goTo(currentIdx + 1) : goTo(currentIdx - 1);
  touchX = null;
});

// ── Expose arrow buttons ──
window.nextSlide = () => goTo(currentIdx + 1);
window.prevSlide = () => goTo(currentIdx - 1);

// ── Firebase subscription ──
document.addEventListener("DOMContentLoaded", () => {
  const q = query(collection(db, "gameRooms"), orderBy("createdAt", "desc"));

  onSnapshot(q,
    snap => {
      const games   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      allPlayers    = buildPlayers(games);

      if (!initialized) {
        initialized = true;
        initSlides();
        updateContent(allPlayers);
        goTo(0, true);
        resetTimer();
      } else {
        // Live update — refresh content without interrupting the current slide transition
        updateContent(allPlayers);
      }
    },
    err => {
      document.getElementById("slides-wrap").innerHTML =
        `<div class="sc-loading" style="color:#ef4444">Failed to load: ${err.message}</div>`;
    }
  );
});
