// Alteration tag sync for the Bespoke Tailoring registers (tablet and shop computer).
// Talks to the website's /api/tag-sync with the register's own key, like customer-sync.js.
// The website holds the master list of tags; each register keeps its own copy so it works offline:
//   1. tags saved or deleted here are sent up, with the version (rev) this register last saw,
//   2. everything changed on the website since the last check comes back down.
// If two registers change the same tag, the website decides which copy wins (a paid tag stays
// paid, otherwise the newer edit) and both registers end up with that copy.
// Nothing here knows how a register stores tags or customers; the register passes an adapter.
(function (root) {
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

  // adapter:
  //   tags()                  -> the register's tags (objects it owns; sync sets tag.rev)
  //   toWire(tag)             -> the tag as the website stores it, or null if it can't be sent yet
  //                              (for example its customer hasn't reached the website)
  //   fromWire(wire)          -> take on the website's copy: update or add the local tag
  //   removeLocal(id)         -> the tag was deleted on another register
  //   state() / saveState(s)  -> persist { cursor, dirty: [ids], deletes: [ids] } between runs
  //   changed()               -> save and redraw after a sync changed tags
  // opts.before (optional)    -> run first on every sync, e.g. the customer sync, so new customers
  //                              have their website id before their tags are sent
  function createTagSync(opts) {
    const a = opts.adapter;
    const f = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    let base = String(opts.base || "").replace(/\/+$/, "");
    let key = opts.key || "";
    let running = null;
    const status = { state: key ? "idle" : "off", lastOk: null, error: "" };
    const st = () => { const s = a.state() || {}; s.dirty = Array.isArray(s.dirty) ? s.dirty : []; s.deletes = Array.isArray(s.deletes) ? s.deletes : []; return s; };

    async function call(method, path, body) {
      const r = await f(base + path, { method, headers: { "content-type": "application/json", "x-app-key": key }, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch {}
      if (r.status === 404) { const e = new Error("The website doesn't have the tag list yet. Tags are kept here and sent once it does."); e.missing = true; throw e; }
      if (r.status === 401) { const e = new Error("This register's key wasn't accepted. Check it in the connection settings."); e.auth = true; throw e; }
      if (!r.ok) throw new Error((j && j.error) || `The website answered with an error (${r.status}).`);
      return j;
    }

    async function push() {
      const s = st();
      const sentOk = new Set(), drop = new Set();
      // Deletions first.
      for (const group of chunks(s.deletes, 50)) {
        const res = await call("POST", "/api/tag-sync", { ops: group.map((id) => ({ op: "delete", id })) });
        res.results.forEach((x, i) => { if (x.ok) drop.add(group[i]); });
      }
      const ready = [];
      for (const id of s.dirty) {
        const t = a.tags().find((x) => x.id === id);
        if (!t) { sentOk.add(id); continue; }               // deleted here since: nothing to send
        const wire = a.toWire(t);
        if (wire) ready.push([id, t, wire, wire.edited]);    // not ready yet: stays in the list
      }
      for (const group of chunks(ready, 50)) {
        const ops = group.map(([, t, wire]) => ({ op: "tag", baseRev: t.rev || 0, tag: wire }));
        const res = await call("POST", "/api/tag-sync", { ops });
        res.results.forEach((x, i) => {
          const [id, t, , editedSent] = group[i];
          if (x.ok && x.tag) {
            // Only mark it sent if it wasn't edited again while this was on its way.
            const now = a.toWire(t);
            if (!now || now.edited === editedSent) { a.fromWire(x.tag); sentOk.add(id); }
            else t.rev = x.tag.rev;
          } else if (x.removed) { a.removeLocal(id); sentOk.add(id); }
          else if (/isn't a tag/i.test(x.error || "")) { t.syncError = x.error; sentOk.add(id); }
        });
      }
      const s2 = st();
      s2.dirty = s2.dirty.filter((id) => !sentOk.has(id));
      s2.deletes = s2.deletes.filter((id) => !drop.has(id));
      a.saveState(s2);
    }

    async function pull() {
      const s = st();
      const j = await call("GET", "/api/tag-sync" + (s.cursor ? "?since=" + encodeURIComponent(s.cursor) : ""));
      const pending = new Set(s.dirty);
      for (const w of j.tags || []) {
        // A tag with an unsent change here is settled by the website when it's sent.
        if (pending.has(w.id)) continue;
        a.fromWire(w);
      }
      for (const id of j.removed || []) if (!pending.has(id)) a.removeLocal(id);
      const s2 = st(); s2.cursor = j.now; a.saveState(s2);
    }

    async function syncNow() {
      if (!key || !base || !f) { status.state = "off"; return status; }
      if (running) return running;
      running = (async () => {
        status.state = "syncing";
        try {
          if (opts.before) { try { await opts.before(); } catch {} }
          await push();
          await pull();
          status.state = "ok"; status.lastOk = new Date().toISOString(); status.error = "";
        } catch (e) {
          status.state = e && e.auth ? "badkey" : e && e.missing ? "unavailable" : "offline";
          status.error = (e && e.message && !/fetch|network|Load failed/i.test(e.message)) ? e.message : "Couldn't reach the website. Tag changes are kept here and sent when the connection is back.";
        } finally {
          running = null;
          try { a.changed(); } catch {}
        }
        return status;
      })();
      return running;
    }

    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(syncNow, 1500); };
    return {
      status,
      syncNow,
      soon,
      configure(o) { if (o.base != null) base = String(o.base).replace(/\/+$/, ""); if (o.key != null) key = o.key; if (!key) status.state = "off"; else if (status.state === "off" || status.state === "badkey") status.state = "idle"; },
      // A tag was saved here (new, edited, sent to the register, paid...).
      touched(t) { const s = st(); if (!s.dirty.includes(t.id)) s.dirty.push(t.id); a.saveState(s); soon(); },
      // A tag was deleted here.
      deleted(id) { const s = st(); s.dirty = s.dirty.filter((x) => x !== id); if (!s.deletes.includes(id)) s.deletes.push(id); a.saveState(s); soon(); },
      pending: () => { const s = st(); return s.dirty.length + s.deletes.length; },
      // Start over: next sync re-reads every tag (used after changing the key).
      reset() { const s = st(); s.cursor = null; a.saveState(s); },
    };
  }

  const api = { createTagSync };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TagSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
