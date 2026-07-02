import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
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
  const email    = emailEl.value.trim();
  const password = passEl.value;
  if (!email || !password) { showError("Please enter your email and password."); return; }

  setLoading(true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;
    const snap = await getDoc(doc(db, "users", uid));

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
      // Claim the username (best-effort — no error if already taken)
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
  const email = resetEmail.value.trim();
  if (!email) { showError("Enter your email address to reset your password."); return; }

  resetBtn.disabled    = true;
  resetBtn.textContent = "Sending…";
  try {
    await sendPasswordResetEmail(auth, email);
    resetPanel.style.display = "none";
    forgotLink.style.display  = "block";
    showSuccess(`Reset email sent to ${email}. Check your inbox.`);
  } catch (e) {
    showError(e.code === "auth/user-not-found"
      ? "No account found with that email."
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
    case "auth/invalid-email":    return "No account found with that email.";
    case "auth/wrong-password":
    case "auth/invalid-credential": return "Incorrect password. Please try again.";
    case "auth/too-many-requests":  return "Too many attempts. Try again later.";
    case "auth/network-request-failed": return "Network error. Check your connection.";
    default: return "Sign-in failed. Check your credentials.";
  }
}
