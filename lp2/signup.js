import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs,
  collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// ── EmailJS ──
const EJS_SERVICE  = "service_5wsc8cv";
const EJS_TEMPLATE = "template_k1c59gg";
const EJS_KEY      = "dfno0btEY6cfultg7";
emailjs.init(EJS_KEY);

const DIVISION_LABELS = {
  "boy11-14":  "Boys 11–14",
  "boy15-18":  "Boys 15–18",
  "girl11-18": "Girls 11–18",
};

// Admin is NOT available on the public signup form.
// Role defaults to "stats" (first option selected in HTML).
let selectedRole = "stats";
let teams        = [];
let signingUp    = false;

// Warn if already signed in so the user doesn't accidentally create a duplicate session
onAuthStateChanged(auth, (user) => {
  if (user && !signingUp) {
    const warn = document.getElementById("signup-error");
    if (warn) {
      warn.textContent = `You're signed in as @${user.displayName || user.email}. Creating a new account will sign you out.`;
      warn.style.display = "block";
    }
  }
});

// ── Load teams for coach dropdown ──
async function loadTeams() {
  const sel = document.getElementById("su-team");
  try {
    const snap = await getDocs(collection(db, "teams"));
    teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    sel.innerHTML = `<option value="">— Select your team —</option>`;

    const grouped = {};
    teams.forEach(t => {
      const div = t.division || "boy11-14";
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

    if (!teams.length) {
      sel.innerHTML = `<option value="">No teams yet — ask your admin to create one</option>`;
    }
  } catch (e) {
    sel.innerHTML = `<option value="">Failed to load teams — try refreshing</option>`;
    console.error("loadTeams:", e.message);
  }
}

loadTeams();

// ── Role buttons ──
document.getElementById("role-grid").addEventListener("click", (e) => {
  const btn = e.target.closest(".role-btn");
  if (!btn) return;
  document.querySelectorAll(".role-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedRole = btn.dataset.role;
  document.getElementById("team-field").classList.toggle("visible", selectedRole === "coach");
});

// ── Username live validation ──
const usernameInput = document.getElementById("su-username");
const usernameHint  = document.getElementById("username-hint");
const USERNAME_RE   = /^[a-z0-9_]{3,20}$/;

usernameInput.addEventListener("input", () => {
  const raw = usernameInput.value;
  const clean = raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (raw !== clean) usernameInput.value = clean; // auto-sanitize

  if (!clean) {
    setHint("3–20 characters. Letters, numbers, underscores only.", "neutral");
  } else if (clean.length < 3) {
    setHint("Too short — at least 3 characters.", "error");
  } else if (clean.length > 20) {
    setHint("Too long — max 20 characters.", "error");
  } else {
    setHint(`@${clean} looks good!`, "ok");
  }
});

function setHint(msg, state) {
  usernameHint.textContent = msg;
  usernameHint.className   = `field-hint hint-${state}`;
}

// ── Submit ──
const btnEl = document.getElementById("signup-btn");
const errEl = document.getElementById("signup-error");

function showError(msg) { errEl.textContent = msg; errEl.style.display = "block"; }
function clearError()   { errEl.style.display = "none"; }
function setLoading(on) {
  btnEl.disabled    = on;
  btnEl.textContent = on ? "Creating account…" : "Create Account";
}

function friendlyError(code) {
  switch (code) {
    case "auth/email-already-in-use": return "An account with this email already exists. Try signing in.";
    case "auth/weak-password":        return "Password must be at least 6 characters.";
    case "auth/invalid-email":        return "Please enter a valid email address.";
    default: return "Sign-up failed. Please try again.";
  }
}

btnEl.addEventListener("click", async () => {
  clearError();

  const name     = document.getElementById("su-name").value.trim();
  const username = document.getElementById("su-username").value.trim().toLowerCase();
  const email    = document.getElementById("su-email").value.trim();
  const password = document.getElementById("su-password").value;
  const confirm  = document.getElementById("su-confirm").value;
  const teamId   = document.getElementById("su-team").value;

  // Validate
  if (!name)                        { showError("Please enter your full name."); return; }
  if (!USERNAME_RE.test(username))  { showError("Username must be 3–20 characters (letters, numbers, underscores)."); return; }
  if (!email)                       { showError("Please enter your email."); return; }
  if (password.length < 6)          { showError("Password must be at least 6 characters."); return; }
  if (password !== confirm)         { showError("Passwords do not match."); return; }
  if (selectedRole === "coach" && !teamId) { showError("Please select your team."); return; }

  setLoading(true);
  signingUp = true;

  // Check username uniqueness
  const usernameSnap = await getDoc(doc(db, "usernames", username));
  if (usernameSnap.exists()) {
    showError(`@${username} is already taken. Try a different username.`);
    setLoading(false);
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    const team    = teams.find(t => t.id === teamId) || null;
    const profile = {
      name,
      username,
      email,
      role:      selectedRole,   // "stats" or "coach" only — never "admin" from signup
      teamId:    selectedRole === "coach" ? teamId   : null,
      division:  selectedRole === "coach" ? (team?.division || null) : null,
      createdAt: serverTimestamp(),
    };

    // Write profile and claim username
    await setDoc(doc(db, "users", uid), profile);
    await setDoc(doc(db, "usernames", username), { uid });

    // Send verification email via Firebase (best-effort)
    try { await sendEmailVerification(cred.user); } catch (_) {}

    // Send styled welcome email via EmailJS (best-effort)
    try {
      await emailjs.send(EJS_SERVICE, EJS_TEMPLATE, { name, email });
    } catch (_) {}

    window.location.href = "teams_players.html";
  } catch (e) {
    showError(friendlyError(e.code));
    setLoading(false);
    signingUp = false;
  }
});
