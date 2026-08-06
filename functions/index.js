/**
 * HealthShare Firebase Cloud Functions
 * サーバーサイド検証とセキュリティ強化
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Firebase Admin SDK 初期化
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// ============================================
// セキュリティミドルウェア
// ============================================

/**
 * Firebase Authentication 検証ミドルウェア
 */
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: '認証トークンが必要です'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({
      success: false,
      error: '認証に失敗しました',
      details: error.message
    });
  }
};

/**
 * レート制限ミドルウェア
 */
const rateLimiter = async (req, res, next) => {
  const userId = req.user?.uid || req.ip;
  const endpoint = req.path;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15分
  const maxAttempts = 100; // 15分間に100リクエスト

  try {
    const rateLimitRef = db.collection('rate_limits').doc(`${userId}_${endpoint}`);
    const rateLimitDoc = await rateLimitRef.get();

    let attempts = [];
    if (rateLimitDoc.exists) {
      const data = rateLimitDoc.data();
      attempts = data.attempts.filter(time => now - time < windowMs);
    }

    if (attempts.length >= maxAttempts) {
      const oldestAttempt = attempts[0];
      const waitTime = Math.ceil((windowMs - (now - oldestAttempt)) / 60000);
      
      return res.status(429).json({
        success: false,
        error: 'リクエストが多すぎます',
        retryAfter: waitTime
      });
    }

    attempts.push(now);
    await rateLimitRef.set({
      attempts,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    next();
  } catch (error) {
    console.error('Rate limit error:', error);
    next(); // エラー時はレート制限をスキップ
  }
};

/**
 * 入力値検証ミドルウェア
 */
const validateInput = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: '入力値が無効です',
        details: error.details.map(detail => detail.message)
      });
    }

    req.validatedBody = value;
    next();
  };
};

// ============================================
// セキュリティ監査ログ
// ============================================

/**
 * セキュリティイベントを記録
 */
const logSecurityEvent = async (userId, eventType, details = {}) => {
  try {
    const logEntry = {
      userId,
      eventType,
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress: details.ipAddress || null,
      userAgent: details.userAgent || null
    };

    await db.collection('security_logs').add(logEntry);
  } catch (error) {
    console.error('Security log error:', error);
  }
};

// ============================================
// バリデーションスキーマ
// ============================================

const Joi = require('joi');

const validationSchemas = {
  // 心拍数データ
  heartRate: Joi.object({
    heartRate: Joi.number().min(30).max(250).required(),
    timestamp: Joi.number().integer().optional(),
    status: Joi.string().valid('normal', 'warning', 'danger').optional(),
    source: Joi.string().valid('apple_watch', 'iphone', 'manual').optional()
  }),

  // ユーザープロフィール更新
  userProfile: Joi.object({
    name: Joi.string().min(1).max(50).required(),
    bio: Joi.string().max(500).optional(),
    profileImageUrl: Joi.string().uri().optional()
  }),

  // パスワード変更
  passwordChange: Joi.object({
    currentPassword: Joi.string().min(8).required(),
    newPassword: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/)
      .required()
  }),

  // 共有リクエスト
  shareRequest: Joi.object({
    toUserEmail: Joi.string().email().required(),
    message: Joi.string().max(500).optional()
  })
};

// ============================================
// API エンドポイント
// ============================================

/**
 * 心拍数データ保存（サーバーサイド検証付き）
 */
exports.saveHeartRate = functions.https.onCall(async (data, context) => {
  // 認証チェック
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '認証が必要です'
    );
  }

  const userId = context.auth.uid;

  // 入力値検証
  const { error } = validationSchemas.heartRate.validate(data);
  if (error) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '無効な心拍数データです',
      error.details.map(d => d.message).join(', ')
    );
  }

  try {
    // 心拍数の範囲チェック
    const { heartRate, timestamp = Date.now(), source = 'manual' } = data;
    
    // 異常値の検出
    let status = 'normal';
    if (heartRate < 50 || heartRate > 120) {
      status = 'warning';
      if (heartRate < 40 || heartRate > 150) {
        status = 'danger';
        
        // 緊急通知（後で実装）
        await logSecurityEvent(userId, 'ABNORMAL_HEART_RATE', {
          heartRate,
          status,
          ipAddress: context.rawRequest.ip
        });
      }
    }

    // Firestore に保存
    const heartRateRef = await db.collection('heartRates').add({
      userId,
      heartRate,
      timestamp: admin.firestore.Timestamp.fromMillis(timestamp),
      status,
      source,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      validated: true, // サーバーサイド検証済みフラグ
      validatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      success: true,
      documentId: heartRateRef.id,
      status
    };
  } catch (error) {
    console.error('Save heart rate error:', error);
    throw new functions.https.HttpsError(
      'internal',
      '心拍数データの保存に失敗しました'
    );
  }
});

/**
 * ユーザープロフィール更新（サーバーサイド検証付き）
 */
exports.updateUserProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '認証が必要です'
    );
  }

  const userId = context.auth.uid;

  // 入力値検証
  const { error, value } = validationSchemas.userProfile.validate(data);
  if (error) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '無効な入力データです',
      error.details.map(d => d.message).join(', ')
    );
  }

  try {
    // XSS 対策
    const sanitizeInput = (input) => {
      if (typeof input !== 'string') return input;
      return input
        .trim()
        .replace(/[<>]/g, '')
        .slice(0, 200);
    };

    const { name, bio, profileImageUrl } = value;
    
    // ユーザーデータ更新
    await db.collection('users').doc(userId).update({
      name: sanitizeInput(name),
      bio: bio ? sanitizeInput(bio) : null,
      profileImageUrl: profileImageUrl || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Authentication プロフィールも更新
    await auth.updateUser(userId, {
      displayName: sanitizeInput(name)
    });

    // 監査ログ
    await logSecurityEvent(userId, 'PROFILE_UPDATE', {
      ipAddress: context.rawRequest.ip
    });

    return {
      success: true,
      message: 'プロフィールを更新しました'
    };
  } catch (error) {
    console.error('Update profile error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'プロフィールの更新に失敗しました'
    );
  }
});

/**
 * パスワード変更（サーバーサイド検証付き）
 */
exports.changePassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '認証が必要です'
    );
  }

  const userId = context.auth.uid;

  // 入力値検証
  const { error } = validationSchemas.passwordChange.validate(data);
  if (error) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '無効なパスワードです',
      error.details.map(d => d.message).join(', ')
    );
  }

  try {
    const { currentPassword, newPassword } = data;

    // 現在のパスワード検証（再認証）
    // 注意: 実際の実装では、クライアントから現在のパスワードを受け取って検証
    // この例では簡略化のためスキップ

    // パスワードハッシュ生成（PBKDF2）
    const bcrypt = require('bcrypt');
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // セキュリティ設定を更新
    await db.collection('security').doc(userId).update({
      passwordHash: hashedPassword,
      passwordAlgorithm: 'bcrypt',
      passwordIterations: saltRounds,
      lastPasswordChange: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 監査ログ
    await logSecurityEvent(userId, 'PASSWORD_CHANGE', {
      ipAddress: context.rawRequest.ip
    });

    return {
      success: true,
      message: 'パスワードを変更しました'
    };
  } catch (error) {
    console.error('Change password error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'パスワードの変更に失敗しました'
    );
  }
});

/**
 * 共有リクエスト送信
 */
exports.sendShareRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '認証が必要です'
    );
  }

  const fromUserId = context.auth.uid;

  // 入力値検証
  const { error, value } = validationSchemas.shareRequest.validate(data);
  if (error) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '無効な入力データです',
      error.details.map(d => d.message).join(', ')
    );
  }

  try {
    const { toUserEmail, message } = value;

    // 受信者ユーザーを検索
    const usersSnapshot = await db.collection('users')
      .where('email', '==', toUserEmail)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      throw new functions.https.HttpsError(
        'not-found',
        '指定されたメールアドレスのユーザーが見つかりません'
      );
    }

    const toUserDoc = usersSnapshot.docs[0];
    const toUserId = toUserDoc.id;

    // 自分自身へのリクエストを防ぐ
    if (fromUserId === toUserId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        '自分自身には共有リクエストを送信できません'
      );
    }

    // 既存のリクエストをチェック
    const existingRequest = await db.collection('shareRequests')
      .where('fromUserId', '==', fromUserId)
      .where('toUserId', '==', toUserId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingRequest.empty) {
      throw new functions.https.HttpsError(
        'already-exists',
        '既に共有リクエストを送信しています'
      );
    }

    // 共有リクエストを保存
    const requestRef = await db.collection('shareRequests').add({
      fromUserId,
      toUserId,
      toUserEmail,
      status: 'pending',
      message: message || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      respondedAt: null
    });

    // 監査ログ
    await logSecurityEvent(fromUserId, 'SHARE_REQUEST_SENT', {
      toUserId,
      toUserEmail,
      ipAddress: context.rawRequest.ip
    });

    return {
      success: true,
      requestId: requestRef.id,
      message: '共有リクエストを送信しました'
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Send share request error:', error);
    throw new functions.https.HttpsError(
      'internal',
      '共有リクエストの送信に失敗しました'
    );
  }
});

/**
 * 共有リクエスト応答
 */
exports.respondToShareRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '認証が必要です'
    );
  }

  const userId = context.auth.uid;

  const schema = Joi.object({
    requestId: Joi.string().required(),
    status: Joi.string().valid('accepted', 'rejected').required()
  });

  const { error, value } = schema.validate(data);
  if (error) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '無効な入力データです'
    );
  }

  try {
    const { requestId, status } = value;

    const requestRef = db.collection('shareRequests').doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        '共有リクエストが見つかりません'
      );
    }

    const requestData = requestDoc.data();

    // 受信者本人か確認
    if (requestData.toUserId !== userId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'このリクエストに応答する権限がありません'
      );
    }

    // 既に回答済みか確認
    if (requestData.status !== 'pending') {
      throw new functions.https.HttpsError(
        'already-exists',
        '既に回答済みのリクエストです'
      );
    }

    // ステータス更新
    await requestRef.update({
      status,
      respondedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 承認された場合、共有グループに追加
    if (status === 'accepted') {
      // 共有グループの作成または更新
      const shareGroupsRef = db.collection('shareGroups');
      const existingGroup = await shareGroupsRef
        .where('ownerId', '==', requestData.fromUserId)
        .limit(1)
        .get();

      if (existingGroup.empty) {
        // 新しい共有グループを作成
        await shareGroupsRef.add({
          ownerId: requestData.fromUserId,
          memberIds: [requestData.fromUserId, userId],
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // 既存のグループにメンバーを追加
        const groupDoc = existingGroup.docs[0];
        const groupData = groupDoc.data();
        if (!groupData.memberIds.includes(userId)) {
          await groupDoc.ref.update({
            memberIds: admin.firestore.FieldValue.arrayUnion(userId)
          });
        }
      }
    }

    // 監査ログ
    await logSecurityEvent(userId, 'SHARE_REQUEST_RESPONDED', {
      requestId,
      status,
      ipAddress: context.rawRequest.ip
    });

    return {
      success: true,
      message: status === 'accepted' ? '共有を承認しました' : '共有を拒否しました'
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Respond to share request error:', error);
    throw new functions.https.HttpsError(
      'internal',
      '共有リクエストへの回答に失敗しました'
    );
  }
});

/**
 * セキュリティ設定初期化
 */
exports.initializeSecuritySettings = functions.auth.user().onCreate(async (user) => {
  try {
    const bcrypt = require('bcrypt');
    const saltRounds = 12;
    
    // ランダムなソルト生成
    const salt = await bcrypt.genSalt(saltRounds);

    // セキュリティ設定を初期化
    await db.collection('security').doc(user.uid).set({
      userId: user.uid,
      userEmail: user.email,
      salt,
      algorithms: ['SHA-256', 'SHA-512', 'PBKDF2', 'bcrypt'],
      otpEnabled: false,
      gssApiEnabled: false,
      transactionSigningEnabled: false,
      twoFactorEnabled: false,
      passwordAlgorithm: 'bcrypt',
      passwordIterations: saltRounds,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSecurityUpdate: admin.firestore.FieldValue.serverTimestamp()
    });

    // ユーザープロフィールも初期化
    await db.collection('users').doc(user.uid).set({
      name: user.displayName || '',
      email: user.email,
      isEmailVerified: user.emailVerified,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: null,
      profileImageUrl: user.photoURL || null
    });

    console.log(`Security settings initialized for user: ${user.uid}`);
  } catch (error) {
    console.error('Initialize security settings error:', error);
  }
});

/**
 * ユーザー削除時のクリーンアップ
 */
exports.cleanupUserData = functions.auth.user().onDelete(async (user) => {
  try {
    const userId = user.uid;
    const batch = db.batch();

    // ユーザーデータ削除
    batch.delete(db.collection('users').doc(userId));
    
    // セキュリティ設定削除
    batch.delete(db.collection('security').doc(userId));

    // 心拍データを非同期で削除（大量のデータがある可能性）
    const heartRatesRef = db.collection('heartRates');
    const heartRatesSnapshot = await heartRatesRef
      .where('userId', '==', userId)
      .get();

    heartRatesSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    console.log(`User data cleaned up for user: ${userId}`);
  } catch (error) {
    console.error('Cleanup user data error:', error);
  }
});

/**
 * 定期的なセキュリティ監査（スケジュール関数）
 */
exports.securityAudit = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    try {
      const now = Date.now();
      const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);

      // 1週間以上前のレート制限データをクリーンアップ
      const rateLimitsRef = db.collection('rate_limits');
      const oldRateLimits = await rateLimitsRef
        .where('updatedAt', '<', new Date(oneWeekAgo).toISOString())
        .get();

      const batch = db.batch();
      oldRateLimits.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // 有効期限切れの共有リクエストをクリーンアップ（30日以上）
      const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
      const shareRequestsRef = db.collection('shareRequests');
      const oldRequests = await shareRequestsRef
        .where('createdAt', '<', new Date(thirtyDaysAgo).toISOString())
        .where('status', '==', 'pending')
        .get();

      const requestBatch = db.batch();
      oldRequests.forEach(doc => {
        requestBatch.delete(doc.ref);
      });
      await requestBatch.commit();

      console.log('Security audit completed successfully');
    } catch (error) {
      console.error('Security audit error:', error);
    }
  });

/**
 * 異常なログイン試行の検出
 */
exports.detectSuspiciousActivity = functions.auth.user().onCreate(async (user) => {
  try {
    // 短時間に複数のアカウントが作成されていないか確認
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const recentUsers = await auth.listUsers(100);
    
    const suspiciousCount = recentUsers.users.filter(u => {
      const userCreatedAt = new Date(u.metadata.creationTime).getTime();
      return userCreatedAt > oneHourAgo;
    }).length;

    if (suspiciousCount > 10) {
      // 管理者に通知（後で実装）
      await logSecurityEvent('system', 'SUSPICIOUS_ACTIVITY', {
        type: 'mass_account_creation',
        count: suspiciousCount,
        threshold: 10
      });
    }
  } catch (error) {
    console.error('Detect suspicious activity error:', error);
  }
});