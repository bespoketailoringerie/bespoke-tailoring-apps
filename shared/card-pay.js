// Card reader payments for the Bespoke Tailoring registers (POS and tablet).
// The reader is a PAX A920 Pro on Merchant360. The registers never hold the Merchant360 key: they
// ask the website's /api/card-pay with their own register key, and the website talks to Merchant360.
//
//   const cp = CardPay.createCardPay({ base, key });
//   await cp.check()                       -> { ready, test } (ready is false until the website is set up)
//   await cp.start(cents, ref, note)       -> payment { id, status: "pending", ... }
//   const w = cp.watch(id, (p) => ...)     -> calls back with each update until the payment is finished;
//                                             w.stop() to stop asking
//   await cp.cancel(id) / cp.void(id) / cp.refund(id, cents, ref)
// A payment's status is one of pending, succeeded, failed, canceled, voided, refunded, partially_refunded.
(function (root) {
  const FINAL = ["succeeded", "failed", "canceled", "voided", "refunded", "partially_refunded"];

  function createCardPay(opts) {
    const f = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    let base = String(opts.base || "").replace(/\/+$/, "");
    let key = opts.key || "";
    const state = { ready: false, test: false, checked: false, error: "" };

    async function call(method, query, body) {
      if (!key || !base || !f) { const e = new Error("Connect this register to the website first (Customer list button at the top)."); e.status = 0; throw e; }
      let r;
      try {
        r = await f(base + "/api/card-pay" + (query || ""), { method, headers: { "content-type": "application/json", "x-app-key": key }, body: body ? JSON.stringify(body) : undefined });
      } catch {
        const e = new Error("Couldn't reach the website. Check the internet connection, or key the amount into the reader."); e.status = 0; e.offline = true; throw e;
      }
      let j = null; try { j = await r.json(); } catch {}
      if (!r.ok) {
        const e = new Error((j && j.error) || `The website answered with an error (${r.status}).`);
        e.status = r.status; e.code = (j && j.code) || ""; e.notSetUp = r.status === 404 && j && j.ready === false;
        throw e;
      }
      return j || {};
    }

    async function check() {
      try {
        const j = await call("GET");
        Object.assign(state, { ready: !!j.ready, test: !!j.test, checked: true, error: "" });
      } catch (e) {
        // Not set up (404), an older website without the endpoint (404), no key, or offline: no reader.
        Object.assign(state, { ready: false, test: false, checked: true, error: e.notSetUp || e.status === 404 ? "" : e.message });
      }
      return state;
    }

    // Ask every couple of seconds until the payment is finished. Brief hiccups are retried quietly.
    function watch(id, onUpdate, every = 2500) {
      let stopped = false, timer = null, misses = 0;
      const tick = async () => {
        if (stopped) return;
        try {
          const j = await call("GET", "?id=" + encodeURIComponent(id));
          misses = 0;
          if (stopped) return;
          onUpdate(j.payment);
          if (FINAL.includes(j.payment.status)) return;
        } catch (e) {
          if (stopped) return;
          if (++misses >= 4) onUpdate({ id, status: "pending", error: e.message });
        }
        timer = setTimeout(tick, every);
      };
      timer = setTimeout(tick, Math.min(every, 1200));
      return { stop() { stopped = true; clearTimeout(timer); } };
    }

    return {
      state,
      check,
      watch,
      configure(o) { if (o.base != null) base = String(o.base).replace(/\/+$/, ""); if (o.key != null) key = o.key; state.checked = false; if (!key) state.ready = false; },
      start: async (amount, ref, note) => (await call("POST", "", { op: "start", amount: Math.round(amount), ref, note: note || "" })).payment,
      get: async (id) => (await call("GET", "?id=" + encodeURIComponent(id))).payment,
      cancel: async (id) => (await call("POST", "", { op: "cancel", id })).payment,
      void: async (id) => (await call("POST", "", { op: "void", id })).payment,
      refund: async (id, amount, ref) => (await call("POST", "", { op: "refund", id, ...(amount ? { amount: Math.round(amount) } : {}), ref: ref || "" })).payment,
    };
  }

  // "Visa ending 4242 · approval A1B2C3"
  function describe(p) {
    if (!p) return "";
    const brand = p.brand ? p.brand.charAt(0).toUpperCase() + p.brand.slice(1) : "Card";
    return [p.last4 ? `${brand} ending ${p.last4}` : "", p.auth ? `approval ${p.auth}` : ""].filter(Boolean).join(" · ");
  }

  const api = { createCardPay, describe, FINAL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CardPay = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
