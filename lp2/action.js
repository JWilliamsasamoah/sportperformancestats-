import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, confirmPasswordReset, applyActionCode, verifyPasswordResetCode
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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

const params  = new URLSearchParams(location.search);
const mode    = params.get("mode");
const oobCode = params.get("oobCode");

function show(viewId) {
  ["view-loading","view-reset","view-verify","view-success","view-error"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === viewId ? "" : "none";
    });
}

function showSuccess(title, msg) {
  document.getElementById("success-title").textContent = title;
  document.getElementById("success-msg").textContent   = msg;
  show("view-success");
}

function showError(msg) {
  document.getElementById("error-msg").textContent = msg;
  show("view-error");
}

// ── Password strength meter ──
const newPwInput = document.getElementById("new-password");
newPwInput?.addEventListener("input", () => {
  const pw  = newPwInput.value;
  const fill  = document.getElementById("strength-fill");
  const label = document.getElementById("strength-label");
  if (!pw) { fill.style.width = "0%"; label.textContent = ""; return; }

  let score = 0;
  if (pw.length >= 8)                   score++;
  if (pw.length >= 12)                  score++;
  if (/[A-Z]/.test(pw))                 score++;
  if (/[0-9]/.test(pw))                 score++;
  if (/[^a-zA-Z0-9]/.test(pw))         score++;

  const levels = [
    { pct: "20%", color: "#ef4444", text: "Weak" },
    { pct: "40%", color: "#f97316", text: "Fair" },
    { pct: "60%", color: "#eab308", text: "Good" },
    { pct: "80%", color: "#84cc16", text: "Strong" },
    { pct: "100%",color: "#22c55e", text: "Excellent" },
  ];
  const lvl = levels[Math.min(score, 4)];
  fill.style.width      = lvl.pct;
  fill.style.background = lvl.color;
  label.textContent     = lvl.text;
  label.style.color     = lvl.color;
});

// ── Reset Password ──
async function initReset() {
  if (!oobCode) { showError("Invalid or expired reset link. Request a new one."); return; }
  try {
    const email = await verifyPasswordResetCode(auth, oobCode);
    document.getElementById("reset-email-label").textContent = `for ${email}`;
    show("view-reset");
    document.getElementById("new-password")?.focus();
  } catch {
    showError("This reset link has expired or already been used. Request a new one from the login page.");
  }
}

window.submitReset = async function() {
  const pw      = document.getElementById("new-password")?.value || "";
  const confirm = document.getElementById("confirm-password")?.value || "";
  const errEl   = document.getElementById("reset-error");
  const btn     = document.getElementById("reset-btn");

  errEl.style.display = "none";

  if (pw.length < 6) {
    errEl.textContent   = "Password must be at least 6 characters.";
    errEl.style.display = "block"; return;
  }
  if (pw !== confirm) {
    errEl.textContent   = "Passwords do not match.";
    errEl.style.display = "block"; return;
  }

  btn.disabled    = true;
  btn.textContent = "Saving…";
  try {
    await confirmPasswordReset(auth, oobCode, pw);
    showSuccess("Password Updated", "Your password has been changed. You can now sign in with your new password.");
  } catch (e) {
    errEl.textContent   = e.code === "auth/expired-action-code"
      ? "This link has expired. Request a new reset email."
      : "Failed to update password. Try again.";
    errEl.style.display = "block";
    btn.disabled    = false;
    btn.textContent = "Save New Password";
  }
};

// Enter key on confirm field submits
document.getElementById("confirm-password")?.addEventListener("keydown", e => {
  if (e.key === "Enter") window.submitReset();
});

// ── Verify Email ──
async function initVerify() {
  if (!oobCode) { showError("Invalid verification link."); return; }
  show("view-verify");
  try {
    await applyActionCode(auth, oobCode);
    showSuccess("Email Verified", "Your email address is confirmed. Welcome to Sport Performance Stats!");
  } catch {
    showError("This verification link has expired or already been used.");
  }
}

// ── Route by mode ──
switch (mode) {
  case "resetPassword": initReset();  break;
  case "verifyEmail":   initVerify(); break;
  default:
    showError("Unknown action. This link may be invalid.");
}
