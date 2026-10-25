/* READBOOKS – front end. All user data lives in Supabase (accounts, database, private files).
   The browser only holds the sign-in session. Access is enforced by the database rules in schema.sql. */
(function(){
"use strict";
const PH="Information to be provided by the business owner.";
const MAX_PDF=50*1024*1024;
const cfg=window.READBOOKS_CONFIG||{};
const $=id=>document.getElementById(id);
const app=$("app");
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=id=>$(id).value;
const fmt=t=>new Date(t).toLocaleString([],{dateStyle:"medium",timeStyle:"short"});

/* ---------- not configured yet ---------- */
if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){
  $("menu").innerHTML="";
  app.innerHTML=`<section class="card"><h2>READBOOKS is not connected yet</h2>
  <p>This site needs its account and storage service connected before anyone can sign up.</p>
  <div class="ph">Still to complete: ${esc(PH)} (the SUPABASE_URL and SUPABASE_ANON_KEY settings; see README step 3.)</div></section>`;
  return;
}
const sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

/* ---------- state ---------- */
let session=null, profile=null, route="home", notice=null, draft={};
let books=[], bmCounts={}, hist=[], biz=null, accountCount=null, R=null, loading=false;

const user=()=>session&&session.user;
const verified=()=>!!(user()&&user().email_confirmed_at);

/* ---------- friendly errors (never show raw technical text) ---------- */
function friendly(err,fallback){
  const m=String((err&&(err.message||err.error_description))||"").toLowerCase(), st=err&&err.status;
  if(!navigator.onLine||m.includes("failed to fetch")||m.includes("networkerror")) return "You seem to be offline. Check your connection and try again.";
  if(st===429||m.includes("rate limit")||m.includes("too many")) return "Too many tries. Please wait a few minutes and try again.";
  if(m.includes("invalid login")) return "That email and password don't match. Check them and try again, or create an account.";
  if(m.includes("email not confirmed")) return "Please verify your email first. Check your inbox for our message.";
  if(m.includes("jwt")||st===401) return "Your session ended. Please sign in again.";
  return fallback||"Something went wrong. Please try again.";
}
function banner(){return notice?`<div class="msg ${notice.type}" role="${notice.type==="err"?"alert":"status"}">${esc(notice.text)}</div>`:"";}
function showErr(list,id){$(id||"err").innerHTML=`<div class="msg err" role="alert"><strong>Please check:</strong><ul>${list.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`;}
function showMsg(t,x,id){const e=$(id||"err"); if(e) e.innerHTML=`<div class="msg ${t}" role="${t==="err"?"alert":"status"}">${esc(x)}</div>`;}
function steps(n){const l=["Account","Add a book","Read"];return `<ol class="steps" aria-label="Progress">${l.map((t,i)=>`<li class="${i+1<n?"done":i+1===n?"on":""}" ${i+1===n?'aria-current="step"':""}>${i+1}. ${t}</li>`).join("")}</ol>`;}

/* ---------- navigation ---------- */
function go(r,n){
  const saved=pending?flushPos(false):Promise.resolve();   /* make sure the reading place is saved before leaving */
  saved.then(()=>{ leaveReader(); route=r; notice=n||null; return load(); }).then(()=>{render(); app.focus(); window.scrollTo(0,0);});
}
function menu(){
  let h="";
  if(!user()) h=`<button class="btn" data-go="home">Home</button><button class="btn" data-go="signin">Sign in</button><button class="btn" data-go="privacy">Privacy</button>`;
  else{
    h=`<button class="btn" data-go="library">My books</button><button class="btn" data-go="history">My history</button>`;
    if(profile&&profile.role==="owner") h+=`<button class="btn" data-go="owner">Owner area</button>`;
    h+=`<button class="btn" data-go="privacy">Privacy</button><button class="btn" id="out">Sign out</button>`;
  }
  $("menu").innerHTML=h;
  $("menu").querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  const o=$("out"); if(o) o.onclick=signOut;
}
async function signOut(){
  await flushPos(true); leaveReader();
  await sb.auth.signOut(); session=null; profile=null; books=[]; hist=[];
  go("home",{type:"ok",text:"You're signed out. Your place in each book is saved to your account."});
}

/* ---------- data loading per screen ---------- */
async function load(){
  loading=true;
  try{
    if(user()&&!profile){ const {data}=await sb.from("profiles").select("display_name,role").maybeSingle(); profile=data; }
    if(route==="library"||route==="home"){ if(user()) await loadBooks(); }
    if(route==="history"&&user()){
      const {data,error}=await sb.from("history").select("type,page,created_at,book_id,books(title)").order("created_at",{ascending:false}).limit(60);
      if(error) throw error; hist=data||[];
      await loadBooks();
    }
    if(route==="privacy"||route==="owner"){
      const {data}=await sb.from("business_info").select("*").maybeSingle(); biz=data;
      if(route==="owner"){ const r=await sb.rpc("account_count"); accountCount=r.data; }
    }
  }catch(e){ notice={type:"err",text:friendly(e,"We couldn't load your information. Please try again.")}; }
  loading=false;
}
async function loadBooks(){
  const {data,error}=await sb.from("books").select("id,title,file_path,file_size,page_count,last_page,last_opened,created_at").order("created_at",{ascending:false});
  if(error) throw error; books=data||[];
  const b=await sb.from("bookmarks").select("book_id"); bmCounts={};
  (b.data||[]).forEach(x=>{bmCounts[x.book_id]=(bmCounts[x.book_id]||0)+1;});
}
const lastBook=()=>books.filter(b=>b.last_opened).sort((a,b)=>new Date(b.last_opened)-new Date(a.last_opened))[0];

function render(){
  menu();
  document.querySelector('meta[name=robots]').setAttribute("content",user()?"noindex,nofollow":"index,follow");
  if(["library","reader","history","owner"].includes(route)&&!user()) route="signin";
  if(route==="owner"&&!(profile&&profile.role==="owner")) route="library";
  const views={home,signin,signup,forgot,reset,library,reader,history,owner,privacy};
  const binds={home:bindHome,signin:bindSignin,signup:bindSignup,forgot:bindForgot,reset:bindReset,library:bindLibrary,reader:bindReader,history:bindHistory,owner:bindOwner,privacy:bindPrivacy};
  app.innerHTML=banner()+views[route]();
  if(binds[route]) binds[route]();
}

/* ---------- HOME ---------- */
function home(){
  const last=user()&&lastBook();
  return `<section class="hero"><h2>Upload a book, read it, and bookmark your place.</h2>
  <p>READBOOKS lets you upload a book as a PDF, read it, and put a bookmark in so you can easily go back to where you left off. For people who want to keep their online reading easy and fun.</p>
  ${last?`<button class="btn" id="cont">Continue “${esc(last.title)}” on page ${last.last_page}</button>`:`<button class="btn" id="start">${user()?"Go to my books":"Start here: create your account"}</button>`}</section>
  <section class="card"><h3>Why you need an account</h3>
  <p>Your account is how READBOOKS keeps your books, bookmarks and last-read page, so you can continue on any device. Sign in again and you pick up right where you left off. Nobody else can see your books.</p></section>
  <section class="card"><h3>Start here: three steps</h3>
  <ol><li><strong>Create an account.</strong> It saves your place for you.</li><li><strong>Add a book.</strong> Choose a PDF file from your device.</li><li><strong>Read and bookmark.</strong> Your last page is saved automatically.</li></ol>
  <p class="hint">Recommended addition (not a core feature): this “start here” path.</p></section>`;
}
function bindHome(){
  const s=$("start"); if(s) s.onclick=()=>go(user()?"library":"signup");
  const c=$("cont"); if(c) c.onclick=()=>openReader(lastBook().id);
}

/* ---------- AUTH ---------- */
function signup(){
  return steps(1)+`<section class="card"><h2>Create your account</h2>
  <p>We ask for an account so your books, bookmarks and last-read page are saved and follow you to any device.</p>
  <form id="f" novalidate>
  <label for="n">Name or nickname</label><input id="n" type="text" autocomplete="nickname" maxlength="40" value="${esc(draft.n)}">
  <p class="hint">Shown only to you inside the app.</p>
  <label for="e">Email</label><input id="e" type="email" autocomplete="email" value="${esc(draft.e)}">
  <p class="hint">Used to sign you in, verify your account and reset your password.</p>
  <label for="p">Password</label><input id="p" type="password" autocomplete="new-password" aria-describedby="ph"><p class="hint" id="ph">At least 8 characters.</p>
  <label class="check"><input id="c" type="checkbox" ${draft.c?"checked":""}><span>I agree to READBOOKS keeping my name, email, the PDF books I add, my bookmarks and notes, my last-read page for each book, and a list of my recent activity, so my place is saved. I can delete everything in Privacy.</span></label>
  <div id="err"></div><button class="btn full" type="submit">Create account</button></form>
  <p>Already have one? <a href="#" id="si">Sign in</a></p></section>`;
}
function bindSignup(){
  $("si").onclick=e=>{e.preventDefault();go("signin");};
  $("f").onsubmit=async e=>{
    e.preventDefault();
    const n=val("n").trim(), em=val("e").trim().toLowerCase(), pw=val("p"), c=$("c").checked; draft={n,e:em,c};
    const errs=[];
    if(!n) errs.push("Please enter a name or nickname.");
    if(n.length>40) errs.push("Your name can be up to 40 characters.");
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) errs.push("Please enter an email like name@example.com.");
    if(pw.length<8) errs.push("Your password needs at least 8 characters.");
    if(!c) errs.push("Please tick the box to agree.");
    if(errs.length) return showErr(errs);
    const b=e.target.querySelector("button[type=submit]"); b.disabled=true;
    const {data,error}=await sb.auth.signUp({email:em,password:pw,options:{data:{display_name:n},emailRedirectTo:location.origin+location.pathname}});
    b.disabled=false;
    if(error) return showErr([friendly(error,"We couldn't create your account. Please try again.")]);
    draft={};
    if(data.session){ session=data.session; profile=null; return go("library",{type:"ok",text:"Account created. Next: add your first book."}); }
    go("signin",{type:"ok",text:"Almost done. We've sent a message to "+em+". Open it and press the link to verify your email, then sign in. If you don't see it, check your spam folder."});
  };
}
function signin(){
  return `<section class="card"><h2>Sign in</h2><form id="f" novalidate>
  <label for="e">Email</label><input id="e" type="email" autocomplete="email" value="${esc(draft.e)}">
  <label for="p">Password</label><input id="p" type="password" autocomplete="current-password">
  <div id="err"></div><button class="btn full" type="submit">Sign in</button></form>
  <p><a href="#" id="fg">Forgot your password?</a> · <a href="#" id="su">Create an account</a></p>
  <p><button class="btn alt small" id="rs" type="button">Resend verification email</button></p></section>`;
}
function bindSignin(){
  $("su").onclick=e=>{e.preventDefault();go("signup");};
  $("fg").onclick=e=>{e.preventDefault();go("forgot");};
  $("rs").onclick=async()=>{
    const em=val("e").trim().toLowerCase(); draft={e:em};
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return showErr(["Type your email above first, then press Resend."]);
    const {error}=await sb.auth.resend({type:"signup",email:em,options:{emailRedirectTo:location.origin+location.pathname}});
    if(error) return showErr([friendly(error)]);
    showMsg("ok","If that email has an unverified account, we've sent the message again.");
  };
  $("f").onsubmit=async e=>{
    e.preventDefault();
    const em=val("e").trim().toLowerCase(), pw=val("p"); draft={e:em};
    if(!em||!pw) return showErr(["Enter your email and password."]);
    const b=e.target.querySelector("button[type=submit]"); b.disabled=true;
    const {data,error}=await sb.auth.signInWithPassword({email:em,password:pw});
    b.disabled=false;
    if(error) return showErr([friendly(error)]);
    session=data.session; profile=null; draft={};
    await flushPending();
    await loadBooks().catch(()=>{});
    const last=lastBook();
    go("library",{type:"ok",text:last?`Welcome back. You were reading “${last.title}” on page ${last.last_page}.`:"Welcome back."});
  };
}
function forgot(){
  return `<section class="card"><h2>Reset your password</h2><p>Enter your email and we'll send you a link to choose a new password.</p>
  <form id="f" novalidate><label for="e">Email</label><input id="e" type="email" autocomplete="email" value="${esc(draft.e)}"><div id="err"></div>
  <button class="btn full" type="submit">Send reset link</button></form><p><a href="#" id="bk">Back to sign in</a></p></section>`;
}
function bindForgot(){
  $("bk").onclick=e=>{e.preventDefault();go("signin");};
  $("f").onsubmit=async e=>{
    e.preventDefault(); const em=val("e").trim().toLowerCase(); draft={e:em};
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return showErr(["Please enter an email like name@example.com."]);
    const {error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname});
    if(error&&(error.status===429)) return showErr([friendly(error)]);
    showMsg("ok","If that email has an account, we've sent a reset link. Check your inbox and spam folder.");
  };
}
function reset(){
  return `<section class="card"><h2>Choose a new password</h2><form id="f" novalidate>
  <label for="p">New password</label><input id="p" type="password" autocomplete="new-password"><p class="hint">At least 8 characters.</p><div id="err"></div>
  <button class="btn full" type="submit">Save new password</button></form></section>`;
}
function bindReset(){
  $("f").onsubmit=async e=>{
    e.preventDefault(); const pw=val("p");
    if(pw.length<8) return showErr(["Your password needs at least 8 characters."]);
    const {error}=await sb.auth.updateUser({password:pw});
    if(error) return showErr([friendly(error,"We couldn't change your password. The link may have expired; request a new one.")]);
    go("library",{type:"ok",text:"Your password was changed."});
  };
}

/* ---------- LIBRARY ---------- */
function library(){
  const last=lastBook();
  return steps(books.length?3:2)+(last?`<section class="card"><h3>Continue reading</h3><p><strong>${esc(last.title)}</strong>, page ${last.last_page}${last.page_count?` of ${last.page_count}`:""}</p><button class="btn full" data-read="${esc(last.id)}">Continue where I left off</button></section>`:"")+`
  <section class="card"><h2>Add a book</h2>
  ${verified()?"":`<div class="msg info" role="status">Please verify your email before adding a book. Open the message we sent you and press the link, then refresh this page.</div>`}
  <form id="uf" novalidate><label for="file">Choose a PDF file</label><input id="file" type="file" accept="application/pdf,.pdf">
  <p class="hint">PDF only, up to 50 MB. Your file is private to your account.</p>
  <label for="title">Book title</label><input id="title" type="text" maxlength="120" value="${esc(draft.title)}" placeholder="Filled in from the file name">
  <div id="err"></div><progress id="prog" max="100" value="0" hidden aria-label="Upload progress"></progress>
  <button class="btn full" type="submit" id="upb" ${verified()?"":"disabled"}>Add to my books</button></form></section>
  <section class="card"><h2>My books</h2>
  ${books.length?books.map((b,i)=>{const pct=b.page_count?Math.round(b.last_page/b.page_count*100):0,n=bmCounts[b.id]||0;
    return `<div class="item ${i?"":"first"}"><div class="info"><strong>${esc(b.title)}</strong><br><span class="hint">Page ${b.last_page}${b.page_count?` of ${b.page_count} · ${pct}%`:""} · ${n} bookmark${n===1?"":"s"}</span><div class="bar" aria-hidden="true"><span style="width:${pct}%"></span></div></div>
    <div class="row fixed"><button class="btn" data-read="${esc(b.id)}">${b.last_opened?"Continue":"Start reading"}</button><button class="btn alt" data-del="${esc(b.id)}" aria-label="Remove ${esc(b.title)}">Remove</button></div></div>`;}).join("")
  :`<div class="empty"><p><strong>No books yet.</strong></p><p>Add a PDF above to start reading.</p></div>`}</section>`;
}
function bindLibrary(){
  document.querySelectorAll("[data-read]").forEach(b=>b.onclick=()=>openReader(b.dataset.read));
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    const bk=books.find(x=>x.id===b.dataset.del); if(!bk) return;
    if(!confirm(`Remove “${bk.title}” and its bookmarks? This can't be undone.`)) return;
    const r1=await sb.storage.from("books").remove([bk.file_path]);
    if(r1.error) return go("library",{type:"err",text:friendly(r1.error,"We couldn't remove the file. Please try again.")});
    const r2=await sb.from("books").delete().eq("id",bk.id);
    if(r2.error) return go("library",{type:"err",text:friendly(r2.error,"We couldn't remove the book. Please try again.")});
    go("library",{type:"ok",text:"Book removed."});
  });
  $("uf").onsubmit=upload;
}
async function upload(e){
  e.preventDefault();
  const f=$("file").files[0], t=val("title").trim(); draft={title:t};
  const errs=[];
  if(!verified()) errs.push("Please verify your email before adding a book.");
  if(!f) errs.push("Choose a PDF file to add.");
  else if(f.size===0) errs.push("That file is empty. Choose another one.");
  else if(f.size>MAX_PDF) errs.push("That file is over 50 MB. Try a smaller PDF.");
  else if(!/\.pdf$/i.test(f.name)&&f.type!=="application/pdf") errs.push("That isn't a PDF. READBOOKS only reads PDF files.");
  if(t.length>120) errs.push("The title can be up to 120 characters.");
  if(errs.length) return showErr(errs);
  const head=new Uint8Array(await f.slice(0,5).arrayBuffer());
  if(String.fromCharCode.apply(null,head)!=="%PDF-") return showErr(["That file doesn't look like a real PDF. Try another file."]);
  const btn=$("upb"), prog=$("prog"); btn.disabled=true; btn.textContent="Checking…";
  let pages;
  try{
    await initPdf();
    const d=await pdfjsLib.getDocument({data:new Uint8Array(await f.arrayBuffer()),isEvalSupported:false}).promise; pages=d.numPages; d.destroy();
  }catch(err){
    btn.disabled=false; btn.textContent="Add to my books";
    return showErr([pdfErrText(err)]);
  }
  const id=crypto.randomUUID(), path=`${user().id}/${id}.pdf`;
  btn.textContent="Uploading…"; prog.hidden=false; prog.value=0;
  try{ await putFile(path,f,p=>{prog.value=p;}); }
  catch(err){ btn.disabled=false; btn.textContent="Try again"; prog.hidden=true; return showErr([friendly(err,"The upload didn't finish. Check your connection and press Try again.")]); }
  const title=(t||f.name.replace(/\.pdf$/i,"")).slice(0,120)||"Untitled book";
  const ins=await sb.from("books").insert({id,title,file_path:path,file_size:f.size,page_count:pages});
  if(ins.error){ await sb.storage.from("books").remove([path]); btn.disabled=false; btn.textContent="Try again"; prog.hidden=true; return showErr([friendly(ins.error,"We couldn't save the book. Please try again.")]); }
  await sb.from("history").insert({book_id:id,type:"added",page:1});
  draft={}; go("library",{type:"ok",text:`“${title}” was added. Press Start reading.`});
}
function putFile(path,file,onp){
  return new Promise((res,rej)=>{
    const x=new XMLHttpRequest();
    x.open("POST",`${cfg.SUPABASE_URL}/storage/v1/object/books/${path.split("/").map(encodeURIComponent).join("/")}`);
    x.setRequestHeader("Authorization","Bearer "+session.access_token); x.setRequestHeader("apikey",cfg.SUPABASE_ANON_KEY);
    x.setRequestHeader("Content-Type","application/pdf"); x.setRequestHeader("x-upsert","false");
    x.upload.onprogress=ev=>{ if(ev.lengthComputable) onp(Math.round(ev.loaded/ev.total*100)); };
    x.onload=()=>x.status>=200&&x.status<300?res():rej({status:x.status,message:"upload failed"});
    x.onerror=()=>rej({message:"failed to fetch"});
    x.send(file);
  });
}

/* ---------- READER ---------- */
let pdfReady=false;
async function initPdf(){
  if(!window.pdfjsLib) throw {message:"nolib"};
  if(!pdfReady){ pdfjsLib.GlobalWorkerOptions.workerSrc="vendor/pdf.worker.min.js"; pdfReady=true; }
}
function pdfErrText(err){
  const n=err&&err.name, m=err&&err.message;
  if(m==="nolib") return "The PDF reader couldn't load. Refresh the page and try again.";
  if(n==="PasswordException") return "This PDF is password-protected, which READBOOKS can't open yet. Remove the password and add it again.";
  if(n==="InvalidPDFException"||n==="FormatError") return "This PDF looks damaged and can't be opened. Try another copy.";
  return "We couldn't open this PDF. Try another file.";
}
function openReader(id){ leaveReader(); route="reader"; notice=null; R={id,doc:null,page:1,zoom:0,task:null,gen:0}; render(); app.focus(); window.scrollTo(0,0); }
function leaveReader(){ document.body.classList.remove("noscroll"); if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); flushPos(true); if(R){ try{R.task&&R.task.cancel();}catch(e){} try{R.doc&&R.doc.destroy();}catch(e){} R=null; } clearTimeout(posTimer); }
function reader(){
  const b=R&&books.find(x=>x.id===R.id);
  if(!b) return `<section class="card"><div class="empty"><p><strong>We couldn't find that book.</strong></p><button class="btn" id="back0">Back to my books</button></div></section>`;
  return steps(3)+`<section class="card"><div class="row"><h2 style="margin:0;flex:1 1 200px;overflow-wrap:anywhere">${esc(b.title)}</h2><button class="btn alt" id="back" style="flex:0 0 auto">Back to my books</button></div></section>
  <div id="rmsg"></div>
  <div class="reader"><div id="rwrap">
    <div class="ctrl" role="group" aria-label="Page controls">
      <button class="btn alt" id="prev" aria-label="Previous page">◀ Back</button>
      <label class="sr" for="pg">Page number</label><input id="pg" type="number" min="1" value="${b.last_page}" inputmode="numeric"><span id="of" aria-live="polite"></span>
      <button class="btn alt" id="next" aria-label="Next page">Next ▶</button>
      <button class="btn alt" id="zo" aria-label="Zoom out">−</button><button class="btn alt" id="zi" aria-label="Zoom in">+</button><button class="btn alt" id="zf">Fit width</button>
      <button class="btn alt" id="fs">⛶ Full screen</button><button class="btn alt" id="addbm2" hidden>★ Bookmark</button>
    </div>
    <div class="stage" id="stage" tabindex="0" aria-label="Book page"><p class="hint" id="loading" role="status">Opening your book…</p><canvas id="cv" hidden></canvas></div>
    <p class="hint">Tip: use the left and right arrow keys to turn pages. Your page is saved automatically.</p>
  </div>
  <aside class="card" aria-labelledby="bmh"><h3 id="bmh" style="margin-top:0">Bookmarks</h3>
    <button class="btn full" id="addbm" style="margin-top:0">Bookmark this page</button>
    <label for="bml">Note (optional)</label><input id="bml" type="text" maxlength="60" placeholder="e.g. Chapter 2 starts">
    <div id="bms" style="margin-top:10px"></div></aside></div>`;
}
let bmList=[];
function drawBms(){
  const el=$("bms"); if(!el) return;
  const l=[...bmList].sort((a,b)=>a.page-b.page);
  el.innerHTML=l.length?l.map(m=>`<div class="bm"><div><strong>Page ${m.page}</strong>${m.note?`<br><span class="hint">${esc(m.note)}</span>`:""}</div><div class="row fixed"><button class="btn alt small" data-gp="${m.page}" aria-label="Go to page ${m.page}">Go</button><button class="btn alt small" data-rm="${esc(m.id)}" aria-label="Remove bookmark on page ${m.page}">✕</button></div></div>`).join("")
    :`<p class="empty" style="padding:10px 0">No bookmarks yet. Press “Bookmark this page”.</p>`;
  el.querySelectorAll("[data-gp]").forEach(x=>x.onclick=()=>showPage(+x.dataset.gp));
  el.querySelectorAll("[data-rm]").forEach(x=>x.onclick=async()=>{
    const {error}=await sb.from("bookmarks").delete().eq("id",x.dataset.rm);
    if(error) return showMsg("err",friendly(error,"We couldn't remove that bookmark."),"rmsg");
    bmList=bmList.filter(m=>m.id!==x.dataset.rm); drawBms(); showMsg("ok","Bookmark removed.","rmsg");
  });
}
async function bindReader(){
  const b=R&&books.find(x=>x.id===R.id);
  if(!b){ const x=$("back0"); if(x) x.onclick=()=>go("library"); return; }
  $("back").onclick=()=>go("library");
  $("prev").onclick=()=>showPage(R.page-1); $("next").onclick=()=>showPage(R.page+1);
  $("pg").onchange=()=>showPage(parseInt(val("pg"),10));
  $("zi").onclick=()=>zoom(1.2); $("zo").onclick=()=>zoom(1/1.2); $("zf").onclick=()=>{R.zoom=0;draw();};
  $("fs").onclick=()=>setFull(!$("rwrap").classList.contains("full"));
  const addBm=async()=>{
    if(!R||!R.doc) return;
    if(bmList.some(m=>m.page===R.page)) return showMsg("info","This page is already bookmarked.","rmsg");
    const note=val("bml").trim().slice(0,60);
    const {data,error}=await sb.from("bookmarks").insert({book_id:b.id,page:R.page,note}).select("id,page,note").single();
    if(error) return showMsg("err",error.code==="23505"?"This page is already bookmarked.":friendly(error,"We couldn't save that bookmark. Please try again."),"rmsg");
    await sb.from("history").insert({book_id:b.id,type:"bookmark",page:R.page});
    bmList.push(data); $("bml").value=""; drawBms(); showMsg("ok",`Bookmarked page ${R.page}.`,"rmsg");
  };
  $("addbm").onclick=addBm; $("addbm2").onclick=addBm;
  const my=R, ld=$("loading");
  try{
    await initPdf();
    const bm=await sb.from("bookmarks").select("id,page,note").eq("book_id",b.id);
    if(bm.error) throw bm.error; bmList=bm.data||[]; drawBms();
    const fresh=await sb.from("books").select("last_page,page_count").eq("id",b.id).single();   /* latest place from the account, e.g. saved on another device */
    if(fresh.data){ b.last_page=fresh.data.last_page; }
    const su=await sb.storage.from("books").createSignedUrl(b.file_path,120);
    if(su.error||!su.data) throw {message:"missing"};
    const resp=await fetch(su.data.signedUrl); if(!resp.ok) throw {message:"missing"};
    const doc=await pdfjsLib.getDocument({data:new Uint8Array(await resp.arrayBuffer()),isEvalSupported:false}).promise;
    if(R!==my){ doc.destroy(); return; }
    R.doc=doc;
    if(b.page_count!==doc.numPages){ b.page_count=doc.numPages; await sb.from("books").update({page_count:doc.numPages}).eq("id",b.id); }
    b.last_page=Math.min(Math.max(1,b.last_page||1),doc.numPages); R.page=b.last_page;
    $("pg").max=doc.numPages; $("pg").value=R.page; $("of").textContent="of "+doc.numPages;
    ld.hidden=true; $("cv").hidden=false;
    queuePos(); await sb.from("history").insert({book_id:b.id,type:"opened",page:R.page});
    showMsg("info",R.page>1?`Welcome back. Opened to page ${R.page}, where you left off.`:"Your book is ready.","rmsg");
    await draw();
  }catch(err){
    if(R!==my) return; ld.textContent="";
    showMsg("err",err&&err.message==="missing"?"We couldn't find this book's file. Remove the book and add the PDF again.":(err&&err.name?pdfErrText(err):friendly(err,"We couldn't open this book. Please try again.")),"rmsg");
  }
}
function zoom(f){ R.zoom=Math.min(4,Math.max(.4,(R.zoom||R.fit||1)*f)); draw(); }
function showPage(n){
  if(!R||!R.doc) return;
  if(!Number.isFinite(n)||n<1||n>R.doc.numPages){ $("pg").value=R.page; return showMsg("err",`Enter a page between 1 and ${R.doc.numPages}.`,"rmsg"); }
  R.page=n; $("pg").value=n; const b=books.find(x=>x.id===R.id); if(b) b.last_page=n;
  queuePos(); draw();
}
async function draw(){
  if(!R||!R.doc) return;
  const my=R, gen=++R.gen;
  try{ R.task&&R.task.cancel(); }catch(e){}
  const page=await R.doc.getPage(R.page); if(R!==my||gen!==R.gen) return;
  const st=$("stage"), base=page.getViewport({scale:1});
  const fit=Math.max(.3,(st.clientWidth-24)/base.width); R.fit=fit;
  const vp=page.getViewport({scale:R.zoom||fit}), cv=$("cv"), dpr=window.devicePixelRatio||1;
  cv.width=Math.floor(vp.width*dpr); cv.height=Math.floor(vp.height*dpr); cv.style.width=Math.floor(vp.width)+"px"; cv.style.height=Math.floor(vp.height)+"px";
  R.task=page.render({canvasContext:cv.getContext("2d"),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
  try{ await R.task.promise; }catch(e){ if(e&&e.name==="RenderingCancelledException") return; showMsg("err","This page couldn't be shown. Try another page.","rmsg"); }
  if(R===my&&gen===R.gen){ $("prev").disabled=R.page<=1; $("next").disabled=R.page>=R.doc.numPages; st.scrollTop=0; cv.setAttribute("aria-label",`Page ${R.page} of ${R.doc.numPages}`); }
}
function setFull(on){
  const w=$("rwrap"); if(!w) return;
  w.classList.toggle("full",on); document.body.classList.toggle("noscroll",on);
  $("fs").textContent=on?"✕ Exit full screen":"⛶ Full screen"; $("addbm2").hidden=!on;
  if(on&&w.requestFullscreen) w.requestFullscreen().catch(()=>{});   /* true full screen where the browser allows it; otherwise the page fills the window */
  if(!on&&document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  setTimeout(()=>{ if(R&&R.doc) draw(); },150);
}
document.addEventListener("fullscreenchange",()=>{ const w=$("rwrap"); if(!document.fullscreenElement&&w&&w.classList.contains("full")) setFull(false); });
document.addEventListener("keydown",e=>{
  if(route!=="reader"||!R||!R.doc) return;
  const t=e.target.tagName; if(t==="INPUT"||t==="TEXTAREA") return;
  if(e.key==="ArrowRight"){ e.preventDefault(); showPage(R.page+1); }
  else if(e.key==="ArrowLeft"){ e.preventDefault(); showPage(R.page-1); }
  else if(e.key==="Escape"){ const w=$("rwrap"); if(w&&w.classList.contains("full")) setFull(false); }
});
window.addEventListener("resize",()=>{ if(route==="reader"&&R&&R.doc&&!R.zoom) draw(); });

/* ---------- saving where you stopped ---------- */
let pending=null, posTimer=null;
const PKEY="readbooks.pending";
function queuePos(){
  if(!R||!user()) return;
  pending={uid:user().id,id:R.id,page:R.page};
  try{localStorage.setItem(PKEY,JSON.stringify(pending));}catch(e){}
  clearTimeout(posTimer); posTimer=setTimeout(()=>flushPos(false),800);
}
async function flushPos(unloading){
  if(!pending||!session) return;
  const p=pending, body={last_page:p.page,last_opened:new Date().toISOString()};
  try{
    if(unloading){
      fetch(`${cfg.SUPABASE_URL}/rest/v1/books?id=eq.${encodeURIComponent(p.id)}`,{method:"PATCH",keepalive:true,headers:{"Content-Type":"application/json",apikey:cfg.SUPABASE_ANON_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify(body)}).catch(()=>{});
      return;
    }
    const {error}=await sb.from("books").update(body).eq("id",p.id);
    if(error) throw error;
    if(pending===p){ pending=null; try{localStorage.removeItem(PKEY);}catch(e){} }
  }catch(e){
    if(route==="reader") showMsg("info","Your place couldn't be saved just now. We'll keep trying.","rmsg");
    setTimeout(()=>flushPos(false),15000);
  }
}
async function flushPending(){   /* after signing in, send a place that couldn't be saved earlier (same person only) */
  try{ const p=JSON.parse(localStorage.getItem(PKEY)||"null"); if(p&&user()&&p.uid===user().id){ pending=p; await flushPos(false); } else if(p) localStorage.removeItem(PKEY); }catch(e){}
}
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") flushPos(true); });
window.addEventListener("pagehide",()=>flushPos(true));
window.addEventListener("online",()=>{ $("net").hidden=true; flushPos(false); });
window.addEventListener("offline",()=>{ $("net").hidden=false; });
if(!navigator.onLine) $("net").hidden=false;

/* ---------- HISTORY ---------- */
function history(){
  const lbl={added:"Added",opened:"Opened",bookmark:"Bookmarked"};
  return `<section class="card"><h2>My history</h2><p class="hint">Only you can see this. Showing your latest activity.</p>
  ${hist.length?hist.map((h,i)=>{const bk=books.find(b=>b.id===h.book_id);
    return `<div class="item ${i?"":"first"}"><div class="info"><strong>${lbl[h.type]||esc(h.type)}: ${esc(h.books&&h.books.title||"A book")}</strong>${h.page?` · page ${h.page}`:""}<br><span class="hint">${fmt(h.created_at)}</span></div>${bk&&h.type!=="added"&&h.page?`<button class="btn alt" data-pg="${esc(h.book_id)}|${h.page}">Go to page ${h.page}</button>`:""}</div>`;}).join("")
  :`<div class="empty"><p><strong>Nothing here yet.</strong></p><p>Add a book and start reading. Your history will show up here.</p><button class="btn" id="mk">Go to my books</button></div>`}</section>`;
}
function bindHistory(){
  const mk=$("mk"); if(mk) mk.onclick=()=>go("library");
  document.querySelectorAll("[data-pg]").forEach(b=>b.onclick=async()=>{
    const [id,p]=b.dataset.pg.split("|"); const bk=books.find(x=>x.id===id); if(!bk) return;
    bk.last_page=+p; openReader(id); queuePos();
  });
}

/* ---------- OWNER ---------- */
function owner(){
  const o=biz||{};
  const f=(k,l,long)=>`<label for="o_${k}">${l}</label><${long?'textarea rows="4"':'input type="text"'} id="o_${k}"${long?"":` value="${esc(o[k])}"`}>${long?esc(o[k]):""}${long?"</textarea>":""}${o[k]===PH?`<div class="ph">Still to complete: ${esc(PH)}</div>`:""}`;
  return `<section class="card"><h2>Owner area</h2><p>Only the owner account can change this. It holds only the information the privacy and account screens need. It does not show anyone's books, bookmarks or history.</p>
  <form id="of">${f("terms","Terms of use",1)}${f("privacy_policy","Privacy policy",1)}${f("retention","How long books and bookmarks are kept")}${f("support_contact","Support contact")}${f("business_contact","Business contact details")}
  <div id="err"></div><button class="btn full" type="submit">Save</button></form></section>
  <section class="card"><h3>Handoff notes</h3>
  <details open><summary>Open items</summary><p>The spec says “Just me” but also requires customer accounts. This build lets anyone create a reader account; the first account ever created is the owner. Please confirm that is what you want.</p>
  <p>No blockchain was built. It could be reconsidered later (for example BSV with @bsv/simple on a trusted server, testnet first, never storing private content on-chain).</p></details>
  <details><summary>Accounts</summary><p>${accountCount==null?"Not available.":`${accountCount} account${accountCount===1?"":"s"}`}</p><p class="hint">A count only. Books and bookmarks are private to each reader.</p></details></section>`;
}
function bindOwner(){
  $("of").onsubmit=async e=>{
    e.preventDefault();
    const keys=["terms","privacy_policy","retention","support_contact","business_contact"], upd={};
    for(const k of keys){ const v=val("o_"+k).trim(); if(v.length>8000) return showErr(["Please keep each entry under 8000 characters."]); upd[k]=v||PH; }
    const {error}=await sb.from("business_info").update(upd).eq("id",1);
    if(error) return showErr([friendly(error,"We couldn't save. Please try again.")]);
    go("owner",{type:"ok",text:"Saved."});
  };
}

/* ---------- PRIVACY ---------- */
function privacy(){
  const o=biz||{terms:PH,privacy_policy:PH,retention:PH,support_contact:PH};
  return `<section class="card"><h2>Privacy</h2>
  <p>With an account we keep: your name or nickname, your email, your password (stored only in scrambled form by our sign-in service), the PDF books you add, your bookmarks and notes, your last-read page for each book, and a list of your recent activity. We keep them so you can come back to where you left off on any device. Nothing is on a public page, and we don't use advertising or tracking.</p>
  <p><strong>Privacy policy:</strong><br>${esc(o.privacy_policy).replace(/\n/g,"<br>")}</p><p><strong>How long things are kept:</strong> ${esc(o.retention)}</p>
  <p><strong>Terms:</strong><br>${esc(o.terms).replace(/\n/g,"<br>")}</p><p><strong>Support:</strong> ${esc(o.support_contact)}</p></section>
  ${user()?`<section class="card"><h3>Delete my data</h3><p>This permanently removes your account, your books and files, bookmarks and history. It can't be undone.</p>
  <form id="df" novalidate><label for="cf">Type DELETE to confirm</label><input id="cf" type="text" autocomplete="off">
  <label for="dp">Your password</label><input id="dp" type="password" autocomplete="current-password"><div id="err"></div>
  <button class="btn danger full" type="submit">Delete my account and data</button></form></section>`:""}`;
}
function bindPrivacy(){
  const f=$("df"); if(!f) return;
  f.onsubmit=async e=>{
    e.preventDefault();
    if(val("cf").trim()!=="DELETE") return showErr(["Type DELETE in capitals to confirm."]);
    if(!val("dp")) return showErr(["Enter your password to confirm."]);
    const b=e.target.querySelector("button[type=submit]"); b.disabled=true;
    const chk=await sb.auth.signInWithPassword({email:user().email,password:val("dp")});
    if(chk.error){ b.disabled=false; return showErr([friendly(chk.error,"That password isn't right.")]); }
    const r=await sb.functions.invoke("delete-account");
    if(r.error||(r.data&&r.data.error)){ b.disabled=false; return showErr(["We couldn't delete your account. Please try again, or contact support."]); }
    pending=null; try{localStorage.removeItem(PKEY);}catch(x){}
    await sb.auth.signOut().catch(()=>{}); session=null; profile=null; books=[]; hist=[];
    go("home",{type:"ok",text:"Your account and data have been deleted."});
  };
}

/* ---------- start ---------- */
sb.auth.onAuthStateChange((ev,s)=>{
  setTimeout(()=>{
    session=s; if(ev==="SIGNED_OUT") profile=null;
    if(ev==="PASSWORD_RECOVERY"){ route="reset"; load().then(render); }
    else if(ev==="SIGNED_IN"&&route==="home"&&!R){ profile=null; load().then(render); }
  },0);
});
(async()=>{
  const {data}=await sb.auth.getSession(); session=data.session;
  if(session) await flushPending();
  await load(); render();
})();
})();
