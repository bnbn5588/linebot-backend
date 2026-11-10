// Help content for the LINE bot — the single place to edit it.
// The bot shows each card as one bubble of a carousel ("help" / "ช่วยเหลือ")
// and builds the plain-text version ("help text") from the same cards.
//
// Card fields (all optional except title):
//   rows:    [command, description, example?]  — shown as command + text
//   lines:   plain lines of text
//   note:    small grey text at the end
//   buttons: { label (max 20 chars), text } sends `text` as if the user typed it
//            { label, uri } opens a link (the first link button is highlighted)
// Keep commands in sync with what line-bot-fb handles (functions/index.js).

const WEB_APP_URL = "https://liff.line.me/2012532003-r80iatKj";

const HELP = {
  th: {
    title: "วิธีใช้งาน",
    eg: "เช่น",
    alt: "วิธีใช้งาน: บันทึก -120 ข้าว / +500 เงินเดือน, ดูยอดด้วย sumall / sumbymonth, กดปุ่มบนการ์ดเพื่อเปลี่ยนหมวด แก้ไข ลบ",
    cards: [
      { title: "✍️ บันทึกรายการ",
        rows: [
          ["-จำนวน โน้ต", "รายจ่าย", "-120 ข้าวเที่ยง"],
          ["+จำนวน โน้ต", "รายรับ", "+30000 เงินเดือน"],
          ["#หมวด", "เลือกหมวดเอง (ไม่ใส่ก็ได้)", "-60 กาแฟ #เครื่องดื่ม"],
          ["-d / -h", "ระบุวันที่ / เวลา", "-80 ข้าว -d 2026-11-01 -h 12:30"],
        ],
        note: "ใส่ลูกน้ำได้ เช่น -1,500 และทศนิยมได้ 2 ตำแหน่ง" },
      { title: "🏷️ หมวดและการ์ด",
        lines: [
          "ระบบเลือกหมวดให้อัตโนมัติจากโน้ต เช่น กาแฟ → ☕ เครื่องดื่ม",
          "หลังบันทึกจะได้การ์ดสรุป พร้อมปุ่ม:",
          "🏷️ เปลี่ยนหมวด — ระบบจะจำไว้ใช้กับโน้ตเดิมครั้งต่อไป",
          "✏️ แก้ไข — เปิดหน้าเว็บที่รายการนั้น",
          "🗑️ ลบ — มีให้ยืนยันก่อน",
        ] },
      { title: "📊 ดูยอด",
        note: "ดูเดือนอื่น: sumbynote -m 2026-10",
        buttons: [
          { label: "ยอดรวมทั้งหมด", text: "sumall" },
          { label: "ยอดรายเดือน", text: "sumbymonth" },
          { label: "เฉลี่ยต่อวัน", text: "avgbymonth" },
          { label: "แยกโน้ต เดือนนี้", text: "sumbynote -m" },
          { label: "แยกโน้ต ทั้งหมด", text: "sumbynote" },
        ] },
      { title: "👛 กระเป๋าเงิน",
        rows: [
          ["wallet", "ดูกระเป๋าทั้งหมด (* = ที่ใช้อยู่)"],
          ["wallet 1", "สลับไปกระเป๋าหมายเลข 1"],
          ["create ชื่อ timezone", "สร้างกระเป๋าใหม่", "create travel Asia/Tokyo"],
        ],
        buttons: [{ label: "ดูกระเป๋า", text: "wallet" }] },
      { title: "✨ อื่นๆ",
        lines: [
          "🌐 หน้าเว็บ: กราฟ แยกตามหมวด ค้นหา แก้ไขรายการ",
          "📍 สุ่มร้านอาหาร: แชร์ตำแหน่ง หรือกดปุ่ม 📍 ด้านล่างแชท",
          "พิมพ์ 'ช่วยเหลือ ข้อความ' เพื่อดูคำอธิบายแบบข้อความ",
        ],
        buttons: [
          { label: "🌐 เปิดหน้าเว็บ", uri: WEB_APP_URL },
          { label: "English help", text: "help" },
        ] },
    ],
  },
  en: {
    title: "How to use",
    eg: "e.g.",
    alt: "How to use: record -120 lunch / +500 salary, check balances with sumall / sumbymonth, use the card buttons to change category, edit or delete",
    cards: [
      { title: "✍️ Record",
        rows: [
          ["-amount note", "Expense", "-120 lunch"],
          ["+amount note", "Income", "+30000 salary"],
          ["#category", "Pick the category (optional)", "-60 coffee #drink"],
          ["-d / -h", "Date / time", "-80 lunch -d 2026-11-01 -h 12:30"],
        ],
        note: "Commas and 2 decimals are fine, e.g. -1,500.50" },
      { title: "🏷️ Categories & card",
        lines: [
          "The category is picked from the note, e.g. coffee → ☕ drink",
          "After saving you get a card with buttons:",
          "🏷️ Change category — remembered for the same note",
          "✏️ Edit — opens the web app on that record",
          "🗑️ Delete — asks to confirm",
        ] },
      { title: "📊 Balances",
        note: "Another month: sumbynote -m 2026-10",
        buttons: [
          { label: "Total balance", text: "sumall" },
          { label: "By month", text: "sumbymonth" },
          { label: "Daily average", text: "avgbymonth" },
          { label: "By note (this month)", text: "sumbynote -m" },
          { label: "By note (all time)", text: "sumbynote" },
        ] },
      { title: "👛 Wallets",
        rows: [
          ["wallet", "List wallets (* = current)"],
          ["wallet 1", "Switch to wallet 1"],
          ["create name timezone", "Create a wallet", "create travel Asia/Tokyo"],
        ],
        buttons: [{ label: "My wallets", text: "wallet" }] },
      { title: "✨ More",
        lines: [
          "🌐 Web app: charts, categories, search, edit records",
          "📍 Random restaurant: share your location or tap 📍 below",
          "Type 'help text' for the plain-text version",
        ],
        buttons: [
          { label: "🌐 Open web app", uri: WEB_APP_URL },
          { label: "ภาษาไทย", text: "ช่วยเหลือ" },
        ] },
    ],
  },
};

// The old flat list (name / description / command), derived from the cards,
// for bot versions that still read `commands`.
function legacyCommands(h) {
  const out = [];
  for (const c of h.cards) {
    for (const [cmd, desc, ex] of c.rows || []) {
      out.push({ name: desc, command: cmd, description: ex ? `${desc} (${h.eg} ${ex})` : desc });
    }
    for (const b of c.buttons || []) {
      if (b.text) out.push({ name: b.label, command: b.text, description: b.label });
    }
  }
  return out;
}

function helpContent(lang) {
  const h = lang === "th" ? HELP.th : HELP.en;
  return { lang: lang === "th" ? "th" : "en", ...h, commands: legacyCommands(h) };
}

module.exports = { helpContent, HELP };
