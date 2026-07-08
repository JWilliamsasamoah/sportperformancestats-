import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp,
  collection, query, where, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Resolves an email-or-username string to an email address.
// If the input contains '@' it is used directly; otherwise it is treated as
// a username and looked up in the usernames → users Firestore chain.
async function resolveToEmail(input) {
  const val = input.trim();
  if (val.includes("@")) return val;
  const slug = val.replace(/^@/, "").toLowerCase();

  // Primary: usernames collection lookup (publicly readable)
  try {
    const unSnap = await getDoc(doc(db, "usernames", slug));
    if (unSnap.exists()) {
      const uid = unSnap.data().uid;
      const uSnap = await getDoc(doc(db, "users", uid));
      if (uSnap.exists()) return uSnap.data().email;
    }
  } catch (_) {}

  // Fallback: query users collection by username field
  try {
    const q    = query(collection(db, "users"), where("username", "==", slug), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].data().email;
  } catch (_) {}

  throw { code: "auth/user-not-found" };
}


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

const emailEl = document.getElementById("login-email");
const passEl  = document.getElementById("login-password");
const btnEl   = document.getElementById("login-btn");
const errEl   = document.getElementById("login-error");
const okEl    = document.getElementById("login-ok");

// If already signed in and profile exists, skip to app
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) window.location.href = "teams_players.html";
});

// ── Sign In ──
btnEl.addEventListener("click", async () => {
  hideMessages();
  const identifier = emailEl.value.trim();
  const password   = passEl.value;
  if (!identifier || !password) { showError("Please enter your email (or username) and password."); return; }

  setLoading(true);
  try {
    const email = await resolveToEmail(identifier);
    const cred  = await signInWithEmailAndPassword(auth, email, password);
    const uid   = cred.user.uid;
    const snap  = await getDoc(doc(db, "users", uid));

    if (!snap.exists()) {
      // Pre-existing account — create an Admin profile automatically
      const rawUsername = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
      const username    = rawUsername || "admin";
      await setDoc(doc(db, "users", uid), {
        name:      email.split("@")[0],
        username,
        email,
        role:      "admin",
        teamId:    null,
        division:  null,
        createdAt: serverTimestamp(),
      });
      try {
        await setDoc(doc(db, "usernames", username), { uid });
      } catch (_) {}
    }

    window.location.href = "teams_players.html";
  } catch (e) {
    showError(friendlyError(e.code));
    setLoading(false);
  }
});

passEl.addEventListener("keydown", (e) => { if (e.key === "Enter") btnEl.click(); });

// ── Forgot Password ──
const forgotLink  = document.getElementById("forgot-link");
const resetPanel  = document.getElementById("reset-panel");
const resetEmail  = document.getElementById("reset-email");
const resetBtn    = document.getElementById("reset-btn");
const cancelReset = document.getElementById("cancel-reset");

forgotLink.addEventListener("click", (e) => {
  e.preventDefault();
  resetEmail.value = emailEl.value.trim(); // pre-fill from login email
  resetPanel.style.display = "flex";
  forgotLink.style.display = "none";
  hideMessages();
});

cancelReset.addEventListener("click", () => {
  resetPanel.style.display = "none";
  forgotLink.style.display = "block";
});

resetBtn.addEventListener("click", async () => {
  const identifier = resetEmail.value.trim();
  if (!identifier) { showError("Enter your email or username to reset your password."); return; }

  resetBtn.disabled    = true;
  resetBtn.textContent = "Sending…";
  try {
    const email = await resolveToEmail(identifier);
    await sendPasswordResetEmail(auth, email);
    resetPanel.style.display = "none";
    forgotLink.style.display  = "block";
    showSuccess(`Reset email sent. Check your inbox.`);
  } catch (e) {
    showError(e.code === "auth/user-not-found"
      ? "No account found. Check your email or username."
      : "Failed to send reset email. Try again.");
  } finally {
    resetBtn.disabled    = false;
    resetBtn.textContent = "Send Reset Email";
  }
});

// ── Helpers ──
function setLoading(on) {
  btnEl.disabled    = on;
  btnEl.textContent = on ? "Signing in…" : "Sign In";
}

function showError(msg) {
  errEl.textContent    = msg;
  errEl.style.display  = "block";
  okEl.style.display   = "none";
}

function showSuccess(msg) {
  okEl.textContent    = msg;
  okEl.style.display  = "block";
  errEl.style.display = "none";
}

function hideMessages() {
  errEl.style.display = "none";
  okEl.style.display  = "none";
}

function friendlyError(code) {
  switch (code) {
    case "auth/user-not-found":
    case "auth/invalid-email":    return "No account found. Check your email or username.";
    case "auth/wrong-password":
    case "auth/invalid-credential": return "Incorrect password. Please try again.";
    case "auth/too-many-requests":  return "Too many attempts. Try again later.";
    case "auth/network-request-failed": return "Network error. Check your connection.";
    default: return "Sign-in failed. Check your credentials.";
  }
}
