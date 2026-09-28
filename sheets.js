// Google sign-in + Google Sheets as the planner's database.
// No server: the browser talks to the Sheets API directly with the signed-in person's own access,
// so only people the sheet is shared with can read or change it.
import { TABS } from "./schema.js";

const API = "https://sheets.googleapis.com/v4/spreadsheets/";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets openid email";
const TOKEN_KEY = "fp.token", EMAIL_KEY = "fp.email";
const quote = t => "'" + t.replace(/'/g, "''") + "'";
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch {} },
  del(k){ try { localStorage.removeItem(k); } catch {} },
};

export function createSheetsBackend({ clientId, spreadsheetId, onAuthChange = () => {} }){
  let token = null, exp = 0, email = store.get(EMAIL_KEY) || null, tokenClient = null, sheetIds = null;
  try {
    const saved = JSON.parse(store.get(TOKEN_KEY) || "null");
    if (saved && saved.exp > Date.now() + 60000){ token = saved.token; exp = saved.exp; email = saved.email || email; }
  } catch {}

  function loadGis(){
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Google sign-in couldn’t load. Check your connection and reload."));
      document.head.appendChild(s);
    });
  }
  async function init(){
    await loadGis();
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
  }

  // Must be called from a tap or click: Google opens a small sign-in window.
  function signIn(){
    return new Promise((resolve, reject) => {
      if (!tokenClient) return reject(new Error("Google sign-in isn’t ready yet."));
      tokenClient.callback = async (resp) => {
        if (resp.error){ reject(Object.assign(new Error(resp.error_description || resp.error), { code: "auth" })); return; }
        token = resp.access_token;
        exp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        try {
          const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + token } });
          if (r.ok) email = (await r.json()).email || email;
        } catch {}
        store.set(TOKEN_KEY, JSON.stringify({ token, exp, email }));
        if (email) store.set(EMAIL_KEY, email);
        onAuthChange(); resolve();
      };
      tokenClient.error_callback = (err) => reject(Object.assign(new Error(err?.message || "Sign-in was closed."), { code: "auth" }));
      tokenClient.requestAccessToken({ prompt: email ? "" : "consent", login_hint: email || undefined });
    });
  }
  function signOut(){
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
    token = null; exp = 0; email = null;
    store.del(TOKEN_KEY); store.del(EMAIL_KEY);
    onAuthChange();
  }
  const signedIn = () => !!token && exp > Date.now() + 30000;
  const expiresSoon = () => !token || exp < Date.now() + 10 * 60000;

  async function api(path, opts = {}){
    if (!signedIn()) throw Object.assign(new Error("Signed out"), { code: "auth" });
    const r = await fetch(API + spreadsheetId + path, {
      ...opts, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (r.status === 401){ token = null; store.del(TOKEN_KEY); onAuthChange(); throw Object.assign(new Error("Sign-in expired"), { code: "auth" }); }
    if (!r.ok){
      let msg = r.statusText; try { msg = (await r.json()).error.message; } catch {}
      const code = r.status === 403 ? "forbidden" : r.status === 404 ? "notfound" : r.status === 429 ? "busy" : "http";
      throw Object.assign(new Error(msg), { code, status: r.status });
    }
    return r.status === 204 ? null : r.json();
  }
  async function meta(){
    const m = await api("?fields=properties.title,sheets.properties(sheetId,title)");
    sheetIds = {}; m.sheets.forEach(s => { sheetIds[s.properties.title] = s.properties.sheetId; });
    return m;
  }
  // Adds any tab the app needs that the sheet is missing, with headers and starter rows.
  async function ensureTabs(starter){
    const m = await meta();
    const missing = Object.keys(TABS).filter(t => !(t in sheetIds));
    if (missing.length){
      await api(":batchUpdate", { method: "POST", body: JSON.stringify({
        requests: missing.map(t => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })) }) });
      await meta();
      await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW",
        data: missing.map(t => ({ range: quote(t) + "!A1", values: [TABS[t].labels, ...((starter && starter[t]) || [])] })) }) });
    }
    return m.properties.title;
  }
  async function readAll(){
    const names = Object.keys(TABS);
    const qs = names.map(t => "ranges=" + encodeURIComponent(quote(t) + "!A2:Z")).join("&");
    const r = await api("/values:batchGet?" + qs + "&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS");
    const out = {};
    names.forEach((t, i) => { out[t] = (r.valueRanges[i] && r.valueRanges[i].values) || []; });
    return out;
  }
  async function findRow(tab, key, norm){
    const r = await api("/values/" + encodeURIComponent(quote(tab) + "!A:A") + "?valueRenderOption=FORMATTED_VALUE");
    const col = (r.values || []).map(v => v[0] ?? "");
    for (let i = 1; i < col.length; i++) if ((norm ? norm(col[i]) : String(col[i]).trim()) === key) return i + 1;
    return -1;
  }
  async function upsert(tab, key, row, norm){
    const n = await findRow(tab, key, norm);
    if (n > 0){
      await api("/values/" + encodeURIComponent(quote(tab) + "!A" + n) + "?valueInputOption=RAW",
        { method: "PUT", body: JSON.stringify({ values: [row] }) });
    } else {
      await api("/values/" + encodeURIComponent(quote(tab) + "!A1") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        { method: "POST", body: JSON.stringify({ values: [row] }) });
    }
  }
  async function remove(tab, key, norm){
    const n = await findRow(tab, key, norm); if (n < 0) return;
    if (!sheetIds || !(tab in sheetIds)) await meta();
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ deleteDimension: {
      range: { sheetId: sheetIds[tab], dimension: "ROWS", startIndex: n - 1, endIndex: n } } }] }) });
  }
  // Writes ids into column A for rows someone added by hand.
  async function setIds(tab, updates){
    if (!updates.length) return;
    await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW",
      data: updates.map(u => ({ range: quote(tab) + "!A" + u.row, values: [[u.value]] })) }) });
  }
  return {
    kind: "sheets", init, signIn, signOut, signedIn, expiresSoon, email: () => email,
    ensureTabs, readAll, upsert, remove, setIds,
    sheetUrl: "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/edit",
  };
}
