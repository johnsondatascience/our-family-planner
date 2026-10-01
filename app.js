import { CONFIG } from "./config.js";
import { TABS, WHO_COLUMNS, STARTER } from "./schema.js";
import { createSheetsBackend } from "./sheets.js";
import { createLocalBackend } from "./local.js";

/* ---------- helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Math.random().toString(36).slice(2,10);
const ls = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} } };
const clone = o => JSON.parse(JSON.stringify(o ?? {}));
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
function deepMerge(t, s){ for (const k in s){ const v = s[k]; if (isObj(v)){ if (!isObj(t[k])) t[k] = {}; deepMerge(t[k], v); } else t[k] = v; } return t; }
function getPath(o, p){ return p.split(".").reduce((a,k)=> a==null ? undefined : a[k], o); }
function nest(p, v){ const ks = p.split("."); const out = {}; let c = out; ks.forEach((k,i)=>{ if (i === ks.length-1) c[k] = v; else { c[k] = {}; c = c[k]; } }); return out; }
const live = m => Object.entries(m || {}).filter(([,v]) => v != null);
const byOrder = (a,b) => ((a[1].order ?? 0) - (b[1].order ?? 0)) || String(a[0]).localeCompare(String(b[0]));

/* dates */
function iso(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function parseISO(s){ const [y,m,d] = String(s).split("-").map(Number); return new Date(y, (m||1)-1, d||1); }
function mondayOf(d){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return x; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DAYS_LONG = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const md = d => d.toLocaleDateString(undefined, {month:"short", day:"numeric"});
function fmtTime(t){ if(!t) return ""; const [h,m] = t.split(":").map(Number); if (isNaN(h)) return t; const ap = h>=12 ? "pm" : "am"; return ((h%12)||12) + ":" + String(m||0).padStart(2,"0") + " " + ap; }

/* ---------- state ---------- */
const TODAY = new Date();
const S = { settings:{}, rhythm:{}, snacks:{}, shop:{}, week:{}, stars:{}, groceries:[], checkins:[], loaded:{} };
let backend = null, mode = "connecting", errMsg = "";
let localBannerHidden = ls.get("fp.hideLocal") === "1";
let weekStart = mondayOf(TODAY);
const thisMonday = iso(mondayOf(TODAY));
let selDay = (TODAY.getDay()+6)%7;
const VIEW_TABS = [["week","Week plan"],["groceries","Groceries"],["stars","Kids’ stars"],["rhythm","Daily rhythm"],["snacks","Snacks"],["checkin","Check-in"],["setup","Setup"]];
let tab = (location.hash||"").slice(1);
if (!VIEW_TABS.some(t=>t[0]===tab)) tab = ls.get("fp.tab") || "week";
if (!VIEW_TABS.some(t=>t[0]===tab)) tab = "week";
let starKid = ls.get("fp.kid") || "k1";
let snackFilter = "all", rhythmEdit = false;
const draft = { g:{ name:"", type:"Produce", forWhat:"", who:"" }, c:{ date: iso(TODAY), who:"", good:"", hard:"", tryThis:"" }, s:{ name:"", kind:"", self:"Yes" } };
let armed = null, armedTimer = null;

const P = { settings:"family/settings", rhythm:"family/rhythm", snacks:"family/snacks", shop:"family/shop" };
const weekPath = () => "weeks/" + iso(weekStart);
const starsPath = () => "stars/" + iso(weekStart);

const MEMBERS = ["m1","m2","k1","k2"];
const FALLBACK = { m1:"Grown-up 1", m2:"Grown-up 2", k1:"Kid 1", k2:"Kid 2", all:"Everyone" };
const nm = id => id === "all" ? "Everyone" : ((S.settings.members||{})[id]?.name || FALLBACK[id] || String(id ?? ""));
const pill = id => id ? `<span class="pill p-${(MEMBERS.includes(id) || id === "all") ? id : "all"}">${esc(nm(id))}</span>` : `<span class="empty">—</span>`;
const GROC_TYPES = ["Produce","Dairy & eggs","Meat & fish","Pantry","Frozen","Snacks","Household","Cat supplies","Kids / school","Other"];
const AREAS = ["Laundry","My room","Our cats","Other"];
const LEVELS = ["Helper","Doer","Owner"];

/* ---------- the Google Sheet as the database ---------- */
// The views work on documents (settings, a week, a kid's stars…). Each change is turned into
// "write this row" or "delete this row" on the matching tab, queued, and sent one at a time.
const weekCache = {};   // "2026-09-28" -> { breakfast, dropoff: "m1", … }
const starsCache = {};  // "2026-09-28" -> { k1: { j1: { d0: 2 } } }
function targetFor(path){
  for (const k in P) if (P[k] === path) return S[k];
  if (path === weekPath()) return S.week;
  if (path === starsPath()) return S.stars;
  const [coll, id] = path.split("/");
  if (coll === "groceries" || coll === "checkins") return S[coll].find(x => x.id === id);
  return null;
}
function patch(path, obj){
  const t = targetFor(path); if (t) deepMerge(t, clone(obj));
  persist(path, obj);
  render();
}
function persist(path, obj){
  const each = (m, fn) => { for (const k in (m || {})) fn(k, m[k]); };
  if (path === P.settings){
    each(obj.members, id => enqueue("People", id));
    each(obj.jobs, (id, v) => enqueue("Jobs", id, v === null));
    each(obj.levels, (kid, m) => each(m, id => enqueue("Jobs", id)));
    each(obj.rewards, (id, v) => enqueue("Rewards", id, v === null));
  } else if (path === P.rhythm){
    each(obj.rows, (id, v) => enqueue("Rhythm", id, v === null));
    each(obj.rules, (id, v) => enqueue("Rules", id, v === null));
  } else if (path === P.snacks){
    each(obj.items, (id, v) => enqueue("Snacks", id, v === null));
    each(obj.likes, (kid, m) => each(m, id => enqueue("Snacks", id)));
  } else if (path === P.shop){
    each(obj, k => enqueue("Settings", "shop_" + k));
  } else if (path.startsWith("weeks/")){
    const wk = parseISO(path.slice(6));
    each(obj.days, dk => enqueue("Week", iso(addDays(wk, Number(dk.slice(1))))));
  } else if (path.startsWith("stars/")){
    const wk = path.slice(6);
    each(obj, (kid, m) => each(m, jid => enqueue("Stars", wk + "|" + kid + "|" + jid)));
  } else if (path.startsWith("groceries/")){
    enqueue("Groceries", path.split("/")[1]);
  }
}
const whoName = v => !v ? "" : (MEMBERS.includes(v) || v === "all") ? nm(v) : String(v);
function rowFor(tab, key){
  const st = S.settings;
  switch (tab){
    case "People": return [key, key[0] === "m" ? "Grown-up" : "Kid", st.members?.[key]?.name || ""];
    case "Jobs": { const j = st.jobs?.[key] || {}; return [key, j.area || "", j.name || "", j.often || "", j.order ?? "", st.levels?.k1?.[key] || "Helper", st.levels?.k2?.[key] || "Helper"]; }
    case "Rewards": { const r = st.rewards?.[key] || {}; return [key, r.stars ?? "", r.text || ""]; }
    case "Rhythm": { const r = S.rhythm.rows?.[key] || {}; return [key, r.time || "", r.what || "", r.duty || "", r.kids || ""]; }
    case "Rules": { const r = S.rhythm.rules?.[key] || {}; return [key, r.text || ""]; }
    case "Snacks": { const s = S.snacks.items?.[key] || {}, L = S.snacks.likes || {}; return [key, s.name || "", s.kind || "", s.self || "", L.k1?.[key] ? "★" : "", L.k2?.[key] ? "★" : "", s.order ?? ""]; }
    case "Settings": { const f = key.replace("shop_", ""), v = S.shop[f] || ""; return [key, f === "who" ? whoName(v) : v]; }
    case "Week": {
      const d = weekCache[key] || {};
      return TABS.Week.keys.map(k => k === "date" ? key : k === "day" ? DAYS[(parseISO(key).getDay() + 6) % 7]
        : WHO_COLUMNS.Week.includes(k) ? whoName(d[k]) : (d[k] ?? ""));
    }
    case "Stars": {
      const [wk, kid, jid] = key.split("|"); const m = starsCache[wk]?.[kid]?.[jid] || {};
      return [key, wk, nm(kid), st.jobs?.[jid]?.name || jid, ...[0,1,2,3,4,5,6].map(i => Number(m["d" + i]) || "")];
    }
    case "Groceries": { const g = S.groceries.find(x => x.id === key) || {}; return [key, g.name || "", g.type || "", g.forWhat || "", whoName(g.who), g.got ? "✓" : "", g.createdAt || ""]; }
    case "Checkins": { const c = S.checkins.find(x => x.id === key) || {}; return [key, c.date || "", whoName(c.who), c.good || "", c.hard || "", c.tryThis || "", c.createdAt || ""]; }
  }
  return [key];
}
const pending = new Map(); let running = false, authLost = false;
function enqueue(tab, key, del = false){
  pending.set(tab + "\u0001" + key, { tab, key, del, row: del ? null : rowFor(tab, key) });
  renderStatus(); pump();
}
async function pump(){
  if (running || !backend || (mode !== "on" && mode !== "local")) return;
  running = true; renderStatus();
  try {
    while (pending.size){
      const [k, op] = pending.entries().next().value;
      const norm = op.tab === "Week" ? normDate : null;
      try {
        if (op.del) await backend.remove(op.tab, op.key, norm);
        else await backend.upsert(op.tab, op.key, op.row, norm);
        if (pending.get(k) === op) pending.delete(k);
      } catch (e){
        if (e && e.code === "auth"){ authLost = true; break; }
        if (e && e.code === "busy"){ await new Promise(r => setTimeout(r, 4000)); continue; }
        pending.delete(k); writeError(e);
      }
    }
  } finally { running = false; renderStatus(); renderBanner(); }
}
async function addDoc(coll, data){
  const id = uid(); S[coll].push({ id, ...data });
  enqueue(coll === "groceries" ? "Groceries" : "Checkins", id); render(); return true;
}
async function delDoc(coll, id){
  S[coll] = S[coll].filter(x => x.id !== id);
  enqueue(coll === "groceries" ? "Groceries" : "Checkins", id, true); render();
}
function writeError(e){
  const c = e && e.code;
  if (c === "forbidden") errMsg = "This Google account can see the planner sheet but can’t edit it. Ask for Editor access to the sheet.";
  else if (c === "notfound") errMsg = "The planner sheet wasn’t found. Check the spreadsheet ID in config.js.";
  else errMsg = "A change didn’t save (" + ((e && e.message) || "connection problem") + "). Check your connection, then try again.";
  renderStatus(); renderBanner();
}

/* reading the sheet */
function normDate(v){
  const s = String(v ?? "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(new Date(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m){ let y = +m[3]; if (y < 100) y += 2000; return iso(new Date(y, +m[1] - 1, +m[2])); }
  const d = new Date(s); return isNaN(d) ? s : iso(d);
}
function normTime(v){
  const s = String(v ?? "").trim(); if (!s) return "";
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?$/i); if (!m) return s;
  let h = +m[1]; const ap = m[3] && m[3].toLowerCase();
  if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 5) h += 12; // "3:15" on a school-day rhythm means the afternoon
  return String(h).padStart(2, "0") + ":" + m[2];
}
const truthy = v => { const s = String(v ?? "").trim().toLowerCase(); return !!s && !["false", "no", "0", "n", "-", "☆"].includes(s); };
const levelOf = s => LEVELS.find(L => L.toLowerCase() === String(s).trim().toLowerCase()) || "Helper";
function nameToId(v){
  const s = String(v ?? "").trim(); if (!s) return "";
  const l = s.toLowerCase(); if (l === "everyone") return "all";
  for (const id of MEMBERS) if (nm(id).toLowerCase() === l) return id;
  return s;
}
function buildState(T){
  const fixes = {};
  const rowsOf = t => (T[t] || []).map((r, i) => ({ r, n: i + 2 })).filter(x => x.r.some(c => String(c ?? "").trim() !== ""));
  const get = (t, x, k) => { const i = TABS[t].keys.indexOf(k); return i < 0 ? "" : String(x.r[i] ?? "").trim(); };
  const idOf = (t, x) => { let id = get(t, x, TABS[t].keys[0]); if (!id){ id = uid(); (fixes[t] = fixes[t] || []).push({ row: x.n, value: id }); } return id; };

  const members = {};
  for (const x of rowsOf("People")){ const id = get("People", x, "id"); if (MEMBERS.includes(id)) members[id] = { name: get("People", x, "name") }; }
  const settings = { members, jobs: {}, levels: { k1: {}, k2: {} }, rewards: {} };
  S.settings = settings; // names first, so the other tabs can match people by name
  rowsOf("Jobs").forEach((x, i) => {
    const id = idOf("Jobs", x);
    settings.jobs[id] = { area: get("Jobs", x, "area") || "Other", name: get("Jobs", x, "name"), often: get("Jobs", x, "often"), order: Number(get("Jobs", x, "order")) || i + 1 };
    settings.levels.k1[id] = levelOf(get("Jobs", x, "lv1")); settings.levels.k2[id] = levelOf(get("Jobs", x, "lv2"));
  });
  rowsOf("Rewards").forEach(x => { settings.rewards[idOf("Rewards", x)] = { stars: Number(get("Rewards", x, "stars")) || 0, text: get("Rewards", x, "text") }; });

  const rows = {}, rules = {};
  rowsOf("Rhythm").forEach(x => { rows[idOf("Rhythm", x)] = { time: normTime(get("Rhythm", x, "time")), what: get("Rhythm", x, "what"), duty: get("Rhythm", x, "duty"), kids: get("Rhythm", x, "kids"), order: x.n }; });
  rowsOf("Rules").forEach(x => { rules[idOf("Rules", x)] = { text: get("Rules", x, "text"), order: x.n }; });
  S.rhythm = { rows, rules };

  const items = {}, likes = { k1: {}, k2: {} };
  rowsOf("Snacks").forEach(x => {
    const id = idOf("Snacks", x);
    items[id] = { name: get("Snacks", x, "name"), kind: get("Snacks", x, "kind"), self: get("Snacks", x, "self"), order: Number(get("Snacks", x, "order")) || x.n };
    if (truthy(get("Snacks", x, "like1"))) likes.k1[id] = true;
    if (truthy(get("Snacks", x, "like2"))) likes.k2[id] = true;
  });
  S.snacks = { items, likes };

  S.shop = {};
  rowsOf("Settings").forEach(x => {
    const k = get("Settings", x, "key"), v = get("Settings", x, "value");
    if (k === "shop_who") S.shop.who = nameToId(v);
    if (k === "shop_when") S.shop.when = v;
  });

  for (const k in weekCache) delete weekCache[k];
  rowsOf("Week").forEach(x => {
    const d = normDate(get("Week", x, "date")); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const o = weekCache[d] || (weekCache[d] = {});
    for (const k of TABS.Week.keys){
      if (k === "date" || k === "day") continue;
      const v = get("Week", x, k); if (v) o[k] = WHO_COLUMNS.Week.includes(k) ? nameToId(v) : v;
    }
  });

  for (const k in starsCache) delete starsCache[k];
  rowsOf("Stars").forEach(x => {
    let id = get("Stars", x, "id"), wk, kid, jid;
    if (id.split("|").length === 3) [wk, kid, jid] = id.split("|");
    else {
      wk = normDate(get("Stars", x, "week")); kid = nameToId(get("Stars", x, "kid"));
      const jn = get("Stars", x, "job").toLowerCase();
      jid = Object.keys(settings.jobs).find(j => settings.jobs[j].name.toLowerCase() === jn);
      if (!wk || !["k1", "k2"].includes(kid) || !jid) return;
      (fixes.Stars = fixes.Stars || []).push({ row: x.n, value: wk + "|" + kid + "|" + jid });
    }
    const m = {}; for (let i = 0; i < 7; i++){ const v = Number(get("Stars", x, "d" + i)); if (v === 1 || v === 2) m["d" + i] = v; }
    const byKid = starsCache[wk] || (starsCache[wk] = {});
    (byKid[kid] || (byKid[kid] = {}))[jid] = m;
  });

  S.groceries = rowsOf("Groceries").map(x => ({ id: idOf("Groceries", x), name: get("Groceries", x, "name"), type: get("Groceries", x, "type") || "Other",
    forWhat: get("Groceries", x, "forWhat"), who: nameToId(get("Groceries", x, "who")), got: truthy(get("Groceries", x, "got")), createdAt: get("Groceries", x, "createdAt") }));
  S.checkins = rowsOf("Checkins").map(x => ({ id: idOf("Checkins", x), date: normDate(get("Checkins", x, "date")) || iso(TODAY), who: nameToId(get("Checkins", x, "who")) || "all",
    good: get("Checkins", x, "good"), hard: get("Checkins", x, "hard"), tryThis: get("Checkins", x, "tryThis"), createdAt: get("Checkins", x, "createdAt") }));
  return fixes;
}
function applyWeek(){
  const days = {};
  for (let i = 0; i < 7; i++){ const d = iso(addDays(weekStart, i)); days["d" + i] = weekCache[d] || (weekCache[d] = {}); }
  S.week = { days };
  const wk = iso(weekStart); S.stars = starsCache[wk] || (starsCache[wk] = {});
}

/* ---------- render scheduling (never rebuild under a finger or a cursor) ---------- */
let queued = false, dirty = false, pointerDown = false;
function render(){ if (queued) return; queued = true; setTimeout(doRender, 0); }
function busy(){
  const a = document.activeElement;
  if (pointerDown) return true;
  return !!(a && a.closest && a.closest("#view") && a.matches("input:not([type=checkbox]),textarea,select"));
}
function doRender(){ queued = false; renderHeader(); if (busy()){ dirty = true; return; } dirty = false; renderView(); }
document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
const release = () => { pointerDown = false; if (dirty) setTimeout(() => { if (dirty) doRender(); }, 120); };
document.addEventListener("pointerup", release, true);
document.addEventListener("pointercancel", release, true);
document.addEventListener("focusout", () => setTimeout(() => { if (dirty) doRender(); }, 40), true);

/* ---------- header ---------- */
let lastTabs = null;
function renderNow(){ const a = document.activeElement, id = a && a.id; queued = false; dirty = false; renderHeader(); renderView(); if (id){ const n = document.getElementById(id); if (n && n !== document.activeElement) n.focus(); } }
function renderHeader(){
  const end = addDays(weekStart, 6);
  $("#range").textContent = md(weekStart) + " – " + md(end);
  $("#thiswk").disabled = iso(weekStart) === thisMonday;
  $("#todayline").textContent = TODAY.toLocaleDateString(undefined, {weekday:"long", month:"long", day:"numeric"});
  if (lastTabs !== tab){ lastTabs = tab; $("#tabs").innerHTML = VIEW_TABS.map(([k,l]) => `<button role="tab" aria-selected="${k===tab}" data-tab="${k}">${l}</button>`).join(""); const on = $("#tabs [aria-selected=true]"); if (on){ const n = $("#tabs"); n.scrollLeft = Math.max(0, on.offsetLeft - (n.clientWidth - on.offsetWidth)/2); } }
  renderStatus(); renderBanner();
}
function renderStatus(){
  const el = $("#status"), tx = $("#statustext");
  el.className = "status";
  const writing = pending.size > 0 || running;
  if (mode === "connecting"){ tx.textContent = "Connecting…"; return; }
  if (mode === "signin"){ el.classList.add("off"); tx.textContent = "Signed out"; return; }
  if (mode === "noaccess" || mode === "error"){ el.classList.add("err"); tx.textContent = "Not connected"; return; }
  if (authLost){ el.classList.add("err"); tx.textContent = writing ? "Waiting to save" : "Reconnect needed"; return; }
  if (errMsg){ el.classList.add("err"); tx.textContent = "Not saved"; return; }
  if (writing){ el.classList.add("saving"); tx.textContent = "Saving…"; return; }
  tx.textContent = mode === "local" ? "Saved on this device" : "Synced with Google Sheet";
}
function renderBanner(){
  const b = $("#banner");
  if (authLost && mode === "on"){
    b.innerHTML = `<div class="banner row"><span>Your Google sign-in timed out${pending.size ? ", so your latest changes are waiting to save" : ""}.</span><span class="spacer"></span><button class="btn" data-act="reconnect">Reconnect</button></div>`;
    return;
  }
  if (errMsg && mode !== "error"){ b.innerHTML = `<div class="banner row"><span>${esc(errMsg)}</span><span class="spacer"></span><button class="linkbtn" data-act="dismiss">Dismiss</button></div>`; return; }
  if (mode === "local" && !localBannerHidden){
    b.innerHTML = `<div class="banner row" style="background:var(--accent-soft);color:var(--accent)"><span>Try-it mode: changes are saved on this device only. Connect your Google Sheet to share the plan between phones (see the README).</span><span class="spacer"></span><button class="linkbtn" data-act="hidebanner">Hide</button></div>`;
    return;
  }
  b.innerHTML = "";
}

/* ---------- small builders ---------- */
function fid(doc, f){ return "f_" + (doc + "_" + f).replace(/[^a-z0-9]/gi, "_"); }
function tf(doc, f, label, ph, opts={}){
  const v = getPath(targetFor(doc) || {}, f) ?? "";
  const id = fid(doc, f);
  const ctl = opts.area
    ? `<textarea id="${id}" rows="${opts.rows||2}" data-doc="${esc(doc)}" data-f="${esc(f)}" placeholder="${esc(ph||"")}">${esc(v)}</textarea>`
    : `<input id="${id}" type="${opts.type||"text"}" data-doc="${esc(doc)}" data-f="${esc(f)}" value="${esc(v)}" placeholder="${esc(ph||"")}" ${opts.list?`list="${opts.list}"`:""} ${opts.type==="number"?'inputmode="numeric" data-num="1"':""} autocomplete="off">`;
  return label ? `<label class="field" for="${id}"><span class="lbl">${esc(label)}</span>${ctl}</label>` : ctl;
}
function whoChips(doc, f, pool){
  const cur = getPath(targetFor(doc) || {}, f) || "";
  const ids = pool === "grown" ? ["m1","m2"] : pool === "kids" ? ["k1","k2"] : [...MEMBERS, "all"];
  return `<div class="chips" role="group">` + ids.map(id =>
    `<button type="button" class="chip p-${id}${cur===id?" on":""}" aria-pressed="${cur===id}" data-act="who" data-doc="${esc(doc)}" data-f="${esc(f)}" data-v="${id}">${esc(nm(id))}</button>`).join("") + `</div>`;
}
function draftChips(key, pool){
  const [g, k] = key.split("."); const cur = draft[g][k];
  const ids = pool === "grown" ? ["m1","m2"] : [...MEMBERS];
  return `<div class="chips" role="group">` + ids.map(id =>
    `<button type="button" class="chip p-${id}${cur===id?" on":""}" aria-pressed="${cur===id}" data-act="dwho" data-k="${key}" data-v="${id}">${esc(nm(id))}</button>`).join("") + `</div>`;
}
function dIn(key, ph, type="text", extra=""){ const [g,k] = key.split("."); return `<input id="d_${g}_${k}" type="${type}" data-draft="${key}" value="${esc(draft[g][k])}" placeholder="${esc(ph)}" autocomplete="off" ${extra}>`; }
function dArea(key, ph){ const [g,k] = key.split("."); return `<textarea id="d_${g}_${k}" rows="2" data-draft="${key}" placeholder="${esc(ph)}">${esc(draft[g][k])}</textarea>`; }
function rmBtn(key, label="Remove"){ const on = armed === key; return `<button type="button" class="linkbtn${on?" armed":""}" data-act="rm" data-key="${esc(key)}">${on ? "Tap again" : label}</button>`; }
const loading = () => !S.loaded.all;

/* ---------- views ---------- */
function renderView(){
  const v = $("#view");
  if (mode === "signin"){ v.innerHTML = vSignIn(); return; }
  if (mode === "noaccess"){ v.innerHTML = vNoAccess(); return; }
  if (mode === "error"){ v.innerHTML = vError(); return; }
  if (!S.loaded.all){ v.innerHTML = `<div class="card"><p class="muted" style="margin:0">Opening your planner…</p></div>`; return; }
  const fn = { week:vWeek, groceries:vGroceries, stars:vStars, rhythm:vRhythm, snacks:vSnacks, checkin:vCheckin, setup:vSetup }[tab];
  v.innerHTML = fn();
}

function vSignIn(){
  return `<div class="card gate"><h2 class="sec">Sign in to your family planner</h2>
    <p class="lede">The planner keeps everything in your family’s Google Sheet. Sign in with a Google account the sheet is shared with.</p>
    <button class="btn" data-act="signin">Sign in with Google</button>
    <p class="muted" style="font-size:.84rem;margin:14px 0 0">Google will ask whether the planner may see and edit your spreadsheets. It only opens the family planner sheet.</p></div>`;
}
function vNoAccess(){
  const who = backend && backend.email ? backend.email() : "";
  return `<div class="card gate"><h2 class="sec">This account can’t open the planner sheet</h2>
    <p class="lede">${who ? `You’re signed in as <b>${esc(who)}</b>. ` : ""}Share the sheet with this Google account as an Editor, or sign in with a different account. If the sheet is already shared, check the spreadsheet ID in config.js.</p>
    <div class="row"><button class="btn" data-act="switch">Use a different account</button><button class="textbtn" data-act="retry">Try again</button></div></div>`;
}
function vError(){
  return `<div class="card gate"><h2 class="sec">The planner couldn’t connect</h2>
    <p class="lede">${esc(errMsg || "Something went wrong.")}</p>
    <div class="row"><button class="btn" data-act="retry">Try again</button></div></div>`;
}

/* Week plan */
const GLANCE = [
  ["Breakfast", {t:"breakfast"}],
  ["Dropoff",   {w:"dropoff"}],
  ["Pickup",    {w:"pickup"}],
  ["Activities",{t:"activity", w:"driver"}],
  ["Homework",  {t:"hwNote", w:"homework"}],
  ["Dinner",    {t:"dinner", w:"cook"}],
  ["Bedtime",   {t:"bedNote", w:"bedtime"}]
];
let lastGap = null;
const GAPKEYS = { "drop-off":"dropoff", "pick-up":"pickup", "homework":"homework", "cook":"cook", "bedtime":"bedtime" };
function glanceCell(x, spec){
  const t = spec.t && x[spec.t], w = spec.w && x[spec.w];
  if (!t && !w) return `<span class="empty">—</span>`;
  return (t ? `<span class="txt">${esc(t)}</span>` : "") + (w ? `<span class="cellwho">${pill(w)}</span>` : "");
}
function vWeek(){
  const wp = weekPath(), days = S.week.days || {};
  const dd = i => days["d"+i] || {};
  const gaps = { "drop-off":0, "pick-up":0, "homework":0, "cook":0, "bedtime":0 };
  for (let i=0;i<7;i++){ const x = dd(i); if(i<5){ if(!x.dropoff) gaps["drop-off"]++; if(!x.pickup) gaps["pick-up"]++; if(!x.homework) gaps["homework"]++; } if(!x.cook) gaps["cook"]++; if(!x.bedtime) gaps["bedtime"]++; }
  const open = Object.entries(gaps).filter(([,n])=>n>0);
  const isThis = iso(weekStart) === thisMonday;
  const empty = !Object.keys(days).some(k => days[k] && Object.values(days[k]).some(v => v));
  let h = `<h2 class="sec">Week at a glance</h2><p class="lede">Plan it together on Sunday, glance at it every morning. Tap a day to fill it in.</p>`;
  h += `<div class="card"><div class="scroller"><table class="glance"><thead><tr><th></th>`;
  for (let i=0;i<7;i++){ const d = addDays(weekStart,i); const td = isThis && i === (TODAY.getDay()+6)%7;
    h += `<th class="${i===selDay?"sel":""}"><button class="daybtn" data-act="day" data-i="${i}"><b>${DAYS[i]}</b><span class="${td?"today":""}">${td?"Today":md(d)}</span></button></th>`; }
  h += `</tr></thead><tbody>`;
  for (const [label, spec] of GLANCE){
    h += `<tr><th class="rowh" scope="row">${label}</th>`;
    for (let i=0;i<7;i++){
      h += `<td class="${i===selDay?"sel":""}">${glanceCell(dd(i), spec)}</td>`; }
    h += `</tr>`;
  }
  h += `</tbody></table></div><div class="gaps"><span class="muted">Still needs an owner:</span>` +
       (open.length ? open.map(([k,n]) => `<button type="button" class="gap" data-act="gap" data-k="${k}" title="Show the next day without a ${k} owner">${n} ${k} →</button>`).join("") : `<span class="ok">Every job has an owner</span>`) +
       (empty ? `<span class="spacer"></span><button class="btn ghost" data-act="copyweek">Copy last week’s plan</button>` : "") + `</div></div>`;

  h += `<div class="daystrip" role="group" aria-label="Pick a day">`;
  for (let i=0;i<7;i++){ const d = addDays(weekStart,i); const td = isThis && i === (TODAY.getDay()+6)%7;
    h += `<button class="dchip${td?" istoday":""}" aria-pressed="${i===selDay}" data-act="day" data-i="${i}">${DAYS[i]}<small>${d.getDate()}</small></button>`; }
  h += `</div><h3 class="dayhead">${DAYS_LONG[selDay]}, ${md(addDays(weekStart, selDay))}</h3>`;
  const f = k => "days.d" + selDay + "." + k;
  h += `<div class="grid4">
    <div class="card"><p class="eyebrow">Morning</p><div class="fields">
      ${tf(wp, f("breakfast"), "Breakfast", "Oatmeal and berries")}
      ${tf(wp, f("lunch"), "Lunch / lunchboxes", "Turkey wraps, apple slices")}
      <div class="field" id="fw_dropoff"><span class="lbl">Dropoff</span>${whoChips(wp, f("dropoff"), "grown")}</div>
    </div></div>
    <div class="card"><p class="eyebrow">After school</p><div class="fields">
      <div class="field" id="fw_pickup"><span class="lbl">Pickup</span>${whoChips(wp, f("pickup"), "grown")}</div>
      ${tf(wp, f("snack"), "After-school snack", "Pick from the snack list", {list:"snacklist"})}
      ${tf(wp, f("activity"), "Activities and times", "Swim 4:30")}
      <div class="field"><span class="lbl">Who drives to activities</span>${whoChips(wp, f("driver"), "grown")}</div>
      <div class="field" id="fw_homework"><span class="lbl">Homework helper</span>${whoChips(wp, f("homework"), "grown")}</div>
      ${tf(wp, f("hwNote"), "Homework due", "Spelling list, reading log")}
    </div></div>
    <div class="card"><p class="eyebrow">Evening</p><div class="fields">
      ${tf(wp, f("dinner"), "Dinner", "Tacos")}
      <div class="field" id="fw_cook"><span class="lbl">Who cooks</span>${whoChips(wp, f("cook"))}</div>
      <div class="field"><span class="lbl">Who cleans up</span>${whoChips(wp, f("clean"))}</div>
      ${tf(wp, f("table"), "Kids’ table job", `${nm("k1")} sets, ${nm("k2")} clears`)}
      <div class="field" id="fw_bedtime"><span class="lbl">Bedtime (baths, stories, lights out)</span>${whoChips(wp, f("bedtime"), "grown")}</div>
      ${tf(wp, f("bedNote"), "Bedtime note", "Lights out 8:15")}
    </div></div>
    <div class="card"><p class="eyebrow">House</p><div class="fields">
      <div class="field"><span class="lbl">Grocery run today</span>${whoChips(wp, f("shopper"), "grown")}</div>
      ${tf(wp, f("errands"), "Errands and appointments", "Vet at 10 (cats)")}
      ${tf(wp, f("notes"), "Anything else today", "Early release, piano moved to Thursday", {area:true, rows:3})}
    </div></div>
  </div>`;
  h += `<datalist id="snacklist">${live(S.snacks.items).sort(byOrder).map(([,s]) => `<option value="${esc(s.name)}"></option>`).join("")}</datalist>`;
  return h;
}

/* Groceries */
function vGroceries(){
  const items = S.groceries;
  const need = items.filter(x => !x.got), got = items.filter(x => x.got);
  let h = `<h2 class="sec">Groceries & sundries</h2><p class="lede">Add things all week as you notice them. On shop day, tick them off as they go in the cart.</p>`;
  h += `<div class="grid2"><div class="card"><p class="eyebrow">Main shop</p><div class="fields">
      <div class="field"><span class="lbl">Who’s shopping</span>${whoChips(P.shop, "who", "grown")}</div>
      ${tf(P.shop, "when", "When", "Saturday morning")}
    </div></div>
    <div class="card"><p class="eyebrow">On the list</p><div class="row"><span class="count">${need.length}</span><span class="muted">to get${got.length?` · ${got.length} in the cart`:""}</span></div>
    ${got.length ? `<div class="row" style="margin-top:12px">${rmBtn("clearGot", `Clear ${got.length} ticked item${got.length>1?"s":""}`)}</div>` : ""}</div></div>`;
  h += `<div class="card" style="margin-top:16px"><p class="eyebrow">Add an item</p><form id="gform" class="stack" style="gap:10px">
    <div class="addrow">
      <label class="field full"><span class="lbl">Item</span>${dIn("g.name","Tortillas")}</label>
      <label class="field"><span class="lbl">Aisle</span><select id="d_g_type" data-draft="g.type">${GROC_TYPES.map(t=>`<option${draft.g.type===t?" selected":""}>${t}</option>`).join("")}</select></label>
      <label class="field"><span class="lbl">For what</span>${dIn("g.forWhat","Monday tacos")}</label>
      <button class="btn" type="submit">Add</button>
    </div>
    <div class="field"><span class="lbl">Someone picking this up separately? (optional)</span>${draftChips("g.who","all")}</div>
  </form></div>`;
  h += `<div class="card" style="margin-top:16px">`;
  if (loading("groceries")) h += `<p class="muted">Loading the list…</p>`;
  else if (!items.length) h += `<p class="muted">The list is empty. Add the first thing you need above.</p>`;
  else {
    for (const t of GROC_TYPES){
      const g = need.filter(x => (x.type||"Other") === t); if (!g.length) continue;
      h += `<p class="gtype">${esc(t)}</p><div class="glist">${g.map(gItem).join("")}</div>`;
    }
    const other = need.filter(x => !GROC_TYPES.includes(x.type||"Other"));
    if (other.length) h += `<p class="gtype">Other</p><div class="glist">${other.map(gItem).join("")}</div>`;
    if (got.length) h += `<p class="gtype" style="color:var(--muted)">In the cart</p><div class="glist">${got.map(gItem).join("")}</div>`;
  }
  return h + `</div>`;
}
function gItem(x){
  return `<div class="gitem${x.got?" got":""}"><button class="check${x.got?" on":""}" aria-pressed="${!!x.got}" aria-label="${x.got?"Untick":"Tick"} ${esc(x.name)}" data-act="got" data-id="${esc(x.id)}">${x.got?"✓":""}</button>
    <div class="body"><div class="name">${esc(x.name)}</div><div class="meta">${x.forWhat?`<span>${esc(x.forWhat)}</span>`:""}${x.who?pill(x.who):""}</div></div>
    ${rmBtn("g:"+x.id)}</div>`;
}

/* Kids' stars */
function jobsList(){ return live(S.settings.jobs).sort((a,b) => (AREAS.indexOf(a[1].area) - AREAS.indexOf(b[1].area)) || byOrder(a,b)); }
function rewardsList(){ return live(S.settings.rewards).map(([id,r]) => [id, r]).sort((a,b) => (Number(a[1].stars)||0) - (Number(b[1].stars)||0)); }
function vStars(){
  const k = starKid, sp = starsPath(), marks = (S.stars[k]) || {};
  const jobs = jobsList(), isThis = iso(weekStart) === thisMonday, ti = (TODAY.getDay()+6)%7;
  let total = 0; for (const [jid] of jobs){ const m = marks[jid] || {}; for (let i=0;i<7;i++) total += Number(m["d"+i]) || 0; }
  const rw = rewardsList();
  let earned = null, next = null; for (const [,r] of rw){ if ((Number(r.stars)||0) <= total) earned = r; else if (!next) next = r; }
  let h = `<div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:14px"><div><h2 class="sec">Jobs & stars</h2><p class="lede" style="margin:0">Kids mark their own stars at bedtime, with a grown-up.</p></div>
    <div class="chips" role="group" aria-label="Whose chart">${["k1","k2"].map(id=>`<button class="chip p-${id}${id===k?" on":""}" aria-pressed="${id===k}" data-act="kid" data-v="${id}">${esc(nm(id))}</button>`).join("")}</div></div>`;
  h += `<div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
    <div class="card"><p class="eyebrow">${esc(nm(k))}’s stars this week</p>
      <div class="bigstars"><span class="n">${total}</span><span class="muted">★</span></div>
      ${earned ? `<p style="margin:8px 0 0"><b>Earned:</b> ${esc(earned.text)}</p>` : ""}
      ${next ? `<div class="progress" aria-hidden="true"><i style="width:${Math.min(100, Math.round(total/(Number(next.stars)||1)*100))}%"></i></div><p class="muted" style="margin:0;font-size:.88rem">${(Number(next.stars)||0) - total} more to <b>${esc(next.text)}</b></p>` : (rw.length ? `<p class="muted" style="margin:6px 0 0">Top reward reached. Amazing week!</p>` : "")}
    </div>
    <div class="card"><p class="eyebrow">Reward menu</p>${rw.length ? `<ul class="ladder">${rw.map(([,r]) => `<li class="${(Number(r.stars)||0)<=total?"hit":""}"><span class="need">${Number(r.stars)||0} ★</span><span>${esc(r.text)}</span></li>`).join("")}</ul>` : `<p class="muted">No rewards yet. Add them in Setup.</p>`}</div>
    <div class="card"><p class="eyebrow">How stars work</p><div class="key"><span><button class="scell s2" tabindex="-1">★★</button> did it without being asked</span><span><button class="scell s1" tabindex="-1">★</button> did it after a reminder</span></div>
      <p class="muted" style="margin:10px 0 0;font-size:.86rem">Tap the level under a job to move it up: <b>Helper</b> (we do it together) → <b>Doer</b> (I do it, maybe with a reminder) → <b>Owner</b> (I remember on my own). Three strong weeks in a row means it’s time to level up.</p></div>
  </div>`;
  h += `<div class="card" style="margin-top:16px">`;
  if (loading("settings")) h += `<p class="muted">Loading jobs…</p>`;
  else if (!jobs.length) h += `<p class="muted">No jobs yet. Add laundry, room and pet jobs in Setup.</p>`;
  else {
    h += `<div class="scroller"><table class="stars"><thead><tr><th class="job"></th>`;
    for (let i=0;i<7;i++) h += `<th class="${isThis&&i===ti?"today":""}">${DAYS[i]}<br>${addDays(weekStart,i).getDate()}</th>`;
    h += `<th>★</th></tr></thead><tbody>`;
    let area = null;
    for (const [jid, j] of jobs){
      if (j.area !== area){ area = j.area; h += `<tr class="area"><th colspan="9">${esc(area||"Other")}</th></tr>`; }
      const m = marks[jid] || {}; let rt = 0;
      const lvl = getPath(S.settings, "levels." + k + "." + jid) || "Helper";
      h += `<tr><th class="job" scope="row"><span class="jobname">${esc(j.name)}</span><span class="often">${esc(j.often||"")}</span><br><button class="level ${esc(lvl)}" data-act="level" data-job="${esc(jid)}" aria-label="Level: ${esc(lvl)}. Tap to change">${esc(lvl)}</button></th>`;
      for (let i=0;i<7;i++){ const v = Number(m["d"+i]) || 0; rt += v;
        h += `<td><button class="scell${v?" s"+v:""}" data-act="star" data-job="${esc(jid)}" data-i="${i}" aria-label="${esc(j.name)}, ${DAYS_LONG[i]}: ${v===2?"two stars":v===1?"one star":"not yet"}">${v===2?"★★":v===1?"★":""}</button></td>`; }
      h += `<td class="rtotal">${rt||""}</td></tr>`;
    }
    h += `</tbody></table></div>`;
  }
  return h + `</div>`;
}

/* Daily rhythm */
function vRhythm(){
  const rows = live(S.rhythm.rows).sort((a,b) => String(a[1].time||"").localeCompare(String(b[1].time||"")) || byOrder(a,b));
  const rules = live(S.rhythm.rules).sort(byOrder);
  let h = `<div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:14px"><div><h2 class="sec">Our school-day rhythm</h2><p class="lede" style="margin:0">Same order every day, so nobody argues about what’s next.</p></div>
    <button class="textbtn" data-act="redit">${rhythmEdit ? "Done editing" : "Edit rhythm"}</button></div>`;
  if (loading("rhythm")) return h + `<div class="card"><p class="muted">Loading…</p></div>`;
  if (!rhythmEdit){
    const now = TODAY.getHours()*60 + TODAY.getMinutes();
    let cur = -1; rows.forEach(([,r],i) => { const [hh,mm] = String(r.time||"").split(":").map(Number); if (!isNaN(hh) && hh*60+(mm||0) <= now) cur = i; });
    if (cur === rows.length-1 && rows.length){ const [hh,mm] = String(rows[cur][1].time).split(":").map(Number); if (now - (hh*60+(mm||0)) > 90) cur = -1; }
    h += `<div class="split"><div class="card">`;
    h += rows.length ? `<ol class="tl">${rows.map(([,r],i) => `<li class="${i===cur?"now":""}"><span class="t">${esc(fmtTime(r.time))}</span><span class="w">${esc(r.what)}${i===cur?`<span class="nowtag">Now</span>`:""}</span>${r.kids||r.duty?`<span class="d">${esc(r.kids||"")}${r.duty?` · <i>Grown-up: ${esc(r.duty)}</i>`:""}</span>`:""}</li>`).join("")}</ol>` : `<p class="muted">No routine yet. Tap “Edit rhythm” to add the first step.</p>`;
    h += `</div><div class="card"><p class="eyebrow">Rhythm rules</p>${rules.length ? `<ul class="rules">${rules.map(([,r]) => `<li>${esc(r.text)}</li>`).join("")}</ul>` : `<p class="muted">No rules yet.</p>`}</div></div>`;
  } else {
    h += `<div class="card"><p class="eyebrow">Steps</p>`;
    for (const [id] of rows){ const b = "rows." + id + ".";
      h += `<div class="editrow">${tf(P.rhythm, b+"time", "", "", {type:"time"})}${tf(P.rhythm, b+"what", "", "What happens")}${tf(P.rhythm, b+"duty", "", "Grown-up on duty")}<div class="wide">${tf(P.rhythm, b+"kids", "", "Kids do")}</div>${rmBtn("rr:"+id)}</div>`; }
    h += `<div class="row" style="margin-top:12px"><button class="btn ghost" data-act="addrow">Add a step</button></div></div>`;
    h += `<div class="card" style="margin-top:16px"><p class="eyebrow">Rules</p><div class="stack" style="gap:8px">`;
    for (const [id] of rules) h += `<div class="row" style="flex-wrap:nowrap"><div style="flex:1;min-width:0">${tf(P.rhythm, "rules."+id+".text", "", "A rule for the day")}</div>${rmBtn("ru:"+id)}</div>`;
    h += `</div><div class="row" style="margin-top:12px"><button class="btn ghost" data-act="addrule">Add a rule</button></div></div>`;
  }
  return h;
}

/* Snacks */
function vSnacks(){
  const items = live(S.snacks.items).sort(byOrder), likes = S.snacks.likes || {};
  const shown = snackFilter === "all" ? items : items.filter(([id]) => likes[snackFilter] && likes[snackFilter][id]);
  let h = `<div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:14px"><div><h2 class="sec">Healthy snack bank</h2><p class="lede" style="margin:0">At the Sunday check-in, each kid stars their picks for the week.</p></div>
    <div class="chips" role="group" aria-label="Show">${[["all","All snacks"],["k1",nm("k1")+"’s picks"],["k2",nm("k2")+"’s picks"]].map(([v,l]) => `<button class="chip ${v==="all"?"p-all":"p-"+v}${snackFilter===v?" on":""}" aria-pressed="${snackFilter===v}" data-act="sfilter" data-v="${v}">${esc(l)}</button>`).join("")}</div></div>`;
  if (loading("snacks")) h += `<div class="card"><p class="muted">Loading…</p></div>`;
  else if (!shown.length) h += `<div class="card"><p class="muted">${items.length ? "No picks starred yet. Switch to All snacks and tap a name to star it." : "No snacks yet. Add one below."}</p></div>`;
  else h += `<div class="snacks">${shown.map(([id,s]) => `<div class="snack"><div><div class="n">${esc(s.name)}</div><div class="k">${esc(s.kind||"")}${s.self?` · Kids make it: ${esc(s.self)}`:""}</div></div>
      <div class="row">${["k1","k2"].map(kid => { const on = !!(likes[kid] && likes[kid][id]); return `<button class="like p-${kid}${on?" on":""}" aria-pressed="${on}" data-act="like" data-kid="${kid}" data-id="${esc(id)}">${on?"★":"☆"} ${esc(nm(kid))}</button>`; }).join("")}<span class="spacer"></span>${rmBtn("sn:"+id)}</div></div>`).join("")}</div>`;
  h += `<div class="card" style="margin-top:16px"><p class="eyebrow">Add a snack idea</p><form id="sform" class="addrow">
    <label class="field full"><span class="lbl">Snack</span>${dIn("s.name","Apple slices and peanut butter")}</label>
    <label class="field"><span class="lbl">Kind</span>${dIn("s.kind","Fruit and protein")}</label>
    <label class="field"><span class="lbl">Kids can make it?</span><select id="d_s_self" data-draft="s.self">${["Yes","With help","No"].map(o=>`<option${draft.s.self===o?" selected":""}>${o}</option>`).join("")}</select></label>
    <button class="btn" type="submit">Add</button></form></div>
    <p class="muted" style="font-size:.82rem;margin-top:12px">Whole grapes, popcorn and whole nuts are choking risks for little ones. Cut, skip or supervise depending on your kids’ ages.</p>`;
  return h;
}

/* Check-in */
// KSLAPH: the family's six pillars, in Michael's words.
const DEAL = [
  ["K", "Know", "We all know our jobs."],
  ["S", "Speak", "We speak our minds, and we often disagree."],
  ["L", "Listen", "We listen to each other regularly."],
  ["A", "Ask", "We ask for help when we need it, or even before."],
  ["P", "Pause", "We are all allowed to pause, and to resume."],
  ["H", "Help", "We try to help each other, not find blame."]
];
// The "case laugh" briefcase, drawn after Michael's sketch. Colors follow the theme.
const CASE_LAUGH = `<svg class="caselaugh" viewBox="0 0 120 100" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="A smiling briefcase: case laugh">
  <path d="M45 29 C45 14 52 10 60 10 C68 10 75 14 75 29"/>
  <path d="M19 30 L103 28 Q106 28 106 31.5 L105.5 81 Q105 84 102 84 L21 85.5 Q18 85.5 18 82.5 L17 33 Q17 30 19 30 Z" fill="var(--surface)"/>
  <path d="M10 89 L108 87.5" stroke-width="3.5"/>
  <path d="M36 51 Q43 41 50 51"/><path d="M70 50 Q77 40 84 50"/>
  <path d="M50 60 Q60 59.5 71 59 Q69.5 73 60.5 73.5 Q51.5 74 50 60 Z" fill="var(--accent-soft)"/>
</svg>`;
const DEAL_URL = CONFIG.dealUrl || "";
function vCheckin(){
  let h = `<h2 class="sec">Weekly check-in</h2><p class="lede">One short family chat, same day, same time. Everyone gets a turn. Even the shortest turn counts.</p>`;
  h += `<div class="split"><div class="card"><p class="eyebrow">Add a turn</p><form id="cform" class="fields">
    <div class="row" style="align-items:flex-end"><label class="field" style="width:11em"><span class="lbl">Date</span>${dIn("c.date","", "date")}</label></div>
    <div class="field"><span class="lbl">Whose turn</span>${draftChips("c.who","all")}</div>
    <label class="field"><span class="lbl">What was good?</span>${dArea("c.good","Swim class, pancakes on Saturday")}</label>
    <label class="field"><span class="lbl">What was hard?</span>${dArea("c.hard","Homework on Wednesday")}</label>
    <label class="field"><span class="lbl">One thing we’ll try this week</span>${dArea("c.tryThis","Start homework before snack is done")}</label>
    <div><button class="btn" type="submit">Save this turn</button></div></form></div>
    <div class="card"><p class="eyebrow">Our Family Deal</p><div class="kshead">${CASE_LAUGH}<div><p class="kslaph" aria-label="K S L A P H">${DEAL.map(([l]) => `<span>${l}</span>`).join("")}</p><p class="muted" style="margin:0;font-size:.84rem">Say it “case laugh.”</p></div></div><ul class="deal">${DEAL.map(([l, w, t]) => `<li><b class="dl">${l}</b><span><b>${esc(w)}.</b> ${esc(t)}</span></li>`).join("")}</ul>${DEAL_URL ? `<p style="margin:12px 0 0;font-size:.88rem"><a href="${esc(DEAL_URL)}" target="_blank" rel="noopener">Open the full Deal</a></p>` : ""}</div></div>`;
  h += `<div class="card" style="margin-top:16px"><p class="eyebrow">Past check-ins</p>`;
  if (loading("checkins")) h += `<p class="muted">Loading…</p>`;
  else if (!S.checkins.length) h += `<p class="muted">No check-ins yet. Your first Sunday chat will show up here.</p>`;
  else {
    const groups = {}; S.checkins.slice().sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))).forEach(c => (groups[c.date] = groups[c.date] || []).push(c));
    for (const d of Object.keys(groups)){
      h += `<p class="dategroup">${esc(parseISO(d).toLocaleDateString(undefined,{weekday:"long", month:"short", day:"numeric"}))}</p>`;
      for (const c of groups[d]) h += `<div class="entry"><div class="row">${pill(c.who || "all")}<span class="spacer"></span>${rmBtn("c:"+c.id)}</div><dl>${c.good?`<dt>Good</dt><dd>${esc(c.good)}</dd>`:""}${c.hard?`<dt>Hard</dt><dd>${esc(c.hard)}</dd>`:""}${c.tryThis?`<dt>We’ll try</dt><dd>${esc(c.tryThis)}</dd>`:""}</dl></div>`;
    }
  }
  return h + `</div>`;
}

/* Setup */
function vSetup(){
  const st = P.settings;
  let h = `<h2 class="sec">Setup</h2><p class="lede">Names, rewards and kids’ jobs. Everything here is shared, so a change shows up on both of your phones.</p>`;
  h += `<div class="grid2"><div class="card"><p class="eyebrow">Our team</p><div class="fields">`;
  for (const id of MEMBERS) h += `<div class="nrow"><span class="pill p-${id}">${id[0]==="m"?"Grown-up":"Kid"}</span>${tf(st, "members."+id+".name", "", FALLBACK[id])}</div>`;
  h += `</div><p class="muted" style="font-size:.84rem;margin:12px 0 0">Each person keeps their color everywhere in the planner.</p></div>`;
  h += `<div class="card"><p class="eyebrow">Reward menu</p><div class="stack" style="gap:8px">`;
  for (const [id] of rewardsList()) h += `<div class="srow">${tf(st, "rewards."+id+".stars", "", "Stars", {type:"number"})}${tf(st, "rewards."+id+".text", "", "Reward")}${rmBtn("rw:"+id)}</div>`;
  h += `</div><div class="row" style="margin-top:12px"><button class="btn ghost" data-act="addreward">Add a reward</button></div><p class="muted" style="font-size:.84rem;margin:10px 0 0">Experiences work better than stuff: picking the movie, a special outing, staying up 15 minutes late.</p></div></div>`;
  h += `<div class="card" style="margin-top:16px"><p class="eyebrow">Kids’ jobs (both kids share this list)</p><div class="stack" style="gap:8px">`;
  for (const [id, j] of jobsList()){
    h += `<div class="jrow"><select id="${fid(st,"jobs."+id+".area")}" data-doc="${st}" data-f="jobs.${esc(id)}.area" aria-label="Area">${AREAS.map(a=>`<option${j.area===a?" selected":""}>${a}</option>`).join("")}</select><div class="wide">${tf(st, "jobs."+id+".name", "", "Job")}</div>${tf(st, "jobs."+id+".often", "", "How often")}${rmBtn("jb:"+id)}</div>`; }
  h += `</div><div class="row" style="margin-top:12px"><button class="btn ghost" data-act="addjob">Add a job</button></div></div>`;
  h += `<div class="card" style="margin-top:16px"><p class="eyebrow">Where the plan is saved</p>` + (mode === "local"
    ? `<p style="margin:0 0 10px;max-width:65ch">Try-it mode: everything is saved in this browser only. Connect your Google Sheet to share the planner between phones (see the README).</p><div class="row">${rmBtn("resetlocal", "Start over with the sample plan")}</div>`
    : `<p style="margin:0 0 12px;max-width:65ch">Everything is saved in your family’s Google Sheet. A change here shows up on the other phone within about ${Number(CONFIG.pollSeconds) || 20} seconds, and you can edit the sheet directly too.</p><div class="row"><a class="btn ghost" href="${esc(backend.sheetUrl)}" target="_blank" rel="noopener">Open the sheet</a><span class="muted" style="font-size:.86rem">Signed in as ${esc(backend.email() || "")}</span><span class="spacer"></span><button class="linkbtn" data-act="signout">Sign out</button></div>`) + `</div>`;
  return h;
}

/* ---------- events ---------- */
const timers = {};
function commitField(el){
  if (!el.matches || !el.matches("input,textarea,select")) return;
  const doc = el.dataset.doc, f = el.dataset.f; if (!doc || !f) return;
  clearTimeout(timers[doc+f]); delete timers[doc+f];
  let v = el.value; if (el.dataset.num) v = v === "" ? null : Number(v);
  const cur = getPath(targetFor(doc) || {}, f);
  if ((cur ?? "") === (v ?? "")) return;
  patch(doc, nest(f, v));
}
const view = $("#view");
view.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.draft){ const [g,k] = el.dataset.draft.split("."); draft[g][k] = el.value; return; }
  if (el.dataset.doc){ const key = el.dataset.doc + el.dataset.f; clearTimeout(timers[key]); timers[key] = setTimeout(() => commitField(el), 700); }
});
view.addEventListener("change", e => { const el = e.target; if (el.dataset.doc) commitField(el); if (el.dataset.draft){ const [g,k] = el.dataset.draft.split("."); draft[g][k] = el.value; } });
view.addEventListener("focusout", e => { const el = e.target; if (el.dataset && el.dataset.doc) commitField(el); });

view.addEventListener("submit", async e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "gform"){
    const name = draft.g.name.trim(); if (!name){ $("#d_g_name")?.focus(); return; }
    const data = { name, type: draft.g.type || "Other", forWhat: draft.g.forWhat.trim(), who: draft.g.who || "", got:false, createdAt: new Date().toISOString() };
    draft.g.name = ""; draft.g.forWhat = ""; draft.g.who = "";
    renderNow(); await addDoc("groceries", data);
    setTimeout(() => $("#d_g_name")?.focus(), 60);
  }
  if (id === "cform"){
    const c = draft.c; if (!c.good.trim() && !c.hard.trim() && !c.tryThis.trim()) { $("#d_c_good")?.focus(); return; }
    const data = { date: c.date || iso(TODAY), who: c.who || "all", good: c.good.trim(), hard: c.hard.trim(), tryThis: c.tryThis.trim(), createdAt: new Date().toISOString() };
    draft.c.good = draft.c.hard = draft.c.tryThis = ""; draft.c.who = "";
    renderNow(); await addDoc("checkins", data);
  }
  if (id === "sform"){
    const name = draft.s.name.trim(); if (!name){ $("#d_s_name")?.focus(); return; }
    const sid = uid(), order = Date.now();
    patch(P.snacks, { items: { [sid]: { name, kind: draft.s.kind.trim(), self: draft.s.self, order } } });
    draft.s.name = ""; draft.s.kind = ""; renderNow();
  }
});

view.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "signin"){ try { await backend.signIn(); authLost = false; await connect(); } catch (err){ errMsg = "Couldn’t sign in to Google: " + (err.message || "the sign-in window closed") + "."; renderStatus(); renderBanner(); } return; }
  if (a === "switch"){ backend.signOut(); resetData(); mode = "signin"; render(); return; }
  if (a === "retry"){ errMsg = ""; if (backend && backend.kind === "sheets" && backend.signedIn()) connect(); else start(); return; }
  if (a === "signout"){ backend.signOut(); resetData(); mode = "signin"; render(); return; }
  if (a === "day"){ selDay = Number(b.dataset.i); render(); }
  else if (a === "gap"){
    const key = GAPKEYS[b.dataset.k], weekdays = b.dataset.k !== "cook" && b.dataset.k !== "bedtime";
    const days = S.week.days || {}; const last = weekdays ? 5 : 7;
    const from = lastGap === b.dataset.k ? selDay + 1 : 0; lastGap = b.dataset.k;
    let i = -1; for (let n = 0; n < last; n++){ const j = (from + n) % last; if (!(days["d"+j] || {})[key]){ i = j; break; } }
    if (i < 0) return;
    selDay = i; renderNow();
    const el = document.getElementById("fw_" + key);
    if (el){ el.scrollIntoView({ block:"center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1800); }
  }
  else if (a === "who"){ const cur = getPath(targetFor(b.dataset.doc) || {}, b.dataset.f); patch(b.dataset.doc, nest(b.dataset.f, cur === b.dataset.v ? "" : b.dataset.v)); }
  else if (a === "dwho"){ const [g,k] = b.dataset.k.split("."); draft[g][k] = draft[g][k] === b.dataset.v ? "" : b.dataset.v; render(); }
  else if (a === "kid"){ starKid = b.dataset.v; ls.set("fp.kid", starKid); render(); }
  else if (a === "star"){ const p = starKid + "." + b.dataset.job + ".d" + b.dataset.i; const cur = Number(getPath(S.stars, p)) || 0; const nxt = cur === 0 ? 2 : cur === 2 ? 1 : 0; patch(starsPath(), nest(p, nxt || null)); }
  else if (a === "level"){ const p = "levels." + starKid + "." + b.dataset.job; const cur = getPath(S.settings, p) || "Helper"; patch(P.settings, nest(p, LEVELS[(LEVELS.indexOf(cur)+1) % LEVELS.length])); }
  else if (a === "got"){ const x = S.groceries.find(g => g.id === b.dataset.id); if (x) patch("groceries/" + x.id, { got: !x.got }); }
  else if (a === "redit"){ rhythmEdit = !rhythmEdit; render(); }
  else if (a === "addrow"){ const id = uid(); patch(P.rhythm, { rows: { [id]: { time:"", what:"", duty:"", kids:"", order: Date.now() } } }); setTimeout(() => $("#"+fid(P.rhythm, "rows."+id+".time"))?.focus(), 80); }
  else if (a === "addrule"){ const id = uid(); patch(P.rhythm, { rules: { [id]: { text:"", order: Date.now() } } }); setTimeout(() => $("#"+fid(P.rhythm, "rules."+id+".text"))?.focus(), 80); }
  else if (a === "addreward"){ const id = uid(); const top = rewardsList().reduce((m,[,r]) => Math.max(m, Number(r.stars)||0), 0); patch(P.settings, { rewards: { [id]: { stars: top + 10, text:"" } } }); setTimeout(() => $("#"+fid(P.settings, "rewards."+id+".text"))?.focus(), 80); }
  else if (a === "addjob"){ const id = uid(); patch(P.settings, { jobs: { [id]: { name:"", area:"Other", often:"Every day", order: Date.now() } } }); setTimeout(() => $("#"+fid(P.settings, "jobs."+id+".name"))?.focus(), 80); }
  else if (a === "sfilter"){ snackFilter = b.dataset.v; render(); }
  else if (a === "like"){ const p = "likes." + b.dataset.kid + "." + b.dataset.id; patch(P.snacks, nest(p, getPath(S.snacks, p) ? null : true)); }
  else if (a === "copyweek"){ await copyLastWeek(); }
  else if (a === "rm"){
    const key = b.dataset.key;
    if (armed !== key){ armed = key; clearTimeout(armedTimer); armedTimer = setTimeout(() => { armed = null; render(); }, 3500); render(); return; }
    armed = null; clearTimeout(armedTimer);
    const [kind, id] = key.split(/:(.+)/);
    if (kind === "resetlocal"){ backend.reset(); location.reload(); return; }
    if (kind === "clearGot"){ const got = S.groceries.filter(x => x.got); for (const x of got) await delDoc("groceries", x.id); }
    else if (kind === "g") await delDoc("groceries", id);
    else if (kind === "c") await delDoc("checkins", id);
    else if (kind === "rr") patch(P.rhythm, { rows: { [id]: null } });
    else if (kind === "ru") patch(P.rhythm, { rules: { [id]: null } });
    else if (kind === "sn") patch(P.snacks, { items: { [id]: null } });
    else if (kind === "rw") patch(P.settings, { rewards: { [id]: null } });
    else if (kind === "jb") patch(P.settings, { jobs: { [id]: null } });
    render();
  }
});
async function copyLastWeek(){
  const days = {}; let any = false;
  for (let i = 0; i < 7; i++){
    const src = weekCache[iso(addDays(weekStart, i - 7))];
    if (src && Object.values(src).some(v => v)){ days["d" + i] = clone(src); any = true; }
  }
  if (!any){ flash("Last week has nothing to copy yet."); return; }
  patch(weekPath(), { days });
}
function flash(msg){ $("#banner").innerHTML = `<div class="banner" style="background:var(--accent-soft);color:var(--accent)">${esc(msg)}</div>`; setTimeout(renderBanner, 3500); }

$("#tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; tab = b.dataset.tab; ls.set("fp.tab", tab); try{ history.replaceState(null, "", "#" + tab); }catch(_){} armed = null; window.scrollTo({top:0}); render(); });
$("#prevwk").addEventListener("click", () => changeWeek(-7));
$("#nextwk").addEventListener("click", () => changeWeek(7));
$("#thiswk").addEventListener("click", () => { weekStart = mondayOf(TODAY); selDay = (TODAY.getDay()+6)%7; subscribeWeek(); render(); });
function changeWeek(n){ weekStart = addDays(weekStart, n); if (iso(weekStart) === thisMonday) selDay = (TODAY.getDay()+6)%7; else selDay = 0; subscribeWeek(); render(); }

/* ---------- connecting ---------- */
let pollTimer = null, lastSilent = 0;
function subscribeWeek(){ applyWeek(); }
function resetData(){
  for (const k in weekCache) delete weekCache[k];
  for (const k in starsCache) delete starsCache[k];
  Object.assign(S, { settings:{}, rhythm:{}, snacks:{}, shop:{}, week:{}, stars:{}, groceries:[], checkins:[], loaded:{} });
  pending.clear(); authLost = false; errMsg = "";
}
async function refresh(){
  if (!backend || (mode !== "on" && mode !== "local")) return;
  if (pending.size || running) return; // never overwrite changes that haven't reached the sheet yet
  if (backend.kind === "sheets" && !backend.signedIn()){ authLost = true; renderStatus(); renderBanner(); return; }
  try {
    const T = await backend.readAll();
    if (pending.size || running) return;
    const fixes = buildState(T);
    applyWeek(); S.loaded.all = true;
    render();
    for (const t in fixes) backend.setIds(t, fixes[t]).catch(() => {});
  } catch (e){
    if (e && e.code === "auth"){ authLost = true; renderStatus(); renderBanner(); }
    else if (!S.loaded.all){ mode = (e.code === "forbidden" || e.code === "notfound") ? "noaccess" : "error"; errMsg = e.message || ""; render(); }
  }
}
function startPolling(){
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, Math.max(5, Number(CONFIG.pollSeconds) || 20) * 1000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
async function connect(){
  mode = "connecting"; errMsg = ""; render();
  try {
    await backend.ensureTabs(STARTER);
    mode = "on"; await refresh(); startPolling(); pump();
  } catch (e){
    if (e && e.code === "auth") mode = "signin";
    else if (e && (e.code === "forbidden" || e.code === "notfound")) mode = "noaccess";
    else { mode = "error"; errMsg = (e && e.message) || "Something went wrong."; }
    render();
  }
}
async function reconnect(){
  try { await backend.signIn(); authLost = false; errMsg = ""; renderStatus(); renderBanner(); await pump(); await refresh(); }
  catch (e){ errMsg = "Couldn’t sign in to Google: " + (e.message || "the sign-in window closed") + "."; renderStatus(); renderBanner(); }
}
// Google access lasts an hour. Renew it quietly on a tap before it runs out, so saves don't stall.
document.addEventListener("click", e => {
  if (!backend || backend.kind !== "sheets" || mode !== "on") return;
  if (e.target.closest && e.target.closest('[data-act="reconnect"],[data-act="signin"],[data-act="signout"]')) return;
  if (backend.expiresSoon() && Date.now() - lastSilent > 120000){
    lastSilent = Date.now();
    backend.signIn().then(() => { authLost = false; renderStatus(); renderBanner(); pump(); }).catch(() => {});
  }
}, true);
$("#banner").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.dataset.act === "reconnect") reconnect();
  if (b.dataset.act === "dismiss"){ errMsg = ""; renderStatus(); renderBanner(); }
  if (b.dataset.act === "hidebanner"){ localBannerHidden = true; ls.set("fp.hideLocal", "1"); renderBanner(); }
});
async function start(){
  renderHeader(); renderView();
  if (!CONFIG.googleClientId || !CONFIG.spreadsheetId){
    backend = createLocalBackend(STARTER); await backend.ensureTabs();
    mode = "local"; await refresh(); return;
  }
  backend = createSheetsBackend({ clientId: CONFIG.googleClientId, spreadsheetId: CONFIG.spreadsheetId, onAuthChange: () => renderStatus() });
  try { await backend.init(); } catch (e){ mode = "error"; errMsg = e.message; render(); return; }
  if (backend.signedIn()) await connect(); else { mode = "signin"; render(); }
}
start();
