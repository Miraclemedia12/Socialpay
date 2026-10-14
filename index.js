const admin = require('firebase-admin');
const crypto = require('node:crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
const db = admin.firestore();
const F = admin.firestore.FieldValue;

// Set these values when Firebase prompts during deployment. Do not hardcode a
// bank account that you do not control. The account details are returned only
// to an authenticated user with a payment request.
const PAYMENT_BANK_NAME = defineString('PAYMENT_BANK_NAME');
const PAYMENT_ACCOUNT_NAME = defineString('PAYMENT_ACCOUNT_NAME');
const PAYMENT_ACCOUNT_NUMBER = defineString('PAYMENT_ACCOUNT_NUMBER');
const PAYMENT_TRANSFER_FEE = defineString('PAYMENT_TRANSFER_FEE', { default: '400' });

const PACKAGES = {
  standard: { key: 'standard', name: 'Standard', price: 15000, bonus: 20000 },
  premium: { key: 'premium', name: 'Premium', price: 30000, bonus: 50000 }
};
const money = n => Math.round(Number(n) * 100) / 100;
const fail = (code, message) => { throw new HttpsError(code, message); };
function uidOf(req) { if (!req.auth?.uid) fail('unauthenticated', 'Please sign in to continue.'); return req.auth.uid; }
async function assertAdmin(uid) {
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists || snap.data()?.enabled === false) fail('permission-denied', 'Administrator access is required.');
}
function cleanString(v, max = 120) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function validHttpsUrl(v) { try { const u = new URL(v); return u.protocol === 'https:'; } catch { return false; } }
function accountConfig() {
  const bank = cleanString(PAYMENT_BANK_NAME.value(), 80);
  const name = cleanString(PAYMENT_ACCOUNT_NAME.value(), 120);
  const number = cleanString(PAYMENT_ACCOUNT_NUMBER.value(), 30);
  const fee = Number(PAYMENT_TRANSFER_FEE.value());
  if (!bank || bank.startsWith('SET_') || !name || name.startsWith('SET_') || !/^\d{10,12}$/.test(number)) {
    fail('failed-precondition', 'Payment bank details are not configured yet. Add your real bank name, account name, and account number to Firebase Functions parameters before accepting payments.');
  }
  if (!Number.isFinite(fee) || fee < 0 || fee > 10000) fail('failed-precondition', 'The configured transfer fee is invalid.');
  return { bankName: bank, accountName: name, accountNumber: number, transferFee: money(fee) };
}

exports.registerUserProfile = onCall(async req => {
  const uid = uidOf(req);
  const firstName = cleanString(req.data?.firstName, 50);
  const lastName = cleanString(req.data?.lastName, 50);
  const username = cleanString(req.data?.username, 24).replace(/^@/, '');
  const email = cleanString(req.auth.token.email, 180).toLowerCase();
  const phone = cleanString(req.data?.phone, 25);
  const referralInput = cleanString(req.data?.referralCode, 20).toUpperCase();
  const planKey = cleanString(req.data?.plan, 20).toLowerCase();
  if (firstName.length < 1 || lastName.length < 1) fail('invalid-argument', 'Enter your first and last name.');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) fail('invalid-argument', 'Username must be 3–24 letters, numbers, or underscores.');
  if (!PACKAGES[planKey]) fail('invalid-argument', 'Select a membership package.');
  const usernameKey = username.toLowerCase();
  const userRef = db.doc(`users/${uid}`);
  const publicRef = db.doc(`publicProfiles/${uid}`);
  const usernameRef = db.doc(`usernames/${usernameKey}`);
  const statsRef = db.doc('publicStats/summary');
  const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  let referrerUid = null;
  if (referralInput) {
    const codeSnap = await db.doc(`referralCodes/${referralInput}`).get();
    if (codeSnap.exists && codeSnap.data().uid !== uid) referrerUid = codeSnap.data().uid;
  }
  await db.runTransaction(async tx => {
    const [userSnap, usernameSnap, codeSnap] = await Promise.all([
      tx.get(userRef), tx.get(usernameRef), tx.get(db.doc(`referralCodes/${referralCode}`))
    ]);
    if (userSnap.exists) return;
    if (usernameSnap.exists) fail('already-exists', 'That username is already taken. Try another one.');
    if (codeSnap.exists) fail('aborted', 'Could not generate a referral code. Please retry.');
    const now = F.serverTimestamp();
    tx.create(userRef, {
      uid, firstName, lastName, username, usernameLower: usernameKey, email, phone,
      role: 'user', walletBalance: 0, isActivated: false, activationStatus: 'pending',
      selectedPackage: planKey, referralCode, referralCount: 0, referredBy: referrerUid,
      createdAt: now, updatedAt: now
    });
    tx.create(publicRef, { uid, firstName, lastName, username, usernameLower: usernameKey, createdAt: now });
    tx.create(usernameRef, { uid, createdAt: now });
    tx.create(db.doc(`referralCodes/${referralCode}`), { uid, createdAt: now });
    tx.set(statsRef, { activeUsers: F.increment(1), totalPaidOut: F.increment(0), paidWithdrawals: F.increment(0), updatedAt: now }, { merge: true });
    if (referrerUid) {
      tx.set(db.doc(`referrals/${referrerUid}/members/${uid}`), {
        uid, username, status: 'registered', createdAt: now
      });
      tx.set(db.doc(`users/${referrerUid}`), { referralCount: F.increment(1), updatedAt: now }, { merge: true });
    }
  });
  return { success: true, referralCode };
});

exports.createPaymentRequest = onCall(async req => {
  const uid = uidOf(req);
  const profileRef = db.doc(`users/${uid}`);
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) fail('failed-precondition', 'Your account profile is missing. Sign out and register again or contact support.');
  const profile = profileSnap.data();
  const type = cleanString(req.data?.type || 'activation', 20);
  const details = accountConfig();
  let packageInfo = null;
  let amount = 0;
  let bonus = 0;
  if (type === 'activation') {
    const planKey = cleanString(req.data?.plan || profile.selectedPackage, 20).toLowerCase();
    packageInfo = PACKAGES[planKey];
    if (!packageInfo) fail('invalid-argument', 'Select a valid activation package.');
    if (profile.isActivated) fail('failed-precondition', 'Your account is already activated. Use Add Funds to top up your wallet.');
    amount = packageInfo.price;
    bonus = packageInfo.bonus;
  } else if (type === 'topup') {
    amount = money(req.data?.amount);
    if (!profile.isActivated) fail('failed-precondition', 'Activate your account before adding wallet funds.');
    if (!Number.isFinite(amount) || amount < 1000 || amount > 1000000) fail('invalid-argument', 'Enter a top-up amount between ₦1,000 and ₦1,000,000.');
  } else {
    fail('invalid-argument', 'Unsupported payment type.');
  }
  const totalDue = money(amount + details.transferFee);
  const paymentRef = db.collection('payments').doc();
  const payment = {
    id: paymentRef.id, uid, type, packageKey: packageInfo?.key || null,
    packageName: packageInfo?.name || (type === 'topup' ? 'Wallet top-up' : null),
    amount, transferFee: details.transferFee, totalDue, bonus,
    bankName: details.bankName, accountName: details.accountName,
    accountNumber: details.accountNumber, status: 'pending',
    createdAt: F.serverTimestamp(), userReportedAt: null, reviewedAt: null
  };
  await paymentRef.set(payment);
  return { success: true, paymentId: paymentRef.id, payment: { ...payment, createdAt: null } };
});

exports.reportPaymentTransfer = onCall(async req => {
  const uid = uidOf(req);
  const paymentId = cleanString(req.data?.paymentId, 100);
  if (!paymentId) fail('invalid-argument', 'Missing payment reference.');
  const ref = db.doc(`payments/${paymentId}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().uid !== uid) fail('not-found', 'Payment request not found.');
    if (!['pending', 'reported'].includes(snap.data().status)) fail('failed-precondition', 'This payment has already been reviewed.');
    tx.update(ref, { status: 'reported', userReportedAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
  });
  return { success: true };
});

exports.adminReviewPayment = onCall(async req => {
  const adminUid = uidOf(req); await assertAdmin(adminUid);
  const paymentId = cleanString(req.data?.paymentId, 100);
  const decision = cleanString(req.data?.decision, 20);
  const note = cleanString(req.data?.note, 500);
  if (!paymentId || !['approve', 'reject'].includes(decision)) fail('invalid-argument', 'Invalid payment review request.');
  const paymentRef = db.doc(`payments/${paymentId}`);
  const ledgerRef = db.collection('ledger').doc();
  const statsRef = db.doc('publicStats/summary');
  await db.runTransaction(async tx => {
    const paymentSnap = await tx.get(paymentRef);
    if (!paymentSnap.exists) fail('not-found', 'Payment request not found.');
    const payment = paymentSnap.data();
    if (!['pending', 'reported'].includes(payment.status)) fail('failed-precondition', 'This payment was already reviewed.');
    const userRef = db.doc(`users/${payment.uid}`);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) fail('not-found', 'Member profile not found.');
    if (decision === 'approve' && payment.type === 'activation' && userSnap.data().isActivated) {
      fail('failed-precondition', 'This member is already activated. Reject the duplicate payment request instead of crediting a second welcome bonus.');
    }
    const now = F.serverTimestamp();
    const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
    tx.update(paymentRef, { status: nextStatus, reviewedAt: now, reviewedBy: adminUid, reviewNote: note, updatedAt: now });
    if (decision === 'approve') {
      const credit = payment.type === 'activation' ? payment.bonus : payment.amount;
      const extra = payment.type === 'activation' ? {
        isActivated: true, activationStatus: 'active', selectedPackage: payment.packageKey,
        activatedAt: now
      } : {};
      tx.update(userRef, { walletBalance: F.increment(credit), ...extra, updatedAt: now });
      tx.set(ledgerRef, { uid: payment.uid, type: payment.type === 'activation' ? 'activation_bonus' : 'topup', amount: credit, status: 'completed', referenceId: paymentId, description: payment.type === 'activation' ? `${payment.packageName} activation bonus` : 'Wallet top-up', createdAt: now });
    }
  });
  return { success: true, status: decision === 'approve' ? 'approved' : 'rejected' };
});

exports.requestWithdrawal = onCall(async req => {
  const uid = uidOf(req);
  const amount = money(req.data?.amount);
  const bankName = cleanString(req.data?.bankName, 80);
  const accountName = cleanString(req.data?.accountName, 120);
  const accountNumber = cleanString(req.data?.accountNumber, 20);
  if (!Number.isFinite(amount) || amount < 1000 || amount > 1000000) fail('invalid-argument', 'Withdrawal must be between ₦1,000 and ₦1,000,000.');
  if (bankName.length < 2 || accountName.length < 2 || !/^\d{10,12}$/.test(accountNumber)) fail('invalid-argument', 'Enter valid bank details and a 10–12 digit account number.');
  const userRef = db.doc(`users/${uid}`);
  const withdrawalRef = db.collection('withdrawals').doc();
  const ledgerRef = db.collection('ledger').doc();
  await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) fail('not-found', 'Member profile not found.');
    const u = userSnap.data();
    if (!u.isActivated) fail('failed-precondition', 'Activate your account before withdrawing.');
    if (money(u.walletBalance || 0) < amount) fail('failed-precondition', 'Your available balance is too low for this withdrawal.');
    const now = F.serverTimestamp();
    tx.update(userRef, { walletBalance: F.increment(-amount), updatedAt: now });
    tx.create(withdrawalRef, {
      uid, displayName: u.username, amount, bankName, accountName, accountNumber,
      bankLabel: bankName, status: 'pending', createdAt: now, reviewedAt: null, paidAt: null
    });
    tx.create(ledgerRef, { uid, type: 'withdrawal', amount: -amount, status: 'pending', referenceId: withdrawalRef.id, description: `Withdrawal request to ${bankName}`, createdAt: now });
  });
  return { success: true, withdrawalId: withdrawalRef.id };
});

exports.adminReviewWithdrawal = onCall(async req => {
  const adminUid = uidOf(req); await assertAdmin(adminUid);
  const withdrawalId = cleanString(req.data?.withdrawalId, 100);
  const decision = cleanString(req.data?.decision, 20);
  const note = cleanString(req.data?.note, 500);
  if (!withdrawalId || !['paid', 'reject'].includes(decision)) fail('invalid-argument', 'Invalid withdrawal review request.');
  const wRef = db.doc(`withdrawals/${withdrawalId}`);
  const statsRef = db.doc('publicStats/summary');
  const payoutRef = db.doc(`payouts/${withdrawalId}`);
  const refundLedgerRef = db.collection('ledger').doc();
  await db.runTransaction(async tx => {
    const wSnap = await tx.get(wRef);
    if (!wSnap.exists) fail('not-found', 'Withdrawal request not found.');
    const w = wSnap.data();
    if (w.status !== 'pending') fail('failed-precondition', 'This withdrawal has already been reviewed.');
    const userRef = db.doc(`users/${w.uid}`);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) fail('not-found', 'Member profile not found.');
    const now = F.serverTimestamp();
    if (decision === 'paid') {
      tx.update(wRef, { status: 'paid', reviewedAt: now, reviewedBy: adminUid, paidAt: now, reviewNote: note });
      tx.set(payoutRef, { uid: w.uid, displayName: w.displayName || userSnap.data().username, amount: w.amount, bankLabel: w.bankLabel || w.bankName, status: 'paid', paidAt: now, withdrawalId });
      tx.set(statsRef, { totalPaidOut: F.increment(w.amount), paidWithdrawals: F.increment(1), updatedAt: now }, { merge: true });
      tx.set(db.collection('ledger').doc(), { uid: w.uid, type: 'withdrawal_paid', amount: 0, status: 'completed', referenceId: withdrawalId, description: 'Withdrawal marked paid', createdAt: now });
    } else {
      tx.update(wRef, { status: 'rejected', reviewedAt: now, reviewedBy: adminUid, reviewNote: note });
      tx.update(userRef, { walletBalance: F.increment(w.amount), updatedAt: now });
      tx.create(refundLedgerRef, { uid: w.uid, type: 'withdrawal_refund', amount: w.amount, status: 'completed', referenceId: withdrawalId, description: 'Returned after withdrawal rejection', createdAt: now });
    }
  });
  return { success: true, status: decision === 'paid' ? 'paid' : 'rejected' };
});

exports.submitTaskProof = onCall(async req => {
  const uid = uidOf(req);
  const taskId = cleanString(req.data?.taskId, 100);
  const proofUrl = cleanString(req.data?.proofUrl, 1000);
  const note = cleanString(req.data?.note, 800);
  if (!taskId || !validHttpsUrl(proofUrl)) fail('invalid-argument', 'Enter a valid HTTPS link to your proof or completed social post.');
  const taskRef = db.doc(`tasks/${taskId}`);
  const profileRef = db.doc(`users/${uid}`);
  const submissionRef = db.doc(`taskSubmissions/${uid}_${taskId}`);
  await db.runTransaction(async tx => {
    const [taskSnap, profileSnap, submissionSnap] = await Promise.all([tx.get(taskRef), tx.get(profileRef), tx.get(submissionRef)]);
    if (!taskSnap.exists || taskSnap.data().status !== 'active') fail('not-found', 'This task is no longer available.');
    if (!profileSnap.exists || !profileSnap.data().isActivated) fail('failed-precondition', 'Activate your account before submitting paid tasks.');
    if (submissionSnap.exists) fail('already-exists', 'You have already submitted this task.');
    const task = taskSnap.data();
    tx.create(submissionRef, { uid, taskId, taskTitle: task.title, reward: task.reward, proofUrl, note, status: 'pending', createdAt: F.serverTimestamp(), reviewedAt: null });
  });
  return { success: true };
});

exports.adminReviewTaskSubmission = onCall(async req => {
  const adminUid = uidOf(req); await assertAdmin(adminUid);
  const submissionId = cleanString(req.data?.submissionId, 130);
  const decision = cleanString(req.data?.decision, 20);
  const note = cleanString(req.data?.note, 500);
  if (!submissionId || !['approve', 'reject'].includes(decision)) fail('invalid-argument', 'Invalid submission review request.');
  const subRef = db.doc(`taskSubmissions/${submissionId}`);
  const ledgerRef = db.collection('ledger').doc();
  await db.runTransaction(async tx => {
    const subSnap = await tx.get(subRef);
    if (!subSnap.exists) fail('not-found', 'Task submission not found.');
    const s = subSnap.data();
    if (s.status !== 'pending') fail('failed-precondition', 'This submission has already been reviewed.');
    const userRef = db.doc(`users/${s.uid}`);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) fail('not-found', 'Member profile not found.');
    const now = F.serverTimestamp();
    tx.update(subRef, { status: decision === 'approve' ? 'approved' : 'rejected', reviewedAt: now, reviewedBy: adminUid, reviewNote: note });
    if (decision === 'approve') {
      tx.update(userRef, { walletBalance: F.increment(s.reward), updatedAt: now });
      tx.create(ledgerRef, { uid: s.uid, type: 'task_reward', amount: s.reward, status: 'completed', referenceId: submissionId, description: `Reward: ${s.taskTitle}`, createdAt: now });
    }
  });
  return { success: true, status: decision === 'approve' ? 'approved' : 'rejected' };
});

exports.adminCreateTask = onCall(async req => {
  const adminUid = uidOf(req); await assertAdmin(adminUid);
  const title = cleanString(req.data?.title, 120);
  const platform = cleanString(req.data?.platform, 50);
  const category = cleanString(req.data?.category || 'social', 30);
  const instructions = cleanString(req.data?.instructions, 1500);
  const actionUrl = cleanString(req.data?.actionUrl, 1000);
  const reward = money(req.data?.reward);
  if (title.length < 4 || platform.length < 2 || instructions.length < 8 || !validHttpsUrl(actionUrl)) fail('invalid-argument', 'Provide a title, platform, instructions, and valid HTTPS task link.');
  if (!Number.isFinite(reward) || reward < 10 || reward > 100000) fail('invalid-argument', 'Task reward must be between ₦10 and ₦100,000.');
  const ref = db.collection('tasks').doc();
  await ref.set({ title, platform, category, instructions, actionUrl, reward, status: 'active', createdBy: adminUid, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
  return { success: true, taskId: ref.id };
});

exports.adminSetTaskStatus = onCall(async req => {
  const adminUid = uidOf(req); await assertAdmin(adminUid);
  const taskId = cleanString(req.data?.taskId, 100);
  const status = cleanString(req.data?.status, 20);
  if (!taskId || !['active', 'paused', 'archived'].includes(status)) fail('invalid-argument', 'Invalid task status.');
  await db.doc(`tasks/${taskId}`).update({ status, updatedAt: F.serverTimestamp(), updatedBy: adminUid });
  return { success: true };
});

exports.updateUserProfile = onCall(async req => {
  const uid = uidOf(req);
  const firstName = cleanString(req.data?.firstName, 50);
  const lastName = cleanString(req.data?.lastName, 50);
  const phone = cleanString(req.data?.phone, 25);
  if (!firstName || !lastName) fail('invalid-argument', 'First and last name are required.');
  const userRef = db.doc(`users/${uid}`);
  const publicRef = db.doc(`publicProfiles/${uid}`);
  await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) fail('not-found', 'Member profile not found.');
    tx.update(userRef, { firstName, lastName, phone, updatedAt: F.serverTimestamp() });
    tx.set(publicRef, { firstName, lastName, username: userSnap.data().username, usernameLower: userSnap.data().usernameLower, uid }, { merge: true });
  });
  return { success: true };
});

exports.sendFriendRequest = onCall(async req => {
  const uid = uidOf(req);
  const targetUid = cleanString(req.data?.targetUid, 128);
  if (!targetUid || targetUid === uid) fail('invalid-argument', 'Choose another member.');
  const [targetSnap, ownSnap] = await Promise.all([db.doc(`publicProfiles/${targetUid}`).get(), db.doc(`users/${uid}`).get()]);
  if (!targetSnap.exists || !ownSnap.exists) fail('not-found', 'Member not found.');
  const id = `${uid}_${targetUid}`;
  const requestRef = db.doc(`friendRequests/${id}`);
  const existing = await requestRef.get();
  if (existing.exists && existing.data().status === 'pending') fail('already-exists', 'Your request is already pending.');
  await requestRef.set({ fromUid: uid, fromUsername: ownSnap.data().username, toUid: targetUid, toUsername: targetSnap.data().username, status: 'pending', createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
  return { success: true };
});

exports.respondFriendRequest = onCall(async req => {
  const uid = uidOf(req);
  const requestId = cleanString(req.data?.requestId, 260);
  const decision = cleanString(req.data?.decision, 20);
  if (!requestId || !['accept', 'decline'].includes(decision)) fail('invalid-argument', 'Invalid friend request.');
  const reqRef = db.doc(`friendRequests/${requestId}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(reqRef);
    if (!snap.exists || snap.data().toUid !== uid) fail('permission-denied', 'This friend request is not addressed to you.');
    if (snap.data().status !== 'pending') fail('failed-precondition', 'This request has already been handled.');
    const r = snap.data();
    tx.update(reqRef, { status: decision === 'accept' ? 'accepted' : 'declined', updatedAt: F.serverTimestamp() });
    if (decision === 'accept') {
      tx.set(db.doc(`friendships/${uid}/members/${r.fromUid}`), { uid: r.fromUid, username: r.fromUsername, since: F.serverTimestamp() });
      tx.set(db.doc(`friendships/${r.fromUid}/members/${uid}`), { uid, username: r.toUsername, since: F.serverTimestamp() });
    }
  });
  return { success: true };
});

exports.getPublicStats = onCall(async () => {
  const snap = await db.doc('publicStats/summary').get();
  const d = snap.exists ? snap.data() : {};
  return { activeUsers: Number(d.activeUsers || 0), totalPaidOut: Number(d.totalPaidOut || 0), paidWithdrawals: Number(d.paidWithdrawals || 0) };
});
