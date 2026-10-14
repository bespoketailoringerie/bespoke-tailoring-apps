// Customer sync for the Bespoke Tailoring registers (POS and tablet).
// Talks to the website's /api/customer-sync with the register's own key. The website holds the
// master customer list; each register keeps its own copy so it works offline, and this keeps the
// two in step:
//   1. customers added or edited here are sent up (the website links them to an existing customer
//      with the same email or phone instead of adding them twice),
//   2. sales and voids for a customer are sent up, credited to this register,
//   3. everything changed on the website since the last check comes back down.
// Nothing here knows how a register stores things; the register passes an adapter.
(function (root) {
  const digits = (v) => { const d = String(v == null ? "" : v).replace(/\D/g, ""); return d.length === 11 && d[0] === "1" ? d.slice(1) : d; };
  const lower = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

  // adapter:
  //   customers()            -> the register's customer list (objects it owns; sync adds remoteId, spent, ...)
  //   addCustomer(fields)    -> create a local customer from website fields, return it
  //   removeCustomer(c)      -> the website removed this customer
  //   state() / saveState(s) -> persist { cursor, outbox } between runs
  //   changed()              -> save and redraw after a sync changed customers
  //   fetch (optional)       -> fetch implementation
  function createSync(opts) {
    const a = opts.adapter;
    const f = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    let base = String(opts.base || "").replace(/\/+$/, "");
    let key = opts.key || "";
    let running = null;
    const status = { state: key ? "idle" : "off", lastOk: null, error: "" };
    const st = () => { const s = a.state() || {}; s.outbox = Array.isArray(s.outbox) ? s.outbox : []; return s; };

    async function call(method, path, body) {
      const r = await f(base + path, { method, headers: { "content-type": "application/json", "x-app-key": key }, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch {}
      if (r.status === 401) { const e = new Error("This register's key wasn't accepted. Check it in the connection settings."); e.auth = true; throw e; }
      if (!r.ok) throw new Error((j && j.error) || `The website answered with an error (${r.status}).`);
      return j;
    }

    // Take on what the website knows about a customer, without undoing an edit not yet sent.
    function absorb(c, r) {
      c.remoteId = r.id;
      if (!c.dirty) { c.name = r.name || c.name || ""; c.email = r.email || ""; c.phone = r.phone || ""; }
      c.spent = r.spent || c.spent || null;
      c.visits = Array.isArray(r.visits) ? r.visits.filter((v) => v.st !== "canceled").length : c.visits || 0;
      c.syncedAt = new Date().toISOString();
    }
    function findLocal(r) {
      const list = a.customers();
      let c = list.find((x) => x.remoteId === r.id);
      if (c) return c;
      const e = lower(r.email), p = digits(r.phone);
      return list.find((x) => !x.remoteId && ((e && lower(x.email) === e) || (p.length >= 7 && digits(x.phone) === p))) || null;
    }

    async function pushCustomers() {
      const todo = a.customers().filter((c) => c.dirty || (!c.remoteId && !c.unlinked));
      for (const group of chunks(todo, 50)) {
        const ops = group.map((c) => ({ op: "customer", ref: c.id, customer: { ...(c.remoteId ? { id: c.remoteId } : {}), name: c.name || "", email: c.email || "", phone: c.phone || "" } }));
        const res = await call("POST", "/api/customer-sync", { ops });
        res.results.forEach((x, i) => {
          const c = group[i];
          if (x.ok) { c.dirty = false; absorb(c, x.customer); }
          else if (/no longer on the list/i.test(x.error || "")) { c.remoteId = null; c.dirty = false; } // removed on the website: add again next time
          else { c.dirty = false; c.syncError = x.error; if (x.customer && !c.remoteId) absorb(c, x.customer); }
        });
      }
    }

    async function pushSales() {
      const s = st();
      const ready = [], wait = [];
      for (const o of s.outbox) {
        const c = a.customers().find((x) => x.id === o.customer);
        if (!c) continue;                                   // customer deleted here: drop it
        if (c.remoteId) ready.push([o, c.remoteId]); else wait.push(o);
      }
      const sent = new Set();
      for (const group of chunks(ready, 50)) {
        const ops = group.map(([o, rid]) => o.kind === "void"
          ? { op: "void", customerId: rid, receipt: o.receipt }
          : { op: "sale", customerId: rid, receipt: o.receipt, amount: o.amount, date: o.date, note: o.note || "" });
        const res = await call("POST", "/api/customer-sync", { ops });
        res.results.forEach((x, i) => {
          const [o] = group[i];
          // A customer removed on the website can't take sales; anything else not accepted is kept to retry.
          if (x.ok || /no longer on the list|Unknown customer/i.test(x.error || "")) sent.add(o);
          if (x.ok && x.customer) { const c = a.customers().find((y) => y.remoteId === x.customer.id); if (c) absorb(c, x.customer); }
        });
      }
      // Re-read the outbox: a sale may have been rung up while this was sending.
      const done = new Set([...sent].map((o) => o.id));
      const s2 = st();
      s2.outbox = s2.outbox.filter((o) => !done.has(o.id));
      a.saveState(s2);
    }

    async function pull() {
      const s = st();
      const j = await call("GET", "/api/customer-sync" + (s.cursor ? "?since=" + encodeURIComponent(s.cursor) : ""));
      for (const r of j.customers || []) {
        const c = findLocal(r);
        if (c) absorb(c, r);
        else { const n = a.addCustomer({ name: r.name || "", email: r.email || "", phone: r.phone || "" }); absorb(n, r); }
      }
      for (const id of j.removed || []) { const c = a.customers().find((x) => x.remoteId === id); if (c) a.removeCustomer(c); }
      const s2 = st(); s2.cursor = j.now; a.saveState(s2);
    }

    async function syncNow() {
      if (!key || !base || !f) { status.state = "off"; return status; }
      if (running) return running;
      running = (async () => {
        status.state = "syncing";
        try {
          await pushCustomers();
          await pushSales();
          await pull();
          status.state = "ok"; status.lastOk = new Date().toISOString(); status.error = "";
        } catch (e) {
          status.state = e && e.auth ? "badkey" : "offline";
          status.error = (e && e.message && !/fetch|network|Load failed/i.test(e.message)) ? e.message : "Couldn't reach the website. Changes are kept here and sent when the connection is back.";
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
      connected: () => !!key,
      // A customer was added or edited here.
      touched(c) { c.dirty = true; soon(); },
      // A finished sale or a void for a customer, credited to this register.
      sale(c, receipt, amountCents, date, note) {
        if (!c || !(amountCents > 0)) return;
        const s = st(); s.outbox.push({ id: Math.random().toString(36).slice(2) + Date.now().toString(36), kind: "sale", customer: c.id, receipt: String(receipt), amount: Math.round(amountCents), date: date || new Date().toISOString().slice(0, 10), note: note || "" });
        a.saveState(s); soon();
      },
      void(c, receipt) {
        if (!c) return;
        const s = st();
        // A sale that never left this register is simply dropped.
        const before = s.outbox.length;
        s.outbox = s.outbox.filter((o) => !(o.kind === "sale" && o.customer === c.id && o.receipt === String(receipt)));
        if (s.outbox.length === before) s.outbox.push({ id: Math.random().toString(36).slice(2) + Date.now().toString(36), kind: "void", customer: c.id, receipt: String(receipt) });
        a.saveState(s); soon();
      },
      pending: () => st().outbox.length + a.customers().filter((c) => c.dirty || (!c.remoteId && !c.unlinked)).length,
      // Start over: next sync re-reads the whole list (used after changing the key).
      reset() { const s = st(); s.cursor = null; a.saveState(s); },
    };
  }

  const api = { createSync, digits };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CustomerSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
