// Expense Wallet — LIFF web app. Talks to /api/me* with the LINE ID token.
// All user content is rendered with textContent (never innerHTML).
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const cfg = window.APP_CONFIG || {};
  const PAGE = 30;
  const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const numFmt = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

  const state = {
    token: null,
    wallets: [],
    wallet: null,
    month: null,
    summary: null,
    tx: [],
    offset: 0,
    hasMore: false,
    q: "",
    editing: null,
    txSeq: 0,
  };

  // ---------- helpers
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function money(v, signed = false) {
    const n = Number(v) || 0;
    const s = numFmt.format(Math.abs(n));
    if (n < 0) return "−" + s;
    return (signed && n > 0 ? "+" : "") + s;
  }
  function monthLabel(ym, withYear = true) {
    const [y, m] = ym.split("-").map(Number);
    return MONTHS_TH[m - 1] + (withYear ? " " + String((y + 543) % 100).padStart(2, "0") : "");
  }
  function addMonths(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  }
  function monthsBetween(a, b) {
    const [ya, ma] = a.split("-").map(Number);
    const [yb, mb] = b.split("-").map(Number);
    return (yb - ya) * 12 + (mb - ma);
  }
  function currentMonth(timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    } catch {
      return new Date().toISOString().slice(0, 7);
    }
  }
  function whenLabel(dt) {
    // "2026-11-06 08:30:00" -> "6 พ.ย. 69 · 08:30"
    const [d, t] = dt.split(" ");
    const [y, m, day] = d.split("-").map(Number);
    return `${day} ${monthLabel(`${y}-${String(m).padStart(2, "0")}`)} · ${t.slice(0, 5)}`;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function svg(tag, attrs) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  }

  function showStatus(message, retry) {
    const s = $("status");
    s.replaceChildren(el("div", "", message));
    if (retry) {
      const b = el("button", "btn", "ลองใหม่");
      b.addEventListener("click", () => location.reload());
      s.append(b);
    }
    s.hidden = false;
    $("view").hidden = true;
  }

  // ---------- API
  class AuthError extends Error {}

  function reauth() {
    if (session.get("reauth")) {
      showStatus("เข้าสู่ระบบด้วย LINE ไม่สำเร็จ ลองปิดหน้านี้แล้วเปิดใหม่", true);
      return;
    }
    session.set("reauth", "1");
    if (window.liff && liff.isLoggedIn && liff.isLoggedIn()) liff.logout();
    liff.login({ redirectUri: location.href });
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = { Authorization: "Bearer " + state.token };
    if (body) headers["Content-Type"] = "application/json";
    const r = await fetch("/api/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let j = null;
    try { j = await r.json(); } catch { /* empty body */ }
    if (r.status === 401) {
      reauth();
      throw new AuthError("unauthorized");
    }
    if (!r.ok) {
      const e = new Error((j && j.message) || "HTTP " + r.status);
      e.status = r.status;
      e.body = j;
      throw e;
    }
    return j.data;
  }

  function q(params) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, v);
    return u.toString();
  }

  // ---------- start
  async function start() {
    const params = new URLSearchParams(location.search);
    const mock = params.get("mocktoken");
    if (mock && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      // Local testing only: the local server verifies tokens against a stub.
      state.token = mock;
      $("hello").textContent = "โหมดทดสอบ";
    } else {
      if (!cfg.liffId) return showStatus("ยังไม่ได้ตั้งค่า LIFF ID (public/config.js)");
      if (!window.liff) return showStatus("โหลด LINE SDK ไม่สำเร็จ", true);
      await liff.init({ liffId: cfg.liffId });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }
      state.token = liff.getIDToken();
      if (!state.token) return showStatus("LIFF app ต้องเปิด scope openid");
      liff.getProfile().then((p) => {
        $("hello").textContent = "สวัสดี " + p.displayName;
        if (p.pictureUrl) {
          $("avatar").src = p.pictureUrl;
          $("avatar").hidden = false;
        }
      }).catch(() => {});
    }

    let me;
    try {
      me = await api("me");
    } catch (e) {
      if (e instanceof AuthError) return;
      if (e.status === 404 && e.body && e.body.code === "NO_WALLET") {
        return showStatus("ยังไม่มีกระเป๋าเงิน — พิมพ์ในแชทของบอท: create main Asia/Bangkok");
      }
      throw e;
    }
    session.del("reauth");

    state.wallets = me.wallets;
    const saved = store.get("wallet_id");
    state.wallet = me.wallets.find((w) => String(w.wallet_id) === saved) || me.current_wallet;
    const sel = $("walletSelect");
    sel.replaceChildren(...me.wallets.map((w) => {
      const o = el("option", "", `[${w.wallet_id}] ${w.wallet_name || "-"}`);
      o.value = String(w.wallet_id);
      return o;
    }));
    sel.value = String(state.wallet.wallet_id);
    state.month = currentMonth(state.wallet.timezone);
    $("monthInput").value = state.month;

    $("status").hidden = true;
    $("view").hidden = false;
    await loadAll();
  }

  async function loadAll() {
    await Promise.all([loadSummary(), loadTx(true)]);
  }

  // ---------- summary
  async function loadSummary() {
    const data = await api("me-summary?" + q({ wallet_id: state.wallet.wallet_id, month: state.month }));
    state.summary = data;
    renderTiles();
    renderChart();
    renderMonthTable();
    renderNotes();
  }

  function monthRow(ym) {
    return (state.summary.months.find((m) => m.month === ym)) || { month: ym, income: 0, expense: 0, balance: 0, count: 0 };
  }

  function renderTiles() {
    const m = monthRow(state.month);
    $("tBalance").textContent = money(m.balance, true);
    $("tIncome").textContent = money(m.income);
    $("tExpense").textContent = money(m.expense);
    $("tAll").textContent = money(state.summary.totals.balance, true);
    $("noteMonth").textContent = monthLabel(state.month);
  }

  function chartWindow() {
    const months = state.summary.months;
    const last = months.length ? months[months.length - 1].month : state.month;
    let end = [currentMonth(state.wallet.timezone), last].sort().pop();
    if (monthsBetween(state.month, end) > 11 || state.month > end) end = state.month;
    const out = [];
    for (let i = 11; i >= 0; i--) out.push(monthRow(addMonths(end, -i)));
    return out;
  }

  function renderChart() {
    const box = $("chart");
    const rows = chartWindow();
    const W = Math.max(box.clientWidth || 320, 280);
    const H = 190;
    const pad = { l: 40, r: 6, t: 18, b: 22 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const vals = rows.map((r) => r.balance);
    const step = niceStep((Math.max(0, ...vals) - Math.min(0, ...vals)) / 3 || 1);
    const lo = Math.floor(Math.min(0, ...vals) / step) * step;
    const hi = Math.ceil(Math.max(0, ...vals) / step) * step || step;
    const y = (v) => pad.t + ((hi - v) / (hi - lo)) * ih;
    const band = iw / rows.length;
    const bw = Math.min(26, band * 0.62);

    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "กราฟคงเหลือรายเดือน 12 เดือน" });

    // grid + y labels on round values
    for (let v = lo; v <= hi + step / 2; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      s.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, class: v === 0 ? "zero" : "grid" }));
      const t = svg("text", { x: pad.l - 6, y: yy + 4, "text-anchor": "end", class: "axis" });
      t.textContent = v === 0 ? "0" : compactFmt.format(v);
      s.append(t);
    }

    const y0 = y(0);
    rows.forEach((r, i) => {
      const cx = pad.l + band * i + band / 2;
      const x = cx - bw / 2;
      const v = r.balance;
      const selected = r.month === state.month;
      if (v !== 0) {
        const yv = y(v);
        const h = Math.max(Math.abs(yv - y0), 1);
        const rad = Math.min(4, h, bw / 2);
        // rounded at the data end, square at the baseline
        const d = v > 0
          ? `M${x},${y0} V${yv + rad} Q${x},${yv} ${x + rad},${yv} H${x + bw - rad} Q${x + bw},${yv} ${x + bw},${yv + rad} V${y0} Z`
          : `M${x},${y0} V${yv - rad} Q${x},${yv} ${x + rad},${yv} H${x + bw - rad} Q${x + bw},${yv} ${x + bw},${yv - rad} V${y0} Z`;
        s.append(svg("path", { d, class: `bar ${v > 0 ? "pos" : "neg"}${selected ? "" : " dim"}` }));
      }
      const every = band < 36 ? 2 : 1;
      if (selected || (rows.length - 1 - i) % every === 0) {
        const at = svg("text", { x: cx, y: H - 6, "text-anchor": "middle", class: "axis" + (selected ? " sel" : "") });
        at.textContent = monthLabel(r.month, false);
        s.append(at);
      }

      const hit = svg("rect", { x: pad.l + band * i, y: pad.t, width: band, height: ih + pad.b, class: "hit", tabindex: "0", role: "button", "aria-label": `${monthLabel(r.month)} คงเหลือ ${money(v, true)}` });
      hit.addEventListener("pointerenter", () => showTip(r, cx / W));
      hit.addEventListener("pointerleave", hideTip);
      hit.addEventListener("focus", () => showTip(r, cx / W));
      hit.addEventListener("blur", hideTip);
      hit.addEventListener("click", () => selectMonth(r.month));
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectMonth(r.month); } });
      s.append(hit);
    });
    box.replaceChildren(s);
    const cur = monthRow(state.month);
    $("chartSel").textContent = `${monthLabel(state.month)}: ${money(cur.balance, true)}`;
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function showTip(r, frac) {
    const tip = $("tooltip");
    const rowEl = (label, value) => {
      const d = el("div", "r");
      d.append(el("span", "", label), el("span", "", value));
      return d;
    };
    tip.replaceChildren(
      el("b", "", monthLabel(r.month)),
      rowEl("รายรับ", money(r.income)),
      rowEl("รายจ่าย", money(r.expense)),
      rowEl("คงเหลือ", money(r.balance, true)),
      rowEl("รายการ", String(r.count))
    );
    tip.hidden = false;
    const card = tip.parentElement.getBoundingClientRect();
    const chart = $("chart").getBoundingClientRect();
    const left = Math.min(Math.max(chart.left - card.left + frac * chart.width - tip.offsetWidth / 2, 8), card.width - tip.offsetWidth - 8);
    tip.style.left = left + "px";
    tip.style.top = (chart.top - card.top - 4) + "px";
  }
  function hideTip() { $("tooltip").hidden = true; }

  function renderMonthTable() {
    const body = $("monthTable");
    body.replaceChildren(...[...state.summary.months].reverse().map((m) => {
      const tr = el("tr");
      tr.append(el("td", "", monthLabel(m.month)), el("td", "", money(m.income)), el("td", "", money(m.expense)), el("td", "", money(m.balance, true)));
      return tr;
    }));
  }

  function renderNotes() {
    const list = $("notes");
    const notes = state.summary.by_note;
    if (!notes.length) {
      list.replaceChildren(el("li", "empty", "ไม่มีรายการในเดือนนี้"));
      return;
    }
    const max = Math.max(...notes.map((n) => Math.abs(n.total))) || 1;
    const shown = notes.slice(0, 15);
    const items = shown.map((n) => {
      const li = el("li");
      const name = el("span", "n", n.note || "-");
      const v = el("span", "v", money(n.total, true));
      const c = el("span", "c", ` ×${n.count}`);
      v.append(c);
      const track = el("div", "track");
      const fill = el("div", "fill " + (n.total >= 0 ? "pos" : "neg"));
      fill.style.width = Math.max((Math.abs(n.total) / max) * 100, 1.5) + "%";
      track.append(fill);
      li.append(name, v, track);
      return li;
    });
    if (notes.length > shown.length) items.push(el("li", "empty", `และอีก ${notes.length - shown.length} โน้ต`));
    list.replaceChildren(...items);
  }

  // ---------- transactions
  async function loadTx(reset) {
    const seq = ++state.txSeq;
    if (reset) {
      state.offset = 0;
      state.tx = [];
    }
    const searching = state.q.trim() !== "";
    $("txMonth").textContent = searching ? "ทุกเดือน" : monthLabel(state.month);
    const data = await api("me-transactions?" + q({
      wallet_id: state.wallet.wallet_id,
      month: searching ? "" : state.month,
      q: state.q.trim(),
      limit: PAGE,
      offset: state.offset,
    }));
    if (seq !== state.txSeq) return; // a newer search replaced this one
    state.tx = state.tx.concat(data.transactions);
    state.offset += data.transactions.length;
    state.hasMore = data.has_more;
    renderTx();
  }

  function renderTx() {
    const list = $("txList");
    if (!state.tx.length) {
      list.replaceChildren(el("li", "empty", state.q ? "ไม่พบรายการ" : "ไม่มีรายการในเดือนนี้"));
    } else {
      list.replaceChildren(...state.tx.map((t) => {
        const li = el("li");
        const b = el("button");
        b.type = "button";
        b.append(
          el("span", "note", t.note || "-"),
          el("span", "amt", money(t.exvalue, true)),
          el("span", "when", whenLabel(t.datetime)),
          el("span", "kind", t.exvalue >= 0 ? "รายรับ" : "รายจ่าย")
        );
        b.addEventListener("click", () => openEditor(t));
        li.append(b);
        return li;
      }));
    }
    $("more").hidden = !state.hasMore;
  }

  // ---------- editor
  const dlg = $("editor");
  function openEditor(t) {
    state.editing = t;
    const [d, time] = t.datetime.split(" ");
    dlg.querySelector(`input[name=sign][value="${t.exvalue < 0 ? "-" : "+"}"]`).checked = true;
    $("fAmount").value = String(Math.abs(t.exvalue));
    $("fDate").value = d;
    $("fTime").value = time;
    $("fNote").value = t.note || "";
    setFormError("");
    setBusy(false);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  function closeEditor() {
    state.editing = null;
    if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
  }
  function setFormError(msg) {
    $("formError").textContent = msg;
    $("formError").hidden = !msg;
  }
  function setBusy(busy) {
    for (const id of ["btnSave", "btnDelete", "btnCancel"]) $(id).disabled = busy;
  }

  async function save(ev) {
    ev.preventDefault();
    const t = state.editing;
    if (!t) return;
    const sign = dlg.querySelector("input[name=sign]:checked").value;
    const amount = $("fAmount").value.trim().replace(/^[+-]/, "");
    let time = $("fTime").value;
    if (/^\d{2}:\d{2}$/.test(time)) time += ":00";
    const body = {
      id: t.id,
      exvalue: sign + amount,
      targetdate: `${$("fDate").value} ${time}`,
      detail: $("fNote").value,
    };
    setBusy(true);
    try {
      await api("me-transactions", { method: "PUT", body });
      closeEditor();
      await loadAll();
    } catch (e) {
      if (!(e instanceof AuthError)) setFormError(e.message);
      setBusy(false);
    }
  }

  async function remove() {
    const t = state.editing;
    if (!t) return;
    if (!window.confirm(`ลบ "${t.note}" ${money(t.exvalue, true)} ?`)) return;
    setBusy(true);
    try {
      await api("me-transactions?" + q({ id: t.id }), { method: "DELETE" });
      closeEditor();
      await loadAll();
    } catch (e) {
      if (!(e instanceof AuthError)) setFormError(e.message);
      setBusy(false);
    }
  }

  // ---------- events
  async function selectMonth(ym) {
    if (!ym || ym === state.month) return;
    state.month = ym;
    $("monthInput").value = ym;
    hideTip();
    await run(loadAll);
  }

  async function run(fn) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof AuthError) return;
      console.error(e);
      showStatus("เกิดข้อผิดพลาด: " + e.message, true);
    }
  }

  $("walletSelect").addEventListener("change", (e) => {
    state.wallet = state.wallets.find((w) => String(w.wallet_id) === e.target.value) || state.wallet;
    store.set("wallet_id", String(state.wallet.wallet_id));
    run(loadAll);
  });
  $("monthInput").addEventListener("change", (e) => {
    if (/^\d{4}-\d{2}$/.test(e.target.value)) selectMonth(e.target.value);
  });
  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = e.target.value;
      run(() => loadTx(true));
    }, 300);
  });
  $("more").addEventListener("click", () => run(() => loadTx(false)));
  $("editForm").addEventListener("submit", save);
  $("btnCancel").addEventListener("click", closeEditor);
  $("btnDelete").addEventListener("click", remove);
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.summary) renderChart(); }, 150);
  });

  run(start);
})();
