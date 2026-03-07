
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import { Chart } from "chart.js";

// 環境変数から Firebase 設定を読み込む
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const charts = {};
const chartsDiv = document.getElementById("charts");
const authDiv = document.getElementById("auth");
const authMessage = document.getElementById("authMessage");
const logoutBtn = document.getElementById("logoutBtn");

function createChart(userId) {
  const canvas = document.createElement("canvas");
  canvas.id = "chart_" + userId;
  canvas.width = 400;
  canvas.height = 200;
  chartsDiv.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  charts[userId] = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [{ label: "BPM", data: [], borderColor: "rgb(75,192,192)", tension: 0.3 }] },
    options: {
      scales: {
        x: { title: { display: true, text: "Time" } },
        y: { title: { display: true, text: "BPM" }, min: 40, max: 180 }
      }
    }
  });
}

function startListening() {
  db.collection("heartRates").orderBy("timestamp", "asc").limit(100).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === "added") {
        const data = change.doc.data();
        const userId = data.userId;
        if (!charts[userId]) createChart(userId);

        const chart = charts[userId];
        const timeLabel = new Date(data.timestamp.seconds * 1000).toLocaleTimeString();
        chart.data.labels.push(timeLabel);
        chart.data.datasets[0].data.push(data.bpm);

        if (chart.data.labels.length > 100) {
          chart.data.labels.shift();
          chart.data.datasets[0].data.shift();
        }

        chart.update();
      }
    });
  });
}

// 認証フォーム
document.getElementById("signupBtn").onclick = () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  auth.createUserWithEmailAndPassword(email, password)
    .then(() => { authMessage.textContent = "登録成功！ログインしてください"; })
    .catch(err => { authMessage.textContent = err.message; });
};

document.getElementById("loginBtn").onclick = () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  auth.signInWithEmailAndPassword(email, password)
    .catch(err => { authMessage.textContent = err.message; });
};

logoutBtn.onclick = () => { auth.signOut(); };

auth.onAuthStateChanged(user => {
  if (user) {
    authDiv.style.display = "none";
    logoutBtn.style.display = "block";
    startListening();
  } else {
    authDiv.style.display = "block";
    logoutBtn.style.display = "none";
    chartsDiv.innerHTML = "";
    for (let c in charts) delete charts[c];
  }
});
