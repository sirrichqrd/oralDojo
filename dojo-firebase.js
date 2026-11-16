/* ═══════════════════════════════════════════════════════════════════════════
   ORAL DOJO — dojo-firebase.js
   Firebase glue for the whole Dojo (index.html + admin.html):
     • Google sign-in (Firebase Auth) with persistent sessions
     • LIVE catalog in Firestore — admin saves go live with no file upload
     • Per-user progress sync (users/{uid}/progress/current)
     • Submissions inbox — feedback, thesis and question contributions flow
       straight into the admin console (submissions collection)
   Everything degrades gracefully: with no Firebase config the Dojo keeps
   running in LOCAL MODE exactly as before. Loaded as an ES module and exposes
   window.DojoFirebase. See FIREBASE-SETUP.md for console setup.
   ═══════════════════════════════════════════════════════════════════════════ */

(function(){
  'use strict';
  // firebase-config.js declares these globally (var) — read them defensively
  // so the module works whether they arrive as lexical globals or window props.
  const CFG = (typeof FIREBASE_CONFIG!=='undefined' && FIREBASE_CONFIG)
    ? FIREBASE_CONFIG
    : ((typeof window!=='undefined' && window.FIREBASE_CONFIG) ? window.FIREBASE_CONFIG : {});
  const ADMIN_LIST = (typeof ADMIN_EMAILS!=='undefined' && Array.isArray(ADMIN_EMAILS))
    ? ADMIN_EMAILS.map(e=>String(e).trim().toLowerCase()).filter(Boolean)
    : ((typeof window!=='undefined' && Array.isArray(window.ADMIN_EMAILS)) ? window.ADMIN_EMAILS.map(e=>String(e).trim().toLowerCase()).filter(Boolean) : []);
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/';
  const SUB_OUTBOX_KEY = 'oralDojo_subOutbox';

  // Config present AND not a placeholder -> Firebase mode; otherwise LOCAL MODE.
  const isConfigured = !!(CFG && CFG.apiKey && CFG.projectId &&
    !/^PASTE/i.test(String(CFG.apiKey)) && !/^PASTE/i.test(String(CFG.projectId)));

  const S = {
    app:null, auth:null, db:null, authM:null, fsM:null,
    ready:false, loading:null, error:null,
    user:null, authCbs:[],
    mainData:null, mainLoaded:false, qLoaded:false, catUnsubs:[],
    inboxCache:[], inboxCbs:[], inboxUnsub:null, inboxError:null,
    progUnsub:null, progUid:null, flushing:false,
    lbUnsub:null, lbCbs:[], lbCache:[], lbError:null
  };

  function sanitize(obj){ try{ return JSON.parse(JSON.stringify(obj)); }catch(e){ return {}; } }
  function safeId(id){
    let s = String(id==null?'':id).replace(/[\/?#O\[\]]/g,'-').trim();
    return s || ('auto-'+Date.now()+'-'+Math.floor(Math.random()*99999));
  }
  function lower(s){ return String(s||'').trim().toLowerCase(); }

  async function ensure(){
    if(S.ready) return true;
    if(!isConfigured){ S.error = S.error || 'not-configured'; return false; }
    if(S.loading) return S.loading;
    S.loading = (async ()=>{
      try{
        const appM = await import(SDK+'firebase-app.js');
        const authM = await import(SDK+'firebase-auth.js');
        const fsM  = await import(SDK+'firebase-firestore.js');
        S.app  = appM.initializeApp(CFG);
        S.auth = authM.getAuth(S.app);
        try{ await authM.setPersistence(S.auth, authM.browserLocalPersistence); }catch(e){}
        S.db = fsM.getFirestore(S.app);
        S.authM = authM; S.fsM = fsM;
        S.ready = true; S.error = null;
        authM.onAuthStateChanged(S.auth, u=>{
          S.user = u ? { uid:u.uid, name:u.displayName||'', email:u.email||'', photo:u.photoURL||'' } : null;
          if(S.user) flushSubOutbox();
          S.authCbs.forEach(cb=>{ try{ cb(S.user); }catch(e){ console.error(e); } });
        });
        return true;
      }catch(e){
        S.error = String((e&&e.message)||e);
        console.warn('Oral Dojo: Firebase failed to start —', S.error);
        return false;
      }
    })();
    return S.loading;
  }

  /* ---------- local outbox for submissions while offline ---------- */
  function readOutbox(){ try{ return JSON.parse(localStorage.getItem(SUB_OUTBOX_KEY)||'[]'); }catch(e){ return []; } }
  function writeOutbox(list){ try{ localStorage.setItem(SUB_OUTBOX_KEY, JSON.stringify(list)); }catch(e){} }
  async function flushSubOutbox(){
    if(!S.ready || S.flushing) return;
    const box = readOutbox(); if(!box.length) return;
    S.flushing = true;
    const remain = [];
    for(const item of box){
      try{ await S.fsM.addDoc(S.fsM.collection(S.db,'submissions'), item); }
      catch(e){ remain.push(item); }
    }
    writeOutbox(remain);
    S.flushing = false;
  }

  const api = {
    /* ---------- status helpers ---------- */
    isConfigured: ()=>isConfigured,
    isConnected: ()=>S.ready,
    error: ()=>S.error,
    currentUser: ()=>S.user,
    needsAdminGoogle: ()=>ADMIN_LIST.length>0,
    isAdminUser: ()=>!!(S.user && ADMIN_LIST.indexOf(lower(S.user.email))>=0),
    adminEmails: ()=>ADMIN_LIST.slice(),

    /* ---------- auth ---------- */
    onAuth(cb){
      if(typeof cb!=='function') return;
      S.authCbs.push(cb);
      ensure();
      if(S.user) { try{ cb(S.user); }catch(e){ console.error(e); } }
    },
    async signInGoogle(){
      const ok = await ensure();
      if(!ok) return { ok:false, reason:'not-configured' };
      try{
        const provider = new S.authM.GoogleAuthProvider();
        provider.setCustomParameters({ prompt:'select_account' });
        await S.authM.signInWithPopup(S.auth, provider);
        return { ok:true };
      }catch(e){
        const code = String(e&&e.code||'');
        if(code.indexOf('popup-closed')>=0 || code.indexOf('cancelled')>=0 || code.indexOf('popup-merged')>=0) return { ok:false, reason:'cancelled' };
        return { ok:false, reason: code || 'error', message: String((e&&e.message)||e) };
      }
    },
    async signOutUser(){
      if(!S.ready) return { ok:true };
      try{ await S.authM.signOut(S.auth); return { ok:true }; }
      catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },

    /* ---------- user profile + progress sync ---------- */
    async ensureUserProfile(user, extra){
      if(!user || !user.uid) return { ok:false };
      const ok = await ensure(); if(!ok) return { ok:false };
      try{
        await S.fsM.setDoc(S.fsM.doc(S.db,'users',user.uid), sanitize({
          name: user.name || (extra&&extra.name) || '',
          email: user.email || (extra&&extra.email) || '',
          rank: (extra&&extra.rank) || '',
          avatar: (extra&&extra.avatar) || '',
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now()
        }), { merge:true });
        return { ok:true };
      }catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },
    async getProgress(uid){
      const ok = await ensure(); if(!ok) return null;
      try{
        const snap = await S.fsM.getDoc(S.fsM.doc(S.db,'users',uid,'progress','current'));
        return snap.exists() ? snap.data() : null;
      }catch(e){ return null; }
    },
    async saveProgress(uid, prog){
      const ok = await ensure(); if(!ok) return { ok:false };
      try{
        await S.fsM.setDoc(S.fsM.doc(S.db,'users',uid,'progress','current'),
          sanitize(Object.assign({}, prog, { updatedAtMs: Date.now(), updatedAtISO: new Date().toISOString() })),
          { merge:true });
        return { ok:true };
      }catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },
    watchProgress(uid, cb){
      if(S.progUnsub && S.progUid===uid){ /* keep existing listener, just swap nothing */ }
      else {
        if(S.progUnsub){ try{ S.progUnsub(); }catch(e){} S.progUnsub=null; }
        S.progUid = uid;
        ensure().then(ok=>{
          if(!ok || S.progUid!==uid) return;
          S.progUnsub = S.fsM.onSnapshot(S.fsM.doc(S.db,'users',S.progUid,'progress','current'), snap=>{
            if(cb) cb(snap.exists() ? snap.data() : null);
          }, err=>console.warn('progress watch:', err));
        });
      }
      return ()=>{ if(S.progUnsub){ try{ S.progUnsub(); }catch(e){} S.progUnsub=null; S.progUid=null; } };
    },

    /* ---------- LIVE catalog ---------- */
    // cb(catalogOrNull): null = connected but Firestore catalog not published yet.
    watchCatalog(cb, onError){
      ensure().then(ok=>{
        if(!ok){ if(onError) onError(S.error); return; }
        S.catUnsubs.forEach(u=>{ try{ u(); }catch(e){} }); S.catUnsubs=[];
        let main=null, qs=null;
        const fire=()=>{
          if(!S.mainLoaded || !S.qLoaded) return;
          if(!main){ cb && cb(null); return; }
          const catalog = sanitize(main);
          catalog.questions = qs || [];
          cb && cb(catalog);
        };
        const mainRef = S.fsM.doc(S.db,'catalog','main');
        const qCol    = S.fsM.collection(S.db,'catalog','main','questions');
        S.catUnsubs.push(S.fsM.onSnapshot(mainRef, snap=>{
          main = snap.exists() ? snap.data() : null;
          S.mainData = main; S.mainLoaded = true; fire();
        }, err=>{ if(onError) onError(err); }));
        S.catUnsubs.push(S.fsM.onSnapshot(qCol, snap=>{
          qs = snap.docs.map(d=>Object.assign({ id:d.id }, d.data()));
          S.qLoaded = true; fire();
        }, err=>{ if(onError) onError(err); }));
      });
      return ()=>{ S.catUnsubs.forEach(u=>{ try{ u(); }catch(e){} }); S.catUnsubs=[]; S.mainLoaded=false; S.qLoaded=false; };
    },
    async saveMain(mainObj){
      const ok = await ensure(); if(!ok) return { ok:false };
      try{
        await S.fsM.setDoc(S.fsM.doc(S.db,'catalog','main'), sanitize(mainObj), { merge:false });
        return { ok:true };
      }catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },
    async upsertQuestionDoc(q){
      const ok = await ensure(); if(!ok) return { ok:false };
      try{
        await S.fsM.setDoc(S.fsM.doc(S.db,'catalog','main','questions', safeId(q.id)), sanitize(q), { merge:true });
        return { ok:true };
      }catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },
    async deleteQuestionDoc(id){
      const ok = await ensure(); if(!ok) return { ok:false };
      try{
        await S.fsM.deleteDoc(S.fsM.doc(S.db,'catalog','main','questions', safeId(id)));
        return { ok:true };
      }catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },
    lastMain: ()=>S.mainData,
    async publishCatalog(catalog){
      const ok = await ensure(); if(!ok) return { ok:false, reason:'not-configured' };
      try{
        const fsM=S.fsM, db=S.db;
        const main = sanitize(catalog); const questions = main.questions||[];
        delete main.questions;
        main.updatedAt = new Date().toISOString();
        main.updatedAtMs = Date.now();
        // existing question docs (to remove stale ones after publish)
        let existingIds = [];
        try{ const ex = await fsM.getDocs(fsM.collection(db,'catalog','main','questions')); existingIds = ex.docs.map(d=>d.id); }catch(e){}
        const wantedIds = questions.map(q=>safeId(q.id));
        const stale = existingIds.filter(id=>wantedIds.indexOf(id)<0);
        const ops = [];
        ops.push({ t:'set', ref: fsM.doc(db,'catalog','main'), data: main });
        questions.forEach(q=>ops.push({ t:'set', ref: fsM.doc(db,'catalog','main','questions', safeId(q.id)), data: sanitize(q) }));
        stale.forEach(id=>ops.push({ t:'del', ref: fsM.doc(db,'catalog','main','questions', id) }));
        for(let i=0;i<ops.length;i+=449){
          const batch = fsM.writeBatch(db);
          ops.slice(i,i+449).forEach(op=>{ if(op.t==='set') batch.set(op.ref, op.data); else batch.delete(op.ref); });
          await batch.commit();
        }
        return { ok:true, questions: questions.length, removed: stale.length };
      }catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },

    /* ---------- LIVE dojo leaderboard ----------
       One row per signed-in karateka at leaderboard/{uid} — real names,
       real XP, real streaks. Every client watches it live, so the board
       reorders itself the moment anyone earns XP. Demo rows are gone. */
    async pushLeaderboardEntry(uid, entry){
      const ok = await ensure(); if(!ok) return { ok:false };
      try{
        await S.fsM.setDoc(S.fsM.doc(S.db,'leaderboard', uid), sanitize(Object.assign({}, entry, {
          uid: uid,
          updatedAtMs: Date.now()
        })), { merge:true });
        return { ok:true };
      }catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },
    watchLeaderboard(cb, onError){
      if(typeof cb==='function' && S.lbCbs.indexOf(cb)<0) S.lbCbs.push(cb);
      ensure().then(ok=>{
        if(!ok){ S.lbError=S.error; if(onError) onError(S.error); return; }
        if(S.lbUnsub) return; // already watching — callbacks already registered
        S.lbUnsub = S.fsM.onSnapshot(
          S.fsM.query(S.fsM.collection(S.db,'leaderboard'), S.fsM.orderBy('xp','desc'), S.fsM.limit(50)),
          snap=>{
            S.lbError=null;
            S.lbCache = snap.docs.map(d=>Object.assign({ uid:d.id }, d.data()));
            S.lbCbs.forEach(f=>{ try{ f(S.lbCache.slice()); }catch(e){ console.error(e); } });
          },
          err=>{
            S.lbError=String((err&&err.code)||err);
            console.warn('leaderboard watch:', err);
            if(onError) onError(S.lbError);
          }
        );
      });
      return ()=>{ S.lbCbs=[]; if(S.lbUnsub){ try{ S.lbUnsub(); }catch(e){} S.lbUnsub=null; } };
    },
    leaderboard: ()=>S.lbCache.slice(),
    leaderboardError: ()=>S.lbError,

    /* ---------- submissions inbox (feedback / theses / questions) ---------- */
    async addSubmission(obj){
      const ok = await ensure();
      if(!ok) return { ok:false, reason:'not-configured' };
      const doc = sanitize(Object.assign({}, obj, {
        status: obj.status || 'new',
        createdAtMs: Date.now(),
        createdAtISO: new Date().toISOString()
      }));
      try{
        await S.fsM.addDoc(S.fsM.collection(S.db,'submissions'), doc);
        return { ok:true };
      }catch(e){
        try{ const box=readOutbox(); box.push(doc); writeOutbox(box); }catch(_){}
        return { ok:false, queued:true, reason:String((e&&e.code)||e) };
      }
    },
    watchSubmissions(cb, onError){
      if(S.inboxUnsub){ if(typeof cb==='function') S.inboxCbs=[cb]; return S.inboxUnsub; }
      if(typeof cb==='function') S.inboxCbs=[cb];
      ensure().then(ok=>{
        if(!ok){ S.inboxError = S.error; if(onError) onError(S.error); return; }
        S.inboxUnsub = S.fsM.onSnapshot(
          S.fsM.query(S.fsM.collection(S.db,'submissions'), S.fsM.orderBy('createdAtMs','desc'), S.fsM.limit(300)),
          snap=>{
            S.inboxError = null;
            S.inboxCache = snap.docs.map(d=>Object.assign({ id:d.id }, d.data()));
            S.inboxCbs.forEach(f=>{ try{ f(S.inboxCache.slice()); }catch(e){ console.error(e); } });
          },
          err=>{ S.inboxError = String((err&&err.code)||err); if(onError) onError(S.inboxError); }
        );
      });
      return ()=>{ if(S.inboxUnsub){ try{ S.inboxUnsub(); }catch(e){} S.inboxUnsub=null; } S.inboxCbs=[]; };
    },
    inbox: ()=>S.inboxCache.slice(),
    inboxError: ()=>S.inboxError,
    async updateSubmission(id, patch){
      const ok = await ensure(); if(!ok) return { ok:false };
      try{
        await S.fsM.updateDoc(S.fsM.doc(S.db,'submissions', id), sanitize(Object.assign({}, patch, { updatedAtMs: Date.now() })));
        return { ok:true };
      }catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    },
    async deleteSubmission(id){
      const ok = await ensure(); if(!ok) return { ok:false };
      try{ await S.fsM.deleteDoc(S.fsM.doc(S.db,'submissions', id)); return { ok:true }; }
      catch(e){ return { ok:false, reason:String((e&&e.code)||e) }; }
    }
  };

  window.DojoFirebase = api;
  console.log('DojoFirebase loaded —', isConfigured ? 'Firebase config found (connecting…)' : 'LOCAL MODE (paste your keys into firebase-config.js)');
})();
