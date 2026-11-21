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
          ["rename ชื่อใหม่", "เปลี่ยนชื่อกระเป๋าที่ใช้อยู่", "rename เงินเก็บ"],
          ["delete wallet", "ย้ายกระเป๋าที่ใช้อยู่ไปถังขยะ กู้คืนได้ภายใน 30 วัน"],
          ["restore wallet", "ดูถังขยะและกู้คืนกระเป๋า"],
        ],
        buttons: [{ label: "ดูกระเป๋า", text: "wallet" }] },
      { title: "📅 สรุปรายเดือน และแจ้งเตือน",
        lines: [
          "วันที่ 1 ตอน 9 โมงเช้า (เวลาไทย) ส่งสรุปเดือนที่แล้ว (เปิดอยู่แล้ว)",
          "สรุปรายสัปดาห์: ทุกวันจันทร์ 9 โมงเช้า (ต้องเปิดก่อน)",
          "เตือนจด: 3 ทุ่ม (เวลาไทย) ถ้าวันนี้ยังไม่ได้จดเลย (ต้องเปิดก่อน)",
        ],
        note: "ปิดได้ด้วย ปิดสรุปรายเดือน / ปิดสรุปรายสัปดาห์ / ปิดเตือนจด (เปิดกลับ: เปิดสรุปรายเดือน)",
        buttons: [
          { label: "🗓️ เปิดสรุปสัปดาห์", text: "เปิดสรุปรายสัปดาห์" },
          { label: "📝 เปิดเตือนจด", text: "เปิดเตือนจด" },
          { label: "🔕 ปิดสรุปรายเดือน", text: "ปิดสรุปรายเดือน" },
        ] },
      { title: "💰 งบต่อหมวด",
        lines: [
          "ตั้งงบรายเดือนให้แต่ละหมวดได้ในหน้าเว็บ ที่การ์ด \"งบรายเดือน\"",
          "บันทึกรายจ่ายแล้วใช้ถึง 80% บอทจะเตือน ⚠️ และเตือน 🚨 เมื่อเกินงบ",
          "สรุปวันที่ 1 จะบอกด้วยว่าแต่ละหมวดใช้ไปเท่าไรจากงบ",
        ],
        note: "งบแยกตามกระเป๋า และใช้ทุกเดือนจนกว่าจะแก้หรือลบ",
        buttons: [{ label: "💰 ตั้งงบในหน้าเว็บ", uri: WEB_APP_URL }] },
      { title: "🔁 รายการประจำ",
        lines: [
          "ตั้งรายการที่จ่ายหรือได้ทุกเดือน เช่น ค่าเช่า ค่าเน็ต เงินเดือน ในหน้าเว็บ ที่การ์ด \"รายการประจำ\"",
          "ระบบบันทึกให้เองตอน 7 โมงเช้า (เวลาไทย) ของวันที่ตั้งไว้ และส่งข้อความบอก พร้อมปุ่มยกเลิก",
        ],
        rows: [["ประจำ", "ดูรายการประจำของกระเป๋าที่ใช้อยู่"]],
        note: "เลือกให้บันทึกเงียบ ๆ ไม่ต้องแจ้งก็ได้ หยุดชั่วคราวหรือลบได้ในหน้าเว็บ",
        buttons: [
          { label: "🔁 ดูรายการประจำ", text: "ประจำ" },
          { label: "🌐 ตั้งในหน้าเว็บ", uri: WEB_APP_URL },
        ] },
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
          ["rename new name", "Rename the current wallet", "rename savings"],
          ["delete wallet", "Move the current wallet to the trash (restorable for 30 days)"],
          ["restore wallet", "See the trash and restore a wallet"],
        ],
        buttons: [{ label: "My wallets", text: "wallet" }] },
      { title: "📅 Summaries & reminder",
        lines: [
          "1st of the month, 9:00 (Thai time): last month's summary (on by default)",
          "Weekly summary: Mondays 9:00 (turn it on first)",
          "Reminder: 21:00 (Thai time) if nothing was recorded today (turn it on first)",
        ],
        note: "Turn off: summary off / weekly off / remind off (back on: summary on)",
        buttons: [
          { label: "🗓️ Weekly on", text: "weekly on" },
          { label: "📝 Reminder on", text: "remind on" },
          { label: "🔕 Monthly off", text: "summary off" },
        ] },
      { title: "💰 Budgets",
        lines: [
          "Set a monthly budget per category in the web app (\"งบรายเดือน\" card)",
          "The bot warns ⚠️ when an expense takes it to 80%, and 🚨 when over",
          "The summary on the 1st shows how much of each budget was used",
        ],
        note: "Budgets are per wallet and apply every month until changed",
        buttons: [{ label: "💰 Set budgets", uri: WEB_APP_URL }] },
      { title: "🔁 Recurring",
        lines: [
          "Set records that repeat every month (rent, internet, salary) in the web app (\"รายการประจำ\" card)",
          "They are recorded at 7:00 (Thai time) on their day, and the bot tells you, with an undo button",
        ],
        rows: [["recurring", "List the current wallet's recurring items"]],
        note: "Each item can be silent instead; pause or delete it in the web app",
        buttons: [
          { label: "🔁 My recurring", text: "recurring" },
          { label: "🌐 Set in web app", uri: WEB_APP_URL },
        ] },
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

module.exports = { helpContent, HELP, WEB_APP_URL };
