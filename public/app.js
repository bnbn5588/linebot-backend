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

  // What the chart, by-note list and record list show: all | expense | income
  const TYPES = {
    all: { field: "balance", title: "คงเหลือรายเดือน", label: "คงเหลือ", empty: "ไม่มีรายการในเดือนนี้" },
    expense: { field: "expense", title: "รายจ่ายรายเดือน", label: "รายจ่าย", empty: "ไม่มีรายจ่ายในเดือนนี้" },
    income: { field: "income", title: "รายรับรายเดือน", label: "รายรับ", empty: "ไม่มีรายรับในเดือนนี้" },
  };

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
    type: "all",
    categories: [],
    category: null,
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
    if (!window.liff || !liff.login || session.get("reauth")) {
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
    state.categories = me.categories || [];
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

    const savedType = store.get("type");
    if (savedType && TYPES[savedType]) setType(savedType);

    $("status").hidden = true;
    $("view").hidden = false;
    await loadAll();
    await openFromLink();
  }

  // The chat card's "แก้ไข" button opens .../?edit=<record id>
  async function openFromLink() {
    const id = new URLSearchParams(location.search).get("edit");
    if (!id || !/^\d{1,15}$/.test(id)) return;
    try {
      const data = await api("me-transactions?" + q({ wallet_id: state.wallet.wallet_id, id }));
      if (data.transactions.length) openEditor(data.transactions[0]);
      else showToast("ไม่พบรายการนี้แล้ว (อาจถูกลบหรืออยู่คนละกระเป๋า)");
    } catch (e) {
      if (!(e instanceof AuthError)) showToast("เปิดรายการไม่สำเร็จ");
    }
    try { history.replaceState(null, "", location.pathname); } catch { /* ignore */ }
  }

  function showToast(msg) {
    const t = el("div", "toast", msg);
    t.setAttribute("role", "status");
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  async function loadAll() {
    await Promise.all([loadSummary(), loadTx(true)]);
  }

  // ---------- summary
  async function loadSummary() {
    const data = await api("me-summary?" + q({ wallet_id: state.wallet.wallet_id, month: state.month, type: state.type, category: state.category ? state.category.key : "" }));
    state.summary = data;
    renderTiles();
    renderChart();
    renderMonthTable();
    renderNotes();
    renderCategories();
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

  // Chart + month table follow the category picked in "แยกตามหมวด"
  // (tiles stay the wallet's totals).
  function seriesMonths() {
    return state.summary.category_months || state.summary.months;
  }
  function seriesRow(ym) {
    return seriesMonths().find((m) => m.month === ym) || { month: ym, income: 0, expense: 0, balance: 0, count: 0 };
  }
  // With an expense/income category and "ทั้งหมด", show that kind instead of the balance
  function chartType() {
    return state.type === "all" && state.category ? state.category.kind : state.type;
  }

  function chartWindow() {
    const months = seriesMonths();
    const last = months.length ? months[months.length - 1].month : state.month;
    let end = [currentMonth(state.wallet.timezone), last].sort().pop();
    if (monthsBetween(state.month, end) > 11 || state.month > end) end = state.month;
    const out = [];
    for (let i = 11; i >= 0; i--) out.push(seriesRow(addMonths(end, -i)));
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
    const T = TYPES[chartType()];
    const cat = state.category ? ` · ${state.category.icon} ${state.category.label}` : "";
    $("chartTitle").textContent = T.title + cat;
    $("chartLegend").hidden = chartType() !== "all";
    const vals = rows.map((r) => r[T.field]);
    const step = niceStep((Math.max(0, ...vals) - Math.min(0, ...vals)) / 3 || 1);
    const lo = Math.floor(Math.min(0, ...vals) / step) * step;
    const hi = Math.ceil(Math.max(0, ...vals) / step) * step || step;
    const y = (v) => pad.t + ((hi - v) / (hi - lo)) * ih;
    const band = iw / rows.length;
    const bw = Math.min(26, band * 0.62);

    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `กราฟ${T.title} 12 เดือน` });

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
      const v = r[T.field];
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

      const hit = svg("rect", { x: pad.l + band * i, y: pad.t, width: band, height: ih + pad.b, class: "hit", tabindex: "0", role: "button", "aria-label": `${monthLabel(r.month)} ${T.label} ${money(v, true)}` });
      hit.addEventListener("pointerenter", () => showTip(r, cx / W));
      hit.addEventListener("pointerleave", hideTip);
      hit.addEventListener("focus", () => showTip(r, cx / W));
      hit.addEventListener("blur", hideTip);
      hit.addEventListener("click", () => selectMonth(r.month));
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectMonth(r.month); } });
      s.append(hit);
    });
    box.replaceChildren(s);
    const cur = seriesRow(state.month);
    $("chartSel").textContent = `${monthLabel(state.month)}: ${money(cur[T.field], chartType() === "all")}`;
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
    body.replaceChildren(...[...seriesMonths()].reverse().map((m) => {
      const tr = el("tr");
      tr.append(el("td", "", monthLabel(m.month)), el("td", "", money(m.income)), el("td", "", money(m.expense)), el("td", "", money(m.balance, true)));
      return tr;
    }));
  }

  function renderNotes() {
    const list = $("notes");
    const notes = state.summary.by_note;
    if (!notes.length) {
      list.replaceChildren(el("li", "empty", TYPES[state.type].empty));
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

  // ---------- categories
  function renderCategories() {
    const list = $("cats");
    $("catMonth").textContent = monthLabel(state.month);
    const cats = state.summary.by_category || [];
    if (!cats.length) {
      list.replaceChildren(el("li", "empty", TYPES[state.type].empty));
      return;
    }
    const max = Math.max(...cats.map((c) => Math.abs(c.total))) || 1;
    list.replaceChildren(...cats.map((c) => {
      const li = el("li", state.category && state.category.key === c.key ? "on" : "");
      const b = el("button");
      b.type = "button";
      b.setAttribute("aria-pressed", state.category && state.category.key === c.key ? "true" : "false");
      const v = el("span", "v", money(c.total, true));
      v.append(el("span", "c", ` ×${c.count}`));
      const track = el("div", "track");
      const fill = el("div", "fill " + (c.total >= 0 ? "pos" : "neg"));
      fill.style.width = Math.max((Math.abs(c.total) / max) * 100, 1.5) + "%";
      track.append(fill);
      b.append(el("span", "n", `${c.icon} ${c.label}`), v, track);
      for (const line of compareLines(c)) b.append(el("span", "d", line));
      b.addEventListener("click", () => setCategoryFilter(state.category && state.category.key === c.key ? null : c));
      li.append(b);
      return li;
    }));
  }

  // ["เดือนก่อน (1–13) −4,400 · ▲ ใช้มากขึ้น 18%", "เฉลี่ย 3 เดือน −9,000"]
  // Compares sizes (abs), so an expense that grew reads "ใช้มากขึ้น" and
  // income that grew reads "ได้มากขึ้น". For the current month the month
  // before is cut to the same days so far (compare.prev_days).
  function compareLines(c) {
    if (c.prev_total === null || c.prev_total === undefined) return [];
    const cmp = state.summary.compare || {};
    const range = cmp.prev_days ? ` (1–${cmp.prev_days})` : "";
    const now = Math.abs(Number(c.total) || 0);
    const before = Math.abs(Number(c.prev_total) || 0);
    let text;
    if (!before) text = `เดือนก่อน${range} ไม่มี`;
    else {
      text = `เดือนก่อน${range} ${money(c.prev_total, true)} · `;
      const pct = Math.round(((now - before) / before) * 100);
      const verb = c.kind === "income" ? "ได้" : "ใช้";
      if (pct === 0) text += "เท่าเดิม";
      else if (pct >= 1000) text += `▲ ${verb}มากขึ้น ${Math.round(now / before)} เท่า`;
      else text += pct > 0 ? `▲ ${verb}มากขึ้น ${pct}%` : `▼ ${verb}น้อยลง ${-pct}%`;
    }
    // 1 month of history = the month before itself; 0 says nothing
    const lines = [text];
    if (cmp.avg_months >= 2 && Number(c.avg_total)) {
      lines.push(`เฉลี่ย ${cmp.avg_months} เดือนก่อน ${money(c.avg_total, true)}/เดือน`);
    }
    return lines;
  }

  function setCategoryFilter(c) {
    state.category = c ? { key: c.key, label: c.label, icon: c.icon, kind: c.kind } : null;
    showCategoryChips();
    // Reload the summary too: the by-note list follows the category
    run(loadAll);
  }

  function showCategoryChips() {
    const label = state.category ? `${state.category.icon} ${state.category.label}  ✕` : "";
    for (const [row, chip] of [["chartChipRow", "chartChip"], ["catChipRow", "catChip"], ["noteChipRow", "noteChip"]]) {
      $(row).hidden = !state.category;
      $(chip).textContent = label;
    }
  }

  // ---------- remembered categories
  async function loadMemory() {
    const list = $("memoryList");
    let items;
    try {
      items = await api("me-memory");
    } catch (e) {
      if (!(e instanceof AuthError)) list.replaceChildren(el("li", "empty", "โหลดไม่สำเร็จ"));
      return;
    }
    $("memoryCount").textContent = items.length ? `${items.length} โน้ต` : "";
    if (!items.length) {
      list.replaceChildren(el("li", "empty", "ยังไม่มี — เลือกหมวดให้รายการไหนก็ได้ ระบบจะเริ่มจำ"));
      return;
    }
    list.replaceChildren(...items.map((m) => {
      const li = el("li");
      const k = el("span", "k", m.note_key);
      k.append(el("small", "", `${m.records} รายการ`));
      const ctl = el("div", "ctl");
      const sel = el("select");
      sel.setAttribute("aria-label", `หมวดของ ${m.note_key}`);
      for (const c of state.categories.filter((c) => c.kind === m.category.kind)) {
        const o = el("option", "", `${c.icon} ${c.label}`);
        o.value = c.key;
        sel.append(o);
      }
      sel.value = m.category.key;
      sel.addEventListener("change", async () => {
        sel.disabled = true;
        try {
          await api("me-memory", { method: "PUT", body: { note_key: m.note_key, category: sel.value } });
          showToast(/^other_/.test(sel.value) ? `ลืม "${m.note_key}" แล้ว` : `"${m.note_key}" → ${sel.options[sel.selectedIndex].text}`);
          await loadMemory();
        } catch (e) {
          if (!(e instanceof AuthError)) showToast("บันทึกไม่สำเร็จ: " + e.message);
          sel.disabled = false;
        }
      });
      const del = el("button", "btn del", "ลืม");
      del.type = "button";
      del.setAttribute("aria-label", `ลืมหมวดของ ${m.note_key}`);
      del.addEventListener("click", async () => {
        if (!window.confirm(`ให้ระบบลืมหมวดของ "${m.note_key}"?\nครั้งต่อไปจะเดาหมวดจากคำในโน้ตแทน`)) return;
        del.disabled = true;
        try {
          await api("me-memory?" + q({ note_key: m.note_key }), { method: "DELETE" });
          await loadMemory();
        } catch (e) {
          if (!(e instanceof AuthError)) showToast("ลบไม่สำเร็จ: " + e.message);
          del.disabled = false;
        }
      });
      ctl.append(sel, del);
      li.append(k, ctl);
      return li;
    }));
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
      type: state.type,
      category: state.category ? state.category.key : "",
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
      list.replaceChildren(el("li", "empty", state.q ? "ไม่พบรายการ" : TYPES[state.type].empty));
    } else {
      list.replaceChildren(...state.tx.map((t) => {
        const li = el("li");
        const b = el("button");
        b.type = "button";
        b.append(
          el("span", "note", t.note || "-"),
          el("span", "amt", money(t.exvalue, true)),
          el("span", "when", whenLabel(t.datetime)),
          el("span", "kind", t.category ? `${t.category.icon} ${t.category.label}` : (t.exvalue >= 0 ? "รายรับ" : "รายจ่าย"))
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
    fillCategorySelect(t.exvalue < 0 ? "expense" : "income", t.category ? t.category.key : null);
    setFormError("");
    setBusy(false);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  function fillCategorySelect(kind, selected) {
    const sel = $("fCategory");
    const options = state.categories.filter((c) => c.kind === kind);
    sel.replaceChildren(...options.map((c) => {
      const o = el("option", "", `${c.icon} ${c.label}`);
      o.value = c.key;
      return o;
    }));
    sel.value = options.some((c) => c.key === selected) ? selected : (kind === "income" ? "other_income" : "other_expense");
  }
  for (const r of dlg.querySelectorAll("input[name=sign]")) {
    r.addEventListener("change", (e) => {
      if (e.target.checked) fillCategorySelect(e.target.value === "-" ? "expense" : "income", $("fCategory").value);
    });
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
    // Send the category only when the user changed it, so an untouched form
    // does not overwrite what the user taught for this note.
    const pickedCategory = $("fCategory").value;
    const wasCategory = t.category && t.category.assigned ? t.category.key : null;
    const signChanged = (sign === "-") !== (t.exvalue < 0);
    if (pickedCategory && (pickedCategory !== wasCategory || signChanged) && !(wasCategory === null && !signChanged && /^other_/.test(pickedCategory))) {
      body.category = pickedCategory;
    }
    setBusy(true);
    try {
      await api("me-transactions", { method: "PUT", body });
      closeEditor();
      await loadAll();
      if ($("memoryCard").open) await loadMemory();
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
      if ($("memoryCard").open) await loadMemory();
    } catch (e) {
      if (!(e instanceof AuthError)) setFormError(e.message);
      setBusy(false);
    }
  }

  // ---------- type filter
  function setType(type) {
    state.type = type;
    const T = TYPES[type];
    const radio = document.querySelector(`.filter input[value="${type}"]`);
    if (radio) radio.checked = true;
    $("chartTitle").textContent = T.title;
    // two-colour legend only when positive and negative bars can both appear
    $("chartLegend").hidden = type !== "all";
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

  for (const r of document.querySelectorAll(".filter input[name=type]")) {
    r.addEventListener("change", (e) => {
      if (!e.target.checked || !TYPES[e.target.value]) return;
      setType(e.target.value);
      store.set("type", e.target.value);
      if (state.category && state.type !== "all" && state.category.kind !== state.type) {
        state.category = null;
        showCategoryChips();
      }
      hideTip();
      run(loadAll);
    });
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
  $("catChip").addEventListener("click", () => setCategoryFilter(null));
  $("noteChip").addEventListener("click", () => setCategoryFilter(null));
  $("chartChip").addEventListener("click", () => setCategoryFilter(null));
  $("memoryCard").addEventListener("toggle", () => { if ($("memoryCard").open) run(loadMemory); });
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
