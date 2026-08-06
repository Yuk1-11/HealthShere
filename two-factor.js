// ============================================
// Firebase 設定のインポート
// ============================================
import { auth, db } from "./firebase.js";
import {
    onAuthStateChanged,
    signOut,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "firebase/auth";
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    addDoc
} from "firebase/firestore";

// ============================================
// 高度なセキュリティモジュールのインポート
// ============================================
import {
    SHA2PasswordHasher,
    OTPTransactionSigner,
    GSSAPITokenManager,
    SecurityManager,
    SECURITY_CONFIG
} from "./security-advanced.js";

// ============================================
// 定数定義
// ============================================
const TOTP_CONFIG = {
    issuer: 'HealthShare',
    algorithm: 'SHA1',
    digits: 6,
    period: 30
};

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

// ============================================
// TOTP 生成・検証クラス（クライアントサイド実装）
// ============================================
class TOTPAuthenticator {
    /**
     * ランダムなシークレットキーを生成
     */
    static generateSecret(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // Base32
        let secret = '';
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        for (let i = 0; i < length; i++) {
            secret += chars[array[i] % chars.length];
        }
        return secret;
    }

    /**
     * Base32 デコード
     */
    static base32ToUint8Array(base32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';
        for (let i = 0; i < base32.length; i++) {
            const val = chars.indexOf(base32[i].toUpperCase());
            if (val === -1) continue;
            bits += val.toString(2).padStart(5, '0');
        }
        
        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.substr(i, 8), 2));
        }
        return new Uint8Array(bytes);
    }

    /**
     * HMAC-SHA1 実装（Web Crypto API 使用）
     */
    static async hmacSha1(key, message) {
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
        return new Uint8Array(signature);
    }

    /**
     * 現在時刻に基づくTOTPコードを生成
     */
    static async generateTOTP(secret, timestamp = Date.now()) {
        const period = TOTP_CONFIG.period * 1000; // milliseconds
        const counter = Math.floor(timestamp / period);
        
        // Counterを8バイトのBigEndianに変換
        const counterBytes = new Uint8Array(8);
        for (let i = 7; i >= 0; i--) {
            counterBytes[i] = counter & 0xff;
            counter >>>= 8;
        }

        const key = this.base32ToUint8Array(secret);
        const hmac = await this.hmacSha1(key, counterBytes);

        // Truncation
        const offset = hmac[hmac.length - 1] & 0x0f;
        const code = (
            ((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff)
        ) % 1000000;

        return code.toString().padStart(6, '0');
    }

    /**
     * TOTPコードを検証（前後30秒のウィンドウ）
     */
    static async verify(secret, token, window = 1) {
        const now = Date.now();
        
        for (let i = -window; i <= window; i++) {
            const expectedToken = await this.generateTOTP(secret, now + i * TOTP_CONFIG.period * 1000);
            if (expectedToken === token) {
                return true;
            }
        }
        return false;
    }

    /**
     * QRコード用のURIを生成
     */
    static generateUri(secret, userEmail) {
        return `otpauth://totp/${encodeURIComponent(TOTP_CONFIG.issuer)}:${encodeURIComponent(userEmail)}?secret=${secret}&issuer=${encodeURIComponent(TOTP_CONFIG.issuer)}&algorithm=${TOTP_CONFIG.algorithm}&digits=${TOTP_CONFIG.digits}&period=${TOTP_CONFIG.period}`;
    }
}

// ============================================
// バックアップコード管理
// ============================================
class BackupCodeManager {
    /**
     * ランダムなバックアップコードを生成
     */
    static generateCodes(count = BACKUP_CODE_COUNT, length = BACKUP_CODE_LENGTH) {
        const codes = [];
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        
        for (let i = 0; i < count; i++) {
            let code = '';
            const array = new Uint8Array(length);
            crypto.getRandomValues(array);
            for (let j = 0; j < length; j++) {
                code += chars[array[j] % chars.length];
            }
            // 読みやすくするために4文字ごとにハイフン
            const formattedCode = code.match(/.{1,4}/g).join('-');
            codes.push(formattedCode);
        }
        
        return codes;
    }

    /**
     * バックアップコードをハッシュ化（Firestore保存用）
     */
    static async hashCodes(codes) {
        const hashedCodes = [];
        for (const code of codes) {
            const encoder = new TextEncoder();
            const data = encoder.encode(code.toLowerCase().replace(/-/g, ''));
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            hashedCodes.push(hashHex);
        }
        return hashedCodes;
    }

    /**
     * バックアップコードを検証
     */
    static async verifyCode(codes, hashedCodes) {
        const inputCode = codes.toLowerCase().replace(/-/g, '');
        const encoder = new TextEncoder();
        const data = encoder.encode(inputCode);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        return hashedCodes.includes(hashHex);
    }
}

// ============================================
// DOM要素
// ============================================
const domElements = {
    authRequired: document.getElementById('authRequired'),
    tfaSection: document.getElementById('tfaSection'),
    tfaStatus: document.getElementById('tfaStatus'),
    tfaDisabledView: document.getElementById('tfaDisabledView'),
    tfaEnabledView: document.getElementById('tfaEnabledView'),
    enableBtn: document.getElementById('enableBtn'),
    disableBtn: document.getElementById('disableBtn'),
    step1Content: document.getElementById('step1Content'),
    step2Content: document.getElementById('step2Content'),
    step3Content: document.getElementById('step3Content'),
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    step3: document.getElementById('step3'),
    qrCode: document.getElementById('qrCode'),
    secretKey: document.getElementById('secretKey'),
    verificationCode: document.getElementById('verificationCode'),
    verifyBtn: document.getElementById('verifyBtn'),
    backToStep1: document.getElementById('backToStep1'),
    backupCodesGrid: document.getElementById('backupCodesGrid'),
    downloadBackupBtn: document.getElementById('downloadBackupBtn'),
    copyBackupBtn: document.getElementById('copyBackupBtn')
};

// ============================================
// グローバル状態
// ============================================
let currentUser = null;
let currentSecret = null;
let backupCodes = [];

// DOM要素（高度なセキュリティセクション用）
const advancedSecuritySection = document.getElementById('advancedSecuritySection');

// ============================================
// 認証状態の監視
// ============================================
function setupAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        
        if (user) {
            domElements.authRequired.style.display = 'none';
            domElements.tfaSection.style.display = 'block';
            
            // 高度なセキュリティセクションを表示
            if (advancedSecuritySection) {
                advancedSecuritySection.style.display = 'block';
            }
            
            // 2FA設定を読み込み
            await loadTFASettings();
        } else {
            domElements.authRequired.style.display = 'block';
            domElements.tfaSection.style.display = 'none';
            
            // 高度なセキュリティセクションを非表示
            if (advancedSecuritySection) {
                advancedSecuritySection.style.display = 'none';
            }
        }
    });
}

// ============================================
// 2FA設定の読み込み
// ============================================
async function loadTFASettings() {
    if (!currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            const is2FAEnabled = userData.twoFactorEnabled || false;
            
            domElements.tfaStatus.textContent = is2FAEnabled ? '有効' : '無効';
            domElements.tfaStatus.className = is2FAEnabled ? 'status-enabled' : 'status-disabled';
            
            if (is2FAEnabled) {
                domElements.tfaDisabledView.classList.add('hidden');
                domElements.tfaEnabledView.classList.remove('hidden');
            } else {
                domElements.tfaDisabledView.classList.remove('hidden');
                domElements.tfaEnabledView.classList.add('hidden');
            }
        }
    } catch (error) {
        console.error('2FA設定の読み込みエラー:', error);
    }
}

// ============================================
// ステップ切り替え
// ============================================
function goToStep(step) {
    // すべてのコンテンツを非表示
    domElements.step1Content.classList.add('hidden');
    domElements.step2Content.classList.add('hidden');
    domElements.step3Content.classList.add('hidden');
    
    // すべてのステップインジケーターをリセット
    domElements.step1.className = 'step';
    domElements.step2.className = 'step';
    domElements.step3.className = 'step';
    
    // 選択されたステップを表示
    switch (step) {
        case 1:
            domElements.step1Content.classList.remove('hidden');
            domElements.step1.className = 'step active';
            break;
        case 2:
            domElements.step2Content.classList.remove('hidden');
            domElements.step1.className = 'step completed';
            domElements.step2.className = 'step active';
            break;
        case 3:
            domElements.step3Content.classList.remove('hidden');
            domElements.step1.className = 'step completed';
            domElements.step2.className = 'step completed';
            domElements.step3.className = 'step active';
            break;
    }
}

// ============================================
// 2FA有効化処理
// ============================================
async function enable2FA() {
    if (!currentUser) return;
    
    // 再認証を要求
    const reauthConfirmed = confirm('セキュリティのため、再度パスワードを入力する必要があります。続けますか？');
    if (!reauthConfirmed) return;
    
    const password = prompt('現在のパスワードを入力してください：');
    if (!password) {
        showToast('パスワードが入力されませんでした。', 'warning');
        return;
    }
    
    try {
        // 再認証
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, credential);
        
        // シークレットキー生成
        currentSecret = TOTPAuthenticator.generateSecret();
        
        // QRコード表示
        const uri = TOTPAuthenticator.generateUri(currentSecret, currentUser.email);
        await QRCode.toCanvas(domElements.qrCode, uri, {
            width: 200,
            margin: 2,
            color: {
                dark: '#2d3748',
                light: '#ffffff'
            }
        });
        
        domElements.secretKey.textContent = currentSecret;
        
        // ステップ2へ
        goToStep(2);
        
    } catch (error) {
        console.error('2FA有効化エラー:', error);
        showToast('認証に失敗しました。パスワードを確認してください。', 'error');
    }
}

// ============================================
// 認証コード検証
// ============================================
async function verifyCode() {
    const code = domElements.verificationCode.value.trim();
    
    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
        showToast('6桁の認証コードを正しく入力してください。', 'warning');
        return;
    }
    
    try {
        const isValid = await TOTPAuthenticator.verify(currentSecret, code);
        
        if (isValid) {
            // バックアップコード生成
            backupCodes = BackupCodeManager.generateCodes();
            const hashedCodes = await BackupCodeManager.hashCodes(backupCodes);
            
            // Firestoreに保存
            await updateDoc(doc(db, 'users', currentUser.uid), {
                twoFactorEnabled: true,
                twoFactorSecret: currentSecret,
                backupCodes: hashedCodes,
                twoFactorEnabledAt: new Date().toISOString()
            });
            
            // バックアップコード表示
            displayBackupCodes();
            
            // ステップ3へ
            goToStep(3);
            
            showToast('2段階認証が有効になりました！', 'success');
        } else {
            showToast('認証コードが正しくありません。', 'error');
        }
    } catch (error) {
        console.error('認証コード検証エラー:', error);
        showToast('検証に失敗しました。', 'error');
    }
}

// ============================================
// バックアップコード表示
// ============================================
function displayBackupCodes() {
    domElements.backupCodesGrid.innerHTML = backupCodes.map(code => 
        `<div class="backup-code">${code}</div>`
    ).join('');
}

// ============================================
// 2FA無効化処理
// ============================================
async function disable2FA() {
    if (!currentUser) return;
    
    const confirmed = confirm('本当に2段階認証を無効にしますか？\n\nアカウントのセキュリティが低下します。');
    if (!confirmed) return;
    
    const password = prompt('現在のパスワードを入力してください：');
    if (!password) {
        showToast('パスワードが入力されませんでした。', 'warning');
        return;
    }
    
    try {
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, credential);
        
        await updateDoc(doc(db, 'users', currentUser.uid), {
            twoFactorEnabled: false,
            twoFactorSecret: null,
            backupCodes: null,
            twoFactorDisabledAt: new Date().toISOString()
        });
        
        showToast('2段階認証が無効になりました。', 'success');
        await loadTFASettings();
        
    } catch (error) {
        console.error('2FA無効化エラー:', error);
        showToast('認証に失敗しました。パスワードを確認してください。', 'error');
    }
}

// ============================================
// バックアップコードダウンロード
// ============================================
function downloadBackupCodes() {
    const content = `HealthShare バックアップコード\n`;
    const codes = backupCodes.join('\n');
    const fullContent = content + codes;
    
    const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `healthshare-backup-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
}

// ============================================
// バックアップコードコピー
// ============================================
function copyBackupCodes() {
    const text = backupCodes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        showToast('バックアップコードをクリップボードにコピーしました。', 'success');
    }).catch(() => {
        showToast('コピーに失敗しました。', 'error');
    });
}

// ============================================
// 高度なセキュリティ機能
// ============================================

// セキュリティマネージャーのインスタンス
let securityManager = null;

// DOM要素（高度なセキュリティ機能用）
const advancedSecurityElements = {
    transactionSigningSection: document.getElementById('transactionSigningSection'),
    transactionSigningStatus: document.getElementById('transactionSigningStatus'),
    enableTransactionSigningBtn: document.getElementById('enableTransactionSigningBtn'),
    transactionSigningOtpInput: document.getElementById('transactionSigningOtpInput'),
    generateSignatureBtn: document.getElementById('generateSignatureBtn'),
    signatureResult: document.getElementById('signatureResult'),
    passwordHashSection: document.getElementById('passwordHashSection'),
    passwordHashResult: document.getElementById('passwordHashResult'),
    hashAlgorithmSelect: document.getElementById('hashAlgorithmSelect'),
    hashPasswordInput: document.getElementById('hashPasswordInput'),
    hashPasswordBtn: document.getElementById('hashPasswordBtn'),
    gssApiSection: document.getElementById('gssApiSection'),
    gssApiStatus: document.getElementById('gssApiStatus'),
    generateGssTokenBtn: document.getElementById('generateGssTokenBtn'),
    gssTokenResult: document.getElementById('gssTokenResult'),
    verifyGssTokenBtn: document.getElementById('verifyGssTokenBtn'),
    gssTokenInput: document.getElementById('gssTokenInput')
};

/**
 * 高度なセキュリティ設定の読み込み
 */
async function loadAdvancedSecuritySettings() {
    if (!currentUser || !securityManager) return;
    
    try {
        const securityConfig = await securityManager.getUserSecurityConfig(currentUser.uid);
        
        if (securityConfig) {
            // トランザクション署名ステータス
            if (advancedSecurityElements.transactionSigningStatus) {
                const isSigningEnabled = securityConfig.transactionSigningEnabled || false;
                advancedSecurityElements.transactionSigningStatus.textContent = isSigningEnabled ? '有効' : '無効';
                advancedSecurityElements.transactionSigningStatus.className = isSigningEnabled ? 'status-enabled' : 'status-disabled';
            }
            
            // GSS-API ステータス
            if (advancedSecurityElements.gssApiStatus) {
                const isGssEnabled = securityConfig.gssApiEnabled || false;
                advancedSecurityElements.gssApiStatus.textContent = isGssEnabled ? '有効' : '無効';
                advancedSecurityElements.gssApiStatus.className = isGssEnabled ? 'status-enabled' : 'status-disabled';
            }
        }
    } catch (error) {
        console.error('高度なセキュリティ設定の読み込みエラー:', error);
    }
}

/**
 * OTP トランザクション署名を有効化
 */
async function enableTransactionSigning() {
    if (!currentUser || !securityManager) return;
    
    const otpToken = advancedSecurityElements.transactionSigningOtpInput?.value.trim();
    if (!otpToken || otpToken.length !== 6) {
        showToast('6桁のOTPコードを入力してください。', 'warning');
        return;
    }
    
    try {
        // シークレットキーが存在することを確認
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (!userDoc.exists() || !userDoc.data().twoFactorSecret) {
            showToast('まず2段階認証を有効にしてください。', 'warning');
            return;
        }
        
        const secret = userDoc.data().twoFactorSecret;
        const isValid = await TOTPAuthenticator.verify(secret, otpToken);
        
        if (!isValid) {
            showToast('OTPコードが正しくありません。', 'error');
            return;
        }
        
        // トランザクション署名を有効化
        const result = await securityManager.enableOTPTransactionSigning(
            currentUser.uid,
            currentUser.email,
            secret
        );
        
        if (result.success) {
            showToast('OTP トランザクション署名が有効になりました。', 'success');
            await loadAdvancedSecuritySettings();
            
            // 署名を生成して表示
            await generateTransactionSignature();
        } else {
            showToast('有効化に失敗しました。', 'error');
        }
    } catch (error) {
        console.error('トランザクション署名有効化エラー:', error);
        showToast('エラーが発生しました。', 'error');
    }
}

/**
 * トランザクション署名を生成
 */
async function generateTransactionSignature() {
    if (!currentUser || !securityManager) return;
    
    const otpToken = advancedSecurityElements.transactionSigningOtpInput?.value.trim();
    if (!otpToken || otpToken.length !== 6) {
        showToast('6桁のOTPコードを入力してください。', 'warning');
        return;
    }
    
    try {
        const signature = await securityManager.createTransactionSignature(
            currentUser.uid,
            currentUser.email,
            otpToken
        );
        
        // 署名をFirestoreに保存
        await addDoc(collection(db, 'transaction_signatures'), {
            userId: currentUser.uid,
            userEmail: currentUser.email,
            version: signature.data.version,
            otpToken: otpToken,
            timestamp: signature.data.timestamp,
            expiry: signature.data.expiry,
            nonce: signature.data.nonce,
            signature: signature.signature,
            verified: true,
            createdAt: new Date().toISOString()
        });
        
        // 結果を表示
        if (advancedSecurityElements.signatureResult) {
            advancedSecurityElements.signatureResult.innerHTML = `
                <div class="signature-details">
                    <h4>署名生成結果</h4>
                    <p><strong>署名ID:</strong> ${signature.data.nonce.substring(0, 16)}...</p>
                    <p><strong>有効期限:</strong> ${new Date(signature.data.expiry).toLocaleString()}</p>
                    <p><strong>署名ハッシュ:</strong> ${signature.signature.substring(0, 32)}...</p>
                    <pre class="signature-json">${JSON.stringify(signature.data, null, 2)}</pre>
                </div>
            `;
        }
        
        showToast('トランザクション署名が生成されました。', 'success');
        
        // セキュリティログを記録
        await securityManager.logSecurityEvent(currentUser.uid, 'TRANSACTION_SIGNATURE_GENERATED', {
            nonce: signature.data.nonce.substring(0, 16),
            expiry: signature.data.expiry
        });
        
    } catch (error) {
        console.error('トランザクション署名生成エラー:', error);
        showToast('署名生成に失敗しました。', 'error');
    }
}

/**
 * パスワードハッシュ生成
 */
async function hashPassword() {
    const password = advancedSecurityElements.hashPasswordInput?.value;
    const algorithm = advancedSecurityElements.hashAlgorithmSelect?.value || 'SHA-256';
    
    if (!password) {
        showToast('パスワードを入力してください。', 'warning');
        return;
    }
    
    if (password.length < 8) {
        showToast('パスワードは8文字以上である必要があります。', 'warning');
        return;
    }
    
    try {
        const salt = SHA2PasswordHasher.generateSalt();
        let result;
        
        if (algorithm === 'PBKDF2') {
            result = await SHA2PasswordHasher.hashPBKDF2(password, salt);
        } else if (algorithm === 'SHA-512') {
            result = await SHA2PasswordHasher.hashSHA512(password, salt);
        } else {
            result = await SHA2PasswordHasher.hashSHA256(password, salt);
        }
        
        // 結果を表示
        if (advancedSecurityElements.passwordHashResult) {
            advancedSecurityElements.passwordHashResult.innerHTML = `
                <div class="hash-details">
                    <h4>ハッシュ結果 (${algorithm})</h4>
                    <p><strong>アルゴリズム:</strong> ${algorithm}</p>
                    <p><strong>ソルト:</strong> ${result.salt}</p>
                    <p><strong>ハッシュ:</strong> ${result.hash}</p>
                    ${result.iterations ? `<p><strong>イテレーション数:</strong> ${result.iterations.toLocaleString()}</p>` : ''}
                </div>
            `;
        }
        
        showToast('パスワードハッシュが生成されました。', 'success');
        
        // 入力フィールドをクリア
        advancedSecurityElements.hashPasswordInput.value = '';
        
    } catch (error) {
        console.error('パスワードハッシュ生成エラー:', error);
        showToast('ハッシュ生成に失敗しました。', 'error');
    }
}

/**
 * GSS-API トークン生成
 */
async function generateGSSAPIToken() {
    if (!currentUser || !securityManager) return;
    
    try {
        // 権限を定義
        const permissions = ['read', 'write', 'profile_update'];
        
        const result = await securityManager.generateGSSAPIToken(
            currentUser.uid,
            currentUser.email,
            permissions
        );
        
        // トークン結果を表示
        if (advancedSecurityElements.gssTokenResult) {
            advancedSecurityElements.gssTokenResult.innerHTML = `
                <div class="gss-token-details">
                    <h4>GSS-API トークン</h4>
                    <p><strong>トークンID:</strong> ${result.token.nonce}</p>
                    <p><strong>有効期限:</strong> ${new Date(result.token.expiry).toLocaleString()}</p>
                    <p><strong>権限:</strong> ${result.token.permissions.join(', ')}</p>
                    <div class="token-encoded">
                        <strong>エンコードされたトークン:</strong>
                        <pre>${result.tokenString}</pre>
                    </div>
                </div>
            `;
        }
        
        showToast('GSS-API トークンが生成されました。', 'success');
        await loadAdvancedSecuritySettings();
        
        // セキュリティログを記録
        await securityManager.logSecurityEvent(currentUser.uid, 'GSS_API_TOKEN_GENERATED', {
            nonce: result.token.nonce,
            permissions: permissions,
            expiry: result.token.expiry
        });
        
    } catch (error) {
        console.error('GSS-API トークン生成エラー:', error);
        showToast('トークン生成に失敗しました。', 'error');
    }
}

/**
 * GSS-API トークン検証
 */
async function verifyGSSAPIToken() {
    if (!currentUser) return;
    
    const tokenString = advancedSecurityElements.gssTokenInput?.value.trim();
    if (!tokenString) {
        showToast('トークンを入力してください。', 'warning');
        return;
    }
    
    try {
        const result = await GSSAPITokenManager.verifyToken(
            tokenString,
            currentUser.uid,
            currentUser.email
        );
        
        if (result.valid) {
            showToast('トークンが有効です。', 'success');
            
            // 権限表示
            const permissions = GSSAPITokenManager.getPermissions(result.token);
            if (advancedSecurityElements.gssTokenResult) {
                advancedSecurityElements.gssTokenResult.innerHTML = `
                    <div class="token-verification-result valid">
                        <h4>✅ トークン有効</h4>
                        <p><strong>ユーザーID:</strong> ${result.token.userId}</p>
                        <p><strong>権限:</strong> ${permissions.join(', ')}</p>
                        <p><strong>有効期限:</strong> ${new Date(result.token.expiry).toLocaleString()}</p>
                    </div>
                `;
            }
        } else {
            showToast(`トークンが無効です: ${result.reason}`, 'error');
            
            if (advancedSecurityElements.gssTokenResult) {
                advancedSecurityElements.gssTokenResult.innerHTML = `
                    <div class="token-verification-result invalid">
                        <h4>❌ トークン無効</h4>
                        <p><strong>理由:</strong> ${result.reason}</p>
                    </div>
                `;
            }
        }
        
    } catch (error) {
        console.error('GSS-API トークン検証エラー:', error);
        showToast('トークン検証に失敗しました。', 'error');
    }
}

// ============================================
// イベントリスナーの設定
// ============================================
function setupEventListeners() {
    domElements.enableBtn?.addEventListener('click', enable2FA);
    domElements.disableBtn?.addEventListener('click', disable2FA);
    domElements.verifyBtn?.addEventListener('click', verifyCode);
    domElements.backToStep1?.addEventListener('click', () => goToStep(1));
    domElements.downloadBackupBtn?.addEventListener('click', downloadBackupCodes);
    domElements.copyBackupBtn?.addEventListener('click', copyBackupCodes);
    
    // 認証コード入力フィールドの自動フォーマット
    domElements.verificationCode?.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    });
    
    // Enterキーで認証
    domElements.verificationCode?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            verifyCode();
        }
    });
    
    // 高度なセキュリティ機能のイベントリスナー
    advancedSecurityElements.enableTransactionSigningBtn?.addEventListener('click', enableTransactionSigning);
    advancedSecurityElements.generateSignatureBtn?.addEventListener('click', generateTransactionSignature);
    advancedSecurityElements.hashPasswordBtn?.addEventListener('click', hashPassword);
    advancedSecurityElements.generateGssTokenBtn?.addEventListener('click', generateGSSAPIToken);
    advancedSecurityElements.verifyGssTokenBtn?.addEventListener('click', verifyGSSAPIToken);
    
    // OTP入力フィールドの自動フォーマット
    advancedSecurityElements.transactionSigningOtpInput?.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    });
}

// ============================================
// メイン初期化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    setupAuthListener();
    setupEventListeners();
    
    // セキュリティマネージャーを初期化
    securityManager = new SecurityManager();
    
    // 高度なセキュリティ設定を読み込み
    if (currentUser) {
        loadAdvancedSecuritySettings();
    }
    
    console.log('2FA Settings page initialized with advanced security features');
});
