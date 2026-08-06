import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
  updateProfile
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc
} from "firebase/firestore";

// ============================================
// 定数定義
// ============================================
const RATE_LIMITS = {
  REGISTRATION: { maxAttempts: 3, windowMs: 15 * 60 * 1000 },
  LOGIN: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  EMAIL_SEND: { maxAttempts: 3, windowMs: 60 * 60 * 1000 }
};

const VALIDATION_RULES = {
  NAME: { min: 1, max: 50 },
  PASSWORD: { min: 8, max: 128 },
  EMAIL: { max: 254 }
};

const COMMON_PASSWORDS = ['password', '123456', 'qwerty', 'abc123'];

// ============================================
// ユーティリティ関数
// ============================================

/**
 * 入力値をサニタイズする
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/[<>]/g, '').slice(0, 200);
}

/**
 * メールアドレスの形式を検証する
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= VALIDATION_RULES.EMAIL.max;
}

/**
 * パスワードの強度を検証する
 */
function validatePasswordStrength(password) {
  const errors = [];
  const { min, max } = VALIDATION_RULES.PASSWORD;

  if (password.length < min) {
    errors.push(`パスワードは${min}文字以上である必要があります`);
  }
  if (password.length > max) {
    errors.push(`パスワードは${max}文字以下である必要があります`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("パスワードには大文字を1文字以上含めてください");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("パスワードには小文字を1文字以上含めてください");
  }
  if (!/\d/.test(password)) {
    errors.push("パスワードには数字を1文字以上含めてください");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("パスワードには特殊文字（!@#$%^&*など）を1文字以上含めてください");
  }

  if (COMMON_PASSWORDS.some(p => password.toLowerCase().includes(p))) {
    errors.push("一般的なパスワードは使用できません");
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * パスワード強度を計算する（0-6の6段階）
 */
function calculatePasswordStrength(password) {
  let strength = 0;
  if (password.length >= 8) strength += 1;
  if (password.length >= 12) strength += 1;
  if (/[A-Z]/.test(password)) strength += 1;
  if (/[a-z]/.test(password)) strength += 1;
  if (/\d/.test(password)) strength += 1;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) strength += 1;
  return strength;
}

// ============================================
// レート制限管理
// ============================================
class RateLimiter {
  constructor() {
    this.attempts = new Map();
  }

  check(identifier, limit) {
    const now = Date.now();

    if (!this.attempts.has(identifier)) {
      this.attempts.set(identifier, []);
    }

    const attempts = this.attempts.get(identifier);
    const validAttempts = attempts.filter(time => now - time < limit.windowMs);
    this.attempts.set(identifier, validAttempts);

    if (validAttempts.length >= limit.maxAttempts) {
      const oldestAttempt = validAttempts[0];
      const waitTime = Math.ceil((limit.windowMs - (now - oldestAttempt)) / 60000);
      return { allowed: false, retryAfter: waitTime };
    }

    validAttempts.push(now);
    return { allowed: true };
  }
}

const rateLimiter = new RateLimiter();

// ============================================
// UI通知システム
// ============================================

/**
 * トースト通知を表示する
 */
function showToast(message, type = 'info', duration = 3000) {
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '16px 24px',
    borderRadius: '8px',
    color: 'white',
    fontWeight: '600',
    fontSize: '0.95rem',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    zIndex: '10000',
    animation: 'slideIn 0.3s ease-out',
    maxWidth: '400px'
  });

  const colors = {
    success: '#48bb78',
    error: '#f56565',
    warning: '#ed8936',
    info: '#4299e1'
  };
  toast.style.background = colors[type] || colors.info;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * インラインエラーを表示する
 */
function showInlineError(input, message) {
  const existingError = input.parentElement.querySelector('.inline-error');
  if (existingError) existingError.remove();

  input.style.borderColor = '#f56565';

  const errorDiv = document.createElement('div');
  errorDiv.className = 'inline-error';
  errorDiv.textContent = message;
  errorDiv.style.cssText = `
    color: #f56565;
    font-size: 0.85rem;
    margin-top: 6px;
    padding: 4px 8px;
    background: rgba(245, 101, 101, 0.1);
    border-radius: 4px;
  `;

  input.parentElement.appendChild(errorDiv);

  input.addEventListener('input', function clearError() {
    this.style.borderColor = '';
    const err = this.parentElement.querySelector('.inline-error');
    if (err) err.remove();
    this.removeEventListener('input', clearError);
  }, { once: true });
}

/**
 * 入力フィールドの有効状態を設定
 */
function setInputValidity(input, isValid, message = '') {
  input.setAttribute('aria-invalid', !isValid);
  if (!isValid && message) {
    showInlineError(input, message);
  }
}

// ============================================
// DOM要素の取得
// ============================================
let domElements = {};

function initializeDOMElements() {
  domElements = {
    loginBtn: document.getElementById("loginBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    registerBtn: document.getElementById("registerBtn"),
    emailInput: document.getElementById("emailInput"),
    passwordInput: document.getElementById("passwordInput"),
    nameInput: document.getElementById("nameInput"),
    passwordStrength: document.getElementById("passwordStrength"),
    profileSection: document.getElementById("profileSection"),
    profileNameInput: document.getElementById("profileNameInput"),
    profileBioInput: document.getElementById("profileBioInput"),
    saveProfileBtn: document.getElementById("saveProfileBtn"),
    changePasswordBtn: document.getElementById("changePasswordBtn"),
    deleteAccountBtn: document.getElementById("deleteAccountBtn"),
    currentPassword: document.getElementById("currentPassword"),
    newPassword: document.getElementById("newPassword"),
    profileImageInput: document.getElementById("profileImageInput"),
    changeImageBtn: document.getElementById("changeImageBtn"),
    profileImagePreview: document.getElementById("profileImagePreview"),
    shortcutsHelp: document.querySelector('.shortcuts-help')
  };
}

// ============================================
// キーボードショートカット
// ============================================
class ShortcutManager {
  constructor() {
    this.shortcutsVisible = true;
    this.init();
  }

  init() {
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  handleKeyDown(e) {
    const { ctrlKey, shiftKey, key } = e;
    const { loginBtn, logoutBtn, registerBtn, saveProfileBtn, shortcutsHelp } = domElements;

    if (ctrlKey && key === 'Enter') {
      e.preventDefault();
      if (logoutBtn.style.display === 'none') loginBtn?.click();
    }

    if (ctrlKey && shiftKey && key === 'R') {
      e.preventDefault();
      if (logoutBtn.style.display === 'none') registerBtn?.click();
    }

    if (ctrlKey && shiftKey && key === 'L') {
      e.preventDefault();
      if (logoutBtn.style.display !== 'none') logoutBtn?.click();
    }

    if (ctrlKey && key === 's') {
      e.preventDefault();
      if (saveProfileBtn && logoutBtn.style.display !== 'none') saveProfileBtn.click();
    }

    if (key === '?' && !ctrlKey && !shiftKey) {
      e.preventDefault();
      if (shortcutsHelp) {
        shortcutsHelp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        shortcutsHelp.style.animation = 'none';
        setTimeout(() => { shortcutsHelp.style.animation = ''; }, 10);
      }
    }

    if (key === 'Escape') {
      this.clearForms();
    }

    if (ctrlKey && key === 'h') {
      e.preventDefault();
      if (shortcutsHelp) {
        this.shortcutsVisible = !this.shortcutsVisible;
        shortcutsHelp.style.display = this.shortcutsVisible ? 'block' : 'none';
      }
    }
  }

  clearForms() {
    const { emailInput, passwordInput, nameInput } = domElements;
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (nameInput) nameInput.value = '';
    updatePasswordStrengthIndicator('');
  }
}

// ============================================
// パスワード強度インジケーター
// ============================================
const STRENGTH_LEVELS = ["非常に弱い", "弱い", "普通", "強い", "非常に強い", "最強"];
const STRENGTH_COLORS = ["#ff4444", "#ff6644", "#ffaa00", "#dddd00", "#88cc00", "#44aa00"];

function updatePasswordStrengthIndicator(password) {
  const { passwordStrength } = domElements;
  if (!passwordStrength) return;

  if (!password) {
    passwordStrength.textContent = "";
    return;
  }

  const strength = calculatePasswordStrength(password);
  passwordStrength.textContent = `パスワード強度: ${STRENGTH_LEVELS[strength]}`;
  passwordStrength.style.color = STRENGTH_COLORS[strength];
}

// ============================================
// 認証処理
// ============================================

async function handleRegister() {
  const { emailInput, passwordInput, nameInput, registerBtn } = domElements;
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const name = sanitizeInput(nameInput.value);

  let hasError = false;
  if (!email) {
    setInputValidity(emailInput, false, "メールアドレスを入力してください");
    hasError = true;
  } else if (!isValidEmail(email)) {
    setInputValidity(emailInput, false, "有効なメールアドレス形式を入力してください");
    hasError = true;
  }

  if (!password) {
    setInputValidity(passwordInput, false, "パスワードを入力してください");
    hasError = true;
  }

  if (!name) {
    setInputValidity(nameInput, false, "お名前を入力してください");
    hasError = true;
  } else if (name.length < VALIDATION_RULES.NAME.min || name.length > VALIDATION_RULES.NAME.max) {
    setInputValidity(nameInput, false, `名前は${VALIDATION_RULES.NAME.min}-${VALIDATION_RULES.NAME.max}文字で入力してください`);
    hasError = true;
  } else if (/script/i.test(name)) {
    setInputValidity(nameInput, false, "名前に不正な文字が含まれています");
    hasError = true;
  }

  if (hasError) return;

  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.isValid) {
    setInputValidity(passwordInput, false, passwordValidation.errors.join("\n"));
    return;
  }

  const rateLimitResult = rateLimiter.check(email, RATE_LIMITS.REGISTRATION);
  if (!rateLimitResult.allowed) {
    showToast(`登録試行が多すぎます。${rateLimitResult.retryAfter}分後にもう一度お試しください。`, 'warning');
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "登録中...";

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    await updateProfile(user, { displayName: name });
    await sendEmailVerification(user);

    await setDoc(doc(db, "users", user.uid), {
      name,
      email,
      isEmailVerified: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    });

    showToast("登録メールを送信しました。メール内のリンクをクリックしてアカウントを有効化してください。", 'success');

    await signOut(auth);
    shortcutManager.clearForms();

  } catch (error) {
    const errorMessages = {
      'auth/email-already-in-use': 'このメールアドレスは既に登録されています',
      'auth/invalid-email': '無効なメールアドレスです',
      'auth/operation-not-allowed': 'この操作は許可されていません',
      'auth/weak-password': 'パスワードが弱すぎます'
    };
    const message = errorMessages[error.code] || `登録失敗：${error.message}`;
    showToast(message, 'error');
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = "新規登録";
  }
}

async function handleLogin() {
  const { emailInput, passwordInput, loginBtn } = domElements;
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  let hasError = false;
  if (!email) {
    setInputValidity(emailInput, false, "メールアドレスを入力してください");
    hasError = true;
  } else if (!isValidEmail(email)) {
    setInputValidity(emailInput, false, "有効なメールアドレス形式を入力してください");
    hasError = true;
  }

  if (!password) {
    setInputValidity(passwordInput, false, "パスワードを入力してください");
    hasError = true;
  }

  if (hasError) return;

  const rateLimitResult = rateLimiter.check(email, RATE_LIMITS.LOGIN);
  if (!rateLimitResult.allowed) {
    showToast(`ログイン試行が多すぎます。${rateLimitResult.retryAfter}分後にもう一度お試しください。`, 'warning');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "ログイン中...";

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    if (!user.emailVerified) {
      const shouldResend = confirm("メールアドレスが未検証です。検証メールを再送信しますか？");

      if (shouldResend) {
        const emailRateLimit = rateLimiter.check(email, RATE_LIMITS.EMAIL_SEND);
        if (emailRateLimit.allowed) {
          await sendEmailVerification(user);
          showToast("検証メールを再送信しました。メールをご確認ください。", 'info');
        } else {
          showToast(`メール送信試行が多すぎます。${emailRateLimit.retryAfter}分後にもう一度お試しください。`, 'warning');
        }
      }

      await signOut(auth);
      return;
    }

    await updateDoc(doc(db, "users", user.uid), {
      lastLoginAt: new Date().toISOString()
    });

    showToast("ログインしました！", 'success');

  } catch (error) {
    const errorMessages = {
      'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません',
      'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません',
      'auth/user-not-found': 'このメールアドレスは登録されていません',
      'auth/too-many-requests': '試行が多すぎます。しばらく待ってからお試しください'
    };
    const message = errorMessages[error.code] || `ログイン失敗：${error.message}`;
    showToast(message, 'error');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "ログイン";
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    showToast("ログアウトしました。", 'success');
  } catch (error) {
    showToast(`ログアウト失敗：${error.message}`, 'error');
  }
}

function setupAuthStateListener() {
  onAuthStateChanged(auth, async (user) => {
    const { loginBtn, logoutBtn, registerBtn, profileSection, emailInput, nameInput } = domElements;

    if (user) {
      logoutBtn.style.display = "block";
      loginBtn.style.display = "none";
      registerBtn.style.display = "none";
      profileSection.style.display = "block";

      const docRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        nameInput.value = data.name || "";
        emailInput.value = user.email || "";
      }
    } else {
      logoutBtn.style.display = "none";
      loginBtn.style.display = "block";
      registerBtn.style.display = "block";
      profileSection.style.display = "none";
    }
  });
}

// ============================================
// プロファイル管理
// ============================================
async function handleSaveProfile() {
  const user = auth.currentUser;
  if (!user) return;

  const { profileNameInput, profileBioInput, saveProfileBtn } = domElements;
  const name = sanitizeInput(profileNameInput.value);
  const bio = sanitizeInput(profileBioInput.value);

  if (!name) {
    showToast("お名前を入力してください", 'warning');
    return;
  }

  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = "保存中...";

  try {
    await updateDoc(doc(db, "users", user.uid), {
      name,
      bio: bio || null,
      updatedAt: new Date().toISOString()
    });

    await updateProfile(user, { displayName: name });

    showToast("プロフィールを保存しました。", 'success');
  } catch (error) {
    showToast(`保存失敗：${error.message}`, 'error');
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = "💾 プロフィールを保存";
  }
}

async function handleChangePassword() {
  const user = auth.currentUser;
  if (!user) return;

  const { currentPassword, newPassword, changePasswordBtn } = domElements;
  const currentPwd = currentPassword.value;
  const newPwd = newPassword.value;

  if (!currentPwd || !newPwd) {
    showToast("現在のパスワードと新しいパスワードを入力してください", 'warning');
    return;
  }

  const passwordValidation = validatePasswordStrength(newPwd);
  if (!passwordValidation.isValid) {
    showToast("パスワードの設定が不適切です：" + passwordValidation.errors.join("、"), 'warning');
    return;
  }

  changePasswordBtn.disabled = true;
  changePasswordBtn.textContent = "変更中...";

  try {
    await signInWithEmailAndPassword(auth, user.email, currentPwd);
    await user.updatePassword(newPwd);

    currentPassword.value = '';
    newPassword.value = '';
    showToast("パスワードを変更しました。", 'success');
  } catch (error) {
    showToast(`パスワード変更に失敗しました。現在のパスワードが正しいか確認してください。`, 'error');
  } finally {
    changePasswordBtn.disabled = false;
    changePasswordBtn.textContent = "🔑 パスワードを変更";
  }
}

async function handleDeleteAccount() {
  const user = auth.currentUser;
  if (!user) return;

  const confirmed = confirm("本当にアカウントを削除しますか？\n\nこの操作は取り消せません。すべてのデータが失われます。");
  if (!confirmed) return;

  const reauthConfirmed = confirm("セキュリティのため、再度ログインする必要があります。続けますか？");
  if (!reauthConfirmed) return;

  try {
    const email = user.email;
    const password = prompt("確認のため、現在のパスワードを入力してください：");

    if (!password) {
      showToast("パスワードが入力されませんでした。", 'warning');
      return;
    }

    await signInWithEmailAndPassword(auth, email, password);
    await user.delete();

    showToast("アカウントが削除されました。", 'success');
  } catch (error) {
    showToast(`アカウント削除に失敗しました：${error.message}`, 'error');
  }
}

// ============================================
// メイン初期化処理
// ============================================
let shortcutManager;

document.addEventListener("DOMContentLoaded", () => {
  initializeDOMElements();
  shortcutManager = new ShortcutManager();
  setupAuthStateListener();

  domElements.passwordInput?.addEventListener('input', () => {
    updatePasswordStrengthIndicator(domElements.passwordInput.value);
  });

  domElements.registerBtn?.addEventListener("click", handleRegister);
  domElements.loginBtn?.addEventListener("click", handleLogin);
  domElements.logoutBtn?.addEventListener("click", handleLogout);
  domElements.saveProfileBtn?.addEventListener("click", handleSaveProfile);
  domElements.changePasswordBtn?.addEventListener("click", handleChangePassword);
  domElements.deleteAccountBtn?.addEventListener("click", handleDeleteAccount);

  domElements.changeImageBtn?.addEventListener("click", () => {
    domElements.profileImageInput?.click();
  });

  domElements.profileImageInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        domElements.profileImagePreview.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

  domElements.emailInput?.addEventListener('blur', () => {
    const email = domElements.emailInput.value.trim();
    if (email && !isValidEmail(email)) {
      setInputValidity(domElements.emailInput, false, "有効なメールアドレス形式を入力してください");
    }
  });

  // アニメーション用CSSを動的に追加
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
});
