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
    note: null, // { key, kind } picked in the by-note list or the note picker
    txMonths: null, // by_month of an all-months list (note or search)
    txDays: null, // by_day of a one-month list (day headers)
    pendingDelete: null, // { t, at, timer, toast } while "เลิกทำ" is offered
    allNotes: null, // me-notes of the current wallet (picker), reloaded after edits
    catRange: "month", // category card: "month" | "12" (last 12 months)
    txSort: "new", // record list: new | old | amount_desc | amount_asc
  };
  const TX_SORTS = new Set(["new", "old", "amount_desc", "amount_asc"]);

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
  // "2026-11-19" -> "วันนี้ · พฤ. 19 พ.ย." (เมื่อวาน for the day before)
  const DAYS_TH = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
  function dayLabel(d) {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    const text = `${DAYS_TH[dt.getUTCDay()]} ${day} ${MONTHS_TH[m - 1]}`;
    const today = nowLocal(state.wallet.timezone).date;
    const yest = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    return d === today ? `วันนี้ · ${text}` : d === yest ? `เมื่อวาน · ${text}` : text;
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
    // The monthly summary card opens .../?wallet=<id>&month=YYYY-MM
    const link = new URLSearchParams(location.search);
    const linkWallet = me.wallets.find((w) => String(w.wallet_id) === link.get("wallet"));
    const linkMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(link.get("month") || "") ? link.get("month") : null;
    const saved = store.get("wallet_id");
    state.wallet = linkWallet || me.wallets.find((w) => String(w.wallet_id) === saved) || me.current_wallet;
    const sel = $("walletSelect");
    sel.replaceChildren(...me.wallets.map((w) => {
      const o = el("option", "", `[${w.wallet_id}] ${w.wallet_name || "-"}`);
      o.value = String(w.wallet_id);
      return o;
    }));
    sel.value = String(state.wallet.wallet_id);
    state.month = linkMonth || currentMonth(state.wallet.timezone);
    $("monthInput").value = state.month;

    const savedType = store.get("type");
    if (savedType && TYPES[savedType]) setType(savedType);
    const savedSort = store.get("txSort");
    if (savedSort && TX_SORTS.has(savedSort)) {
      state.txSort = savedSort;
      document.querySelector(`input[name=txSort][value="${savedSort}"]`).checked = true;
    }
    if (store.get("catRange") === "12") {
      state.catRange = "12";
      document.querySelector("input[name=catRange][value='12']").checked = true;
    }

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

  // CSV of the selected wallet + month (all records; list filters do not apply).
  // fetch with the token, then save via a temporary <a download>.
  // The CSV is the record list as shown: same month / type / category / note / search
  function listAllMonths() {
    return state.q.trim() !== "" || !!state.note;
  }
  function exportFilters() {
    return {
      wallet_id: state.wallet.wallet_id,
      month: listAllMonths() ? "" : state.month,
      type: state.type === "all" ? "" : state.type,
      category: state.category ? state.category.key : "",
      note: state.note ? state.note.key : "",
      q: state.q.trim(),
      sort: state.txSort,
    };
  }
  function exportLabel() {
    const parts = [];
    if (state.category) parts.push(`${state.category.icon} ${state.category.label}`);
    if (state.note) parts.push(`📝 ${clipText(state.note.key, 16)}`);
    else if (state.q.trim()) parts.push(`"${clipText(state.q.trim(), 12)}"`);
    if (state.type !== "all") parts.push(TYPES[state.type].label);
    parts.push(listAllMonths() ? "ทุกเดือน" : monthLabel(state.month));
    return `ส่งออก CSV (${parts.join(" · ")})`;
  }

  async function exportCsv() {
    const btn = $("exportCsv");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "กำลังสร้างไฟล์…";
    try {
      // Inside LINE (iPhone cannot save a file there): get a short-lived link
      // and open it in the phone's browser, which downloads it.
      if (window.liff && liff.isInClient && liff.isInClient()) {
        try {
          const link = await api("me-export", { method: "POST", body: exportFilters() });
          if (!link.rows) showToast(listAllMonths() ? "ไม่มีรายการให้ส่งออก" : "เดือนนี้ไม่มีรายการให้ส่งออก");
          else {
            liff.openWindow({ url: new URL(link.url, location.href).href, external: true });
            showToast("กำลังเปิดไฟล์ในเบราว์เซอร์ของเครื่อง");
          }
        } catch (e) {
          if (!(e instanceof AuthError)) showToast(e.status === 413 && e.message ? e.message : "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง");
        }
        return;
      }
      const r = await fetch("/api/me-export?" + q(exportFilters()), {
        headers: { Authorization: "Bearer " + state.token },
      });
      if (r.status === 401) {
        reauth();
        return;
      }
      if (!r.ok) {
        let j = null;
        try { j = await r.json(); } catch { /* not JSON */ }
        showToast(r.status === 413 && j && j.message ? j.message : "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง");
        return;
      }
      if (r.headers.get("X-Row-Count") === "0") {
        showToast(listAllMonths() ? "ไม่มีรายการให้ส่งออก" : "เดือนนี้ไม่มีรายการให้ส่งออก");
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "");
      a.download = cd ? cd[1] : `expenses-${state.wallet.wallet_id}-${state.month}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      showToast("ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function showToast(msg) {
    const t = el("div", "toast", msg);
    t.setAttribute("role", "status");
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  async function loadAll() {
    await flushDelete();
    updateMonthNav();
    await Promise.all([loadSummary(), loadTx(true), loadBudgets()]);
    requestAnimationFrame(markJump); // card heights changed
  }

  // ---------- budgets (per expense category, every month of this wallet)
  async function loadBudgets() {
    $("budgetMonth").textContent = monthLabel(state.month);
    const done = showLoading(["budgetCard"]);
    try {
      state.budgets = (await api("me-budget?" + q({ wallet_id: state.wallet.wallet_id, month: state.month }))).budgets;
    } catch (e) {
      if (e instanceof AuthError) return;
      state.budgets = [];
      $("budgetList").replaceChildren(el("li", "empty", "โหลดงบไม่สำเร็จ"));
      return;
    } finally {
      done();
    }
    renderBudgets();
  }

  function renderBudgets() {
    const list = $("budgetList");
    const items = state.budgets || [];
    if (!items.length) {
      list.replaceChildren(el("li", "empty", "ยังไม่ได้ตั้งงบ เลือกหมวดด้านล่างแล้วใส่จำนวน"));
    } else {
      list.replaceChildren(...items.map((b) => {
        const level = b.spent > b.amount ? "over" : b.pct >= 80 ? "near" : "ok";
        const li = el("li");
        const btn = el("button");
        btn.type = "button";
        btn.setAttribute("aria-label", `แก้งบ ${b.label}`);
        const v = el("span", "v", `${money(b.spent)} / ${money(b.amount)}`);
        const track = el("div", "track");
        const fill = el("div", "fill " + level);
        fill.style.width = Math.min(Math.max(b.pct, b.spent > 0 ? 1.5 : 0), 100) + "%";
        track.append(fill);
        const line = level === "over"
          ? `⚠️ เกินงบ ${money(b.spent - b.amount)} (${b.pct}%)`
          : `${level === "near" ? "⚠️ " : ""}ใช้ไป ${b.pct}% · เหลือ ${money(b.amount - b.spent)}`;
        btn.append(el("span", "n", `${b.icon} ${b.label}`), v, track, el("span", "d " + level, line));
        const pace = paceLine(b);
        if (pace) btn.append(el("span", "d pace", pace));
        btn.addEventListener("click", () => pickBudget(b.key));
        li.append(btn);
        return li;
      }));
    }
    const sel = $("bCategory");
    const keep = sel.value;
    sel.replaceChildren(...state.categories.filter((c) => c.kind === "expense").map((c) => {
      const o = el("option", "", `${c.icon} ${c.label}`);
      o.value = c.key;
      return o;
    }));
    pickBudget(keep || (sel.options[0] && sel.options[0].value), false);
    setBudgetEdit(state.budgetOpen);
  }

  // The form folds away behind "✎ ตั้ง / แก้ไขงบ" once a budget exists
  // (no budget yet: always open). Tapping a budget row opens it too.
  function setBudgetEdit(open) {
    const none = !(state.budgets || []).length;
    state.budgetOpen = !!open;
    const show = none || state.budgetOpen;
    $("budgetEdit").hidden = !show;
    $("budgetToggle").hidden = none;
    $("budgetToggle").setAttribute("aria-expanded", String(show));
    $("budgetToggle").textContent = show ? "ซ่อนฟอร์มงบ" : "✎ ตั้ง / แก้ไขงบ";
  }

  // Current month only: what is left spread over the days left (today counts).
  // "ใช้ได้วันละ ~290 · อีก 12 วัน รวมวันนี้" / last day: "วันนี้ใช้ได้อีก 3,200"
  function paceLine(b) {
    if (state.month !== currentMonth(state.wallet.timezone)) return "";
    const left = Number(b.amount) - Number(b.spent);
    if (!(left > 0)) return "";
    const today = Number(nowLocal(state.wallet.timezone).date.slice(8, 10));
    const days = daysIn(state.month) - today + 1;
    if (days <= 1) return `วันนี้ใช้ได้อีก ${money(Math.floor(left))}`;
    const per = Math.floor(left / days);
    if (per < 1) return `เหลือไม่ถึงวันละ 1 · อีก ${days} วัน รวมวันนี้`;
    return `ใช้ได้วันละ ~${money(per)} · อีก ${days} วัน รวมวันนี้`;
  }

  // Fill the form with a category's budget (tap a row to change it)
  function pickBudget(key, focus = true) {
    if (focus) setBudgetEdit(true);
    const sel = $("bCategory");
    if (key) sel.value = key;
    const b = (state.budgets || []).find((x) => x.key === sel.value);
    $("bAmount").value = b ? String(b.amount) : "";
    $("bRemove").hidden = !b;
    $("bSave").textContent = b ? "บันทึกงบ" : "ตั้งงบ";
    if (focus) $("bAmount").focus();
  }

  async function saveBudget(amount) {
    const sel = $("bCategory");
    const label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "";
    for (const id of ["bSave", "bRemove"]) $(id).disabled = true;
    try {
      await api("me-budget", { method: "PUT", body: { wallet_id: state.wallet.wallet_id, category: sel.value, amount } });
      showToast(amount ? `ตั้งงบ ${label} ${money(amount)} ต่อเดือนแล้ว` : `ลบงบ ${label} แล้ว`);
      state.budgetOpen = false; // done: fold the form again
      await loadBudgets();
    } catch (e) {
      if (!(e instanceof AuthError)) showToast("บันทึกงบไม่สำเร็จ: " + e.message);
    } finally {
      for (const id of ["bSave", "bRemove"]) $(id).disabled = false;
    }
  }

  // ---------- summary
  // Loading look (after LOADING_MS, so quick loads do not flash): tiles turn
  // into grey bars, card contents fade under a moving line, aria-busy set.
  const LOADING_MS = 150;
  function showLoading(ids) {
    const els = ids.map($).filter(Boolean);
    const timer = setTimeout(() => {
      for (const e of els) { e.classList.add("loading"); e.setAttribute("aria-busy", "true"); }
    }, LOADING_MS);
    return () => {
      clearTimeout(timer);
      for (const e of els) { e.classList.remove("loading"); e.removeAttribute("aria-busy"); }
    };
  }
  function txSkeleton() {
    return Array.from({ length: 5 }, () => {
      const li = el("li", "sk");
      li.setAttribute("aria-hidden", "true");
      li.append(el("span", "b w60"), el("span", "b w20"), el("span", "b w30 s"), el("span", "b w25 s"));
      return li;
    });
  }

  async function loadSummary() {
    const done = showLoading(["secOverview", "secChart", "secCats", "secNotes"]);
    try {
      await loadSummaryData();
    } finally {
      done();
    }
  }
  async function loadSummaryData() {
    const data = await api("me-summary?" + q({ wallet_id: state.wallet.wallet_id, month: state.month, type: state.type, category: state.category ? state.category.key : "", note: state.note ? state.note.key : "", range: state.catRange === "12" ? "12" : "" }));
    state.summary = data;
    renderTiles();
    renderChart();
    renderChartStats();
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
    renderTileCompare("tIncomeCmp", m.income, "income");
    renderTileCompare("tExpenseCmp", m.expense, "expense");
    $("tAll").textContent = money(state.summary.totals.balance, true);
    $("noteMonth").textContent = monthLabel(state.month);
  }

  // "▲ ใช้มากขึ้น 18%" / "เทียบ 1–19 ต.ค. −4,400": the whole wallet vs the
  // month before (cut to the same days while the month is not over).
  function renderTileCompare(id, now, kind) {
    const box = $(id);
    const cmp = state.summary.compare;
    const prev = cmp ? Number(cmp[kind === "income" ? "prev_income" : "prev_expense"]) : NaN;
    if (!cmp || !Number.isFinite(prev) || (!prev && !Number(now))) {
      box.hidden = true;
      return;
    }
    const pm = addMonths(state.month, -1);
    const range = cmp.prev_days ? `1–${Math.min(cmp.prev_days, daysIn(pm))} ` : "";
    const a = Math.abs(Number(now) || 0), b = Math.abs(prev);
    const verb = kind === "income" ? "ได้" : "ใช้";
    if (!b) {
      box.replaceChildren(`${monthLabel(pm, false)} ${range ? `(${range.trim()}) ` : ""}ไม่มี${kind === "income" ? "รายรับ" : "รายจ่าย"}`);
      box.hidden = false;
      return;
    }
    let head;
    {
      const pct = Math.round(((a - b) / b) * 100);
      head = !a ? `ยังไม่มี${kind === "income" ? "รายรับ" : "รายจ่าย"}` : pct === 0 ? "เท่าเดือนก่อน" : pct >= 1000 ? `▲ ${verb}มากขึ้น ${Math.round(a / b)} เท่า` : pct > 0 ? `▲ ${verb}มากขึ้น ${pct}%` : `▼ ${verb}น้อยลง ${-pct}%`;
    }
    box.replaceChildren(el("b", "", head), el("br"), `เทียบ ${range}${monthLabel(pm, false)} ${money(prev)}`);
    box.hidden = false;
  }
  function daysIn(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  // Chart + month table follow the category picked in "แยกตามหมวด"
  // (tiles stay the wallet's totals).
  function seriesMonths() {
    return state.summary.filter_months || state.summary.category_months || state.summary.months;
  }
  function seriesRow(ym) {
    return seriesMonths().find((m) => m.month === ym) || { month: ym, income: 0, expense: 0, balance: 0, count: 0 };
  }
  // With an expense/income category or note and "ทั้งหมด", show that kind instead of the balance
  function chartType() {
    if (state.type !== "all") return state.type;
    if (state.note) return state.note.kind;
    return state.category ? state.category.kind : "all";
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

  // Under the chart, with a category or note picked: total / monthly average
  // over the chart's 12 months, and the highest / lowest month. Months before
  // the wallet's first record are left out; months with nothing count as 0.
  function renderChartStats() {
    const box = $("chartStats");
    if (!state.category && !state.note) {
      box.hidden = true;
      return;
    }
    const first = state.summary.months.length ? state.summary.months[0].month : null;
    const T = TYPES[chartType()];
    const now = currentMonth(state.wallet.timezone);
    const rows = chartWindow().filter((r) => first && r.month >= first && r.month <= [now, state.month].sort().pop());
    if (!rows.length) {
      box.hidden = true;
      return;
    }
    const vals = rows.map((r) => Number(r[T.field]) || 0);
    const total = vals.reduce((a, v) => a + v, 0);
    const size = (v) => Math.abs(v);
    let hi = 0, lo = 0;
    vals.forEach((v, i) => {
      if (size(v) > size(vals[hi])) hi = i;
      if (size(v) < size(vals[lo])) lo = i;
    });
    const span = rows.length === 1 ? monthLabel(rows[0].month) : `${rows.length} เดือน (${monthLabel(rows[0].month)} – ${monthLabel(rows[rows.length - 1].month)})`;
    const line1 = [`${span}: รวม `, el("b", "", money(total, true)), " · เฉลี่ย ", el("b", "", `${money(Math.round(total / rows.length), true)}/เดือน`)];
    box.replaceChildren(...line1);
    if (rows.length > 1) {
      box.append(el("br"), `สูงสุด ${monthLabel(rows[hi].month)} ${money(vals[hi], true)} · ต่ำสุด ${monthLabel(rows[lo].month)} ${money(vals[lo], true)}`);
    }
    box.hidden = false;
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
    const note = state.note ? ` · 📝 ${clipText(state.note.key, 24)}` : "";
    $("chartTitle").textContent = T.title + cat + note;
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
      const on = !!state.note && state.note.key === n.note;
      const li = el("li", on ? "on" : "");
      const b = el("button");
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      const name = el("span", "n", n.note || "-");
      const v = el("span", "v", money(n.total, true));
      const c = el("span", "c", ` ×${n.count}`);
      v.append(c);
      const track = el("div", "track");
      const fill = el("div", "fill " + (n.total >= 0 ? "pos" : "neg"));
      fill.style.width = Math.max((Math.abs(n.total) / max) * 100, 1.5) + "%";
      track.append(fill);
      b.append(name, v, track);
      const kind = n.total > 0 ? "income" : "expense";
      for (const line of compareLines({ ...n, kind }, true)) b.append(el("span", "d", line));
      b.addEventListener("click", () => setNoteFilter(on ? null : { key: n.note, kind }));
      li.append(b);
      return li;
    });
    if (notes.length > shown.length) items.push(el("li", "empty", `และอีก ${notes.length - shown.length} โน้ต`));
    list.replaceChildren(...items);
  }

  // ---------- categories
  function renderCategories() {
    const list = $("cats");
    const r12 = state.catRange === "12" ? state.summary.range12 : null;
    $("catMonth").textContent = r12 ? (r12.from === r12.to ? monthLabel(r12.to) : `${monthLabel(r12.from)} – ${monthLabel(r12.to)}`) : monthLabel(state.month);
    const note = $("catRangeNote");
    note.hidden = !r12;
    if (r12) {
      note.textContent = r12.months < 12
        ? `รวม ${r12.months} เดือน (กระเป๋านี้เริ่มมีรายการ ${monthLabel(r12.from)}) · เฉลี่ยหารด้วยทุกเดือน รวมเดือนที่ไม่มีรายการ`
        : "รวม 12 เดือน · เฉลี่ยหารด้วย 12 รวมเดือนที่ไม่มีรายการ";
    }
    const cats = r12 ? r12.by_category : state.summary.by_category || [];
    if (!cats.length) {
      list.replaceChildren(el("li", "empty", r12 ? "ไม่มีรายการใน 12 เดือนนี้" : TYPES[state.type].empty));
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
      if (r12) {
        v.firstChild.textContent = "รวม " + money(c.total, true);
        b.append(el("span", "d", `เฉลี่ย ${money(Math.round(c.avg_total), true)}/เดือน`));
      } else {
        for (const line of compareLines(c)) b.append(el("span", "d", line));
      }
      b.addEventListener("click", () => setCategoryFilter(state.category && state.category.key === c.key ? null : c));
      li.append(b);
      return li;
    }));
  }

  // ["เดือนก่อน (1–13) −4,400 · ▲ ใช้มากขึ้น 18%", "เฉลี่ย 3 เดือน −9,000"]
  // Compares sizes (abs), so an expense that grew reads "ใช้มากขึ้น" and
  // income that grew reads "ได้มากขึ้น". For the current month the month
  // before is cut to the same days so far (compare.prev_days).
  // quiet: say nothing when there is nothing to compare (one-off notes)
  function compareLines(c, quiet = false) {
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
    const lines = quiet && !before ? [] : [text];
    if (cmp.avg_months >= 2 && Number(c.avg_total)) {
      lines.push(`เฉลี่ย ${cmp.avg_months} เดือนก่อน ${money(c.avg_total, true)}/เดือน`);
    }
    return lines;
  }

  // Picking a category clears the note: the note list changes with it.
  function setCategoryFilter(c) {
    state.category = c ? { key: c.key, label: c.label, icon: c.icon, kind: c.kind } : null;
    state.note = null;
    showFilterChips();
    // Reload the summary too: the by-note list follows the category
    run(loadAll);
  }

  function setNoteFilter(n) {
    state.note = n;
    showFilterChips();
    run(loadAll);
  }

  function clipText(t, n) {
    const chars = [...String(t)];
    return chars.length > n ? chars.slice(0, n - 1).join("") + "…" : chars.join("");
  }

  // One ✕ chip per active filter. The by-note card shows only the category
  // chip (its list is narrowed by category; the picked note is highlighted).
  function showFilterChips() {
    const chip = (text, label, onClick) => {
      const b = el("button", "chip", text + "  ✕");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.addEventListener("click", onClick);
      return b;
    };
    const catChip = () => state.category && chip(`${state.category.icon} ${state.category.label}`, "ล้างตัวกรองหมวด", () => setCategoryFilter(null));
    const noteChip = () => state.note && chip(`📝 ${clipText(state.note.key, 24)} · ทุกเดือน`, "ล้างตัวกรองโน้ต", () => setNoteFilter(null));
    for (const [row, chips] of [["chartChipRow", [catChip(), noteChip()]], ["catChipRow", [catChip(), noteChip()]], ["noteChipRow", [catChip()]]]) {
      const list = chips.filter(Boolean);
      $(row).replaceChildren(...list);
      $(row).hidden = !list.length;
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
    await flushDelete(); // "โหลดเพิ่ม" too: the offset counts the row as gone
    const seq = ++state.txSeq;
    if (reset) {
      state.offset = 0;
      state.tx = [];
    }
    // A picked note or a search lists every month
    const allMonths = listAllMonths();
    $("txMonth").textContent = allMonths ? "ทุกเดือน" : monthLabel(state.month);
    if (!$("exportCsv").disabled) $("exportCsv").textContent = exportLabel();
    // new list: grey rows in its place; "โหลดเพิ่ม": the button says so
    const list = $("txList"), more = $("more");
    const skel = reset && setTimeout(() => {
      if (seq !== state.txSeq) return;
      $("txSummary").hidden = true;
      list.replaceChildren(...txSkeleton());
      list.setAttribute("aria-busy", "true");
    }, LOADING_MS);
    if (!reset) { more.disabled = true; more.textContent = "กำลังโหลด…"; }
    let data;
    try {
      data = await loadTxPage(allMonths);
    } finally {
      clearTimeout(skel);
      if (seq === state.txSeq) {
        list.removeAttribute("aria-busy");
        more.disabled = false;
        more.textContent = "โหลดเพิ่ม";
      }
    }
    if (seq !== state.txSeq) return; // a newer search replaced this one
    if (reset) {
      state.txMonths = allMonths ? data.by_month || [] : null;
      state.txDays = allMonths ? null : data.by_day || null;
    }
    state.tx = state.tx.concat(data.transactions);
    state.offset += data.transactions.length;
    state.hasMore = data.has_more;
    renderTx();
  }
  function loadTxPage(allMonths) {
    return api("me-transactions?" + q({
      wallet_id: state.wallet.wallet_id,
      month: allMonths ? "" : state.month,
      q: state.q.trim(),
      sort: state.txSort,
      type: state.type,
      category: state.category ? state.category.key : "",
      note: state.note ? state.note.key : "",
      limit: PAGE,
      offset: state.offset,
    }));
  }

  // "86 รายการ ใน 14 เดือน · รวม −4,300 · เฉลี่ย −307/เดือน" for an all-months list
  function renderTxSummary() {
    const box = $("txSummary");
    const months = state.txMonths;
    if (!months || !months.length) {
      box.hidden = true;
      return;
    }
    const count = months.reduce((a, m) => a + m.count, 0);
    const total = months.reduce((a, m) => a + Number(m.total), 0);
    box.replaceChildren(
      el("b", "", `${numFmt.format(count)} รายการ`), ` ใน ${months.length} เดือน · รวม `,
      el("b", "", money(total, true)),
      months.length > 1 ? ` · เฉลี่ย ${money(Math.round(total / months.length), true)}/เดือน (เฉพาะเดือนที่มี)` : ""
    );
    box.hidden = false;
  }

  function renderTx() {
    const list = $("txList");
    renderTxSummary();
    if (!state.tx.length) {
      list.replaceChildren(el("li", "empty", state.q || state.note ? "ไม่พบรายการ" : TYPES[state.type].empty));
    } else {
      // month headers only when the list is in date order
      const byDate = state.txSort === "new" || state.txSort === "old";
      const byMonth = state.txMonths && byDate ? new Map(state.txMonths.map((m) => [m.month, m])) : null;
      // one month in date order: a header per day with that day's total
      const byDay = !byMonth && byDate && state.txDays ? new Map(state.txDays.map((d) => [d.day, d])) : null;
      let lastMonth = null, lastDay = null;
      list.replaceChildren(...state.tx.flatMap((t) => {
        const out = [];
        const ym = t.datetime.slice(0, 7);
        const day = t.datetime.slice(0, 10);
        if (byDay && day !== lastDay) {
          lastDay = day;
          const d = byDay.get(day);
          const h = el("li", "dh");
          h.append(el("span", "", dayLabel(day)), el("span", "", d ? `${money(d.total, true)} · ${d.count} รายการ` : ""));
          out.push(h);
        }
        if (byMonth && ym !== lastMonth) {
          lastMonth = ym;
          const m = byMonth.get(ym);
          const h = el("li", "mh");
          h.append(el("span", "", monthLabel(ym)), el("span", "", m ? `${money(m.total, true)} · ${m.count} รายการ` : ""));
          out.push(h);
        }
        const li = el("li");
        out.push(li);
        const b = el("button");
        b.type = "button";
        b.append(
          el("span", "note", t.note || "-"),
          el("span", "amt", money(t.exvalue, true)),
          el("span", "when", byDay ? t.datetime.slice(11, 16) : whenLabel(t.datetime)),
          el("span", "kind", t.category ? `${t.category.icon} ${t.category.label}` : (t.exvalue >= 0 ? "รายรับ" : "รายจ่าย"))
        );
        b.addEventListener("click", () => openEditor(t));
        li.append(b);
        return out;
      }));
    }
    $("more").hidden = !state.hasMore;
  }

  // ---------- note picker (notes from every month)
  const picker = $("notePicker");
  const pickerType = () => (picker.querySelector("input[name=npType]:checked") || {}).value || "all";
  async function openNotePicker() {
    const t = picker.querySelector(`input[name=npType][value="${state.type}"]`);
    if (t) t.checked = true;
    $("npFilter").value = "";
    if (picker.showModal) picker.showModal(); else picker.setAttribute("open", "");
    if (!state.allNotes) {
      $("npList").replaceChildren(el("li", "empty", "กำลังโหลด…"));
      const wallet = state.wallet.wallet_id;
      try {
        const data = await api("me-notes?" + q({ wallet_id: wallet }));
        if (wallet !== state.wallet.wallet_id) return;
        state.allNotes = data.notes;
      } catch (e) {
        if (!(e instanceof AuthError)) $("npList").replaceChildren(el("li", "empty", "โหลดไม่สำเร็จ ลองใหม่อีกครั้ง"));
        return;
      }
    }
    renderNotePicker();
  }
  function closeNotePicker() {
    if (picker.close) picker.close(); else picker.removeAttribute("open");
  }
  function renderNotePicker() {
    if (!state.allNotes) return;
    const type = pickerType();
    const text = $("npFilter").value.trim().toLowerCase();
    const shown = state.allNotes.filter((n) => {
      const kind = n.total > 0 ? "income" : "expense";
      return (type === "all" || kind === type) && (!text || n.note.includes(text));
    });
    const list = $("npList");
    if (!shown.length) {
      list.replaceChildren(el("li", "empty", text ? "ไม่พบโน้ตที่มีคำนี้" : "ยังไม่มีโน้ต"));
      return;
    }
    // A few hundred rows at most per render; keep the DOM small
    const LIMIT = 300;
    const items = shown.slice(0, LIMIT).map((n) => {
      const on = !!state.note && state.note.key === n.note;
      const li = el("li", on ? "on" : "");
      const b = el("button");
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.append(
        el("span", "n", n.note),
        el("span", "v", money(n.total, true)),
        el("span", "d", `${numFmt.format(n.count)} ครั้ง`),
        el("span", "d r", `ล่าสุด ${whenLabel(n.last + " 00:00").split(" · ")[0]}`)
      );
      b.addEventListener("click", () => pickNote(n));
      li.append(b);
      return li;
    });
    if (shown.length > LIMIT) items.push(el("li", "empty", `และอีก ${shown.length - LIMIT} โน้ต — พิมพ์กรองเพื่อหา`));
    list.replaceChildren(...items);
  }
  // The picker lists every note, whatever the category: picking one clears
  // the category, and a type filter of the other kind.
  function pickNote(n) {
    const kind = n.total > 0 ? "income" : "expense";
    closeNotePicker();
    if (state.type !== "all" && state.type !== kind) {
      setType("all");
      store.set("type", "all");
    }
    state.category = null;
    setNoteFilter({ key: n.note, kind });
    $("txList").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ---------- editor
  const dlg = $("editor");
  // "2026-11-19", "14:05" now in the wallet's time zone
  function nowLocal(timeZone) {
    const parts = (opts) => {
      try { return new Intl.DateTimeFormat("en-CA", { timeZone, ...opts }).formatToParts(new Date()); } catch { return new Intl.DateTimeFormat("en-CA", opts).formatToParts(new Date()); }
    };
    const get = (ps, t) => (ps.find((p) => p.type === t) || {}).value;
    const d = parts({ year: "numeric", month: "2-digit", day: "2-digit" });
    const t = parts({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return { date: `${get(d, "year")}-${get(d, "month")}-${get(d, "day")}`, time: `${get(t, "hour")}:${get(t, "minute")}` };
  }

  // New record: same form as editing. Date = now; when another month is
  // open, the 1st of that month.
  function openAdd() {
    state.editing = { isNew: true };
    $("editTitle").textContent = "เพิ่มรายการ";
    $("btnDelete").hidden = true;
    dlg.querySelector('input[name=sign][value="-"]').checked = true;
    const now = nowLocal(state.wallet.timezone);
    const sameMonth = now.date.slice(0, 7) === state.month;
    $("fAmount").value = "";
    $("fDate").value = sameMonth ? now.date : `${state.month}-01`;
    $("fTime").value = sameMonth ? now.time : "12:00";
    $("fNote").value = "";
    fillCategorySelect("expense", "");
    setFormError("");
    setBusy(false);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    $("fAmount").focus();
  }

  function openEditor(t) {
    state.editing = t;
    $("editTitle").textContent = "แก้ไขรายการ";
    $("btnDelete").hidden = false;
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
    const items = options.map((c) => {
      const o = el("option", "", `${c.icon} ${c.label}`);
      o.value = c.key;
      return o;
    });
    // adding: let the system pick (as the bot does) unless the user chooses
    const isNew = !!(state.editing && state.editing.isNew);
    if (isNew) {
      const auto = el("option", "", "✨ ให้ระบบเดาให้");
      auto.value = "";
      items.unshift(auto);
    }
    sel.replaceChildren(...items);
    sel.value = options.some((c) => c.key === selected) ? selected : isNew ? "" : (kind === "income" ? "other_income" : "other_expense");
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
    if (t.isNew) return addRecord(sign, amount, time);
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
      state.allNotes = null;
      closeEditor();
      await loadAll();
      if ($("memoryCard").open) await loadMemory();
    } catch (e) {
      if (!(e instanceof AuthError)) setFormError(e.message);
      setBusy(false);
    }
  }

  async function addRecord(sign, amount, time) {
    const body = {
      wallet_id: state.wallet.wallet_id,
      exvalue: sign + amount,
      targetdate: `${$("fDate").value} ${time}`,
      detail: $("fNote").value,
    };
    if ($("fCategory").value) body.category = $("fCategory").value;
    setBusy(true);
    try {
      const r = await api("me-transactions", { method: "POST", body });
      state.allNotes = null;
      closeEditor();
      const c = r.category;
      // one toast (two would stack on the same spot)
      const b = r.budget;
      const warn = !b ? "" : b.level === "over"
        ? ` · ⚠️ ${b.label} เกินงบแล้ว (${b.pct}%)`
        : ` · ⚠️ ${b.label} ใช้ไป ${b.pct}% ของงบ`;
      showToast(`บันทึกแล้ว ${r.note} ${money(r.exvalue, true)} → ${c.icon} ${c.label}${c.ai_pending ? " (AI กำลังช่วยเดาหมวด)" : ""}${warn}`);
      // show the month the record went into
      const ym = body.targetdate.slice(0, 7);
      if (ym !== state.month) {
        state.month = ym;
        $("monthInput").value = ym;
      }
      await loadAll();
      if ($("memoryCard").open) await loadMemory();
    } catch (e) {
      if (!(e instanceof AuthError)) setFormError(e.message);
      setBusy(false);
    }
  }

  // Delete with undo: the row leaves the list at once and the delete is sent
  // after UNDO_MS, unless "เลิกทำ" is tapped. Anything that reloads the list,
  // another delete, or leaving the page sends it right away.
  const UNDO_MS = 5000;
  function remove() {
    const t = state.editing;
    if (!t) return;
    closeEditor();
    flushDelete(); // only one pending at a time
    const at = state.tx.findIndex((x) => x.id === t.id);
    if (at < 0) { // not on screen (should not happen): delete now
      run(async () => { await api("me-transactions?" + q({ id: t.id }), { method: "DELETE" }); state.allNotes = null; await loadAll(); });
      return;
    }
    state.tx.splice(at, 1);
    state.offset = Math.max(0, state.offset - 1);
    adjustHeaders(t, -1);
    renderTx();
    const p = { t, at, timer: setTimeout(() => commitDelete(p), UNDO_MS), toast: null };
    state.pendingDelete = p;
    p.toast = showUndoToast(`ลบ "${clipText(t.note || "-", 24)}" ${money(t.exvalue, true)} แล้ว`, () => undoDelete(p));
  }
  // day / month header totals follow the rows on screen until the reload
  function adjustHeaders(t, sign) {
    const fix = (list, key) => {
      const h = list && list.find((x) => (x.day || x.month) === key);
      if (h) { h.count += sign; h.total = Math.round((Number(h.total) + sign * Number(t.exvalue)) * 100) / 100; }
    };
    fix(state.txDays, t.datetime.slice(0, 10));
    fix(state.txMonths, t.datetime.slice(0, 7));
  }
  function undoDelete(p) {
    if (state.pendingDelete !== p) return;
    clearTimeout(p.timer);
    state.pendingDelete = null;
    p.toast.remove();
    state.tx.splice(Math.min(p.at, state.tx.length), 0, p.t);
    state.offset += 1;
    adjustHeaders(p.t, 1);
    renderTx();
    showToast("คืนรายการแล้ว");
  }
  async function commitDelete(p) {
    if (state.pendingDelete !== p) return;
    clearTimeout(p.timer);
    state.pendingDelete = null;
    p.toast.remove();
    try {
      await api("me-transactions?" + q({ id: p.t.id }), { method: "DELETE" });
      state.allNotes = null;
    } catch (e) {
      if (e instanceof AuthError) return;
      if (e.status !== 404) showToast("ลบไม่สำเร็จ: " + e.message);
    }
    await run(async () => {
      await loadAll();
      if ($("memoryCard").open) await loadMemory();
    });
  }
  // send a pending delete now; the reload that follows is the caller's
  function flushDelete() {
    const p = state.pendingDelete;
    if (!p) return null;
    clearTimeout(p.timer);
    state.pendingDelete = null;
    p.toast.remove();
    state.allNotes = null;
    return api("me-transactions?" + q({ id: p.t.id }), { method: "DELETE" }).catch((e) => {
      if (!(e instanceof AuthError) && e.status !== 404) showToast("ลบไม่สำเร็จ: " + e.message);
    });
  }
  // closing LIFF / switching app: the request must outlive the page
  function flushOnLeave() {
    const p = state.pendingDelete;
    if (!p) return;
    clearTimeout(p.timer);
    state.pendingDelete = null;
    p.toast.remove();
    state.reloadOnReturn = true; // tiles/charts still count it
    try {
      fetch("/api/me-transactions?" + q({ id: p.t.id }), { method: "DELETE", headers: { Authorization: "Bearer " + state.token }, keepalive: true });
    } catch { /* page is going away */ }
  }
  function showUndoToast(msg, onUndo) {
    const t = el("div", "toast undo");
    t.setAttribute("role", "status");
    const b = el("button", "", "เลิกทำ");
    b.type = "button";
    b.addEventListener("click", onUndo);
    t.append(el("span", "", msg), b);
    document.body.append(t);
    return t;
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
  // ‹ › and "เดือนนี้" around the month picker
  function updateMonthNav() {
    const now = currentMonth(state.wallet.timezone);
    $("thisMonth").hidden = state.month === now;
    $("nextMonth").disabled = state.month >= now;
  }

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
        state.note = null;
      }
      if (state.note && state.type !== "all" && state.note.kind !== state.type) state.note = null;
      showFilterChips();
      hideTip();
      run(loadAll);
    });
  }

  $("bCategory").addEventListener("change", () => pickBudget(null, false));
  $("budgetForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("bAmount").value.replace(/[,\s]/g, "");
    const amount = Number(raw);
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(amount > 0) || amount >= 10000000) {
      showToast("ใส่งบเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
      return;
    }
    saveBudget(amount);
  });
  $("bRemove").addEventListener("click", () => saveBudget(null));
  $("budgetToggle").addEventListener("click", () => {
    setBudgetEdit(!state.budgetOpen);
    if (state.budgetOpen) $("bCategory").focus();
  });

  $("walletSelect").addEventListener("change", (e) => {
    state.wallet = state.wallets.find((w) => String(w.wallet_id) === e.target.value) || state.wallet;
    store.set("wallet_id", String(state.wallet.wallet_id));
    state.note = null; // notes belong to a wallet
    state.allNotes = null;
    showFilterChips();
    run(loadAll);
  });
  $("prevMonth").addEventListener("click", () => selectMonth(addMonths(state.month, -1)));
  $("nextMonth").addEventListener("click", () => selectMonth(addMonths(state.month, 1)));
  $("thisMonth").addEventListener("click", () => selectMonth(currentMonth(state.wallet.timezone)));
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
  $("memoryCard").addEventListener("toggle", () => { if ($("memoryCard").open) run(loadMemory); });
  $("more").addEventListener("click", () => run(() => loadTx(false)));
  $("exportCsv").addEventListener("click", exportCsv);
  $("pickNote").addEventListener("click", () => run(openNotePicker));
  $("addTx").addEventListener("click", openAdd);
  $("fab").addEventListener("click", openAdd);
  // the floating ＋ shows only while the card's own add button is off screen
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { $("fab").hidden = e.isIntersecting; }).observe($("addTx"));
  } else {
    $("fab").hidden = false;
  }

  // shortcuts bar: jump to a card; mark the card being read
  const jump = $("jump");
  const jumpBtns = [...jump.querySelectorAll("button[data-target]")];
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const b of jumpBtns) {
    b.addEventListener("click", () => {
      const t = $(b.dataset.target);
      if (t) t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  }
  let jumpRaf = 0;
  function markJump() {
    jumpRaf = 0;
    const line = jump.getBoundingClientRect().bottom + 16;
    let on = jumpBtns[0];
    for (const b of jumpBtns) {
      const t = $(b.dataset.target);
      if (t && t.getBoundingClientRect().top <= line) on = b;
    }
    // at the very bottom the last card counts even when it is short
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) on = jumpBtns[jumpBtns.length - 1];
    for (const b of jumpBtns) {
      b.classList.toggle("on", b === on);
      if (b === on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    }
    jump.classList.toggle("stuck", window.scrollY > 0 && jump.getBoundingClientRect().top <= 0);
    // keep the marked button visible when the bar scrolls sideways
    if (jump.scrollWidth > jump.clientWidth) {
      const l = on.offsetLeft - 16, r = on.offsetLeft + on.offsetWidth + 16 - jump.clientWidth;
      if (jump.scrollLeft > l) jump.scrollLeft = l; else if (jump.scrollLeft < r) jump.scrollLeft = r;
    }
  }
  window.addEventListener("scroll", () => { if (!jumpRaf) jumpRaf = requestAnimationFrame(markJump); }, { passive: true });
  markJump();
  for (const r of document.querySelectorAll("input[name=txSort]")) {
    r.addEventListener("change", (e) => {
      if (!e.target.checked || !TX_SORTS.has(e.target.value)) return;
      state.txSort = e.target.value;
      store.set("txSort", state.txSort);
      run(() => loadTx(true));
    });
  }
  for (const r of document.querySelectorAll("input[name=catRange]")) {
    r.addEventListener("change", (e) => {
      if (!e.target.checked) return;
      state.catRange = e.target.value === "12" ? "12" : "month";
      store.set("catRange", state.catRange);
      run(loadSummary);
    });
  }
  $("npClose").addEventListener("click", closeNotePicker);
  $("npFilter").addEventListener("input", renderNotePicker);
  for (const r of picker.querySelectorAll("input[name=npType]")) r.addEventListener("change", renderNotePicker);
  // tap outside the sheet closes it
  picker.addEventListener("click", (e) => {
    if (e.target !== picker) return;
    const r = picker.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeNotePicker();
  });
  $("editForm").addEventListener("submit", save);
  $("btnCancel").addEventListener("click", closeEditor);
  $("btnDelete").addEventListener("click", remove);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnLeave();
    else if (state.reloadOnReturn) {
      state.reloadOnReturn = false;
      state.allNotes = null;
      run(loadAll);
    }
  });
  window.addEventListener("pagehide", flushOnLeave);
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.summary) renderChart(); }, 150);
  });

  run(start);
})();
