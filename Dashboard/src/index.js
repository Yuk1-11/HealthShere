import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import Chart from "chart.js/auto";

// Firebase 設定
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const chartsDiv = document.getElementById('charts');
const authDiv = document.getElementById('auth');
const authMessage = document.getElementById('authMessage');
const logoutBtn = document.getElementById('logoutBtn');

const charts = {};

// チャート作成
function createChart(userId) {
  const canvas = document.createElement('canvas');
  canvas.id = 'chart_' + userId;
  canvas.width = 400;
  canvas.height = 200;
  chartsDiv.appendChild(canvas);

  charts[userId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'BPM',
        data: [],
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.3
      }]
    },
    options: {
      scales: {
        x: { title: { display: true, text: 'Time' } },
        y: { title: { display: true, text: 'BPM' }, min: 40, max: 180 }
      }
    }
  });
}

// Firestore リアルタイム監視
function startListening() {
  const q = query(collection(db, "heartRates"), orderBy("timestamp", "asc"), limit(100));
  onSnapshot(q, snapshot => {
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
document.getElementById('signupBtn').onclick = () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  createUserWithEmailAndPassword(auth, email, password)
    .then(() => { authMessage.textContent = '登録成功！ログインしてください'; })
    .catch(err => { authMessage.textContent = err.message; });
};

document.getElementById('loginBtn').onclick = () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  signInWithEmailAndPassword(auth, email, password)
    .catch(err => { authMessage.textContent = err.message; });
};

logoutBtn.onclick = () => { signOut(auth); };

onAuthStateChanged(auth, user => {
  if (user) {
    authDiv.style.display = 'none';
    logoutBtn.style.display = 'block';
    startListening();
  } else {
    authDiv.style.display = 'block';
    logoutBtn.style.display = 'none';
    chartsDiv.innerHTML = '';
    for (let c in charts) delete charts[c];
  }
});
