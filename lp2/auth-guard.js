// ── Shared auth guard — import in every protected page ──
// Usage:
//   import { requireAuth } from "./auth-guard.js";
//   const { user, profile } = await requireAuth(auth, db);

import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function requireAuth(auth, db) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "login.html";
        return;
      }

      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) {
        await signOut(auth);
        window.location.href = "login.html";
        return;
      }

      resolve({ user, profile: snap.data() });
    });
  });
}

export function buildNavAuth(profile, auth) {
  // Inject user name + logout button into nav
  const navList = document.querySelector(".nav-links");
  if (!navList) return;

  // Hide the "Login" link — user is already signed in
  navList.querySelectorAll("a").forEach(a => {
    if (a.getAttribute("href") === "login.html") a.closest("li").style.display = "none";
  });

  // Remove old auth item if present
  document.getElementById("nav-auth-item")?.remove();

  const li = document.createElement("li");
  li.id = "nav-auth-item";
  const displayName = profile.username ? `@${profile.username}` : profile.name.split(" ")[0];
  li.innerHTML = `
    <div class="nav-user">
      <span class="nav-user-name">${displayName}</span>
      <span class="nav-user-role nav-role-${profile.role}">${roleBadge(profile.role)}</span>
      <button class="nav-logout-btn" id="nav-logout">Logout</button>
    </div>`;
  navList.appendChild(li);

  document.getElementById("nav-logout").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}

function roleBadge(role) {
  switch (role) {
    case "admin":  return "Admin";
    case "stats":  return "Scorekeeper";
    case "coach":  return "Coach";
    default:       return role;
  }
}
