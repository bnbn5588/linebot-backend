// Expense Bot admin site. Signs in with LINE (LIFF), calls /api/admin-overview.
// All values are rendered with textContent.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const cfg = window.ADMIN_CONFIG || {};
  const num = new Intl.NumberFormat("th-TH");
  let apiBase = cfg.apiBase;
  let token = null;
  let data = null;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };
  const svg = (tag, attrs) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  };
  function bytes(n) {
    if (n === null || n === undefined) return "–";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + " " + u[i];
  }
  function ago(iso) {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "เมื่อสักครู่";
    if (s < 3600) return Math.floor(s / 60) + " นาทีที่แล้ว";
    if (s < 86400) return Math.floor(s / 3600) + " ชม.ที่แล้ว";
    return Math.floor(s / 86400) + " วันที่แล้ว";
  }
  function dur(sec) {
    if (sec < 60) return sec + " วินาที";
    if (sec < 3600) return Math.floor(sec / 60) + " นาที";
    return (sec / 3600).toFixed(1) + " ชม.";
  }
  const shortId = (id) => (id.length > 12 ? id.slice(0, 6) + "…" + id.slice(-4) : id);

  function showStatus(nodes, retry) {
    const s = $("status");
    s.replaceChildren(...(Array.isArray(nodes) ? nodes : [el("div", "", nodes)]));
    if (retry) {
      const b = el("button", "btn", "ลองใหม่");
      b.addEventListener("click", () => location.reload());
      s.append(b);
    }
    s.hidden = false;
    $("view").hidden = true;
  }

  async function start() {
    const p = new URLSearchParams(location.search);
    if (p.get("mocktoken") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      token = p.get("mocktoken"); // local testing only
      apiBase = p.get("api") || apiBase;
      $("who").textContent = "โหมดทดสอบ";
    } else {
      if (!cfg.liffId) return showStatus("ยังไม่ได้ตั้งค่า LIFF ID (admin/config.js)");
      if (!window.liff) return showStatus("โหลด LINE SDK ไม่สำเร็จ", true);
      await liff.init({ liffId: cfg.liffId });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }
      token = liff.getIDToken();
      if (!token) return showStatus("LIFF app ต้องเปิด scope openid");
      liff.getProfile().then((pr) => { $("who").textContent = pr.displayName; }).catch(() => {});
    }
    await load();
  }

  async function load() {
    $("refresh").disabled = true;
    try {
      const r = await fetch(apiBase + "/admin-overview", { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
      let j = null;
      try { j = await r.json(); } catch { /* ignore */ }
      if (r.status === 401) {
        if (!window.liff || !liff.login || sessionStorage.getItem("reauth")) return showStatus("เข้าสู่ระบบด้วย LINE ไม่สำเร็จ", true);
        sessionStorage.setItem("reauth", "1");
        if (window.liff && liff.isLoggedIn()) liff.logout();
        return liff.login({ redirectUri: location.href });
      }
      if (r.status === 403 && j && j.code === "NOT_ADMIN") {
        const code = el("code", "", j.user_id);
        return showStatus([el("p", "", "บัญชี LINE นี้ยังไม่ใช่ admin"), el("p", "muted", "LINE userId ของคุณ:"), code]);
      }
      if (!r.ok) throw new Error((j && j.message) || "HTTP " + r.status);
      try { sessionStorage.removeItem("reauth"); } catch { /* ignore */ }
      data = j.data;
      render();
      $("status").hidden = true;
      $("view").hidden = false;
      renderChart();
      loadMap();
      fillGuessUsers();
    } catch (e) {
      showStatus("โหลดข้อมูลไม่สำเร็จ: " + e.message, true);
    } finally {
      $("refresh").disabled = false;
    }
  }

  function render() {
    const c = data.counts;
    $("updated").textContent = "อัปเดต " + new Date(data.generated_at).toLocaleString("th-TH");
    $("kUsers").textContent = num.format(c.users);
    $("kWallets").textContent = `${num.format(c.wallets)} กระเป๋า`;
    $("kActive7").textContent = num.format(c.active_users_7d);
    $("kActive30").textContent = `30 วัน: ${num.format(c.active_users_30d)} คน`;
    $("kRecords").textContent = num.format(c.records);
    $("kRecords30").textContent = `7 วัน: ${num.format(c.records_7d)} · 30 วัน: ${num.format(c.records_30d)}`;

    // DB
    const db = data.db;
    const q = db.quotas[0];
    $("kDb").textContent = bytes(db.total_bytes);
    $("kDbQuota").textContent = q ? (q.max_bytes > 0 ? `quota ${bytes(q.max_bytes)} (${q.tablespace})` : `quota ไม่จำกัด (${q.tablespace})`) : "";
    $("dbVersion").textContent = "Oracle " + db.version;
    const meter = $("dbMeter");
    if (q && q.max_bytes > 0) {
      const pct = Math.min((q.bytes / q.max_bytes) * 100, 100);
      const bar = el("div", "bar");
      const fill = el("div", "fill");
      fill.style.width = Math.max(pct, 0.5) + "%";
      bar.append(fill);
      const cap = el("div", "cap");
      cap.append(el("span", "", `ใช้ ${bytes(q.bytes)} (${pct.toFixed(1)}%)`), el("span", "", `จาก ${bytes(q.max_bytes)}`));
      meter.replaceChildren(bar, cap);
    } else {
      meter.replaceChildren(el("div", "muted", `ใช้ ${bytes(q ? q.bytes : db.total_bytes)} — schema ไม่มี quota กำหนด (ขีดจำกัดคือพื้นที่รวมของ Autonomous DB)`));
    }
    $("segTable").replaceChildren(...db.segments.map((s) => {
      const tr = el("tr");
      const label = s.type === "INDEX" ? `${s.table} (index)` : s.name;
      tr.append(el("td", "", label), el("td", "", s.type), el("td", "", bytes(s.bytes)));
      return tr;
    }));
    $("tableTable").replaceChildren(...db.tables.map((t) => {
      const tr = el("tr");
      tr.append(el("td", "", t.table), el("td", "", t.num_rows === null ? "–" : num.format(t.num_rows)), el("td", "", t.last_analyzed || "–"));
      return tr;
    }));

    // runtime
    const rt = data.runtime;
    const kv = (dl, rows) => dl.replaceChildren(...rows.flatMap(([k, v]) => {
      const dd = el("dd");
      if (v instanceof Node) dd.append(v); else dd.textContent = v;
      return [el("dt", "", k), dd];
    }));
    const dbBadge = el("span", "badge " + (db.ping_ms < 50 ? "good" : db.ping_ms < 200 ? "warn" : "bad"), `${db.ping_ms} ms`);
    kv($("runtime"), [
      ["DB query (SELECT 1)", dbBadge],
      ["DB connect", `${db.connect_ms} ms`],
      ["Vercel region", rt.region],
      ["Environment", rt.env],
      ["Node.js", rt.node],
      ["Instance อายุ", `${dur(rt.instance_uptime_s)} · ${rt.instance_requests} คำขอ`],
      ["Memory", `${rt.memory_mb} MB`],
      ["เวลา DB", db.db_time],
    ]);

    // LINE
    const line = data.line;
    if (!line.configured) {
      kv($("line"), [["สถานะ", "ยังไม่ได้ตั้ง LB_KEY ใน Vercel"]]);
    } else {
      if (line.bot) {
        $("botName").textContent = line.bot.name + " — Admin";
        if (line.bot.picture) { $("botPic").src = line.bot.picture; $("botPic").hidden = false; }
      }
      const quota = !line.quota ? "–" : line.quota.type === "none" ? "ไม่จำกัด" : num.format(line.quota.value);
      const f = line.followers;
      const rows = [
        ["Basic ID", line.bot ? line.bot.basic_id : "–"],
        ["ข้อความ push เดือนนี้", `${line.consumption === null ? "–" : num.format(line.consumption)} / ${quota}`],
        ["เพื่อน (เมื่อวาน)", f && f.status === "ready" ? num.format(f.followers) : f ? `ยังไม่พร้อม (${f.status})` : "–"],
        ["บล็อก", f && f.status === "ready" ? num.format(f.blocks) : "–"],
      ];
      if (line.errors && line.errors.length) rows.push(["ข้อผิดพลาด", line.errors.join(", ")]);
      kv($("line"), rows);
    }

    // users
    $("userTable").replaceChildren(...data.users.map((u) => {
      const tr = el("tr");
      const td = el("td");
      const box = el("div", "u");
      if (u.picture) { const img = el("img"); img.src = u.picture; img.alt = ""; box.append(img); }
      const txt = el("div");
      txt.append(el("div", "", u.name || shortId(u.user_id)));
      const idEl = el("div", "id", shortId(u.user_id));
      idEl.title = u.user_id;
      if (u.name) txt.append(idEl);
      box.append(txt);
      td.append(box);
      tr.append(td, el("td", "", num.format(u.wallets)), el("td", "", num.format(u.records)), el("td", "", num.format(u.records_30d)), el("td", "", u.first_date || "–"), el("td", "", u.last_date || "–"));
      return tr;
    }));

    $("monthTable").replaceChildren(...[...data.monthly].reverse().map((m) => {
      const tr = el("tr");
      tr.append(el("td", "", m.month), el("td", "", num.format(m.records)), el("td", "", num.format(m.users)));
      return tr;
    }));
  }

  // 60-day bar chart: one series (records/day), so no legend; hover for details
  function renderChart() {
    const box = $("chart");
    const byDate = new Map(data.daily.map((d) => [d.date, d]));
    const days = [];
    const end = new Date(data.generated_at);
    for (let i = 59; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 864e5).toISOString().slice(0, 10);
      days.push(byDate.get(d) || { date: d, records: 0, users: 0 });
    }
    const W = Math.max(box.clientWidth || 600, 280);
    const H = 180;
    const pad = { l: 34, r: 4, t: 10, b: 22 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const max = Math.max(1, ...days.map((d) => d.records));
    const step = niceStep(max / 3);
    const top = Math.ceil(max / step) * step;
    const y = (v) => pad.t + ih - (v / top) * ih;
    const band = iw / days.length;
    const bw = Math.max(band - 2, 1); // 2px gap between bars
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "จำนวนรายการต่อวัน 60 วันล่าสุด" });
    for (let v = step; v <= top; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      s.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, class: "grid-l" }));
      const t = svg("text", { x: pad.l - 6, y: yy + 4, "text-anchor": "end", class: "axis" });
      t.textContent = num.format(v);
      s.append(t);
    }
    const base = Math.round(y(0)) + 0.5;
    days.forEach((d, i) => {
      const x = pad.l + band * i + 1;
      if (d.records > 0) {
        const yv = y(d.records);
        const h = base - yv;
        const r = Math.min(4, h, bw / 2);
        s.append(svg("path", { class: "bar", d: `M${x},${base} V${yv + r} Q${x},${yv} ${x + r},${yv} H${x + bw - r} Q${x + bw},${yv} ${x + bw},${yv + r} V${base} Z` }));
      }
      if (i % 14 === 59 % 14) {
        const t = svg("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", class: "axis" });
        const [, m, dd] = d.date.split("-");
        t.textContent = `${Number(dd)}/${Number(m)}`;
        s.append(t);
      }
      const hit = svg("rect", { x: pad.l + band * i, y: pad.t, width: band, height: ih, class: "hit" });
      hit.addEventListener("pointerenter", () => tip(d, (x + bw / 2) / W));
      hit.addEventListener("pointerleave", () => { $("tooltip").hidden = true; });
      s.append(hit);
    });
    s.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: base, y2: base, class: "base" }));
    box.replaceChildren(s);
  }
  function tip(d, frac) {
    const t = $("tooltip");
    const row = (k, v) => { const r = el("div", "r"); r.append(el("span", "", k), el("span", "", v)); return r; };
    t.replaceChildren(el("b", "", new Date(d.date + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })), row("รายการ", num.format(d.records)), row("ผู้ใช้", num.format(d.users)));
    t.hidden = false;
    const card = t.parentElement.getBoundingClientRect();
    const ch = $("chart").getBoundingClientRect();
    t.style.left = Math.min(Math.max(ch.left - card.left + frac * ch.width - t.offsetWidth / 2, 8), card.width - t.offsetWidth - 8) + "px";
    t.style.top = (ch.top - card.top - 8) + "px";
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = (raw || 1) / p;
    return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
  }

  // ---- shared note → category mapping (/api/admin-category-map)
  let map = { categories: [], items: [] };
  const KIND_TH = { expense: "รายจ่าย", income: "รายรับ" };
  const SOURCE_TH = { admin: "admin", history: "จากประวัติ", ai: "AI" };
  const PAGE_SIZE = 20;
  let mapPageNo = 1;
  const catLabel = (key) => { const c = map.categories.find((x) => x.key === key); return c ? `${c.icon} ${c.label}` : key; };
  function mapMsg(text, isErr) { const m = $("mapMsg"); m.textContent = text || ""; m.classList.toggle("err", !!isErr); }
  async function mapApi(method, query, body) {
    const r = await fetch(apiBase + "/admin-category-map" + (query ? "?" + new URLSearchParams(query) : ""), {
      method,
      headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let j = null;
    try { j = await r.json(); } catch { /* ignore */ }
    if (!r.ok) throw new Error((j && j.message) || "HTTP " + r.status);
    return j.data;
  }
  function categoryOptions(select, kind, selected) {
    const groups = kind ? [kind] : ["expense", "income"];
    select.replaceChildren(...groups.map((k) => {
      const g = el("optgroup");
      g.label = KIND_TH[k];
      for (const c of map.categories.filter((x) => x.kind === k)) {
        const o = el("option", "", `${c.icon} ${c.label}`);
        o.value = c.key;
        if (c.key === selected) o.selected = true;
        g.append(o);
      }
      return g;
    }));
  }
  async function loadMap() {
    try {
      map = await mapApi("GET");
      if (!$("mapCat").options.length) categoryOptions($("mapCat"));
      renderMap();
      renderRules();
    } catch (e) {
      mapMsg("โหลดตารางหมวดกลางไม่สำเร็จ: " + e.message, true);
    }
  }
  function renderMap() {
    const q = $("mapSearch").value.trim().toLowerCase();
    const src = $("mapSource").value;
    const all = map.items.filter((it) => (!q || it.note_key.includes(q)) && (!src || it.source === src));
    $("mapCount").textContent = `${num.format(map.items.length)} รายการ`;
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    mapPageNo = Math.min(Math.max(mapPageNo, 1), pages);
    const from = (mapPageNo - 1) * PAGE_SIZE;
    const items = all.slice(from, from + PAGE_SIZE);
    $("mapPager").hidden = all.length <= PAGE_SIZE;
    $("mapPage").textContent = `หน้า ${mapPageNo}/${pages} · ${num.format(from + 1)}–${num.format(from + items.length)} จาก ${num.format(all.length)}`;
    $("mapPrev").disabled = mapPageNo <= 1;
    $("mapNext").disabled = mapPageNo >= pages;
    if (!items.length) {
      const tr = el("tr", "empty");
      const td = el("td", "", map.items.length ? "ไม่พบที่ตรงกับตัวกรอง" : "ยังไม่มีรายการ — เพิ่มด้านบน");
      td.colSpan = 7;
      tr.append(td);
      return $("mapTable").replaceChildren(tr);
    }
    $("mapTable").replaceChildren(...items.map((it) => {
      const tr = el("tr");
      const sel = el("select");
      sel.setAttribute("aria-label", "หมวดของ " + it.note_key);
      categoryOptions(sel, it.kind, it.category);
      sel.addEventListener("change", async () => {
        sel.disabled = true;
        try {
          await mapApi("PUT", null, { note: it.note_key, category: sel.value });
          mapMsg(`บันทึก "${it.note_key}" → ${catLabel(sel.value)}`);
          await loadMap();
        } catch (e) {
          mapMsg("บันทึกไม่สำเร็จ: " + e.message, true);
          sel.value = it.category;
          sel.disabled = false;
        }
      });
      const tdSel = el("td"); tdSel.append(sel);
      const tdSrc = el("td");
      const badge = el("span", "src " + it.source, (SOURCE_TH[it.source] || it.source) + (it.source === "ai" && it.confidence != null ? ` ${Math.round(it.confidence * 100)}%` : ""));
      if (it.model) badge.title = it.model;
      tdSrc.append(badge);
      const del = el("button", "btn small", "ลบ");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm(`ลบ "${it.note_key}" (${KIND_TH[it.kind]}) ออกจากตารางหมวดกลาง?`)) return;
        del.disabled = true;
        try {
          await mapApi("DELETE", { note_key: it.note_key, kind: it.kind });
          mapMsg(`ลบ "${it.note_key}" แล้ว`);
          await loadMap();
        } catch (e) {
          mapMsg("ลบไม่สำเร็จ: " + e.message, true);
          del.disabled = false;
        }
      });
      const tdDel = el("td"); tdDel.append(del);
      tr.append(el("td", "", it.note_key), el("td", "", KIND_TH[it.kind]), tdSel, tdSrc, el("td", "", num.format(it.records)), el("td", "", it.updated_at), tdDel);
      return tr;
    }));
  }
  $("mapForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("mapNote").value.trim();
    const category = $("mapCat").value;
    if (!note || !category) return;
    $("mapSave").disabled = true;
    try {
      const d = await mapApi("PUT", null, { note, category });
      mapMsg(`บันทึก "${d.note_key}" → ${catLabel(d.category)}`);
      $("mapNote").value = "";
      await loadMap();
    } catch (e) {
      mapMsg("บันทึกไม่สำเร็จ: " + e.message, true);
    } finally {
      $("mapSave").disabled = false;
    }
  });
  $("mapSearch").addEventListener("input", () => { mapPageNo = 1; renderMap(); });
  $("mapSource").addEventListener("change", () => { mapPageNo = 1; renderMap(); });
  $("mapPrev").addEventListener("click", () => { mapPageNo--; renderMap(); });
  $("mapNext").addEventListener("click", () => { mapPageNo++; renderMap(); });

  // "ลองเดาหมวด": same steps as a real add, read-only (/api/admin-category-guess)
  const STEP_TH = { explicit: "#tag ในโน้ต", memory: "ความจำของผู้ใช้", shared: "ตารางหมวดกลาง", keyword: "คำในโน้ต", fallback: "ไม่เจอ → อื่นๆ" };
  const AI_ERR = { NO_KEY: "ยังไม่ได้ตั้ง GEMINI_API_KEY บน server", QUOTA: "เกินโควตา Gemini ลองใหม่ภายหลัง", NETWORK: "ติดต่อ Gemini ไม่ได้ (timeout)", EMPTY: "ไม่มีข้อความให้ถาม (เหลือแค่ #tag)" };
  const catText = (c) => `${c.icon} ${c.label}`;
  function guessMsg(text, isErr) { const m = $("guessMsg"); m.textContent = text || ""; m.classList.toggle("err", !!isErr); }
  function fillGuessUsers() {
    const sel = $("guessUser");
    const keep = sel.value;
    sel.replaceChildren(sel.options[0]);
    for (const u of (data && data.users) || []) {
      const o = el("option", "", "มุมมองของ: " + (u.name || shortId(u.user_id)));
      o.value = u.user_id;
      sel.append(o);
    }
    sel.value = keep;
    if (sel.value !== keep) sel.value = "";
  }
  function stepDetail(s, r) {
    if (s.step === "explicit") return s.category ? `ใส่ tag เป็น ${catText(s.category)}` : "ไม่มี #tag";
    if (s.step === "memory") {
      if (s.skipped) return "ไม่ได้เลือกผู้ใช้";
      return s.category ? `ผู้ใช้คนนี้เคยตั้ง "${r.note_key}" เป็น ${catText(s.category)}` : "ผู้ใช้คนนี้ไม่เคยตั้งหมวดของโน้ตนี้";
    }
    if (s.step === "shared") return s.category ? `"${r.note_key}" → ${catText(s.category)} (ที่มา: ${SOURCE_TH[s.source] || s.source})` : "ไม่มีโน้ตนี้ในตาราง (ต้องตรงทั้งข้อความ)";
    if (s.step === "keyword") return s.category ? `เจอคำว่า "${s.word}"${s.field === "places" ? " (ชื่อร้าน/สถานที่)" : ""} → ${catText(s.category)}` : "ไม่เจอคำที่รู้จัก";
    return catText(s.category);
  }
  let lastGuess = null;
  function aiItem(d) {
    const s = d.steps.find((x) => x.step === "ai");
    const li = el("li", "ai" + (s && s.category ? " hit" : ""));
    const what = el("span", "what");
    const shared = d.steps.find((x) => x.step === "shared");
    if (!s) {
      const b = el("button", "btn small", "ถาม AI");
      b.type = "button";
      b.addEventListener("click", () => runGuess(true, b));
      what.append(b, el("span", "note", "ส่งไปแค่ข้อความโน้ตกับประเภท (ไม่มีชื่อผู้ใช้/จำนวนเงิน)"));
    } else if (!s.category) {
      what.append(el("span", "err-text", AI_ERR[s.error] || s.message || "ถาม AI ไม่สำเร็จ"));
    } else {
      what.append(`แนะนำ ${catText(s.category)} · มั่นใจ ${Math.round(s.confidence * 100)}%`, el("span", "note", `${s.model} · ยังไม่ได้ใช้ตอนบันทึกจริง เป็นแค่คำแนะนำ`));
      if (shared && shared.category && shared.source !== "ai") {
        what.append(el("span", "note", `มีในตารางกลางแล้ว (ที่มา: ${SOURCE_TH[shared.source] || shared.source}) — AI ไม่ทับ`));
      } else {
        const b = el("button", "btn small primary", "บันทึกลงตารางกลาง");
        b.type = "button";
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            await mapApi("PUT", null, { note: d.note_key, category: s.category.key, ai: { confidence: s.confidence, model: s.model } });
            guessMsg(`บันทึก "${d.note_key}" → ${catText(s.category)} (ที่มา: AI) ลงตารางกลางแล้ว`);
            b.textContent = "บันทึกแล้ว";
            loadMap();
          } catch (e) {
            guessMsg("บันทึกไม่สำเร็จ: " + e.message, true);
            b.disabled = false;
          }
        });
        what.append(b);
      }
    }
    li.append(el("span", "mark", s && s.category ? "★" : "–"), el("span", "name", "5. AI (Gemini)"), what);
    return li;
  }
  async function runGuess(withAi, btn) {
    const q = Object.assign({}, lastGuess);
    if (withAi) q.ai = "1";
    if (btn) { btn.disabled = true; btn.textContent = "กำลังถาม…"; }
    $("guessGo").disabled = true;
    guessMsg("");
    try {
      const r = await fetch(apiBase + "/admin-category-guess?" + new URLSearchParams(q), { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
      let j = null;
      try { j = await r.json(); } catch { /* ignore */ }
      if (!r.ok) throw new Error((j && j.message) || "HTTP " + r.status);
      const d = j.data;
      const res = $("guessResult");
      res.replaceChildren("ผลลัพธ์: ", el("b", "", catText(d.category)), el("span", "muted", "  ← มาจาก: " + STEP_TH[d.source]));
      if (d.note !== q.note) res.append(el("span", "note muted", `โน้ตที่จะบันทึก: "${d.note}"`));
      const steps = d.steps.filter((s) => s.step !== "ai" && (s.step !== "fallback" || s.used));
      const items = steps.map((s, i) => {
        const li = el("li", (s.used ? "used " : "") + (s.category ? "hit" : ""));
        const what = el("span", "what", stepDetail(s, d));
        if (s.category && !s.used && s.step !== "fallback") what.append(el("span", "note", "ไม่ได้ใช้ เพราะขั้นก่อนหน้าเจอแล้ว"));
        li.append(el("span", "mark", s.used ? "✓" : s.category ? "·" : "–"), el("span", "name", `${i + 1}. ${STEP_TH[s.step]}`), what);
        return li;
      });
      const fb = items.length === 5 ? items.pop() : null; // fallback row goes after AI
      if (fb) fb.querySelector(".name").textContent = "6. " + STEP_TH.fallback;
      items.push(aiItem(d));
      if (fb) items.push(fb);
      $("guessSteps").replaceChildren(...items);
      $("guessOut").hidden = false;
    } catch (e) {
      guessMsg("เดาไม่สำเร็จ: " + e.message, true);
      if (btn) { btn.disabled = false; btn.textContent = "ถาม AI"; }
    } finally {
      $("guessGo").disabled = false;
    }
  }
  $("guessForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const note = $("guessNote").value.trim();
    if (!note) return;
    lastGuess = { note, kind: $("guessKind").value };
    if ($("guessUser").value) lastGuess.uname = $("guessUser").value;
    runGuess(false);
  });

  // "หมวดหมู่และคำที่ใช้เดา": read-only view of components/categories.js
  function chips(words, q, cls) {
    const box = el("div", "chips");
    for (const w of words) box.append(el("span", "chip" + (cls ? " " + cls : "") + (q && w.toLowerCase().includes(q) ? " hit" : ""), w));
    return box;
  }
  function renderRules() {
    const rules = map.rules || [];
    const q = $("rulesSearch").value.trim().toLowerCase();
    const shared = new Map();
    for (const it of map.items) shared.set(it.category, (shared.get(it.category) || 0) + 1);
    const words = rules.reduce((n, c) => n + c.keywords.length + c.places.length, 0);
    $("rulesCount").textContent = `${num.format(rules.length)} หมวด · ${num.format(words)} คำ`;
    const match = (c) => !q || [...c.tags, ...c.keywords, ...c.places].some((w) => w.toLowerCase().includes(q));
    const shown = rules.filter(match);
    if (!shown.length) return $("rulesList").replaceChildren(el("p", "muted", `ไม่มีหมวดไหนมีคำที่มี "${q}"`));
    $("rulesList").replaceChildren(...shown.map((c) => {
      const d = el("details", "rule");
      if (q) d.open = true;
      const s = el("summary");
      const meta = [KIND_TH[c.kind], `${num.format(c.keywords.length)} คำ`];
      if (c.places.length) meta.push(`ร้าน/สถานที่ ${num.format(c.places.length)}`);
      if (shared.get(c.key)) meta.push(`ตารางกลาง ${num.format(shared.get(c.key))} แถว`);
      s.append(el("span", "rule-name", `${c.icon} ${c.label}`), el("span", "muted", meta.join(" · ")));
      d.append(s);
      const body = el("div", "rule-body");
      body.append(el("div", "rule-h", "#tag ที่ใช้ได้"), chips(c.tags.map((t) => "#" + t), q, "tag"));
      if (c.keywords.length) body.append(el("div", "rule-h", "คำของที่ซื้อ/จ่าย"), chips(c.keywords, q));
      if (c.places.length) body.append(el("div", "rule-h", "ร้าน/สถานที่ (ใช้เมื่อไม่เจอคำด้านบน)"), chips(c.places, q, "place"));
      if (!c.keywords.length && !c.places.length) body.append(el("p", "muted", "ไม่มีคำ — ใช้เมื่อหาหมวดอื่นไม่เจอ"));
      d.append(body);
      return d;
    }));
  }
  $("rulesSearch").addEventListener("input", () => map && renderRules());

  $("refresh").addEventListener("click", load);
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => data && renderChart(), 150); });
  start().catch((e) => showStatus("เกิดข้อผิดพลาด: " + e.message, true));
})();
