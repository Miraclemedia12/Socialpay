import { auth, db, functions, firebaseConfigured } from './firebase.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut, deleteUser, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, addDoc, query, where, orderBy, limit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';

const root = document.getElementById('app-root');
const page = document.body.dataset.page || 'index';
const protectedPages = new Set(['dashboard','payment','payments','tasks','submit-task','submissions','wallet','withdraw','friends','chat','ads','sponsored','status','meta-ai','referrals','profile','admin']);
let currentUser = null;
let currentProfile = null;
let currentIsAdmin = false;
let busy = false;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const nNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const naira = value => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(nNumber(value));
const shortDate = value => {
  if (!value) return '—';
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});
};
const dateTime = value => {
  if (!value) return '—';
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-NG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
};
const statusPill = status => {
  const s = String(status || 'pending').toLowerCase();
  const kind = ['approved','active','paid','completed','accepted'].includes(s) ? '' : ['rejected','declined','archived'].includes(s) ? 'pill-danger' : ['reported','pending','paused'].includes(s) ? 'pill-warning' : 'pill-muted';
  return `<span class="pill ${kind}">${esc(s.replaceAll('_',' '))}</span>`;
};
const emptyState = (title, description, icon='↗') => `<div class="empty-state"><div class="empty-icon">${icon}</div><strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;
const toast = (message, type='success') => {
  let region = document.querySelector('.toast-region');
  if (!region) { region = document.createElement('div'); region.className='toast-region'; region.setAttribute('aria-live','polite'); document.body.appendChild(region); }
  const item = document.createElement('div'); item.className=`toast ${type}`; item.textContent=message; region.appendChild(item);
  window.setTimeout(() => item.remove(), 5000);
};
const resultData = response => response?.data ?? response ?? {};
async function callFn(name, payload={}) {
  if (!firebaseConfigured || !functions) throw new Error('Firebase is not configured yet. Add your Firebase web settings in src/firebase.js and deploy the Cloud Functions.');
  const result = await httpsCallable(functions, name)(payload);
  return resultData(result);
}
async function getProfile(uid=currentUser?.uid) {
  if (!firebaseConfigured || !uid) return null;
  try { const snap=await getDoc(doc(db,'users',uid)); return snap.exists()?snap.data():null; }
  catch (err) { console.error(err); return null; }
}
async function getRows(name, constraints=[]) {
  if (!firebaseConfigured || !db) return [];
  try {
    const q = query(collection(db,name), ...constraints);
    const snaps=await getDocs(q);
    return snaps.docs.map(s=>({id:s.id,...s.data()}));
  } catch(err) { console.warn(`Could not load ${name}`,err); return []; }
}
function getRow(id, name) {
  if (!id || !firebaseConfigured || !db) return Promise.resolve(null);
  return getDoc(doc(db,name,id)).then(s=>s.exists()?{id:s.id,...s.data()}:null).catch(()=>null);
}
function setupBanner() {
  return firebaseConfigured ? '' : `<div class="config-banner">Setup required: add your Firebase web config and deploy the Firebase backend to enable authentication, live records, task rewards, and payments.</div>`;
}
function brand() { return `<a class="brand" href="index.html" aria-label="SocialPay home"><span class="brand-mark">SS</span><span>SocialPay <b>SS</b></span></a>`; }
function publicHeader() {
  return `<header class="site-header"><div class="container nav-inner">${brand()}<nav class="nav-links" aria-label="Main navigation"><a href="index.html#features">Features</a><a href="index.html#how-it-works">How It Works</a><a href="payouts.html">Live Payouts</a><a href="faq.html">FAQ</a></nav><div class="nav-actions"><a class="btn btn-quiet" href="login.html">Sign In</a><a class="btn btn-primary" href="register.html">Get Started</a></div></div></header>`;
}
const sidebarGroups = [
  {label:'Workspace', links:[['dashboard','⌂','Overview','dashboard.html'],['tasks','▣','Jobs & Tasks','tasks.html'],['sponsored','✦','Sponsored','sponsored.html'],['status','◉','Status Updates','status.html'],['meta-ai','✧','Meta AI','meta-ai.html']]},
  {label:'Community', links:[['chat','▤','Community Chat','chat.html'],['friends','♧','Friends','friends.html'],['ads','▱','Ads & Campaigns','ads.html']]},
  {label:'Wallet', links:[['wallet','₦','Wallet & History','wallet.html'],['withdraw','↗','Withdraw','withdraw.html'],['payments','⇄','Payments','payments.html'],['referrals','♧','Refer & Earn','referrals.html'],['submissions','☷','My Submissions','submissions.html']]},
  {label:'Account', links:[['profile','⚙','Profile Settings','profile.html']]}
];
function appHeader() {
  const name = currentProfile?.username || currentUser?.email?.split('@')[0] || 'Member';
  return `<header class="app-header">${brand()}<div class="app-head-right"><span class="muted small desktop-only">Signed in as <strong>${esc(name)}</strong></span><div class="avatar" aria-hidden="true">${esc(String(name).slice(0,1).toUpperCase())}</div><button class="btn btn-secondary btn-sm" data-action="logout">Logout</button></div></header>`;
}
function sideNav() {
  return `<aside class="sidebar">${sidebarGroups.map(group=>`<div class="side-label">${esc(group.label)}</div>${group.links.map(([key,icon,label,href])=>`<a class="side-link ${page===key?'active':''}" href="${href}"><span class="side-icon">${icon}</span>${label}</a>`).join('')}`).join('')}<div class="side-label">Public</div><a class="side-link" href="payouts.html"><span class="side-icon">↗</span>Verified Payouts</a><a class="side-link" href="faq.html"><span class="side-icon">?</span>Help & FAQ</a>${currentIsAdmin?'<a class="side-link" href="admin.html"><span class="side-icon">⚑</span>Admin Panel</a>':''}</aside>`;
}
function bottomNav() {
  const links=[['chat','▤','Chat','chat.html'],['friends','♧','Friends','friends.html'],['dashboard','⌂','Home','dashboard.html'],['ads','▱','Ads','ads.html'],['logout','↪','Logout','#']];
  return `<nav class="mobile-bottom" aria-label="Mobile navigation">${links.map(([key,icon,label,href])=>key==='logout'?`<a href="#" data-action="logout"><span>${icon}</span><span>${label}</span></a>`:`<a class="${page===key?'active':''}" href="${href}"><span>${icon}</span><span>${label}</span></a>`).join('')}</nav>`;
}
function shell(title, content) {
  return `${setupBanner()}${appHeader()}<div class="app-layout">${sideNav()}<main class="app-main"><div class="page-head"><div><h1>${esc(title)}</h1><p>Manage your SocialPay activity in one place.</p></div>${page==='dashboard'?'':`<a class="btn btn-secondary" href="dashboard.html">← Overview</a>`}</div>${content}</main></div>${bottomNav()}`;
}
function authShell(title, subtitle, body) {
  return `${setupBanner()}<div class="auth-wrap"><section class="auth-card"><div class="auth-brand">${brand()}</div><h1>${title}</h1><p class="auth-sub">${subtitle}</p>${body}<div class="rule"></div><p class="center small muted"><a class="inline-link" href="index.html">← Back to SocialPay SS</a></p></section></div>`;
}
function publicFooter() {
  return `<footer class="footer"><div class="container footer-inner"><div>© ${new Date().getFullYear()} SocialPay SS. Please complete tasks honestly and review payment terms before paying.</div><div class="row wrap"><a href="payouts.html">Payout history</a><a href="faq.html">Help & FAQ</a><a href="terms.html">Terms</a><a href="privacy.html">Privacy</a><a href="register.html">Create account</a><a href="login.html">Sign in</a></div></div></footer>`;
}
function pageHead(title, description, action='') { return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
function textField(name,label,placeholder='',options={}) {
  const type=options.type||'text'; const required=options.required===false?'':'required'; const value=options.value===undefined?'':`value="${esc(options.value)}"`; const min=options.min?`min="${options.min}"`:''; const autocomplete=options.autocomplete?`autocomplete="${options.autocomplete}"`:'';
  return `<div class="field ${options.full?'full':''}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" placeholder="${esc(placeholder)}" ${required} ${value} ${min} ${autocomplete} ${options.maxlength?`maxlength="${options.maxlength}"`:''} ${options.readonly?'readonly':''}></div>`;
}
function selectField(name,label,items,required=true) { return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}" ${required?'required':''}>${items.map(([value,text])=>`<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></div>`; }
function packageCards(selected='standard') {
  const pkgs=[['standard','STANDARD','₦15,000','₦20,000','Standard package'],['premium','PREMIUM','₦30,000','₦50,000','Popular package']];
  return `<div class="package-grid">${pkgs.map(([key,tag,price,bonus,label])=>`<label class="package-choice"><input type="radio" name="plan" value="${key}" ${selected===key?'checked':''} required><span class="package-inner"><span class="package-top"><span class="eyebrow">${tag}</span>${key==='premium'?'<span class="pill">POPULAR</span>':''}</span><span class="package-price">${price}</span><span class="muted small">${label}</span><span class="form-note" style="display:block;margin-top:11px">Welcome bonus shown after payment approval</span><span class="package-bonus">${bonus}</span></span></label>`).join('')}</div>`;
}
function loginPage() {
  return authShell('Welcome back','Sign in to manage your tasks, wallet, and submissions.',`<form data-form="login" class="stack"><div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" placeholder="you@example.com" autocomplete="email" required></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" placeholder="Enter your password" autocomplete="current-password" required></div><div class="row between"><span class="form-note">Use the email you registered with.</span><a href="#" class="inline-link small" data-action="forgot-password">Forgot password?</a></div><button class="btn btn-primary w-full" type="submit">Sign In →</button><p class="center small muted mb-0">New to SocialPay? <a class="inline-link" href="register.html">Create an account</a></p></form>`);
}
function registerPage() {
  const ref=new URLSearchParams(location.search).get('ref')||'';
  return authShell('Create Account','Choose a membership package, then complete the bank transfer for review.',`<form data-form="register" class="stack"><div><div class="row between"><strong class="small">SELECT MEMBERSHIP PACKAGE</strong><span class="pill">SECURE REVIEW</span></div><div class="mt-2">${packageCards('standard')}</div></div><div class="form-grid">${textField('firstName','First name','Ada',{autocomplete:'given-name'})}${textField('lastName','Last name','Okonkwo',{autocomplete:'family-name'})}${textField('username','Username','Choose a unique username',{full:true,maxlength:24})}${textField('email','Email address','you@example.com',{type:'email',full:true,autocomplete:'email'})}${textField('phone','Phone number','08012345678',{full:true,autocomplete:'tel'})}${textField('password','Password','At least 8 characters',{type:'password',full:true,autocomplete:'new-password'})}${textField('confirmPassword','Confirm password','Enter password again',{type:'password',full:true,autocomplete:'new-password'})}${textField('referralCode','Referral code (optional)','Paste code if you were referred',{full:true,value:ref,required:false})}</div><label class="row small muted" style="align-items:flex-start"><input type="checkbox" name="terms" required style="margin-top:4px;accent-color:var(--green)"><span>I agree to the task rules, payment review process, and privacy terms. I understand package payments must be verified before account activation.</span></label><button class="btn btn-primary w-full" type="submit">Create Account & Continue →</button><p class="center small muted mb-0">Already registered? <a class="inline-link" href="login.html">Sign in</a></p></form>`);
}
function homePage(stats) {
  const users=stats?new Intl.NumberFormat('en-NG').format(stats.activeUsers):'—';
  const paid=stats?naira(stats.totalPaidOut):'—';
  const payouts=stats?new Intl.NumberFormat('en-NG').format(stats.paidWithdrawals):'—';
  return `${setupBanner()}${publicHeader()}<section class="hero"><div class="container hero-grid"><div class="live-chip"><span class="chip-icon">↗</span><div><strong>SocialPay SS</strong><div class="small muted">Verified payment records only</div></div><span class="status-pill">LIVE</span></div><div class="eyebrow">Next-gen social earning platform</div><h1>Monetize Every Click &amp;<br><span>Social Task Instantly.</span></h1><p>Complete micro-tasks, take part in social media campaigns, invite friends, and track rewards from one clean dashboard. Withdrawals are reviewed and recorded transparently.</p><div class="hero-actions"><a href="register.html" class="btn btn-primary">Create Account <span>→</span></a><a href="payouts.html" class="btn btn-secondary">♢ View Live Payouts</a></div><div class="stats-grid"><div class="stat"><strong>${users}</strong><span>Registered members</span></div><div class="stat"><strong>${paid}</strong><span>Verified paid out</span></div><div class="stat"><strong>${payouts}</strong><span>Completed withdrawals</span></div></div></div></section><section class="section" id="features"><div class="container"><div class="center"><div class="eyebrow">Everything in one place</div><h2 class="section-heading">Built for speed, clarity &amp; earnings</h2><p class="section-copy">A simple workspace to find eligible tasks, submit proof, follow review status, and track account activity.</p></div><div class="cards mt-3"><article class="card feature-card"><div class="icon-box">▣</div><h3>Social micro-tasks</h3><p>Browse tasks, review requirements, complete the work, and submit a proof link for approval.</p></article><article class="card feature-card"><div class="icon-box">₦</div><h3>Transparent wallet</h3><p>See approved task rewards, payment bonuses, top-ups, and every balance change in your ledger.</p></article><article class="card feature-card"><div class="icon-box">↗</div><h3>Withdrawal tracking</h3><p>Request a bank payout and follow whether it is pending, paid, or returned for correction.</p></article></div></div></section><section class="section" id="how-it-works"><div class="container"><div class="center"><div class="eyebrow">Simple process</div><h2 class="section-heading">How it works</h2><p class="section-copy">Your dashboard keeps each step visible, with payment approvals handled by an administrator.</p></div><div class="how-grid mt-3"><article class="card"><div class="step-num">01</div><h3>Create your account</h3><p>Register with your details and review the membership package before proceeding.</p></article><article class="card"><div class="step-num">02</div><h3>Complete tasks</h3><p>Follow the task instructions and submit a link or other requested proof.</p></article><article class="card"><div class="step-num">03</div><h3>Track rewards</h3><p>Once a submission is approved, the reward appears in your wallet ledger.</p></article></div></div></section><section class="section" id="faq"><div class="container"><div class="center"><div class="eyebrow">Need to know</div><h2 class="section-heading">Frequently Asked Questions</h2></div>${faqMarkup()}<div class="center mt-3"><a class="btn btn-secondary" href="faq.html">Read all FAQs →</a></div></div></section>${publicFooter()}`;
}
function faqMarkup() {
  const questions=[
    ['What is SocialPay SS?','SocialPay SS is a task and rewards portal where members can browse tasks, submit completion proof, and track approved rewards and withdrawals.'],
    ['How does account activation work?','Choose a package during registration. The transfer details and total due are shown in your payment request. Account activation and any displayed welcome bonus happen only after an administrator verifies the transfer.'],
    ['How do I get paid?','Complete an available task and submit the requested proof. After review and approval, the reward is added to your wallet. You can then request a withdrawal to your own bank account.'],
    ['How long does a withdrawal take?','Withdrawal requests are reviewed by an administrator. Timing depends on review and the actual bank transfer; a request is not marked paid until it has been processed.'],
    ['Are earnings guaranteed?','No. Task availability and rewards can change. Please read each task and package condition carefully, and never pay money you cannot afford to lose.']
  ];
  return `<div class="faq-list">${questions.map(([q,a],i)=>`<details class="faq-item" ${i===0?'open':''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
}
async function payoutsContent() {
  const rows=await getRows('payouts',[where('status','==','paid'),orderBy('paidAt','desc'),limit(30)]);
  const body=rows.length?rows.map((r,i)=>`<tr><td>#${esc(String(i+1).padStart(3,'0'))}</td><td><span class="row"><span class="avatar">${esc(String(r.displayName||'M').slice(0,1).toUpperCase())}</span><strong>${esc(r.displayName||'Member')}</strong></span></td><td class="amount">${naira(r.amount)}</td><td><span class="pill pill-muted">${esc(r.bankLabel||'Bank transfer')}</span></td><td>${shortDate(r.paidAt)}</td></tr>`).join(''):'<tr><td colspan="5">'+emptyState('No verified payouts yet','Once an administrator marks a withdrawal as paid, the public record will appear here.','↗')+'</td></tr>';
  return `${setupBanner()}${publicHeader()}<section class="section-sm"><div class="container">${pageHead('Live Payouts','Public payout history shows only withdrawals that have been confirmed as paid.')}<div class="notice mb-2">For privacy, this list uses usernames and bank names only. Account numbers are never shown.</div><div class="table-wrap"><table><thead><tr><th>Record</th><th>Member</th><th>Amount</th><th>Destination</th><th>Time paid</th></tr></thead><tbody>${body}</tbody></table></div></div></section>${publicFooter()}`;
}
function faqPage() { return `${setupBanner()}${publicHeader()}<section class="section-sm"><div class="container">${pageHead('Frequently Asked Questions','Clear guidance about membership, task proof, balances, and payment review.')}${faqMarkup()}<div class="card mt-3"><h3 class="card-title">Need more help?</h3><p>Sign in and use Community Chat, or contact the support contact configured by the site owner.</p><a href="login.html" class="btn btn-primary">Sign in to continue →</a></div></div></section>${publicFooter()}`; }
function taskCards(rows) {
  if (!rows.length) return emptyState('No tasks are available right now','The task list will update when an administrator publishes a task. Check back later.','▣');
  return `<div class="cards">${rows.map(t=>`<article class="card task-card"><div class="row between"><span class="pill">${esc(t.platform||'Social task')}</span><span class="amount">${naira(t.reward)}</span></div><h3 class="card-title">${esc(t.title)}</h3><p>${esc(t.instructions||'Read the task link and complete the instructions.')}</p><div class="task-meta"><span class="pill pill-muted">${esc(t.category||'social')}</span><span class="small muted">Added ${shortDate(t.createdAt)}</span></div><div class="row wrap mt-2"><a class="btn btn-secondary btn-sm" href="${esc(t.actionUrl)}" target="_blank" rel="noopener noreferrer">Open task ↗</a><a class="btn btn-primary btn-sm" href="submit-task.html?task=${encodeURIComponent(t.id)}">Submit proof</a></div></article>`).join('')}</div>`;
}
function ledgerTable(rows) {
  if (!rows.length) return emptyState('No wallet activity yet','Approved bonuses, task rewards, top-ups, and withdrawals will appear here.','₦');
  return `<div class="table-wrap"><table><thead><tr><th>Description</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.description||r.type||'Account activity')}</td><td class="${nNumber(r.amount)>=0?'amount':''}">${nNumber(r.amount)>=0?'+':''}${naira(r.amount)}</td><td>${statusPill(r.status)}</td><td>${dateTime(r.createdAt)}</td></tr>`).join('')}</tbody></table></div>`;
}
async function pageContent() {
  if (page==='index') {
    let stats=null;
    if (firebaseConfigured) { try { stats=await callFn('getPublicStats'); } catch(e) { console.warn(e); } }
    return homePage(stats);
  }
  if (page==='login') return loginPage();
  if (page==='register') return registerPage();
  if (page==='payouts') return await payoutsContent();
  if (page==='faq') return faqPage();
  if (page==='terms') return `${setupBanner()}${publicHeader()}<section class="section-sm"><div class="container">${pageHead('Terms of Use','Review these operating terms before registering or transferring funds.')}<div class="card stack"><h2 class="card-title">Membership and payments</h2><p>Membership package prices and any bonus shown on the website must be reviewed before payment. Payment requests are not confirmed until an administrator checks the receiving bank account and marks the payment approved. Never pay to account details sent outside your own payment request.</p><h2 class="card-title">Tasks and rewards</h2><p>Task rewards require valid proof and administrator approval. Task availability, reward amounts, and review times may vary. No amount of earnings or withdrawal timing is guaranteed. Do not submit fraudulent proof or use bots.</p><h2 class="card-title">Withdrawals</h2><p>Withdrawal requests are reviewed by the operator. The balance is reserved when a request is placed and restored if a request is rejected. A withdrawal is published as paid only after the bank transfer has actually been sent.</p><h2 class="card-title">Responsible use</h2><p>Provide accurate information and only submit bank accounts you are authorized to use. Do not share account passwords, authentication codes, or private details with other members.</p><h2 class="card-title">Operator details</h2><p class="muted">Before launch, the site owner must add their legal business name, contact details, payment/refund terms, and applicable local compliance disclosures.</p></div></div></section>${publicFooter()}`;
  if (page==='privacy') return `${setupBanner()}${publicHeader()}<section class="section-sm"><div class="container">${pageHead('Privacy Notice','How this starter project handles member information.')}<div class="card stack"><h2 class="card-title">Information stored</h2><p>The platform stores account name, username, email address, optional phone number, referral relationships, task proof links, chat/status content, payment request records, and withdrawal details needed to operate the service.</p><h2 class="card-title">Financial information</h2><p>Bank account details submitted for withdrawals are visible only to the account owner and administrators. Public payout history shows a username, amount, destination bank label, and paid date; it never displays a bank account number.</p><h2 class="card-title">Purpose and security</h2><p>Firebase Authentication manages sign-in. Firestore rules and Cloud Functions restrict balance updates and payment approvals to trusted server-side functions. Operators must protect administrator access and configure retention and support processes.</p><h2 class="card-title">Your choices</h2><p>Contact the site operator to ask about correcting or deleting profile information. Before accepting real members, replace this starter notice with a legally reviewed privacy policy that includes your real business identity, contact method, retention schedule, and applicable data-protection disclosures.</p></div></div></section>${publicFooter()}`;
  if (protectedPages.has(page)) {
    const user=currentUser;
    if (!user && firebaseConfigured) return `${setupBanner()}<div class="auth-wrap"><div class="auth-card center"><span class="spinner"></span><p>Checking your session…</p></div></div>`;
    const profile=currentProfile;
    if (page==='payment') return await paymentPage();
    if (page==='payments') {
      const items=await getRows('payments',[where('uid','==',user?.uid||''),orderBy('createdAt','desc'),limit(80)]);
      return shell('Payments',items.length?`<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Type</th><th>Amount due</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${items.map(p=>`<tr><td><code>${esc(p.id)}</code></td><td>${esc(p.packageName||'Wallet top-up')}</td><td class="amount">${naira(p.totalDue)}</td><td>${statusPill(p.status)}</td><td>${dateTime(p.createdAt)}</td><td><a class="inline-link" href="payment.html?id=${encodeURIComponent(p.id)}">Details →</a></td></tr>`).join('')}</tbody></table></div>`:emptyState('No payment records yet','Create an activation request or top up your wallet to see the payment history here.','⇄'));
    }
    if (page==='dashboard') return await dashboardPage(profile);
    if (page==='tasks') return shell('Jobs & Tasks',`<div class="notice mb-2">Complete the instructions exactly and submit your proof link. Rewards are credited only after review.</div>${taskCards(await getRows('tasks',[where('status','==','active'),orderBy('createdAt','desc'),limit(60)]))}`);
    if (page==='sponsored') {
      const rows=(await getRows('tasks',[where('status','==','active'),orderBy('createdAt','desc'),limit(60)])).filter(t=>String(t.category||'').toLowerCase()==='sponsored');
      return shell('Sponsored Tasks',`<p class="muted">Promotional tasks that have been published and are accepting submissions.</p>${taskCards(rows)}`);
    }
    if (page==='submit-task') return await submitTaskPage();
    if (page==='submissions') {
      const rows=await getRows('taskSubmissions',[where('uid','==',user?.uid||''),orderBy('createdAt','desc'),limit(60)]);
      const cards=rows.length?`<div class="stack">${rows.map(s=>`<article class="card"><div class="row between wrap"><h3 class="card-title">${esc(s.taskTitle||'Task submission')}</h3>${statusPill(s.status)}</div><p class="small muted">Submitted ${dateTime(s.createdAt)} · Reward ${naira(s.reward)}</p><a href="${esc(s.proofUrl)}" target="_blank" rel="noopener noreferrer" class="inline-link">Open proof link ↗</a>${s.reviewNote?`<p class="small">Review note: ${esc(s.reviewNote)}</p>`:''}</article>`).join('')}</div>`:emptyState('Nothing submitted yet','Open Jobs & Tasks and submit proof when you complete an available task.','☷');
      return shell('My Submissions',cards);
    }
    if (page==='wallet') {
      const rows=await getRows('ledger',[where('uid','==',user?.uid||''),orderBy('createdAt','desc'),limit(80)]);
      const payments=await getRows('payments',[where('uid','==',user?.uid||''),orderBy('createdAt','desc'),limit(20)]);
      return shell('Wallet & History',`<div class="cards cards-2"><section class="card balance-card"><div class="balance-label">Available balance</div><div class="balance-amount">${naira(profile?.walletBalance||0)}</div><div class="balance-actions">${profile?.isActivated?`<a class="btn btn-secondary" href="payment.html?type=topup">＋ Add Funds</a><a class="btn btn-secondary" href="withdraw.html">Withdraw ↗</a>`:`<a class="btn btn-secondary" href="payment.html?plan=${esc(profile?.selectedPackage||'standard')}">Activate account →</a>`}</div></section><section class="card"><h3 class="card-title">Account activation</h3><p>${profile?.isActivated?'Your account is activated.': 'Activate your account to access paid tasks.'}</p><div class="row between"><span class="muted small">Current package</span><strong>${esc(profile?.selectedPackage?profile.selectedPackage.toUpperCase():'Not selected')}</strong></div><div class="row between mt-1"><span class="muted small">Status</span>${statusPill(profile?.activationStatus||'pending')}</div>${!profile?.isActivated?'<a href="register.html" class="btn btn-primary w-full mt-2">Review packages</a>':''}</section></div><h2 class="card-title mt-3">Wallet ledger</h2>${ledgerTable(rows)}<h2 class="card-title mt-3">Payment requests</h2>${payments.length?`<div class="stack">${payments.map(p=>`<div class="card"><div class="row between wrap"><strong>${esc(p.packageName||'Wallet top-up')}</strong>${statusPill(p.status)}</div><div class="data-row"><span class="muted">Amount due</span><strong>${naira(p.totalDue)}</strong></div><div class="row between wrap"><span class="muted small">${dateTime(p.createdAt)}</span><a href="payment.html?id=${encodeURIComponent(p.id||p.id)}" class="inline-link">View transfer details →</a></div></div>`).join('')}</div>`:emptyState('No payment requests','Start an activation payment or add funds to create one.','₦')}`);
    }
    if (page==='withdraw') return await withdrawPage(profile);
    if (page==='profile') return shell('Profile Settings',`<form data-form="profile" class="card stack"><div class="form-grid">${textField('firstName','First name','First name',{value:profile?.firstName||''})}${textField('lastName','Last name','Last name',{value:profile?.lastName||''})}${textField('username','Username','',{value:profile?.username||'',full:true,required:false,readonly:true})}${textField('email','Email address','',{type:'email',value:user?.email||'',full:true,required:false,readonly:true})}${textField('phone','Phone number','08012345678',{value:profile?.phone||'',full:true,required:false})}</div><p class="form-note">Email and username are read-only here. Never share your password with support.</p><button class="btn btn-primary" type="submit">Save profile</button></form><form data-form="change-password" class="card stack mt-2"><h2 class="card-title">Change password</h2><div class="form-grid">${textField('currentPassword','Current password','Enter current password',{type:'password',full:true,autocomplete:'current-password'})}${textField('newPassword','New password','At least 8 characters',{type:'password',full:true,autocomplete:'new-password'})}${textField('confirmNewPassword','Confirm new password','Repeat new password',{type:'password',full:true,autocomplete:'new-password'})}</div><button class="btn btn-secondary" type="submit">Update password</button></form>`);
    if (page==='referrals') return await referralsPage(profile);
    if (page==='chat') return await chatPage(profile);
    if (page==='friends') return await friendsPage();
    if (page==='status') return await statusPage(profile);
    if (page==='ads') return await adsPage();
    if (page==='meta-ai') return shell('Meta AI',`<div class="card"><div class="icon-box">✧</div><h2 class="card-title mt-2">Explore Meta AI</h2><p>Open Meta AI in a separate tab to ask questions, brainstorm social content, or draft task captions. SocialPay does not send your chat to Meta.</p><a class="btn btn-primary mt-2" href="https://www.meta.ai/" target="_blank" rel="noopener noreferrer">Open Meta AI ↗</a><p class="small muted mt-2">External service. Follow its terms and do not share passwords, bank details, or private account credentials.</p></div>`);
    if (page==='admin') return await adminPage();
  }
  return `${setupBanner()}${publicHeader()}<section class="section"><div class="container center">${emptyState('Page not found','The page you are looking for does not exist.','?')}<a class="btn btn-primary" href="index.html">Go home</a></div></section>${publicFooter()}`;
}

async function dashboardPage(profile) {
  const user=currentUser;
  const ledger=await getRows('ledger',[where('uid','==',user?.uid||''),orderBy('createdAt','desc'),limit(5)]);
  const submissions=await getRows('taskSubmissions',[where('uid','==',user?.uid||''),limit(100)]);
  const withdrawalRows=await getRows('withdrawals',[where('uid','==',user?.uid||''),limit(100)]);
  const pending=submissions.filter(s=>s.status==='pending').length;
  const approved=submissions.filter(s=>s.status==='approved').length;
  const wPending=withdrawalRows.filter(w=>w.status==='pending').length;
  const firstName=profile?.firstName||user?.displayName||user?.email?.split('@')[0]||'Member';
  const activateBlock=profile?.isActivated?`<div class="notice">Your account is active. Rewards are credited after task submissions are reviewed.</div>`:`<div class="notice notice-warning"><strong>Account activation pending.</strong> Choose a package and complete the bank transfer. Access to paid tasks opens after your payment is verified.<div class="row wrap mt-2"><a class="btn btn-primary btn-sm" href="payment.html?plan=${esc(profile?.selectedPackage||'standard')}">Activate account →</a><a class="btn btn-secondary btn-sm" href="faq.html">Read terms</a></div></div>`;
  const quick=[['tasks','▣','Jobs'],['sponsored','✦','Sponsored'],['status','◉','Status'],['meta-ai','✧','Meta AI'],['wallet','₦','Wallet'],['referrals','♧','Refer & Earn'],['submissions','☷','Activity History'],['friends','♧','Friends']];
  return shell(`Welcome back, ${firstName}`,`<div class="cards cards-2"><section class="card balance-card"><div class="balance-label">Main balance</div><div class="balance-amount">${naira(profile?.walletBalance||0)} <span style="font-size:.82rem;letter-spacing:0">NGN</span></div><div class="balance-actions">${profile?.isActivated?`<a class="btn btn-secondary" href="payment.html?type=topup">＋ Add Funds</a><a class="btn btn-secondary" href="withdraw.html">Withdraw ↗</a>`:`<a class="btn btn-secondary" href="payment.html?plan=${esc(profile?.selectedPackage||'standard')}">Activate plan ↗</a>`}</div></section><section class="card"><div class="row between"><div><span class="muted small">Membership</span><h2 class="card-title mt-1">${esc(profile?.selectedPackage?profile.selectedPackage.toUpperCase():'Not selected')}</h2></div>${statusPill(profile?.isActivated?'active':profile?.activationStatus||'pending')}</div><div class="data-row"><span class="muted">Referral code</span><strong>${esc(profile?.referralCode||'—')}</strong></div><div class="data-row"><span class="muted">Account created</span><strong>${shortDate(profile?.createdAt)}</strong></div></section></div><div class="mt-2">${activateBlock}</div><div class="metric-grid mt-2"><div class="metric"><div class="metric-label">Approved submissions</div><strong>${approved}</strong></div><div class="metric"><div class="metric-label">Pending reviews</div><strong>${pending}</strong></div><div class="metric"><div class="metric-label">Pending withdrawals</div><strong>${wPending}</strong></div></div><div class="row between mt-3"><h2 class="card-title">Quick Actions</h2><a href="submissions.html" class="inline-link small">Activity history →</a></div><div class="quick-grid mt-2">${quick.map(([href,icon,label])=>`<a class="quick-link" href="${href}.html"><span class="icon-box">${icon}</span><span>${label}</span></a>`).join('')}</div><div class="row between mt-3"><h2 class="card-title">Recent wallet activity</h2><a href="wallet.html" class="inline-link small">View all →</a></div>${ledgerTable(ledger)}`);
}

async function paymentPage() {
  const params=new URLSearchParams(location.search);
  const paymentId=params.get('id');
  const type=params.get('type')||'activation';
  let payment=null;
  if(paymentId) payment=await getRow(paymentId,'payments');
  const own=payment && payment.uid===currentUser?.uid;
  if(payment && !own) payment=null;
  if(payment) {
    return shell('Manual Bank Transfer',`<div class="cards cards-2"><section class="card"><div class="row between"><h2 class="card-title">Payment details</h2>${statusPill(payment.status)}</div><p>Transfer the exact amount below. Your account or wallet is updated only after an administrator verifies receipt.</p><div class="data-row"><span class="muted">Payment reference</span><strong>${esc(payment.id||paymentId)}</strong></div><div class="data-row"><span class="muted">Package / payment</span><strong>${esc(payment.packageName||'Wallet top-up')}</strong></div><div class="data-row"><span class="muted">Base amount</span><strong>${naira(payment.amount)}</strong></div><div class="data-row"><span class="muted">Transfer fee</span><strong>${naira(payment.transferFee)}</strong></div><div class="data-row"><span>Amount due</span><strong class="amount">${naira(payment.totalDue)}</strong></div><div class="notice mt-2">Never transfer to bank details sent by a stranger. Check the account name displayed below before making payment.</div></section><section class="card"><h2 class="card-title">Bank account</h2><div class="data-row"><span class="muted">Bank name</span><strong>${esc(payment.bankName||'Not configured')}</strong></div><div class="data-row"><span class="muted">Account name</span><strong>${esc(payment.accountName||'Not configured')}</strong></div><div class="data-row"><span class="muted">Account number</span><strong id="bank-account-number">${esc(payment.accountNumber||'Not configured')}</strong></div><button class="btn btn-secondary w-full mt-2" data-action="copy" data-copy="${esc(payment.accountNumber||'')}">▢ Copy account number</button><div class="rule"></div><ol class="muted small"><li>Copy the bank details and transfer the exact amount.</li><li>Wait for your banking app to confirm the transfer succeeded.</li><li>Return here and report that you completed the transfer.</li><li>An administrator reviews the payment before activation or wallet credit.</li></ol>${payment.status==='pending'?`<form data-form="report-payment" class="mt-2"><input type="hidden" name="paymentId" value="${esc(payment.id||paymentId)}"><button class="btn btn-primary w-full" type="submit">I have completed payment ✓</button></form>`:payment.status==='reported'?'<div class="notice mt-2">You reported this transfer. It is waiting for administrator review.</div>':`<div class="notice mt-2">This payment is ${esc(payment.status)}. If you need help, contact the administrator.</div>`}</section></div>`);
  }
  if (paymentId && !payment) return shell('Payment not found',`${emptyState('Payment request unavailable','This reference does not belong to your account or has expired. You can create a new request below.','!')}<a class="btn btn-primary" href="payment.html?plan=standard">Create payment request</a>`);
  const plan=params.get('plan')||currentProfile?.selectedPackage||'standard';
  const topup=type==='topup';
  return shell(topup?'Add Funds':'Activate Your Account',`<div class="cards cards-2"><section class="card"><h2 class="card-title">${topup?'Wallet top-up':'Select a package'}</h2><p>${topup?'Add funds by bank transfer. Your balance increases after verification.':'Choose a membership package. The welcome bonus shown below is credited only after the transfer is verified.'}</p><form data-form="payment-create" class="stack mt-2"><input type="hidden" name="type" value="${topup?'topup':'activation'}">${topup?textField('amount','Top-up amount (NGN)','10000',{type:'number',min:1000,full:true}):`<div class="package-grid">${packageCards(plan)}</div>`}<button class="btn btn-primary w-full" type="submit">Generate transfer details →</button></form></section><section class="card"><h2 class="card-title">Before you transfer</h2><div class="stack"><div class="row"><span class="icon-box">1</span><div><strong>Generate a request</strong><div class="small muted">Your exact due amount and a unique reference will be shown.</div></div></div><div class="row"><span class="icon-box">2</span><div><strong>Send the transfer</strong><div class="small muted">Use only the verified account details supplied on the request.</div></div></div><div class="row"><span class="icon-box">3</span><div><strong>Report it for review</strong><div class="small muted">Reporting does not itself mark the transfer as paid.</div></div></div><div class="notice notice-warning">The website owner must configure real bank details in Firebase Functions before new payment requests can be created.</div></div></section></div>`);
}
async function submitTaskPage() {
  const taskId=new URLSearchParams(location.search).get('task');
  const task=await getRow(taskId,'tasks');
  if(!task || task.status!=='active') return shell('Submit task proof',emptyState('Task unavailable','The task may have been removed or paused. Return to Jobs & Tasks for the current list.','!')+'<a class="btn btn-primary" href="tasks.html">Browse tasks</a>');
  return shell('Submit task proof',`<div class="cards cards-2"><section class="card"><div class="task-meta"><span class="pill">${esc(task.platform)}</span><span class="amount">Reward ${naira(task.reward)}</span></div><h2 class="card-title mt-2">${esc(task.title)}</h2><p>${esc(task.instructions)}</p><a class="btn btn-secondary mt-2" href="${esc(task.actionUrl)}" target="_blank" rel="noopener noreferrer">Open task link ↗</a></section><section class="card"><h2 class="card-title">Your proof</h2><p class="small muted">Paste a secure HTTPS link to your public post or screenshot proof. Do not include passwords or private banking information.</p><form data-form="task-submit" class="stack"><input type="hidden" name="taskId" value="${esc(task.id)}">${textField('proofUrl','Proof URL','https://...',{type:'url',full:true})}<div class="field"><label for="note">Note (optional)</label><textarea id="note" name="note" placeholder="Add context for the reviewer"></textarea></div><button class="btn btn-primary" type="submit" ${!currentProfile?.isActivated?'disabled':''}>Submit for review</button>${!currentProfile?.isActivated?'<div class="notice notice-warning">Activate your account before submitting paid tasks.</div>':''}</form></section></div>`);
}
async function withdrawPage(profile) {
  const rows=await getRows('withdrawals',[where('uid','==',currentUser?.uid||''),orderBy('createdAt','desc'),limit(30)]);
  return shell('Withdraw Funds',`<div class="cards cards-2"><section class="card"><span class="muted small">Available balance</span><div class="balance-amount">${naira(profile?.walletBalance||0)}</div><p>Minimum withdrawal: ₦1,000. Enter bank details that belong to you.</p><form data-form="withdrawal" class="stack mt-2">${textField('amount','Amount (NGN)','1000',{type:'number',min:1000})}${selectField('bankName','Bank name',[['','Choose bank'],['Access Bank','Access Bank'],['GTBank','GTBank'],['First Bank','First Bank'],['UBA','UBA'],['Zenith Bank','Zenith Bank'],['OPay','OPay'],['PalmPay','PalmPay'],['Kuda Bank','Kuda Bank'],['Moniepoint','Moniepoint'],['Wema Bank','Wema Bank'],['Other','Other']])}${textField('accountName','Account name','Name on bank account')}${textField('accountNumber','Account number','10-digit account number',{maxlength:12})}<button class="btn btn-primary" type="submit" ${!profile?.isActivated?'disabled':''}>Request withdrawal →</button>${!profile?.isActivated?'<div class="notice notice-warning">Activate your account before requesting withdrawals.</div>':''}</form></section><section class="card"><h2 class="card-title">Withdrawal status</h2><p>Funds are reserved when you submit a request. If a request is rejected, the backend returns the amount to your balance automatically.</p>${rows.length?`<div class="stack mt-2">${rows.map(w=>`<div class="status-card"><div class="row between"><strong>${naira(w.amount)}</strong>${statusPill(w.status)}</div><p class="small muted">${esc(w.bankName)} · ${dateTime(w.createdAt)}</p>${w.reviewNote?`<p class="small">${esc(w.reviewNote)}</p>`:''}</div>`).join('')}</div>`:emptyState('No withdrawal requests','Your withdrawal history will appear here.','↗')}</section></div>`);
}
async function referralsPage(profile) {
  const referrals=await getRows(`referrals/${currentUser.uid}/members`,[orderBy('createdAt','desc'),limit(100)]);
  const link=`${location.origin}${location.pathname.slice(0,location.pathname.lastIndexOf('/')+1)}register.html?ref=${encodeURIComponent(profile?.referralCode||'')}`;
  return shell('Refer & Earn',`<div class="cards cards-2"><section class="card"><h2 class="card-title">Your referral link</h2><p>Share the link with people who want to register. Referral records reflect actual sign-ups; any commission must be explicitly configured and approved.</p><div class="code-box" id="referral-link">${esc(link)}</div><button class="btn btn-primary mt-2" data-action="copy" data-copy="${esc(link)}">Copy referral link</button></section><section class="card"><span class="muted small">Referral code</span><div class="balance-amount">${esc(profile?.referralCode||'—')}</div><div class="metric-label">Registered referrals</div><strong style="font:700 1.9rem 'Space Grotesk'">${referrals.length}</strong></section></div><h2 class="card-title mt-3">Your referrals</h2>${referrals.length?`<div class="table-wrap"><table><thead><tr><th>Username</th><th>Joined</th><th>Status</th></tr></thead><tbody>${referrals.map(r=>`<tr><td>${esc(r.username||'Member')}</td><td>${shortDate(r.createdAt)}</td><td>${statusPill(r.status)}</td></tr>`).join('')}</tbody></table></div>`:emptyState('No referrals yet','When someone registers with your referral link, their record appears here.','♧')}`);
}
async function chatPage(profile) {
  const rows=await getRows('communityMessages',[orderBy('createdAt','desc'),limit(70)]);
  return shell('Community Chat',`<section class="card"><h2 class="card-title">Community messages</h2><p class="small muted">Keep messages respectful. Never post passwords, bank details, or private information.</p><div class="stack mt-2">${rows.length?rows.slice().reverse().map(m=>`<article class="status-card"><div class="row between"><strong>${esc(m.username||'Member')}</strong><span class="tiny muted">${dateTime(m.createdAt)}</span></div><p>${esc(m.message)}</p></article>`).join(''):emptyState('Be the first to say hello','There are no messages in the community yet.','▤')}</div><form data-form="chat" class="stack mt-3"><div class="field"><label for="message">Your message</label><textarea id="message" name="message" maxlength="700" placeholder="Type a message to the community…" required></textarea></div><button class="btn btn-primary" type="submit">Send message →</button></form></section>`);
}
async function friendsPage() {
  const people=await getRows('publicProfiles',[orderBy('usernameLower','asc'),limit(40)]);
  const friends=await getRows(`friendships/${currentUser.uid}/members`,[orderBy('since','desc'),limit(100)]);
  const requests=await getRows('friendRequests',[where('toUid','==',currentUser.uid),where('status','==','pending'),orderBy('createdAt','desc'),limit(30)]);
  const friendIds=new Set(friends.map(f=>f.id));
  const friendPanel=requests.length?`<div class="card mb-2"><h2 class="card-title">Incoming requests</h2><div class="stack mt-2">${requests.map(r=>`<div class="row between wrap"><div><strong>${esc(r.fromUsername||'Member')}</strong><div class="small muted">${dateTime(r.createdAt)}</div></div><div class="admin-actions"><button class="btn btn-primary btn-sm" data-action="friend-response" data-id="${esc(r.id)}" data-decision="accept">Accept</button><button class="btn btn-secondary btn-sm" data-action="friend-response" data-id="${esc(r.id)}" data-decision="decline">Decline</button></div></div>`).join('')}</div></div>`:'';
  return shell('Friends',`${friendPanel}<div class="cards cards-2"><section class="card"><h2 class="card-title">Your friends (${friends.length})</h2>${friends.length?`<div class="stack mt-2">${friends.map(f=>`<div class="row"><div class="avatar">${esc(String(f.username||'M')[0].toUpperCase())}</div><div><strong>${esc(f.username||'Member')}</strong><div class="small muted">Connected ${shortDate(f.since)}</div></div></div>`).join('')}</div>`:emptyState('No friends connected','Send a connection request to someone from the member directory.','♧')}</section><section class="card"><h2 class="card-title">Member directory</h2><p class="small muted">Only public usernames are shown here.</p><div class="stack mt-2">${people.filter(p=>p.uid!==currentUser.uid).map(p=>`<div class="row between"><div class="row"><div class="avatar">${esc(String(p.username||'M')[0].toUpperCase())}</div><div><strong>${esc(p.username||'Member')}</strong><div class="tiny muted">${esc(p.firstName||'')} ${esc(p.lastName||'')}</div></div></div>${friendIds.has(p.uid)?'<span class="pill">Connected</span>':`<button class="btn btn-secondary btn-sm" data-action="friend-request" data-id="${esc(p.uid)}">Add</button>`}</div>`).join('')||'<p class="muted small">No other members are visible yet.</p>'}</div></section></div>`);
}
async function statusPage(profile) {
  const rows=await getRows('socialStatuses',[orderBy('createdAt','desc'),limit(50)]);
  return shell('Status Updates',`<section class="card"><h2 class="card-title">Share an update</h2><form data-form="status" class="stack mt-2"><div class="field"><label for="statusText">What's happening?</label><textarea id="statusText" name="statusText" maxlength="400" placeholder="Share a short update with the community…" required></textarea></div><button class="btn btn-primary" type="submit">Post status</button></form></section><h2 class="card-title mt-3">Recent status updates</h2><div class="stack">${rows.length?rows.map(s=>`<article class="status-card"><div class="row between"><strong>${esc(s.username||'Member')}</strong><span class="tiny muted">${dateTime(s.createdAt)}</span></div><p>${esc(s.text)}</p></article>`).join(''):emptyState('No status updates yet','Post the first update to start the feed.','◉')}</div>`);
}
async function adsPage() {
  const rows=await getRows('ads',[where('status','==','active'),orderBy('createdAt','desc'),limit(40)]);
  return shell('Ads & Campaigns',`<div class="notice mb-2">Campaigns appear here after an administrator publishes them. Review every destination before opening it.</div>${rows.length?`<div class="cards">${rows.map(ad=>`<article class="card"><span class="pill">${esc(ad.category||'Campaign')}</span><h2 class="card-title mt-2">${esc(ad.title)}</h2><p>${esc(ad.description||'Campaign details')}</p><a href="${esc(ad.targetUrl||'#')}" target="_blank" rel="noopener noreferrer" class="btn btn-primary mt-2">View campaign ↗</a></article>`).join('')}</div>`:emptyState('No campaigns published','Active ad campaigns will be listed when an administrator adds them.','▱')}`);
}
async function adminPage() {
  if (!firebaseConfigured || !currentUser) return shell('Admin Panel', '<div class="notice notice-warning">Connect Firebase and sign in with an administrator account to use this panel.</div>');
  let adminRecord=null;
  try { adminRecord=await getDoc(doc(db,'admins',currentUser.uid)); } catch(e) { console.warn(e); }
  if (!adminRecord?.exists()) return shell('Admin Panel',`<div class="notice notice-danger">This account does not have administrator permissions. Create an <code>admins/${esc(currentUser.uid)}</code> document in Firestore Console (not from the browser) to grant access.</div>`);
  const [payments,withdrawals,subs,tasks]=await Promise.all([
    getRows('payments',[orderBy('createdAt','desc'),limit(100)]),getRows('withdrawals',[orderBy('createdAt','desc'),limit(100)]),getRows('taskSubmissions',[orderBy('createdAt','desc'),limit(100)]),getRows('tasks',[orderBy('createdAt','desc'),limit(100)])
  ]);
  const pendingPayments=payments.filter(p=>['pending','reported'].includes(p.status));
  const pendingWithdrawals=withdrawals.filter(w=>w.status==='pending');
  const pendingSubs=subs.filter(s=>s.status==='pending');
  const paymentCards=pendingPayments.length?`<div class="stack">${pendingPayments.map(p=>`<article class="card"><div class="row between wrap"><h3 class="card-title">${esc(p.packageName||'Wallet top-up')}</h3>${statusPill(p.status)}</div><p class="small muted">Member: ${esc(p.uid)} · Reference: ${esc(p.id)} · ${dateTime(p.createdAt)}</p><div class="data-list"><div class="data-row"><span class="muted">Amount due</span><strong>${naira(p.totalDue)}</strong></div><div class="data-row"><span class="muted">Bank details</span><strong>${esc(p.bankName)} / ${esc(p.accountName)} / ${esc(p.accountNumber)}</strong></div></div><div class="admin-actions mt-2"><button class="btn btn-primary btn-sm" data-action="review-payment" data-id="${esc(p.id)}" data-decision="approve">Verify & approve</button><button class="btn btn-danger btn-sm" data-action="review-payment" data-id="${esc(p.id)}" data-decision="reject">Reject</button></div></article>`).join('')}</div>`:emptyState('No payments waiting','Reported and pending bank transfers will appear here.','₦');
  const withdrawalCards=pendingWithdrawals.length?`<div class="stack">${pendingWithdrawals.map(w=>`<article class="card"><div class="row between wrap"><h3 class="card-title">${naira(w.amount)}</h3>${statusPill(w.status)}</div><p class="small muted">Member: ${esc(w.uid)} · ${dateTime(w.createdAt)}</p><div class="data-list"><div class="data-row"><span class="muted">Bank</span><strong>${esc(w.bankName)}</strong></div><div class="data-row"><span class="muted">Account name</span><strong>${esc(w.accountName)}</strong></div><div class="data-row"><span class="muted">Account number</span><strong>${esc(w.accountNumber)}</strong></div></div><div class="admin-actions mt-2"><button class="btn btn-primary btn-sm" data-action="review-withdrawal" data-id="${esc(w.id)}" data-decision="paid">Mark paid</button><button class="btn btn-danger btn-sm" data-action="review-withdrawal" data-id="${esc(w.id)}" data-decision="reject">Reject & refund</button></div></article>`).join('')}</div>`:emptyState('No pending withdrawals','New withdrawal requests will appear here.','↗');
  const subCards=pendingSubs.length?`<div class="stack">${pendingSubs.map(s=>`<article class="card"><div class="row between wrap"><h3 class="card-title">${esc(s.taskTitle)}</h3><span class="amount">${naira(s.reward)}</span></div><p class="small muted">Member: ${esc(s.uid)} · ${dateTime(s.createdAt)}</p><p>${esc(s.note||'No note added.')}</p><a href="${esc(s.proofUrl)}" target="_blank" rel="noopener noreferrer" class="inline-link">Open submitted proof ↗</a><div class="admin-actions mt-2"><button class="btn btn-primary btn-sm" data-action="review-submission" data-id="${esc(s.id)}" data-decision="approve">Approve reward</button><button class="btn btn-danger btn-sm" data-action="review-submission" data-id="${esc(s.id)}" data-decision="reject">Reject</button></div></article>`).join('')}</div>`:emptyState('No task proofs waiting','Submitted task proofs will appear here.','☷');
  const taskRows=tasks.length?`<div class="table-wrap"><table><thead><tr><th>Task</th><th>Platform</th><th>Reward</th><th>Status</th><th>Action</th></tr></thead><tbody>${tasks.map(t=>`<tr><td>${esc(t.title)}</td><td>${esc(t.platform)}</td><td class="amount">${naira(t.reward)}</td><td>${statusPill(t.status)}</td><td><button class="btn btn-secondary btn-sm" data-action="task-status" data-id="${esc(t.id)}" data-status="${t.status==='active'?'paused':'active'}">${t.status==='active'?'Pause':'Activate'}</button></td></tr>`).join('')}</tbody></table></div>`:emptyState('No tasks created','Use the form to publish the first task.','▣');
  return shell('Admin Panel',`<div class="notice notice-warning mb-2">Approve a payment only after checking your bank statement. “Mark paid” must mean the transfer was actually sent. These actions cannot be performed by ordinary members.</div><div class="metric-grid"><div class="metric"><div class="metric-label">Payments waiting</div><strong>${pendingPayments.length}</strong></div><div class="metric"><div class="metric-label">Withdrawals waiting</div><strong>${pendingWithdrawals.length}</strong></div><div class="metric"><div class="metric-label">Proofs to review</div><strong>${pendingSubs.length}</strong></div></div><h2 class="card-title mt-3">Payment approvals</h2>${paymentCards}<h2 class="card-title mt-3">Withdrawal queue</h2>${withdrawalCards}<h2 class="card-title mt-3">Task submissions</h2>${subCards}<h2 class="card-title mt-3">Create a task</h2><form data-form="admin-task" class="card stack"><div class="form-grid">${textField('title','Task title','Follow a creator on Instagram',{full:true})}${textField('platform','Platform','Instagram / YouTube')}${selectField('category','Category',[['social','Social task'],['sponsored','Sponsored'],['survey','Survey'],['other','Other']])}${textField('reward','Reward (NGN)','100',{type:'number',min:10})}${textField('actionUrl','Task URL','https://example.com',{type:'url',full:true})}<div class="field full"><label for="instructions">Instructions</label><textarea id="instructions" name="instructions" placeholder="Describe what the member must do and what proof is required" required></textarea></div></div><button class="btn btn-primary" type="submit">Publish task</button></form><h2 class="card-title mt-3">Published tasks</h2>${taskRows}`);
}

async function render() {
  if (!root) return;
  if (protectedPages.has(page) && firebaseConfigured && !currentUser) {
    root.innerHTML=`${setupBanner()}<div class="auth-wrap"><div class="auth-card center"><span class="spinner"></span><p>Checking your session…</p></div></div>`;
    return;
  }
  currentProfile = currentUser ? await getProfile(currentUser.uid) : null;
  currentIsAdmin = false;
  if (currentUser && firebaseConfigured && db) {
    try { const adminSnap = await getDoc(doc(db, 'admins', currentUser.uid)); currentIsAdmin = adminSnap.exists() && adminSnap.data()?.enabled !== false; } catch (_) { currentIsAdmin = false; }
  }
  if (protectedPages.has(page) && firebaseConfigured && currentUser && !currentProfile && page!=='admin') {
    root.innerHTML=`${setupBanner()}<div class="auth-wrap"><div class="auth-card"><h1>Finish setting up your account</h1><p class="auth-sub">Your sign-in is valid, but the member profile is missing. If registration was interrupted, sign out and register again with support guidance.</p><button class="btn btn-secondary w-full" data-action="logout">Sign out</button></div></div>`;
    return;
  }
  root.innerHTML=await pageContent();
  if (page==='login' && currentUser && firebaseConfigured) { const next=new URLSearchParams(location.search).get('next'); location.replace(next && /^[a-z0-9-]+\.html(\?.*)?$/i.test(next) ? next : 'dashboard.html'); return; }
  if (page==='register' && currentUser && firebaseConfigured && currentProfile) { /* Keep the form available if a signed-in member intentionally revisits it. */ }
  const setupHint=new URLSearchParams(location.search).get('setup');
  if (setupHint==='payment') toast('Account created. The transfer request could not be started; check Firebase payment bank settings.','error');
}

async function withBusy(button, task) {
  if (busy) return;
  busy=true;
  const old=button?.innerHTML;
  if (button) { button.disabled=true; button.innerHTML='<span class="spinner"></span> Please wait…'; }
  try { await task(); }
  catch (err) { console.error(err); toast(err?.message || 'Something went wrong. Please try again.', 'error'); }
  finally { busy=false; if (button && document.body.contains(button)) { button.disabled=false; button.innerHTML=old; } }
}

function authRedirect() { return `login.html?next=${encodeURIComponent(`${page}.html${location.search||''}`)}`; }

document.addEventListener('submit', async event => {
  const form=event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const kind=form.dataset.form;
  const button=form.querySelector('button[type="submit"]');
  const fd=new FormData(form);
  await withBusy(button, async () => {
    if (kind==='login') {
      const email=String(fd.get('email')||'').trim();
      const password=String(fd.get('password')||'');
      if (!firebaseConfigured) throw new Error('Add your Firebase client settings first. See README.md.');
      const result=await signInWithEmailAndPassword(auth,email,password);
      const next=new URLSearchParams(location.search).get('next');
      location.href=next && /^[a-z0-9-]+\.html(\?.*)?$/i.test(next) ? next : 'dashboard.html';
      return;
    }
    if (kind==='register') {
      if (!firebaseConfigured) throw new Error('Add your Firebase client settings first. See README.md.');
      const password=String(fd.get('password')||'');
      if (password.length<8) throw new Error('Use a password with at least 8 characters.');
      if (password!==String(fd.get('confirmPassword')||'')) throw new Error('The password fields do not match.');
      const plan=String(fd.get('plan')||'standard');
      const create=await createUserWithEmailAndPassword(auth,String(fd.get('email')||'').trim(),password);
      try {
        await updateProfile(create.user,{displayName:`${String(fd.get('firstName')).trim()} ${String(fd.get('lastName')).trim()}`.trim()});
        await callFn('registerUserProfile',{firstName:fd.get('firstName'),lastName:fd.get('lastName'),username:fd.get('username'),phone:fd.get('phone'),referralCode:fd.get('referralCode'),plan});
      } catch (err) {
        try { await deleteUser(create.user); } catch(_) { /* account deletion may require a fresh sign-in */ }
        throw err;
      }
      try {
        const payment=await callFn('createPaymentRequest',{type:'activation',plan});
        location.href=`payment.html?id=${encodeURIComponent(payment.paymentId)}`;
      } catch(err) {
        console.warn('Account is created, but payment details are not ready',err);
        location.href='dashboard.html?setup=payment';
      }
      return;
    }
    if (kind==='payment-create') {
      const type=String(fd.get('type')||'activation');
      const data=type==='topup'?{type,amount:Number(fd.get('amount'))}:{type,plan:String(fd.get('plan')||'standard')};
      const result=await callFn('createPaymentRequest',data);
      location.href=`payment.html?id=${encodeURIComponent(result.paymentId)}`;
      return;
    }
    if (kind==='report-payment') {
      await callFn('reportPaymentTransfer',{paymentId:fd.get('paymentId')});
      toast('Transfer reported. It will remain pending until an administrator verifies it.');
      await render(); return;
    }
    if (kind==='withdrawal') {
      const result=await callFn('requestWithdrawal',{amount:Number(fd.get('amount')),bankName:fd.get('bankName'),accountName:fd.get('accountName'),accountNumber:fd.get('accountNumber')});
      toast(`Withdrawal request created: ${result.withdrawalId}`);
      location.href='withdraw.html'; return;
    }
    if (kind==='task-submit') {
      await callFn('submitTaskProof',{taskId:fd.get('taskId'),proofUrl:fd.get('proofUrl'),note:fd.get('note')});
      toast('Task proof submitted for review.'); location.href='submissions.html'; return;
    }
    if (kind==='chat') {
      const message=String(fd.get('message')||'').trim();
      if (!message) throw new Error('Write a message first.');
      await addDoc(collection(db,'communityMessages'),{uid:currentUser.uid,username:currentProfile?.username||'Member',message:message.slice(0,700),createdAt:serverTimestamp()});
      toast('Message sent.'); await render(); return;
    }
    if (kind==='status') {
      const text=String(fd.get('statusText')||'').trim();
      if (!text) throw new Error('Write a short status first.');
      await addDoc(collection(db,'socialStatuses'),{uid:currentUser.uid,username:currentProfile?.username||'Member',text:text.slice(0,400),createdAt:serverTimestamp()});
      toast('Status posted.'); await render(); return;
    }
    if (kind==='change-password') {
      const currentPassword=String(fd.get('currentPassword')||'');
      const newPassword=String(fd.get('newPassword')||'');
      if(newPassword.length<8) throw new Error('Use a new password with at least 8 characters.');
      if(newPassword!==String(fd.get('confirmNewPassword')||'')) throw new Error('The new password fields do not match.');
      if(!currentUser?.email) throw new Error('This account does not support email/password changes here.');
      const credential=EmailAuthProvider.credential(currentUser.email,currentPassword);
      await reauthenticateWithCredential(currentUser,credential);
      await updatePassword(currentUser,newPassword);
      toast('Password updated successfully.'); form.reset(); return;
    }
    if (kind==='profile') {
      await callFn('updateUserProfile',{firstName:fd.get('firstName'),lastName:fd.get('lastName'),phone:fd.get('phone')});
      toast('Profile saved.'); await render(); return;
    }
    if (kind==='admin-task') {
      const result=await callFn('adminCreateTask',{title:fd.get('title'),platform:fd.get('platform'),category:fd.get('category'),reward:Number(fd.get('reward')),actionUrl:fd.get('actionUrl'),instructions:fd.get('instructions')});
      toast(`Task published: ${result.taskId}`); await render(); return;
    }
  });
});

document.addEventListener('click', async event => {
  const el=event.target.closest('[data-action]');
  if (!el) return;
  const action=el.dataset.action;
  if (action==='forgot-password') { event.preventDefault(); const field=document.querySelector('#email'); const email=String(field?.value||'').trim(); if(!firebaseConfigured){toast('Add your Firebase client settings first.','error');return;} if(!email){toast('Enter your account email above, then click Forgot password again.','error');field?.focus();return;} try{await sendPasswordResetEmail(auth,email);toast('Password reset email sent. Check your inbox and spam folder.');}catch(err){toast(err?.message||'Could not send the password reset email.','error');} return; }
  if (action==='copy') {
    event.preventDefault();
    try { await navigator.clipboard.writeText(el.dataset.copy||''); toast('Copied to clipboard.'); }
    catch { toast('Clipboard access was blocked by this browser. Please copy the text manually.','error'); }
    return;
  }
  if (action==='logout') {
    event.preventDefault();
    location.href='logout.html'; return;
  }
  const id=el.dataset.id;
  if (action==='review-payment') {
    const verb=el.dataset.decision==='approve'?'approve':'reject';
    const promptText=verb==='approve'?'Confirm you checked your bank statement and received the exact amount.':'Optional reason for rejecting this payment:';
    const note=window.prompt(promptText,''); if(note===null) return;
    await withBusy(el,async()=>{await callFn('adminReviewPayment',{paymentId:id,decision:verb,note});toast(`Payment ${verb==='approve'?'approved':'rejected'}.`);await render();}); return;
  }
  if (action==='review-withdrawal') {
    const decision=el.dataset.decision;
    const note=window.prompt(decision==='paid'?'Confirm the bank transfer has actually been sent. Add an optional note:':'Reason for rejection (amount will be returned):',''); if(note===null) return;
    await withBusy(el,async()=>{await callFn('adminReviewWithdrawal',{withdrawalId:id,decision,note});toast(decision==='paid'?'Withdrawal marked paid.':'Withdrawal rejected and amount refunded.');await render();}); return;
  }
  if (action==='review-submission') {
    const decision=el.dataset.decision;
    const note=window.prompt(decision==='approve'?'Optional approval note:':'Reason for rejecting this proof:',''); if(note===null) return;
    await withBusy(el,async()=>{await callFn('adminReviewTaskSubmission',{submissionId:id,decision,note});toast(decision==='approve'?'Reward credited after approval.':'Submission rejected.');await render();}); return;
  }
  if (action==='task-status') {
    const next=el.dataset.status;
    await withBusy(el,async()=>{await callFn('adminSetTaskStatus',{taskId:id,status:next});toast(`Task ${next}.`);await render();}); return;
  }
  if (action==='friend-request') {
    await withBusy(el,async()=>{await callFn('sendFriendRequest',{targetUid:id});toast('Friend request sent.');await render();}); return;
  }
  if (action==='friend-response') {
    const decision=el.dataset.decision;
    await withBusy(el,async()=>{await callFn('respondFriendRequest',{requestId:id,decision});toast(decision==='accept'?'Friend request accepted.':'Friend request declined.');await render();}); return;
  }
});

if (page==='logout') {
  if (firebaseConfigured && auth) {
    onAuthStateChanged(auth, async user => {
      currentUser=user;
      if (user) { try { await signOut(auth); } catch (err) { console.error(err); } }
      location.replace('index.html');
    });
  } else { location.replace('index.html'); }
} else if (firebaseConfigured && auth) {
  onAuthStateChanged(auth, async user => {
    currentUser=user;
    if (protectedPages.has(page) && !user) { location.replace(authRedirect()); return; }
    if (page==='login' && user) { const next=new URLSearchParams(location.search).get('next'); location.replace(next && /^[a-z0-9-]+\.html(\?.*)?$/i.test(next) ? next : 'dashboard.html'); return; }
    await render();
  });
} else {
  render().catch(err=>{console.error(err);root.innerHTML=`<div class="auth-wrap"><div class="auth-card"><h1>Unable to load this page</h1><p class="muted">${esc(err.message||'Please try again.')}</p></div></div>`;});
}
