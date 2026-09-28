// Try-it mode: the same tabs and rows as the Google Sheet, kept in this browser only.
// Used until config.js has a Google client ID and a spreadsheet ID.
import { TABS } from "./schema.js";

const KEY = "fp.localSheet.v1";

export function createLocalBackend(starter){
  let tabs = null;
  try { tabs = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tabs)); } catch {} };
  const find = (tab, key, norm) => tabs[tab].findIndex(r => (norm ? norm(r[0]) : String(r[0] ?? "").trim()) === key);
  return {
    kind: "local",
    async ensureTabs(){
      tabs = tabs || {};
      for (const t of Object.keys(TABS)) if (!tabs[t]) tabs[t] = JSON.parse(JSON.stringify((starter && starter[t]) || []));
      save();
    },
    async readAll(){ return JSON.parse(JSON.stringify(tabs)); },
    async upsert(tab, key, row, norm){ const i = find(tab, key, norm); if (i >= 0) tabs[tab][i] = row; else tabs[tab].push(row); save(); },
    async remove(tab, key, norm){ const i = find(tab, key, norm); if (i >= 0) tabs[tab].splice(i, 1); save(); },
    async setIds(tab, updates){ updates.forEach(u => { const r = tabs[tab][u.row - 2]; if (r) r[0] = u.value; }); save(); },
    reset(){ try { localStorage.removeItem(KEY); } catch {} },
  };
}
