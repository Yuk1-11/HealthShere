// ============================================
// Firebase 設定のインポート
// ============================================
import { auth, db } from "./firebase.js";
import {
    onAuthStateChanged,
    signOut
} from "firebase/auth";
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    onSnapshot,
    addDoc,
    serverTimestamp
} from "firebase/firestore";

// ============================================
// 定数定義
// ============================================
const HEART_RATE_THRESHOLDS = {
    LOW: 50,      // 徐脈
    HIGH: 100,    // 頻脈
    CRITICAL_LOW: 40,
    CRITICAL_HIGH: 150
};

const TIME_RANGES = {
    '1h': { hours: 1, label: '直近1時間' },
    '6h': { hours: 6, label: '直近6時間' },
    '24h': { hours: 24, label: '直近24時間' },
    '7d': { hours: 24 * 7, label: '直近7日間' }
};

// ============================================
// グローバル変数
// ============================================
let currentUser = null;
let heartRateChart = null;
let unsubscribeHeartRate = null;

// ============================================
// DOM要素の取得
// ============================================
const domElements = {
    authRequired: document.getElementById('authRequired'),
    dashboard: document.getElementById('dashboard'),
    userName: document.getElementById('userName'),
    logoutBtn: document.getElementById('logoutBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    currentHeartRate: document.getElementById('currentHeartRate'),
    heartRateStatus: document.getElementById('heartRateStatus'),
    lastUpdate: document.getElementById('lastUpdate'),
    avgHeartRate: document.getElementById('avgHeartRate'),
    maxHeartRate: document.getElementById('maxHeartRate'),
    minHeartRate: document.getElementById('minHeartRate'),
    dataCount: document.getElementById('dataCount'),
    timeRange: document.getElementById('timeRange'),
    historyTableBody: document.getElementById('historyTableBody'),
    noDataMessage: document.getElementById('noDataMessage'),
    exportBtn: document.getElementById('exportBtn')
};

// ============================================
// 認証状態の監視
// ============================================
function setupAuthListener() {
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        
        if (user) {
            // ログイン中
            domElements.authRequired.style.display = 'none';
            domElements.dashboard.style.display = 'flex';
            domElements.userName.textContent = user.displayName || user.email;
            
            // 心拍データの購読を開始
            subscribeToHeartRateData();
        } else {
            // ログアウト中
            domElements.authRequired.style.display = 'flex';
            domElements.dashboard.style.display = 'none';
            
            // 購読を解除
            if (unsubscribeHeartRate) {
                unsubscribeHeartRate();
                unsubscribeHeartRate = null;
            }
        }
    });
}

// ============================================
// 心拍データの購読
// ============================================
function subscribeToHeartRateData() {
    if (!currentUser) return;
    
    const heartRateRef = collection(db, 'heartRates');
    const q = query(
        heartRateRef,
        where('userId', '==', currentUser.uid),
        orderBy('timestamp', 'desc'),
        limit(1000)
    );
    
    unsubscribeHeartRate = onSnapshot(q, (snapshot) => {
        const heartRateData = [];
        snapshot.forEach((doc) => {
            heartRateData.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        // データをタイムスタンプでソート（昇順）
        heartRateData.sort((a, b) => {
            const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
            const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
            return timeA - timeB;
        });
        
        updateDashboard(heartRateData);
    }, (error) => {
        console.error('心拍データの購読エラー:', error);
    });
}

// ============================================
// ダッシュボードの更新
// ============================================
function updateDashboard(heartRateData) {
    if (heartRateData.length === 0) {
        showNoData();
        return;
    }
    
    hideNoData();
    
    // 選択された時間範囲でフィルタ
    const selectedRange = domElements.timeRange.value;
    const filteredData = filterByTimeRange(heartRateData, selectedRange);
    
    if (filteredData.length === 0) {
        showNoData();
        return;
    }
    
    // 現在の心拍数（最新のデータ）
    const latestData = filteredData[filteredData.length - 1];
    updateCurrentHeartRate(latestData);
    
    // 統計情報の計算
    updateStatistics(filteredData);
    
    // グラフの更新
    updateChart(filteredData);
    
    // 履歴テーブルの更新
    updateHistoryTable(filteredData);
}

// ============================================
// 時間範囲でフィルタ
// ============================================
function filterByTimeRange(data, rangeKey) {
    const range = TIME_RANGES[rangeKey];
    if (!range) return data;
    
    const now = new Date();
    const cutoff = new Date(now.getTime() - range.hours * 60 * 60 * 1000);
    
    return data.filter(item => {
        const itemTime = item.timestamp?.toDate ? item.timestamp.toDate() : new Date(item.timestamp);
        return itemTime >= cutoff;
    });
}

// ============================================
// 現在の心拍数を表示
// ============================================
function updateCurrentHeartRate(data) {
    const heartRate = data.heartRate;
    domElements.currentHeartRate.textContent = heartRate;
    
    // 状態の判定
    const status = getHeartRateStatus(heartRate);
    domElements.heartRateStatus.textContent = status.label;
    domElements.heartRateStatus.className = `status-badge status-${status.class}`;
    
    // 最終更新時刻
    const timestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
    domElements.lastUpdate.textContent = formatTime(timestamp);
}

// ============================================
// 心拍数の状態を取得
// ============================================
function getHeartRateStatus(heartRate) {
    if (heartRate <= HEART_RATE_THRESHOLDS.CRITICAL_LOW || heartRate >= HEART_RATE_THRESHOLDS.CRITICAL_HIGH) {
        return { label: '危険', class: 'danger' };
    } else if (heartRate <= HEART_RATE_THRESHOLDS.LOW || heartRate >= HEART_RATE_THRESHOLDS.HIGH) {
        return { label: '注意', class: 'warning' };
    } else {
        return { label: '正常', class: 'normal' };
    }
}

// ============================================
// 統計情報を更新
// ============================================
function updateStatistics(data) {
    const heartRates = data.map(d => d.heartRate);
    
    const avg = Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length);
    const max = Math.max(...heartRates);
    const min = Math.min(...heartRates);
    
    domElements.avgHeartRate.textContent = avg;
    domElements.maxHeartRate.textContent = max;
    domElements.minHeartRate.textContent = min;
    domElements.dataCount.textContent = data.length;
}

// ============================================
// グラフを更新
// ============================================
function updateChart(data) {
    const ctx = document.getElementById('heartRateChart').getContext('2d');
    
    const labels = data.map(d => {
        const timestamp = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp);
        return formatChartTime(timestamp);
    });
    
    const values = data.map(d => d.heartRate);
    
    if (heartRateChart) {
        heartRateChart.destroy();
    }
    
    heartRateChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '心拍数 (bpm)',
                data: values,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 2,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return `心拍数: ${context.parsed.y} bpm`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxTicksLimit: 10
                    }
                },
                y: {
                    display: true,
                    beginAtZero: false,
                    min: 30,
                    max: 200,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    title: {
                        display: true,
                        text: 'bpm'
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// ============================================
// 履歴テーブルを更新
// ============================================
function updateHistoryTable(data) {
    // 最新の20件を表示（降順）
    const recentData = [...data].reverse().slice(-20).reverse();
    
    domElements.historyTableBody.innerHTML = recentData.map(d => {
        const timestamp = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp);
        const status = getHeartRateStatus(d.heartRate);
        
        return `
            <tr>
                <td>${formatDateTime(timestamp)}</td>
                <td><strong>${d.heartRate}</strong> bpm</td>
                <td><span class="status-badge status-${status.class}">${status.label}</span></td>
            </tr>
        `;
    }).join('');
}

// ============================================
// 日付・時刻のフォーマット
// ============================================
function formatTime(date) {
    return date.toLocaleTimeString('ja-JP', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
}

function formatDateTime(date) {
    return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function formatChartTime(date) {
    return date.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ============================================
// メッセージ表示
// ============================================
function showNoData() {
    domElements.noDataMessage.style.display = 'block';
    domElements.historyTableBody.parentElement.style.display = 'none';
}

function hideNoData() {
    domElements.noDataMessage.style.display = 'none';
    domElements.historyTableBody.parentElement.style.display = 'block';
}

// ============================================
// ログアウト処理
// ============================================
async function handleLogout() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error('ログアウトエラー:', error);
    }
}

// ============================================
// データのエクスポート
// ============================================
async function handleExport() {
    if (!currentUser) return;
    
    const heartRateRef = collection(db, 'heartRates');
    const q = query(
        heartRateRef,
        where('userId', '==', currentUser.uid),
        orderBy('timestamp', 'desc'),
        limit(10000)
    );
    
    try {
        const snapshot = await getDocs(q);
        const data = [];
        
        snapshot.forEach((doc) => {
            const d = doc.data();
            data.push({
                timestamp: d.timestamp?.toDate ? d.timestamp.toDate().toISOString() : d.timestamp,
                heartRate: d.heartRate,
                status: d.status || 'normal'
            });
        });
        
        // CSV形式でエクスポート
        let csv = '日時,心拍数(bpm),状態\n';
        data.forEach(d => {
            csv += `${d.timestamp},${d.heartRate},${d.status}\n`;
        });
        
        // ファイルとしてダウンロード
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `heartrate_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('エクスポートエラー:', error);
    }
}

// ============================================
// テストデータの追加（開発用）
// ============================================
export async function addTestHeartRateData(count = 50) {
    if (!currentUser) {
        console.warn('ログインしてください');
        return;
    }
    
    const heartRateRef = collection(db, 'heartRates');
    const now = new Date();
    const data = [];
    
    for (let i = 0; i < count; i++) {
        const timestamp = new Date(now.getTime() - i * 5 * 60 * 1000); // 5分ごと
        const heartRate = Math.floor(60 + Math.random() * 40); // 60-100 bpm
        
        data.push({
            userId: currentUser.uid,
            heartRate: heartRate,
            timestamp: timestamp,
            status: 'normal',
            createdAt: serverTimestamp()
        });
    }
    
    // 批量插入
    for (const d of data) {
        await addDoc(heartRateRef, d);
    }
    
    console.log(`${count}件のテストデータを追加しました`);
}

// ============================================
// イベントリスナーの設定
// ============================================
function setupEventListeners() {
    // ログアウトボタン
    domElements.logoutBtn?.addEventListener('click', handleLogout);
    
    // 更新ボタン
    domElements.refreshBtn?.addEventListener('click', () => {
        if (currentUser) {
            subscribeToHeartRateData();
        }
    });
    
    // 時間範囲変更
    domElements.timeRange?.addEventListener('change', () => {
        // 再描画は onSnapshot で自動的に行われる
    });
    
    // エクスポートボタン
    domElements.exportBtn?.addEventListener('click', handleExport);
    
    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
        // Ctrl+R で更新（ブラウザの更新は無効化）
        if (e.ctrlKey && e.key === 'r') {
            e.preventDefault();
            domElements.refreshBtn?.click();
        }
        
        // Ctrl+S でエクスポート
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            domElements.exportBtn?.click();
        }
        
        // Escape でログアウト確認
        if (e.key === 'Escape') {
            if (confirm('ログアウトしますか？')) {
                handleLogout();
            }
        }
    });
}

// ============================================
// メイン初期化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    setupAuthListener();
    setupEventListeners();
    
    console.log('HeartShare Dashboard initialized');
    console.log('開発用コマンド: addTestHeartRateData(件数)');
});

// グローバルに関数をエクスポート（コンソールから呼び出せるように）
window.addTestHeartRateData = addTestHeartRateData;