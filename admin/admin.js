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

  $("refresh").addEventListener("click", load);
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => data && renderChart(), 150); });
  start().catch((e) => showStatus("เกิดข้อผิดพลาด: " + e.message, true));
})();
