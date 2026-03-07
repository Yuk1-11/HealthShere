import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

document.addEventListener("DOMContentLoaded", () => {

  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const registerBtn = document.getElementById("registerBtn");
  const emailInput = document.getElementById("emailInput");
  const passwordInput = document.getElementById("passwordInput");
  const nameInput = document.getElementById("nameInput");

  onAuthStateChanged(auth, async (user) => {

    if (user) {

      logoutBtn.style.display = "block";
      loginBtn.style.display = "none";
      registerBtn.style.display = "none";

      const docRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        nameInput.value = data.name || "";
      }

    } else {

      logoutBtn.style.display = "none";
      loginBtn.style.display = "block";
      registerBtn.style.display = "block";

    }

  });
  
  registerBtn.addEventListener("click", async () => {
  console.log("register clicked");
  const email = emailInput.value;
  const password = passwordInput.value;
  const name = nameInput.value;

  if (!email || !password || !name) {
    alert("メール、パスワード、名前を入力してください");
    return;
  }

  try {
    // Firebase Auth にユーザー登録
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Firestore にユーザーデータ保存
    await setDoc(doc(db, "users", user.uid), { name });

    alert("登録成功！");
  } catch (error) {
    alert("登録失敗：" + error.message);
  }
  });


  loginBtn.addEventListener("click", async () => {

    const email = emailInput.value;
    const password = passwordInput.value;

    if (!email || !password) {
      alert("メールとパスワードを入力してください");
      return;
    }

    try {

      await signInWithEmailAndPassword(auth, email, password);
      alert("ログイン成功！");

    } catch (error) {

      alert("ログイン失敗：" + error.message);

    }

  });

  logoutBtn.addEventListener("click", async () => {

    try {

      await signOut(auth);
      alert("ログアウトしました！");

    } catch (error) {

      alert("ログアウト失敗：" + error.message);

    }

  });
});

