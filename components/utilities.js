function checkDateInput(indate) {
  // Check if input is valid (non-empty and non-null)
  if (!indate) {
    return -1;
  }

  // Split the input date by '-'
  const splited = indate.split("-");
  // Determine expected format based on number of parts
  let date_pattern;
  if (splited.length === 3) {
    // YYYY-MM-DD
    date_pattern = /^\d{4}-\d{2}-\d{2}$/;
  } else if (splited.length === 2) {
    // YYYY-MM
    date_pattern = /^\d{4}-\d{2}$/;
  } else if (splited.length === 1) {
    // YYYY
    date_pattern = /^\d{4}$/;
  } else {
    // Invalid number of parts
    return -1;
  }

  // Match input against pattern
  if (date_pattern.test(indate)) {
    return splited.length; // Return the number of valid components
  } else {
    return -1; // Invalid format
  }
}

// Parse a transaction amount such as "-120", "+1,500.50" or 30000.
// Commas are only accepted as proper thousands separators ("1,000", not "1,0").
// Returns the number, or null if the input is not a valid non-zero amount that
// fits EXPENSE.EXVALUE NUMBER(9,2).
function parseAmount(input) {
  if (typeof input === "number") {
    input = String(input);
  }
  if (typeof input !== "string") {
    return null;
  }
  const s = input.trim();
  const pattern = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/;
  if (!pattern.test(s)) {
    return null;
  }
  const value = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) >= 1e7) {
    return null;
  }
  return value;
}

// True when a required field was not provided. Unlike `!value`, the number 0
// counts as provided — wallet ids are 0-based, so wallet_id 0 is valid.
function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

// A real calendar date-time in 'YYYY-MM-DD HH:MM:SS' (rejects 2026-02-30, 24:00:00...)
function isValidDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(typeof s === "string" ? s : "");
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d &&
    h < 24 && mi < 60 && se < 60
  );
}

// A non-empty string that fits a VARCHAR2(n BYTE) column (Thai is 3 bytes/char).
function isTextWithin(value, maxBytes) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Buffer.byteLength(value, "utf8") <= maxBytes
  );
}

// Optional ?type= filter of the web app: "income" (exvalue > 0), "expense"
// (exvalue < 0) or all. Returns the SQL condition, or null if the value is invalid.
function typeCondition(type) {
  if (type === undefined || type === "" || type === "all") return "";
  if (type === "income") return " AND exvalue > 0";
  if (type === "expense") return " AND exvalue < 0";
  return null;
}

function getMRange(indate) {
  const splited = indate.split("-");
  const nyear = parseInt(splited[0]);
  const nmonth = parseInt(splited[1]);

  const firstDayOfMonth = new Date(nyear, nmonth - 1, 1);
  const lastDayOfMonth = new Date(nyear, nmonth, 0);
  const mrange = [firstDayOfMonth.getDate(), lastDayOfMonth.getDate()];

  return mrange;
}

const WEB_APP_URL = "https://liff.line.me/2012532003-r80iatKj";

// Help text for the bot. lang "th" = Thai, anything else = English.
// Keep in sync with the commands handled by line-bot-fb (functions/index.js).
function helpCommand(lang) {
  const th = lang === "th";
  const commands = th
    ? [
        { name: "บันทึกรายจ่าย / รายรับ", command: "{+,-}จำนวน โน้ต [#หมวด] [-d YYYY-MM-DD] [-h HH:mm]",
          description: "ใช้ - สำหรับรายจ่าย และ + สำหรับรายรับ ตามด้วยโน้ตสั้นๆ ระบบเลือกหมวดให้อัตโนมัติ ถ้าอยากระบุเองให้ใส่ #หมวด (เช่น #อาหาร #เดินทาง) ใส่วันที่ (-d) หรือเวลา (-h) ได้ เช่น -120 ข้าวเที่ยง, -60 กาแฟ #เครื่องดื่ม, +1,500 เงินเดือน -d 2026-11-01" },
        { name: "การ์ดหลังบันทึก", command: "(กดปุ่มบนการ์ด)",
          description: "หลังบันทึกจะได้การ์ดสรุป มีปุ่ม 🏷️ เปลี่ยนหมวด (ระบบจะจำไว้ใช้กับโน้ตเดียวกันครั้งต่อไป), ✏️ แก้ไข (เปิดหน้าเว็บ) และ 🗑️ ลบ (มีให้ยืนยันก่อน)" },
        { name: "ยอดคงเหลือทั้งหมด", command: "sumall",
          description: "ยอดรวม (รายรับ + รายจ่าย) ของกระเป๋าปัจจุบันตั้งแต่รายการแรก" },
        { name: "ยอดรายเดือน", command: "sumbymonth",
          description: "ยอดรวม (รายรับ + รายจ่าย) แยกตามเดือน" },
        { name: "เฉลี่ยต่อวัน", command: "avgbymonth",
          description: "ยอดเฉลี่ยต่อวันของแต่ละเดือน" },
        { name: "แยกตามโน้ต", command: "sumbynote [-m [YYYY-MM]]",
          description: "ยอดรวมแยกตามโน้ตทั้งหมด ใส่ -m เพื่อดูเดือนนี้ หรือ -m YYYY-MM เพื่อดูเดือนที่ต้องการ" },
        { name: "ดูกระเป๋าเงิน", command: "wallet",
          description: "แสดงกระเป๋าทั้งหมด * คือกระเป๋าที่ใช้อยู่" },
        { name: "สลับกระเป๋า", command: "wallet [id]",
          description: "เปลี่ยนกระเป๋าที่ใช้อยู่ เช่น wallet 1" },
        { name: "สร้างกระเป๋า", command: "create [ชื่อ] [timezone]",
          description: "สร้างกระเป๋าใหม่และใช้เป็นกระเป๋าปัจจุบัน เช่น create main Asia/Bangkok" },
        { name: "สุ่มร้านอาหาร", command: "(แชร์ตำแหน่ง หรือกด 📍)",
          description: "แชร์ตำแหน่งเพื่อสุ่มร้านอาหารที่เปิดอยู่ในระยะ 1 กม." },
        { name: "หน้าเว็บ", command: WEB_APP_URL,
          description: "ดูกราฟ แยกตามหมวด/โน้ต ค้นหา แก้ไข ลบรายการ และจัดการหมวดที่ระบบจำไว้ (กดปุ่ม 🌐 เปิดเว็บ ก็ได้)" },
      ]
    : [
        { name: "Add Transaction", command: "{+,-}amount note [#category] [-d YYYY-MM-DD] [-h HH:mm]",
          description: "Record an expense (use '-') or income (use '+') with a short note. Optionally set the date (-d) and/or time (-h). The category is picked automatically; add #category to choose it (e.g. #food #อาหาร). e.g. -120 lunch, -60 coffee #drink, +1,500 salary -d 2026-11-01" },
        { name: "Record Card", command: "(tap the card buttons)",
          description: "After saving, the bot replies with a card: 🏷️ change category (remembered for the same note next time), ✏️ edit (opens the web app), 🗑️ delete (asks to confirm)." },
        { name: "Total Balance", command: "sumall",
          description: "Overall balance (income + expenses) of the current wallet since its first transaction." },
        { name: "Monthly Total Balance", command: "sumbymonth",
          description: "Balance (income + expenses) for each month." },
        { name: "Average Daily Balance", command: "avgbymonth",
          description: "Average daily balance (income + expenses) for each month." },
        { name: "Group by Note", command: "sumbynote [-m [YYYY-MM]]",
          description: "Totals grouped by note, all-time. Add -m for this month, or -m YYYY-MM for a specific month." },
        { name: "List Wallets", command: "wallet",
          description: "List your wallets. * marks the current one." },
        { name: "Switch Wallet", command: "wallet [id]",
          description: "Switch the current wallet, e.g. wallet 1" },
        { name: "Create Wallet", command: "create [wallet_name] [timezone]",
          description: "Create a new wallet and make it current, e.g. create main Asia/Bangkok" },
        { name: "Random Restaurant", command: "(share your location or tap 📍)",
          description: "Share a location to get a random open restaurant within 1 km." },
        { name: "Web App", command: WEB_APP_URL,
          description: "Charts, totals by category and note, search, edit and delete records, and manage remembered categories (or tap 🌐)." },
      ];
  return { lang: th ? "th" : "en", commands };
}

module.exports = {
  typeCondition,
  isValidDateTime,
  isTextWithin,
  isMissing,
  parseAmount,
  getMRange,
  checkDateInput,
  helpCommand,
};
