/* ═══════════════════════════════════════════════════════════════════════════
   ORAL DOJO — dojo-data.js v5 (Firebase-first)
   One data layer for index.html and admin.html. Same API the app already
   uses (getCatalog/getQuestions/upsertQuestion/...), but now:

     1. Firestore is the live source of truth when Firebase is configured.
        Admin saves are pushed straight to Firestore and every karateka's
        browser receives them via onSnapshot — no catalog.json upload.
     2. Without Firebase (or offline) it behaves like before: built-in seed →
        cached catalog → catalog.json, with admin edits kept as a local draft
        that can be published or exported at any time.

   Loading order: seed → localStorage cache → catalog.json (optional) →
   Firebase snapshot. Highest version wins. Admin page (admin.html) will
   auto-seed an empty Firestore with the current best local catalog.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  const CACHE_KEY='oralDojo_catalog_cache';
  const DRAFT_KEY='oralDojo_catalogDraft';

  /* ---------- Built-in seed (only used until catalog.json / Firebase loads) ---------- */
  const SEED={
    version:0, updatedAt:null,
    belts:[
      {id:0, from:'White Belt', to:'9th Kyu', short:'WHITE',  kanji:'白', color:'#FFFFFF', gradient:'from-white to-[#EDEDE8]', focus:['Dojo Etiquette','First Words']},
      {id:1, from:'9th Kyu', to:'8th Kyu', short:'YELLOW', kanji:'黃', color:'#FFD93D', gradient:'from-[#FFE671] to-[#FFC800]', focus:['Kihon Basics','Rei & Zanshin']},
      {id:2, from:'8th Kyu', to:'7th Kyu', short:'ORANGE', kanji:'橙', color:'#FF8C42', gradient:'from-[#FFA968] to-[#F0741D]', focus:['Kata: Heian Shodan','Bunkai']},
      {id:3, from:'7th Kyu', to:'6th Kyu', short:'GREEN',  kanji:'綠', color:'#2ECC71', gradient:'from-[#54E08B] to-[#219a52]', focus:['Kata: Heian Nidan','Dojo History']},
      {id:4, from:'6th Kyu', to:'5th Kyu', short:'BLUE',   kanji:'青', color:'#3498DB', gradient:'from-[#5FB4EA] to-[#2472A4]', focus:['Kata: Heian Sandan','Philosophy']},
      {id:5, from:'5th Kyu', to:'4th Kyu', short:'PURPLE', kanji:'紫', color:'#8E44AD', gradient:'from-[#A66BC4] to-[#6C3483]', focus:['Kata: Heian Yondan','Tradition']},
      {id:6, from:'4th Kyu', to:'3rd Kyu', short:'BROWN',  kanji:'茶', color:'#8B5E3C', gradient:'from-[#A5774F] to-[#6E4529]', focus:['Kata: Heian Godan','Technique Depth']},
      {id:7, from:'3rd Kyu', to:'2nd Kyu', short:'RED',    kanji:'赤', color:'#C0392B', gradient:'from-[#E05B4C] to-[#922B21]', focus:['Kata: Tekki Shodan','Bunkai Depth']},
      {id:8, from:'2nd Kyu', to:'1st Kyu', short:'BROWN 2',kanji:'褐', color:'#6E4B2A', gradient:'from-[#8B6440] to-[#533517]', focus:['Kata: Bassai Dai','Teaching Basics']},
      {id:9, from:'1st Kyu', to:'Shodan',  short:'SHODAN', kanji:'初', color:'#111111', gradient:'from-[#222222] to-[#000000]', focus:['Black Belt Thesis','Grading Etiquette']},
      {id:10,from:'Shodan', to:'Nidan',   short:'NIDAN',  kanji:'弐', color:'#1A1A1A', gradient:'from-[#2b2b2b] to-[#0a0a0a]', focus:['Kata: Jion','Coaching']},
      {id:11,from:'Nidan',  to:'Sandan',  short:'SANDAN', kanji:'参', color:'#262626', gradient:'from-[#333333] to-[#111111]', focus:['Kata: Empi','Dojo Management']},
      {id:12,from:'Sandan', to:'Yondan',  short:'YONDAN', kanji:'肆', color:'#303030', gradient:'from-[#3d3d3d] to-[#181818]', focus:['Kata: Kanku Dai','Sensei Path']}
    ],
    questions:[
      {id:'seed-q1', belt:0, type:'mcq', topic:'Concepts', q:'What does the word Dojo mean?', options:['Place of the way','Fighting arena','Meditation hall','Weapon store'], answer:0, explanation:'Dojo translates to "place of the way" — where the Do (way) is trained.'},
      {id:'seed-q2', belt:0, type:'mcq', topic:'Etiquette', q:'What is the first thing you do when entering the dojo?', options:['Bow (rei)','Sparring','Remove your belt','Count to ten'], answer:0, explanation:'Rei — bowing on entry shows respect for the space, the sensei and the art.'},
      {id:'seed-q3', belt:0, type:'mcq', topic:'Commands', q:'What does the command Hajime mean?', options:['Begin','Stop','Bow','Line up'], answer:0, explanation:'Hajime means "begin". Yame means stop.'},
      {id:'seed-q4', belt:0, type:'mcq', topic:'Etiquette', q:'What does OSS represent in the dojo?', options:['Respect, perseverance and dojo spirit','A fighting shout only','The name of a kata','A salute to opponents'], answer:0, explanation:'OSS compresses respect, perseverance and the dojo spirit into one word.'},
      {id:'seed-q5', belt:0, type:'mcq', topic:'Concepts', q:'What is Zanshin?', options:['Remaining awareness after a technique ends','A kicking drill','A belt rank','A weapon'], answer:0, explanation:'Zanshin is the alert awareness that remains after the technique ends.'}
    ],
    extras:[],
    research:[
      {id:1, title:'Oral grading as a tool for kata understanding', author:'Sensei Bola', rank:'Rokudan', tag:'Methodology', excerpt:'How speaking answers aloud exposes gaps that written tests hide — and how to structure an oral panel.', likes:12},
      {id:2, title:'Retention drills that work on the dojo floor', author:'Sensei Ada', rank:'Godan', tag:'Original Research', excerpt:'Analysis of 200 students: the 3 main reasons beginners quit and 5 drills that improve retention by 40%.', likes:24}
    ],
    leaderboard:[
      {name:'You', belt:'White → 9th Kyu', xp:1240, streak:7},
      {name:'Sensei Bola', belt:'Shodan', xp:2100, streak:12},
      {name:'Chidi O.', belt:'8th Kyu', xp:980, streak:5},
      {name:'Amina K.', belt:'6th Kyu', xp:1610, streak:9}
    ],
    dictionary:[
      {id:'seed-d1', term:'Rei', reading:'れい', category:'Command', definition:'Bow — respect made visible. Rei opens and closes every class and grading.'},
      {id:'seed-d2', term:'Zanshin', reading:'ざんしん', category:'Concept', definition:'Awareness that remains after the technique ends — the mind stays alert.'},
      {id:'seed-d3', term:'Kime', reading:'きめ', category:'Technique', definition:'Focus of power — total concentration at the moment of impact.'},
      {id:'seed-d4', term:'Senpai', reading:'せんぱい', category:'Rank', definition:'Senior student or mentor in the dojo.'}
    ],
    library:[
      {id:'seed-l1', title:'Karate-Do: My Way of Life', author:'Gichin Funakoshi', type:'book', category:'Philosophy', description:"Funakoshi's autobiography — the spirit behind modern karate.", url:''},
      {id:'seed-l2', title:'WKF Kata Rules', author:'World Karate Federation', type:'reference', category:'Rules', description:'Official competition kata rules — scoring, flags and procedure.', url:'https://wkf.net'},
      {id:'seed-l3', title:'The Twenty Guiding Principles of Karate', author:'Gichin Funakoshi', type:'book', category:'Philosophy', description:'The Niju Kun — karate as a way of life, in twenty lines.', url:''}
    ],
    settings:{
      senseiWhatsApp:'2348074001613',
      senseiEmail:'oraldojo@ttosr.com',
      adminPin:'1234',
      sheetdbUrl:''
    }
  };

  const LIST_KEYS=['questions','extras','research','leaderboard','dictionary','library'];

  let base=deepClone(SEED), baseOrigin='seed';
  let draft=null;
  let sourceLabel='Built-in seed';
  let fbLive=false, fbEmpty=false, fbWatched=false;
  const listeners=new Set();
  let lastJson='';

  function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
  function fbMain(){
    try{ return (window.DojoFirebase&&window.DojoFirebase.lastMain)?(window.DojoFirebase.lastMain()||null):null; }
    catch(e){ return null; }
  }
  function adminPage(){
    try{ return /admin\.html?$/i.test((location.pathname||'').split('/').pop()||''); }catch(e){ return false; }
  }
  function normCatalog(c){
    c=c||{};
    LIST_KEYS.forEach(k=>{ if(!Array.isArray(c[k])) c[k]=[]; });
    if(!Array.isArray(c.belts)||!c.belts.length) c.belts=deepClone(SEED.belts);
    c.settings=Object.assign({}, deepClone(SEED.settings), c.settings||{});
    c.version=parseInt(c.version,10)||0;
    if(!c.updatedAt) c.updatedAt=null;
    return c;
  }
  function loadCache(){
    try{ const raw=localStorage.getItem(CACHE_KEY); if(!raw) return null; return normCatalog(JSON.parse(raw)); }catch(e){ return null; }
  }
  function saveCache(c){
    try{ localStorage.setItem(CACHE_KEY, JSON.stringify(c||merged())); }catch(e){}
  }
  function loadDraft(){
    try{ const raw=localStorage.getItem(DRAFT_KEY); return raw?normCatalog(JSON.parse(raw)):null; }catch(e){ return null; }
  }
  function saveDraft(){
    try{ if(draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); else localStorage.removeItem(DRAFT_KEY); }catch(e){}
  }
  function merged(){
    const c=deepClone(base);
    if(draft){
      if(Array.isArray(draft.belts)&&draft.belts.length) c.belts=deepClone(draft.belts);
      LIST_KEYS.forEach(k=>{ if(Array.isArray(draft[k])) c[k]=deepClone(draft[k]); });
      c.settings=Object.assign({}, c.settings, draft.settings||{});
      if((draft.version||0)>(c.version||0)) c.version=draft.version;
    }
    return normCatalog(c);
  }
  function computeSource(){
    const v=(merged().version||0);
    if(fbLive && !fbEmpty) return 'Firebase — LIVE global catalog (v'+v+') • saves go live instantly';
    if(fbLive && fbEmpty) return 'Firebase connected — catalog not published yet (v'+v+')';
    if(draft) return 'Local draft — not yet published (v'+v+')';
    if(baseOrigin==='file') return 'catalog.json — global catalog file (v'+v+')';
    if(baseOrigin==='cache') return 'Cached catalog (v'+v+')';
    return 'Built-in seed catalog (v'+v+')';
  }
  function fireChange(force){
    const j=JSON.stringify(merged());
    if(!force && j===lastJson) return;
    lastJson=j;
    listeners.forEach(cb=>{ try{ cb(api.getCatalog()); }catch(e){ console.error(e); } });
  }

  /* ---------- shared write helpers ---------- */
  async function writeMain(mutator){
    // mutator(nextMainClone) mutates arrays/settings in place
    if(fbLive){
      try{
        const cur=fbMain()||merged();
        const next=deepClone(cur);
        delete next.questions;
        mutator(next);
        next.version=(parseInt(cur.version,10)||0)+1;
        next.updatedAt=new Date().toISOString();
        if(window.DojoFirebase){
          const r=await window.DojoFirebase.saveMain(next);
          if(r&&r.ok) return { ok:true, live:true };
          console.warn('Oral Dojo: Firebase write failed — kept as local draft.', r&&r.reason);
        }
      }catch(e){ console.warn('Oral Dojo: Firebase write error — kept as local draft.', e); }
    }
    if(!draft) draft=deepClone(merged());
    mutator(draft);
    draft.version=(draft.version||0)+1;
    saveDraft();
    sourceLabel=computeSource();
    fireChange(true);
    return { ok:true, live:false };
  }
  function upsertIn(arrName, item){
    return writeMain(m=>{
      m[arrName]=m[arrName]||[];
      const i=m[arrName].findIndex(x=>String(x.id)===String(item.id));
      if(i>=0) m[arrName][i]=item; else m[arrName].push(item);
    });
  }
  function deleteFrom(arrName, id){
    return writeMain(m=>{
      m[arrName]=(m[arrName]||[]).filter(x=>String(x.id)!==String(id));
    });
  }

  /* ---------- Firebase wiring ---------- */
  async function connectFirebase(){
    if(fbWatched) return true;
    if(!window.DojoFirebase || !window.DojoFirebase.isConfigured || !window.DojoFirebase.isConfigured()){
      sourceLabel=computeSource(); return false;
    }
    fbWatched=true;
    window.DojoFirebase.watchCatalog(cat=>{
      if(cat){
        fbLive=true; fbEmpty=false; baseOrigin='firebase';
        base=normCatalog(cat);
        saveCache(base);
        sourceLabel=computeSource();
        fireChange(true);
      }else{
        fbLive=true; fbEmpty=true;
        sourceLabel=computeSource();
        // Admin page seeds an empty Firestore once, from the best local data.
        if(adminPage()){
          api.publishToFirebase().then(r=>{
            if(r&&r.ok) console.log('Oral Dojo: Firebase catalog seeded ('+r.questions+' questions) — live from now on.');
            else console.warn('Oral Dojo: could not seed Firebase catalog.', r&&r.reason);
          });
        }
        fireChange(true);
      }
    }, err=>{
      console.warn('Oral Dojo: Firebase catalog unavailable — staying local.', err);
      fbLive=false; fbEmpty=false;
      sourceLabel=computeSource();
      fireChange(true);
    });
    return true;
  }

  /* ---------- public API (same surface the app already uses) ---------- */
  const api={
    async init(){
      draft=loadDraft();
      const cache=loadCache();
      if(cache){ base=cache; baseOrigin='cache'; }
      try{
        const ctrl=('AbortController' in window)?new AbortController():null;
        const t=ctrl?setTimeout(()=>ctrl.abort(),3500):null;
        const r=await fetch('catalog.json', Object.assign({cache:'no-store'}, ctrl?{signal:ctrl.signal}:{}));
        if(t) clearTimeout(t);
        if(r && r.ok){
          const c=normCatalog(await r.json());
          const better=(c.version||0)>(base.version||0) || ((base.version||0)===0 && (c.questions.length||c.research.length||c.dictionary.length));
          if(better){ base=c; baseOrigin='file'; saveCache(base); }
        }
      }catch(e){ /* catalog.json optional */ }
      sourceLabel=computeSource();
      fireChange(true);
      connectFirebase(); // async — live snapshot replaces local data as soon as it arrives
      return true;
    },
    onChange(cb){ if(typeof cb==='function'){ listeners.add(cb); try{ cb(api.getCatalog()); }catch(e){} } },
    getCatalog(){ return merged(); },
    getSource(){ return sourceLabel; },
    isLive(){ return fbLive && !fbEmpty; },
    isConnected(){ return fbLive; },
    hasDraft(){ return !!draft; },
    getQuestions(){ return merged().questions; },
    getDictionary(){ return merged().dictionary; },
    getResearch(){ return merged().research; },
    getLibrary(){ return merged().library; },
    getBelts(){ return merged().belts; },

    async upsertQuestion(item){
      item=deepClone(item);
      if(!item.id) item.id='q'+item.belt+'-'+Date.now();
      if(fbLive){
        try{
          if(!window.DojoFirebase) throw new Error('no firebase');
          const cur=fbMain()||merged();
          const next=deepClone(cur); delete next.questions;
          next.version=(parseInt(cur.version,10)||0)+1;
          next.updatedAt=new Date().toISOString();
          const rq=await window.DojoFirebase.upsertQuestionDoc(item);
          if(rq&&rq.ok){
            const rm=await window.DojoFirebase.saveMain(next);
            if(rm&&rm.ok) return { ok:true, live:true };
          }
        }catch(e){ console.warn('Question write failed — kept as draft.', e); }
      }
      if(!draft) draft=deepClone(merged());
      draft.questions=draft.questions||[];
      const i=draft.questions.findIndex(q=>String(q.id)===String(item.id));
      if(i>=0) draft.questions[i]=item; else draft.questions.push(item);
      draft.version=(draft.version||0)+1;
      saveDraft(); sourceLabel=computeSource(); fireChange(true);
      return { ok:true, live:false };
    },
    async deleteQuestion(id){
      if(fbLive){
        try{
          if(!window.DojoFirebase) throw new Error('no firebase');
          const cur=fbMain()||merged();
          const next=deepClone(cur); delete next.questions;
          next.version=(parseInt(cur.version,10)||0)+1;
          next.updatedAt=new Date().toISOString();
          const rq=await window.DojoFirebase.deleteQuestionDoc(id);
          if(rq&&rq.ok){
            const rm=await window.DojoFirebase.saveMain(next);
            if(rm&&rm.ok) return { ok:true, live:true };
          }
        }catch(e){ console.warn('Question delete failed — kept as draft.', e); }
      }
      if(!draft) draft=deepClone(merged());
      draft.questions=(draft.questions||[]).filter(q=>String(q.id)!==String(id));
      draft.version=(draft.version||0)+1;
      saveDraft(); sourceLabel=computeSource(); fireChange(true);
      return { ok:true, live:false };
    },
    upsertResearch(item){ return upsertIn('research', deepClone(item)); },
    deleteResearch(id){ return deleteFrom('research', id); },
    upsertDictionary(item){ return upsertIn('dictionary', deepClone(item)); },
    deleteDictionary(id){ return deleteFrom('dictionary', id); },
    upsertLibrary(item){ return upsertIn('library', deepClone(item)); },
    deleteLibrary(id){ return deleteFrom('library', id); },
    updateSettings(patch){ return writeMain(m=>{ m.settings=Object.assign({}, m.settings||{}, patch||{}); }); },

    async importCatalog(obj){
      const c=normCatalog(deepClone(obj));
      if(window.DojoFirebase && window.DojoFirebase.isConfigured && window.DojoFirebase.isConfigured()){
        const r=await api.publishToFirebase(c);
        if(r&&r.ok) return { ok:true, live:true };
      }
      draft=c; draft.version=(c.version||0)+1;
      saveDraft(); sourceLabel=computeSource(); fireChange(true);
      return { ok:true, live:false };
    },
    async publishToFirebase(c){
      if(!window.DojoFirebase || !window.DojoFirebase.isConfigured || !window.DojoFirebase.isConfigured()) return { ok:false, reason:'not-configured' };
      const cat=normCatalog(deepClone(c||merged()));
      cat.version=(parseInt(cat.version,10)||0)+1;
      cat.updatedAt=new Date().toISOString();
      const r=await window.DojoFirebase.publishCatalog(cat);
      if(r&&r.ok){
        base=cat; baseOrigin='firebase';
        draft=null; saveDraft(); saveCache(base);
        sourceLabel=computeSource(); fireChange(true);
      }
      return r;
    },
    async discardDraft(){
      draft=null; saveDraft();
      sourceLabel=computeSource(); fireChange(true);
    },
    exportCatalog(){ return merged(); }
  };

  window.DojoData=api;
})();
