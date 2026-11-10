// Transaction categories and the logic that picks one for a new record.
//
// Order of decision (first match wins):
//   1. explicit  — the note contains #<category>, e.g. "-120 lunch #อาหาร"
//   2. memory    — the user picked a category for this same note before
//                  (table CATEGORY_MEMORY, per user, written whenever the user
//                  sets or changes a category)
//   3. keyword   — the note contains a known word, e.g. กาแฟ → drink
//   4. fallback  — other_expense / other_income
// A category must match the sign of the amount (expense < 0, income > 0);
// a remembered or explicit category of the wrong kind is ignored.

const { executeQuery } = require("./db");

// key: stored in EXPENSE.CATEGORY (VARCHAR2(30)); keys never change.
// aliases: words accepted after # (lower-case, besides key and label).
// keywords: matched as substrings of the lower-cased note.
const CATEGORIES = [
  // ---- expense
  { key: "food", kind: "expense", label: "อาหาร", icon: "🍚", aliases: ["food", "กิน", "ข้าว"],
    keywords: ["ข้าว", "อาหาร", "กับข้าว", "ก๋วยเตี๋ยว", "ก๋วยจั๊บ", "หมูกระทะ", "ชาบู", "สุกี้", "ส้มตำ", "ไก่", "หมู", "ผัด", "แกง", "ต้ม", "ขนม", "เบเกอรี่", "พิซซ่า", "เบอร์เกอร์", "บุฟเฟ่", "มื้อ", "อาหารเช้า", "อาหารกลางวัน", "อาหารเย็น", "ข้าวเช้า", "ข้าวเที่ยง", "ข้าวเย็น", "ปิ้งย่าง", "ซูชิ", "ราเมง",
      "lunch", "dinner", "breakfast", "brunch", "food", "meal", "snack", "rice", "noodle", "pizza", "burger", "kfc", "mcdonald", "sushi", "ramen", "bbq", "buffet", "lineman", "foodpanda", "grabfood", "robinhood", "mk"] },
  { key: "drink", kind: "expense", label: "เครื่องดื่ม/กาแฟ", icon: "☕", aliases: ["drink", "กาแฟ", "เครื่องดื่ม", "coffee"],
    keywords: ["กาแฟ", "ชา", "ชานม", "ชาไข่มุก", "น้ำ", "นม", "โกโก้", "เบียร์", "เหล้า", "ไวน์", "สมูทตี้", "น้ำปั่น",
      "coffee", "cafe", "café", "latte", "americano", "espresso", "cappuccino", "mocha", "tea", "milk", "boba", "drink", "beer", "wine", "starbucks", "amazon", "cafe amazon", "chabuton", "smoothie", "juice"] },
  { key: "transport", kind: "expense", label: "เดินทาง", icon: "🚗", aliases: ["transport", "travel", "เดินทาง", "รถ"],
    keywords: ["รถ", "แท็กซี่", "วิน", "มอไซค์", "รถไฟ", "รถเมล์", "เรือ", "ทางด่วน", "น้ำมัน", "เติมน้ำมัน", "ที่จอดรถ", "จอดรถ", "ค่าทาง", "ตั๋ว", "เครื่องบิน", "บีทีเอส", "เอ็มอาร์ที",
      "grab", "bolt", "taxi", "uber", "bts", "mrt", "arl", "bus", "train", "ferry", "toll", "gas", "fuel", "petrol", "parking", "flight", "airasia", "ticket", "muvmi"] },
  { key: "shopping", kind: "expense", label: "ช้อปปิ้ง", icon: "🛍️", aliases: ["shopping", "shop", "ช้อป", "ช้อปปิ้ง"],
    keywords: ["เสื้อ", "กางเกง", "รองเท้า", "กระเป๋า", "ช้อป", "ของขวัญ", "เครื่องสำอาง", "หูฟัง", "มือถือ", "โทรศัพท์",
      "shopee", "lazada", "amazon.com", "uniqlo", "h&m", "zara", "shirt", "shoes", "bag", "gift", "clothes", "shopping", "ikea", "central", "robinson"] },
  { key: "housing", kind: "expense", label: "ที่พัก/ค่าน้ำไฟ", icon: "🏠", aliases: ["housing", "bills", "ที่พัก", "บ้าน", "ค่าห้อง"],
    keywords: ["ค่าห้อง", "ค่าเช่า", "เช่าห้อง", "ค่าบ้าน", "ผ่อนบ้าน", "คอนโด", "ค่าน้ำ", "ค่าไฟ", "ค่าเน็ต", "อินเทอร์เน็ต", "เน็ตบ้าน", "ค่าโทรศัพท์", "ค่าส่วนกลาง", "ค่าโทร",
      "rent", "electric", "electricity", "water bill", "internet", "wifi", "ais", "true", "dtac", "3bb", "condo", "mortgage", "utility", "utilities"] },
  { key: "health", kind: "expense", label: "สุขภาพ", icon: "💊", aliases: ["health", "สุขภาพ", "หมอ"],
    keywords: ["ยา", "หมอ", "โรงพยาบาล", "คลินิก", "ทำฟัน", "หมอฟัน", "ตรวจสุขภาพ", "ฟิตเนส", "ยิม", "นวด", "ประกันสุขภาพ", "วิตามิน",
      "hospital", "clinic", "doctor", "dentist", "medicine", "pharmacy", "gym", "fitness", "massage", "vitamin", "boots", "watsons"] },
  { key: "entertainment", kind: "expense", label: "บันเทิง", icon: "🎬", aliases: ["entertainment", "fun", "บันเทิง"],
    keywords: ["หนัง", "ดูหนัง", "คอนเสิร์ต", "เกม", "เที่ยว", "ปาร์ตี้", "คาราโอเกะ", "สมาชิก",
      "movie", "cinema", "netflix", "spotify", "youtube", "disney", "game", "steam", "concert", "party", "karaoke", "major", "sf cinema", "trip", "hotel", "agoda", "booking"] },
  { key: "education", kind: "expense", label: "การศึกษา", icon: "📚", aliases: ["education", "study", "การศึกษา", "เรียน"],
    keywords: ["หนังสือ", "เรียน", "คอร์ส", "ค่าเทอม", "ติว", "สอบ", "เครื่องเขียน",
      "book", "course", "tuition", "class", "udemy", "coursera", "exam", "stationery"] },
  { key: "household", kind: "expense", label: "ของใช้ในบ้าน", icon: "🧴", aliases: ["household", "ของใช้"],
    keywords: ["ของใช้", "สบู่", "แชมพู", "ยาสีฟัน", "ผงซักฟอก", "ทิชชู่", "กระดาษชำระ", "ซักผ้า", "ร้านสะดวกซื้อ", "ซุปเปอร์", "ตลาด",
      "7-11", "7-eleven", "seven", "711", "lotus", "big c", "bigc", "tops", "makro", "family mart", "familymart", "lawson", "villa", "gourmet", "supermarket", "laundry", "tissue", "detergent", "shampoo", "soap"] },
  { key: "other_expense", kind: "expense", label: "รายจ่ายอื่นๆ", icon: "📦", aliases: ["other", "อื่นๆ", "อื่น"], keywords: [] },

  // ---- income
  { key: "salary", kind: "income", label: "เงินเดือน", icon: "💼", aliases: ["salary", "เงินเดือน"],
    keywords: ["เงินเดือน", "ค่าจ้าง", "โบนัส", "salary", "payroll", "bonus", "wage"] },
  { key: "side_income", kind: "income", label: "รายได้เสริม", icon: "💡", aliases: ["side", "freelance", "รายได้เสริม"],
    keywords: ["ฟรีแลนซ์", "งานเสริม", "ขายของ", "ค่าคอม", "ปันผล", "ดอกเบี้ย", "เงินคืน", "คืนเงิน", "ขาย",
      "freelance", "commission", "dividend", "interest", "refund", "cashback", "sale", "sold", "side"] },
  { key: "other_income", kind: "income", label: "รายรับอื่นๆ", icon: "💰", aliases: ["other", "อื่นๆ", "อื่น"], keywords: [] },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));
const kindOf = (amount) => (amount > 0 ? "income" : "expense");
const fallbackFor = (amount) => (amount > 0 ? "other_income" : "other_expense");

// Note as remembered in CATEGORY_MEMORY: lower-case, single spaces, no #tags.
function noteKey(note) {
  return String(note || "")
    .replace(/#\S+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function isValidFor(key, amount) {
  const c = BY_KEY.get(key);
  return !!c && c.kind === kindOf(amount);
}

// "#อาหาร" / "#food" / "#Food" → category key of the right kind, or null.
function resolveTag(tag, amount) {
  const t = String(tag || "").replace(/^#/, "").toLowerCase().trim();
  if (!t) return null;
  const kind = kindOf(amount);
  for (const c of CATEGORIES) {
    if (c.kind !== kind) continue;
    if (c.key === t || c.label.toLowerCase() === t || c.aliases.includes(t)) return c.key;
  }
  return null;
}

// Split "lunch #อาหาร" into { note: "lunch", tagCategory: "food" }. Unknown
// tags stay in the note untouched.
function extractTag(note, amount) {
  let tagCategory = null;
  const cleaned = String(note || "").replace(/(^|\s)#(\S+)/g, (m, sp, tag) => {
    const key = resolveTag(tag, amount);
    if (key && !tagCategory) {
      tagCategory = key;
      return sp;
    }
    return m;
  });
  return { note: cleaned.replace(/\s+/g, " ").trim(), tagCategory };
}

// Thai has no spaces between words, so Thai keywords match anywhere in the
// note; Latin keywords must be whole words ("tea" must not match "steak").
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = CATEGORIES.map((c) => ({
  key: c.key,
  kind: c.kind,
  words: c.keywords.map((k) => {
    const w = k.trim();
    const latin = /^[\x20-\x7e]+$/.test(w);
    return { len: w.length, test: latin ? ((re) => (t) => re.test(t))(new RegExp(`(^|[^a-z0-9])${escapeRe(w)}($|[^a-z0-9])`)) : (t) => t.includes(w) };
  }),
}));

// Longest keyword wins, so "ค่าน้ำ" (housing) beats "น้ำ" (drink) and
// "น้ำมัน" (transport) beats "น้ำ".
function byKeyword(note, amount) {
  const text = noteKey(note);
  const kind = kindOf(amount);
  let best = null;
  for (const m of MATCHERS) {
    if (m.kind !== kind) continue;
    for (const w of m.words) {
      if ((!best || w.len > best.len) && w.test(text)) best = { key: m.key, len: w.len };
    }
  }
  return best ? best.key : null;
}

async function fromMemory(connection, uname, note, amount) {
  const key = noteKey(note);
  if (!key) return null;
  const r = await executeQuery(
    connection,
    "SELECT category FROM category_memory WHERE uname = :uname AND note_key = :note_key",
    { uname, note_key: key }
  );
  const cat = r.rows[0] && r.rows[0][0];
  return cat && isValidFor(cat, amount) ? cat : null;
}

// Decide the category of a record. Returns { category, source, note } where
// note is the text to store (with a recognised #tag removed).
async function categorize(connection, uname, rawNote, amount) {
  const { note, tagCategory } = extractTag(rawNote, amount);
  if (tagCategory) {
    await remember(connection, uname, note, tagCategory);
    return { category: tagCategory, source: "explicit", note };
  }
  const remembered = await fromMemory(connection, uname, note, amount);
  if (remembered) return { category: remembered, source: "memory", note };
  const keyword = byKeyword(note, amount);
  if (keyword) return { category: keyword, source: "keyword", note };
  return { category: fallbackFor(amount), source: "fallback", note };
}

// Remember the user's choice for this note. "Other" is not remembered, so it
// never overrides a keyword match later.
async function remember(connection, uname, note, category) {
  const key = noteKey(note);
  if (!key || category === "other_expense" || category === "other_income") return;
  await executeQuery(
    connection,
    `MERGE INTO category_memory m
     USING (SELECT :uname AS uname, :note_key AS note_key FROM dual) s
        ON (m.uname = s.uname AND m.note_key = s.note_key)
      WHEN MATCHED THEN UPDATE SET m.category = :category, m.updated_at = SYSDATE
      WHEN NOT MATCHED THEN INSERT (uname, note_key, category, updated_at)
           VALUES (s.uname, s.note_key, :category, SYSDATE)`,
    { uname, note_key: key, category }
  );
}

// What the API returns for a category key (null-safe for old records).
function describe(key, amount) {
  const c = BY_KEY.get(key) || BY_KEY.get(fallbackFor(amount));
  return { key: c.key, label: c.label, icon: c.icon, kind: c.kind, assigned: !!key };
}

// Public list for the web app (no keywords).
function publicList() {
  return CATEGORIES.map(({ key, kind, label, icon }) => ({ key, kind, label, icon }));
}

module.exports = {
  CATEGORIES,
  categorize,
  remember,
  describe,
  publicList,
  isValidFor,
  noteKey,
  byKeyword,
  extractTag,
  fallbackFor,
};
