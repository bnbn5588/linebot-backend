// Transaction categories and the logic that picks one for a new record.
//
// Order of decision (first match wins):
//   1. explicit  — the note contains #<category>, e.g. "-120 lunch #อาหาร"
//   2. memory    — the user picked a category for this same note before
//                  (table CATEGORY_MEMORY, per user, written whenever the user
//                  sets or changes a category)
//   3. shared    — the same note is in the shared mapping for everyone
//                  (table CATEGORY_MAP, edited on the admin site; source
//                  'admin' or 'ai')
//   4. keyword   — the note contains a known word, e.g. กาแฟ → drink
//   5. fallback  — other_expense / other_income
// A category must match the sign of the amount (expense < 0, income > 0);
// a remembered or explicit category of the wrong kind is ignored.

const { executeQuery } = require("./db");

// key: stored in EXPENSE.CATEGORY (VARCHAR2(30)); keys never change.
// aliases: words accepted after # (lower-case, besides key and label).
// keywords: what was bought/paid for — checked first.
// places: shops and places (7-11, hi-life, night market...) — only used when
//   no keyword matches, so "snacks from hi-life" is food, not household.
// Thai/Chinese words match anywhere in the note; Latin words must be whole
// words. When several match, the one written first wins (ties: longest).
const CATEGORIES = [
  // ---- expense
  { key: "food", kind: "expense", label: "อาหาร", icon: "🍚", aliases: ["food", "กิน", "ข้าว"],
    keywords: ["ข้าว", "อาหาร", "กับข้าว", "ก๋วยเตี๋ยว", "ก๋วยจั๊บ", "หมูกระทะ", "ชาบู", "สุกี้", "ส้มตำ", "ไก่", "หมู", "ผัด", "แกง", "ต้ม", "ขนม", "เบเกอรี่", "พิซซ่า", "เบอร์เกอร์", "บุฟเฟ่", "มื้อ", "อาหารเช้า", "อาหารกลางวัน", "อาหารเย็น", "ข้าวเช้า", "ข้าวเที่ยง", "ข้าวเย็น", "ปิ้งย่าง", "ซูชิ", "ราเมง", "ไอศกรีม", "ไอติม", "ขนมปัง", "เค้ก", "โดนัท", "ของหวาน", "ไข่", "กะเพรา", "หมาล่า", "ชาบู", "早餐", "午餐", "晚餐", "便當", "小籠包", "麵", "飯",
      "lunch", "dinner", "breakfast", "beakfast", "brunch", "food", "foods", "meal", "snack", "snacks", "rice", "noodle", "noodles", "pizza", "burger", "kfc", "mcdonald", "sushi", "ramen", "bbq", "barbeq", "bar b q", "buffet", "lineman", "foodpanda", "grabfood", "robinhood", "mk",
      "bakery", "bekery", "bread", "breads", "bun", "buns", "toast", "sandwich", "cake", "cakes", "cookie", "cookies", "donut", "donuts", "waffle", "pancake", "pancakes", "tart", "egg tart", "pudding", "tiramisu", "dessert", "desserts", "ice cream", "icecream", "shaved ice", "snow ice", "chocolate", "candy", "cracker", "crackers", "doritos", "cheetos", "chetos", "pringles", "mentos", "nuggets", "dorayaki", "yogurt", "yogert", "egg", "eggs",
      "hotpot", "hot pot", "shabu", "steak", "pork", "pork chop", "beef", "chicken", "fried chicken", "cuttlefish", "seafood", "curry", "poke", "xiao long bao", "tang bao", "dumpling", "dumplings", "krapow", "kra pao", "pad thai", "mala", "bagel", "lays", "bao", "onigiri", "ricola", "corndog", "corn dog", "hotdog", "hot dog", "pasta", "pie", "doughnut", "doughnuts", "fried banana", "sweet potato", "taro", "taro ball", "donburi", "don buri", "twix", "twixs", "mcdonal", "mcdonalds", "luncj", "lunch box", "onikiri", "soup", "wonton", "side dish", "macaron", "jelly", "crepe", "crape", "breaks fast", "fried snacks", "afternoon break", "pre workout", "preworkout", "post workout", "postworkout"],
    places: ["night market", "canteen", "restaurant", "food court", "ตลาดนัด", "夜市"] },
  { key: "drink", kind: "expense", label: "เครื่องดื่ม/กาแฟ", icon: "☕", aliases: ["drink", "กาแฟ", "เครื่องดื่ม", "coffee"],
    keywords: ["กาแฟ", "ชา", "ชานม", "ชาไข่มุก", "ชาไทย", "น้ำ", "นม", "โกโก้", "เบียร์", "เหล้า", "ไวน์", "สมูทตี้", "น้ำปั่น", "โค้ก", "奶茶", "豆漿", "咖啡", "茶",
      "coffee", "cafe", "café", "latte", "americano", "espresso", "cappuccino", "mocha", "arabica", "tea", "milk tea", "cha thai", "matcha", "milk", "soymilk", "boba", "drink", "drinks", "beer", "wine", "alcohol", "starbucks", "starbuck", "amazon", "cafe amazon", "louisa", "smoothie", "smoothies", "juice", "frappe", "water", "coke", "coke zero", "pepsi", "sprite", "soda", "ovaltine", "sidra", "soy milk", "soy milks", "cocoa", "black tea", "oolong"] },
  { key: "transport", kind: "expense", label: "เดินทาง", icon: "🚗", aliases: ["transport", "travel", "เดินทาง", "รถ"],
    keywords: ["รถ", "แท็กซี่", "วิน", "มอไซค์", "รถไฟ", "รถเมล์", "เรือ", "ทางด่วน", "น้ำมัน", "เติมน้ำมัน", "ที่จอดรถ", "จอดรถ", "ค่าทาง", "ตั๋ว", "เครื่องบิน", "บีทีเอส", "เอ็มอาร์ที", "悠遊卡",
      "grab", "bolt", "taxi", "uber", "bts", "mrt", "arl", "bus", "train", "ferry", "toll", "gas", "fuel", "petrol", "parking", "flight", "airasia", "ticket", "muvmi", "youbike",
      "easy card", "easycard", "student card", "rabbit card"],
    places: ["top up", "topup"] },
  { key: "shopping", kind: "expense", label: "ช้อปปิ้ง", icon: "🛍️", aliases: ["shopping", "shop", "ช้อป", "ช้อปปิ้ง"],
    keywords: ["เสื้อ", "กางเกง", "รองเท้า", "กระเป๋า", "ช้อป", "ของขวัญ", "เครื่องสำอาง", "หูฟัง", "มือถือ", "โทรศัพท์",
      "shopee", "lazada", "amazon.com", "uniqlo", "h&m", "zara", "shirt", "shoes", "bag", "gift", "clothes", "jacket", "jackets", "shopping", "shoping", "airpods", "hair dryer", "skin care", "skincare", "nivea", "nivia", "lotion", "decathlon", "present", "souvenir", "graduation gown", "shorts", "pants", "shirts", "long sleeves", "ear rings", "earrings"],
    places: ["ikea", "central", "robinson", "outlet", "mall"] },
  { key: "housing", kind: "expense", label: "ที่พัก/ค่าน้ำไฟ", icon: "🏠", aliases: ["housing", "bills", "ที่พัก", "บ้าน", "ค่าห้อง"],
    keywords: ["ค่าห้อง", "ค่าเช่า", "เช่าห้อง", "ค่าบ้าน", "ผ่อนบ้าน", "คอนโด", "ค่าน้ำ", "ค่าไฟ", "ค่าเน็ต", "อินเทอร์เน็ต", "เน็ตบ้าน", "ค่าโทรศัพท์", "ค่าส่วนกลาง", "ค่าโทร",
      "rent", "electric", "electricity", "water bill", "internet", "wifi", "ais", "true", "dtac", "3bb", "condo", "mortgage", "utility", "utilities", "dorm", "dormitory", "ac fee", "air con", "aircon", "mattress", "sim card", "chunghwa", "chunghua", "telecom", "monthly fee"] },
  { key: "health", kind: "expense", label: "สุขภาพ", icon: "💊", aliases: ["health", "สุขภาพ", "หมอ"],
    keywords: ["ยา", "หมอ", "โรงพยาบาล", "คลินิก", "ทำฟัน", "หมอฟัน", "ตรวจสุขภาพ", "ฟิตเนส", "ยิม", "นวด", "ประกันสุขภาพ", "วิตามิน", "ตัดผม",
      "hospital", "clinic", "doctor", "dentist", "medicine", "medical", "nhi", "pharmacy", "gym", "fitness", "massage", "vitamin", "boots", "watsons", "bandage", "protein", "swimming", "barber", "haircut", "hair cut"] },
  { key: "entertainment", kind: "expense", label: "บันเทิง", icon: "🎬", aliases: ["entertainment", "fun", "บันเทิง"],
    keywords: ["หนัง", "ดูหนัง", "คอนเสิร์ต", "เกม", "เที่ยว", "ปาร์ตี้", "คาราโอเกะ", "สมาชิก", "หวย", "ลอตเตอรี่",
      "movie", "cinema", "netflix", "spotify", "youtube", "disney", "game", "steam", "concert", "party", "karaoke", "major", "sf cinema", "trip", "hotel", "agoda", "booking", "night club", "nightclub", "museum", "club", "pub", "lottery", "entrance fee", "ticket to"] },
  { key: "education", kind: "expense", label: "การศึกษา", icon: "📚", aliases: ["education", "study", "การศึกษา", "เรียน"],
    keywords: ["หนังสือ", "เรียน", "คอร์ส", "ค่าเทอม", "ติว", "สอบ", "เครื่องเขียน", "ปริ้น", "พิมพ์งาน",
      "book", "course", "tuition", "class", "udemy", "coursera", "exam", "stationery", "printing", "print", "midterm", "registration"] },
  { key: "household", kind: "expense", label: "ของใช้ในบ้าน", icon: "🧴", aliases: ["household", "ของใช้", "grocery"],
    keywords: ["ของใช้", "สบู่", "แชมพู", "ยาสีฟัน", "ผงซักฟอก", "ทิชชู่", "กระดาษชำระ", "ซักผ้า", "น้ำยาปรับผ้านุ่ม", "ร่ม",
      "grocery", "groceries", "laundry", "landry", "tissue", "tissues", "detergent", "softener", "shampoo", "soap", "toothpaste", "washing", "umbrella", "pillow", "desiccant", "shower cream", "clipper", "stuff", "stuffs", "dry clothes", "luandry", "ethanol"],
    places: ["ร้านสะดวกซื้อ", "ซุปเปอร์", "ตลาด", "全聯", "全联", "萊爾富", "全家",
      "7-11", "7-eleven", "seven", "711", "lotus", "big c", "bigc", "tops", "makro", "family mart", "familymart", "familiymart", "lawson", "villa", "gourmet", "supermarket",
      "hi-life", "hilife", "hi life", "ok mart", "poya", "px mart", "pxmart", "px store", "carrefour", "carefour", "costco", "watsons"] },
  { key: "other_expense", kind: "expense", label: "รายจ่ายอื่นๆ", icon: "📦", aliases: ["other", "อื่นๆ", "อื่น"], keywords: [] },

  // ---- income
  { key: "salary", kind: "income", label: "เงินเดือน", icon: "💼", aliases: ["salary", "เงินเดือน"],
    keywords: ["เงินเดือน", "ค่าจ้าง", "โบนัส", "salary", "payroll", "bonus", "wage", "stipend", "stipends", "scholarship"] },
  { key: "side_income", kind: "income", label: "รายได้เสริม", icon: "💡", aliases: ["side", "freelance", "รายได้เสริม"],
    keywords: ["ฟรีแลนซ์", "งานเสริม", "ขายของ", "ค่าคอม", "ปันผล", "ดอกเบี้ย", "เงินคืน", "คืนเงิน", "ขาย", "ถูกหวย", "รางวัล",
      "freelance", "commission", "dividend", "interest", "refund", "cashback", "sale", "sold", "side", "profit", "prize", "lottery", "subsidy"] },
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

// The same normalisation as noteKey(), in SQL, for matching EXPENSE.NOTE
// against CATEGORY_MEMORY.NOTE_KEY.
const NOTE_KEY_SQL =
  "SUBSTR(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(note), '#[^[:space:]]+', ' '), '[[:space:]]+', ' ')), 1, 200)";

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
// test(text) returns the position of the word in the note, or -1.
const toMatcher = (k) => {
  const w = k.trim();
  const latin = /^[\x20-\x7e]+$/.test(w);
  const re = latin ? new RegExp(`(^|[^a-z0-9])(${escapeRe(w)})($|[^a-z0-9])`) : null;
  return {
    len: w.length,
    test: re
      ? (t) => { const m = re.exec(t); return m ? m.index + m[1].length : -1; }
      : (t) => t.indexOf(w),
  };
};
const MATCHERS = CATEGORIES.map((c) => ({
  key: c.key,
  kind: c.kind,
  words: c.keywords.map(toMatcher),
  places: (c.places || []).map(toMatcher),
}));

// The word that starts first in the note wins (people usually write what they
// bought first: "taxi to dorm after night party" → transport); at the same
// position the longer word wins ("ค่าน้ำ" beats "น้ำ", "coke zero" beats "coke").
function bestMatch(text, kind, field) {
  let best = null;
  for (const m of MATCHERS) {
    if (m.kind !== kind) continue;
    for (const w of m[field]) {
      const pos = w.test(text);
      if (pos < 0) continue;
      if (!best || pos < best.pos || (pos === best.pos && w.len > best.len)) best = { key: m.key, pos, len: w.len };
    }
  }
  return best ? best.key : null;
}

// What was bought decides; places (shops) are only a fallback.
function byKeyword(note, amount) {
  const text = noteKey(note);
  const kind = kindOf(amount);
  return bestMatch(text, kind, "words") || bestMatch(text, kind, "places");
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

// Shared mapping (same for every user), exact note match.
async function fromShared(connection, note, amount) {
  const key = noteKey(note);
  if (!key) return null;
  let r;
  try {
    r = await executeQuery(
      connection,
      "SELECT category FROM category_map WHERE note_key = :note_key AND kind = :kind",
      { note_key: key, kind: kindOf(amount) }
    );
  } catch (e) {
    // Table not created yet (migration 002 not applied): skip this step
    // rather than fail the whole add.
    if (e && e.errorNum === 942) return null;
    throw e;
  }
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
  const shared = await fromShared(connection, note, amount);
  if (shared) return { category: shared, source: "shared", note };
  const keyword = byKeyword(note, amount);
  if (keyword) return { category: keyword, source: "keyword", note };
  return { category: fallbackFor(amount), source: "fallback", note };
}

// Remember the user's choice for this note. Choosing "other" forgets what
// was remembered instead, so the note goes back to keyword guessing (an
// "other" memory would otherwise override keywords forever).
async function remember(connection, uname, note, category) {
  const key = noteKey(note);
  if (!key) return;
  if (category === "other_expense" || category === "other_income") {
    await executeQuery(
      connection,
      "DELETE FROM category_memory WHERE uname = :uname AND note_key = :note_key",
      { uname, note_key: key }
    );
    return;
  }
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

// After a record is deleted: forget the note's category if no other record
// of this user still has the same note. Returns true if something was forgotten.
async function forgetIfUnused(connection, uname, note) {
  const key = noteKey(note);
  if (!key) return false;
  const still = await executeQuery(
    connection,
    `SELECT 1 FROM expense WHERE uname = :uname AND ${NOTE_KEY_SQL} = :note_key FETCH FIRST 1 ROWS ONLY`,
    { uname, note_key: key }
  );
  if (still.rows.length) return false;
  const r = await executeQuery(
    connection,
    "DELETE FROM category_memory WHERE uname = :uname AND note_key = :note_key",
    { uname, note_key: key }
  );
  return r.rowsAffected > 0;
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
  kindOf,
  NOTE_KEY_SQL,
  forgetIfUnused,
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
