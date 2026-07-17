/**
 * Deterministic, multi-language "source of truth" reply engine for the AI
 * receptionist. This is the guaranteed-correct path — used whenever a guest
 * asks a factual question (price, availability, rules, etc.) or when no
 * OpenAI key is configured — and per ai-knowledge-base/10_AI_Guidelines.md's
 * "never invent information" rule, it must never depend on an LLM to be
 * correct.
 *
 * Previously this logic lived inline in app/api/chat/route.ts and was
 * English-only. It now supports English, Nepali (Devanagari), and Tibetan,
 * per the explicit project decision to translate the deterministic reply
 * templates themselves (not just add an LLM instruction) — see
 * ai-knowledge-base/10_AI_Guidelines.md and 16_Multilanguage_Support.md for
 * the full write-up and caveats.
 *
 * IMPORTANT — translation quality caveat (flag this honestly, do not hide
 * it): the Nepali content below was produced with reasonable confidence.
 * The Tibetan content is a good-faith, grammatically-reasoned first pass —
 * NOT verified by a native Tibetan speaker — and should be reviewed before
 * being treated as fully production-accurate. Numbers, NPR amounts, dates,
 * and room names are kept identical across all three languages so no
 * factual drift is possible even if the surrounding grammar isn't perfect.
 *
 * Also flagged: Nepali guests very commonly type in Romanized/Latin script
 * (e.g. "kati parcha"), which is NOT reliably detected — see lib/language.ts.
 * A handful of common romanized words are layered into the English keyword
 * lists below as a best-effort bonus, not a comprehensive solution.
 */
import { type Lang, detectLanguage } from "./language";

export { detectLanguage };
export type { Lang };

const CONTACT_LINE: Record<Lang, string> = {
  en: "Please WhatsApp or call 9708538395 / 9869035191, or email jikmisdonkhang@gmail.com.",
  ne: "कृपया 9708538395 / 9869035191 मा व्हाट्सएप वा कल गर्नुहोस्, वा jikmisdonkhang@gmail.com मा इमेल गर्नुहोस्।",
  bo: "9708538395 / 9869035191 ཐོག WhatsApp or Call གནང་རོགས, ཡང་ན jikmisdonkhang@gmail.com ལ Email གནང་རོགས།"
};

const BOOKING_DETAILS_PROMPT: Record<Lang, string> = {
  en: "For booking, please share room type, check-in date, check-out date, number of guests, full name, phone number, and email address (this lets us confirm your request by WhatsApp and email automatically), plus ID/citizenship/passport and payment method.",
  ne: "बुकिङको लागि, कृपया रूम प्रकार, चेक-इन मिति, चेक-आउट मिति, पाहुना संख्या, पूरा नाम, फोन नम्बर, र इमेल ठेगाना पठाउनुहोस् (यसले हामीलाई व्हाट्सएप र इमेलबाट स्वचालित रूपमा तपाईंको अनुरोध पुष्टि गर्न मद्दत गर्छ), साथै परिचय-पत्र/नागरिकता/राहदानी र भुक्तानी विधि पनि।",
  bo: "Booking ཆེད་དུ་ Room type, Check-in date, Check-out date, མགྲོན་པོའི་གྲངས, མིང་ཚང་, ཁ་པར་ཨང་, དང་ Email བཏང་རོགས (འདིས་ང་ཚོར་ WhatsApp དང་ Email ནང་རང་འགུལ་གྱིས་ཁྱེད་ཀྱི་ Booking request ངོས་འཛིན་བྱེད་པར་རོགས་རམ་བྱེད), དེ་བཞིན་ ID/citizenship/passport དང་ payment method ཡང་།"
};

function matchesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

type IntentKey =
  | "greeting"
  | "price"
  | "laundry"
  | "roomDetails"
  | "rules"
  | "booking"
  | "discount"
  | "contact"
  | "facilities"
  | "location"
  | "availability"
  | "airport"
  | "roomGeneric"
  | "stayType"
  | "human"
  | "paymentSub";

const KEYWORDS: Record<Lang, Record<IntentKey, string[]>> = {
  en: {
    greeting: ["hello", "hi", "hey", "namaste"],
    price: ["price", "cost", "rate", "rates", "expensive", "cheap", "monthly", "montly", "month", "night", "nightly", "daily", "rent", "charge", "payment", "how much", "per night", "per month", "kati", "paisa"],
    laundry: ["laundry", "wash", "washing", "clothes", "machine"],
    roomDetails: ["room type", "room types", "inside", "include", "included", "have", "has", "bed", "beds", "guest", "guests", "capacity", "how many people", "how many guest", "people can stay", "sofa", "fridge", "refrigerator", "utensil", "utensils", "dining"],
    rules: ["rule", "policy", "policies", "check-in", "check in", "checkout", "check-out", "smoking", "pet", "visitor", "quiet", "alcohol", "id", "passport", "citizenship", "deposit", "cancel", "refund", "damage"],
    booking: ["book", "booking", "reserve", "reservation", "hold room", "confirm room", "viewing", "inspection", "visit room", "payment", "pay", "advance", "esewa", "khalti", "bank", "cash", "summary"],
    discount: ["discount", "negotiate", "negotiation", "nego", "deal", "less", "cheaper", "lower", "reduce", "reduced", "offer"],
    contact: ["contact", "phone", "call", "whatsapp", "email", "number", "gmail"],
    facilities: ["facility", "facilities", "amenity", "amenities", "wifi", "internet", "hot water", "kitchen", "clean", "cleaning", "housekeeping", "parking", "bike", "motorbike", "cctv", "security camera", "rooftop", "view"],
    location: ["location", "where", "address", "boudha", "boudhanath", "stupa", "near", "nearby", "far", "distance", "map", "airport", "restaurant", "cafe", "shop", "bank", "atm"],
    availability: ["available", "availability", "vacant", "free", "which rooms"],
    airport: ["airport pickup", "pickup", "pick up"],
    roomGeneric: ["studio", "single", "double", "2 bhk", "2bhk", "family", "group", "apartment type", "room", "rooms"],
    stayType: ["student", "study", "quiet", "work", "remote", "long-term", "long term", "short-term", "short term", "stay"],
    human: ["person", "staff", "human", "assistance", "help me", "talk"],
    paymentSub: ["payment", "pay", "advance", "esewa", "khalti", "bank", "cash"]
  },
  ne: {
    greeting: ["नमस्ते", "नमस्कार"],
    price: ["मूल्य", "भाडा", "दर", "कति पर्छ", "कति हो", "पैसा", "महिना", "महिनावारी", "रात", "प्रति रात", "शुल्क"],
    laundry: ["लुगा", "धुने", "वासिङ", "मेसिन"],
    roomDetails: ["कोठा प्रकार", "भित्र के छ", "समावेश", "ओछ्यान", "पाहुना संख्या", "क्षमता", "सोफा", "फ्रिज"],
    rules: ["नियम", "चेक-इन", "चेक-आउट", "धुम्रपान", "घरपालुवा", "निक्षेप", "रद्द", "फिर्ता", "परिचय-पत्र", "नागरिकता", "राहदानी"],
    booking: ["बुक", "बुकिङ", "आरक्षण", "भुक्तानी", "पेस्की", "जम्मा"],
    discount: ["छुट", "मोलमोलाइ", "सस्तो", "घटाउन", "कम गर"],
    contact: ["सम्पर्क", "फोन", "कल गर", "व्हाट्सएप", "इमेल", "नम्बर"],
    facilities: ["सुविधा", "वाइफाइ", "तातो पानी", "सरसफाइ", "पार्किङ", "सीसीटीभी", "रुफटप"],
    location: ["स्थान", "कहाँ", "ठेगाना", "बौद्ध", "नजिक", "टाढा", "नक्सा", "विमानस्थल"],
    availability: ["उपलब्ध", "खाली"],
    airport: ["एयरपोर्ट पिकअप", "पिकअप"],
    roomGeneric: ["स्टुडियो", "सिंगल", "डबल", "फ्यामिली", "कोठा", "रूम"],
    stayType: ["विद्यार्थी", "लामो समय", "छोटो समय", "बसाइ"],
    human: ["मान्छे", "स्टाफ", "सहयोग गर", "कुरा गर"],
    paymentSub: ["भुक्तानी", "पेस्की", "esewa", "khalti", "बैंक", "नगद"]
  },
  bo: {
    greeting: ["བཀྲ་ཤིས་བདེ་ལེགས", "ཏཤེ་བདེ"],
    price: ["གོང་ཚད", "རིན", "ག་ཚོད", "ཟླ་རེ", "མཚན་མོ"],
    laundry: ["འཁྲུད"],
    roomDetails: ["ཁང་མིག", "ཉལ་ཁྲི", "མགྲོན་པོའི་གྲངས", "sofa", "fridge"],
    rules: ["སྒྲིག་གཞི", "check-in", "check-out", "ཐ་མག", "id", "citizenship", "passport"],
    booking: ["booking", "ཐོ་འགོད", "payment", "advance"],
    discount: ["discount", "ཉུང་དུ", "ཐོ་ཆུང"],
    contact: ["འབྲེལ་གནས", "ཁ་པར", "whatsapp", "email"],
    facilities: ["ཞབས་ཞུ", "wifi", "ཆུ་ཚན", "cctv"],
    location: ["ས་གནས", "ག་པར", "boudha", "airport", "map"],
    availability: ["སྟོང", "ཡོད་མེད"],
    airport: ["airport pickup", "pickup"],
    roomGeneric: ["studio", "single", "double", "family", "ཁང་མིག"],
    stayType: ["student", "སྡོད་རིང", "སྡོད་ཐུང"],
    human: ["staff", "རོགས་རམ"],
    paymentSub: ["payment", "advance", "cash", "bank"]
  }
};

const ROOM_MATCH: Record<Lang, { family: string[]; double: string[]; single: string[]; monthly: string[] }> = {
  en: {
    family: ["family", "2bhk", "2 bhk"],
    double: ["double"],
    single: ["single"],
    monthly: ["monthly", "month"]
  },
  ne: {
    family: ["family", "2bhk", "फ्यामिली", "पारिवारिक"],
    double: ["double", "डबल"],
    single: ["single", "सिंगल"],
    monthly: ["महिना", "महिनावारी", "monthly"]
  },
  bo: {
    family: ["family", "Family"],
    double: ["double", "Double"],
    single: ["single", "Single"],
    monthly: ["ཟླ་རེ", "monthly", "Month"]
  }
};

function isIntent(text: string, lang: Lang, intent: IntentKey): boolean {
  return matchesAny(text, KEYWORDS[lang][intent]);
}

function isAvailabilityQuestion(text: string, lang: Lang): boolean {
  return isIntent(text, lang, "availability");
}

export function isSourceOfTruthQuestion(message: string): boolean {
  const lang = detectLanguage(message);
  const text = message.toLowerCase();
  return (
    isAvailabilityQuestion(text, lang) ||
    isIntent(text, lang, "price") ||
    isIntent(text, lang, "laundry") ||
    isIntent(text, lang, "contact") ||
    isIntent(text, lang, "discount") ||
    isIntent(text, lang, "booking") ||
    isIntent(text, lang, "roomDetails") ||
    isIntent(text, lang, "rules") ||
    isIntent(text, lang, "facilities") ||
    isIntent(text, lang, "location")
  );
}

// ---------------------------------------------------------------------
// Reply content, one function per intent, switching on language. Keeping
// the decision TREE (localReceptionistReply below) single and
// language-parameterized, rather than duplicating the whole tree three
// times, so the priority order of intents can't drift out of sync between
// languages.
// ---------------------------------------------------------------------

function unknownReply(lang: Lang): string {
  switch (lang) {
    case "ne":
      return `मसँग यो कुरा पक्का भएर फाइलमा छैन, त्यसैले म अड्कल गर्न चाहन्न — म हाम्रो टिमसँग यो जाँच गराउँछु। यसैबीच म जिकमिस अपार्टमेन्टका कोठा, मूल्य, उपलब्धता, बुकिङ, सुविधा, स्थान, वा घरका नियमहरूमा प्रत्यक्ष सहयोग गर्न सक्छु। ${CONTACT_LINE.ne}`;
    case "bo":
      return `འདི་ང་ལ་ངེས་གཏན་ཡོད་མེད་ཤེས་མེད་པས, ང་ངེས་མེད་ཀྱི་ལན་མི་སྤྲོད། ང་ཚོའི Team ལ་ཞིབ་བཤེར་བྱེད་དུ་འཇུག། Meanwhile ང་ Jikmis Apartment གི Room, Price, Availability, Booking, Facilities, Location, or House rules ལ་རོགས་རམ་བྱེད་ཐུབ། ${CONTACT_LINE.bo}`;
    default:
      return `I don't have that confirmed on file, so I don't want to guess — let me get that checked with our team. I can help directly with Jikmis Apartment rooms, prices, availability, booking, facilities, location, or house rules in the meantime. ${CONTACT_LINE.en}`;
  }
}

function availabilityReply(lang: Lang, text: string, compact = false): string {
  const rm = ROOM_MATCH[lang];
  if (matchesAny(text, rm.family)) {
    if (lang === "ne") return compact ? "यो अहिले नै उपलब्ध छ।" : "हो! हाम्रो 2BHK Family Room अहिले नै उपलब्ध छ।";
    if (lang === "bo") return compact ? "ད་ལྟ་སྟོང་ཡོད།" : "རེད། ང་ཚོའི 2BHK Family Room ད་ལྟ་སྟོང་ཡོད།";
    return compact ? "It is available right now." : "Yes! Our 2BHK Family Room is available right now.";
  }
  if (matchesAny(text, rm.double)) {
    if (lang === "ne") return compact ? "यो 12 जुलाईपछि उपलब्ध हुनेछ।" : "Double Studio Room 12 जुलाईपछि उपलब्ध हुनेछ।";
    if (lang === "bo") return compact ? "12 July ཉིན་མའི་རྗེས་སྟོང་ཡོང་།" : "Double Studio Room 12 July ཉིན་མའི་རྗེས་སྟོང་ཡོང་།";
    return compact ? "It will be available after 12 July." : "The Double Studio Room will be available after 12 July.";
  }
  if (matchesAny(text, rm.single)) {
    if (lang === "ne") return compact ? "यो 8 अगस्टपछि उपलब्ध हुनेछ।" : "हाम्रो Single Studio Room 8 अगस्टपछि उपलब्ध हुनेछ।";
    if (lang === "bo") return compact ? "8 August ཉིན་མའི་རྗེས་སྟོང་ཡོང་།" : "ང་ཚོའི Single Studio Room 8 August ཉིན་མའི་རྗེས་སྟོང་ཡོང་།";
    return compact ? "It will be available after 8 August." : "Our Single Studio Room will be available after 8 August.";
  }
  if (lang === "ne") return "अहिले हाम्रो 2BHK Family Room उपलब्ध छ। Double Studio Room 12 जुलाईपछि र Single Studio Room 8 अगस्टपछि उपलब्ध हुनेछ।";
  if (lang === "bo") return "ད་ལྟ་ང་ཚོའི 2BHK Family Room སྟོང་ཡོད། Double Studio Room 12 July ཉིན་མའི་རྗེས་སྟོང་ཡོང་། Single Studio Room 8 August ཉིན་མའི་རྗེས་སྟོང་ཡོང་།";
  return "Right now our 2BHK Family Room is available. The Double Studio Room will be available after 12 July, and the Single Studio Room will be available after 8 August.";
}

function priceReply(lang: Lang, text: string): string {
  const rm = ROOM_MATCH[lang];
  if (matchesAny(text, rm.family)) {
    if (lang === "ne") return "2BHK फ्यामिली रूम प्रति रात NPR 4,000 वा प्रति महिना NPR 65,000 हो।";
    if (lang === "bo") return "2BHK Family Room གི་གོང་ཚད་ནི་མཚན་མོ་རེར་ NPR 4,000 ཡང་ན་ཟླ་བ་རེར་ NPR 65,000 ཡིན།";
    return "Our 2BHK Family Room is NPR 4,000 per night or NPR 65,000 per month.";
  }
  if (matchesAny(text, rm.double)) {
    if (lang === "ne") return "डबल स्टुडियो रूम प्रति रात NPR 2,500 वा प्रति महिना NPR 47,000 हो।";
    if (lang === "bo") return "Double Studio Room གི་གོང་ཚད་ནི་མཚན་མོ་རེར་ NPR 2,500 ཡང་ན་ཟླ་བ་རེར་ NPR 47,000 ཡིན།";
    return "The Double Studio Room is NPR 2,500 per night or NPR 47,000 per month.";
  }
  if (matchesAny(text, rm.single)) {
    if (lang === "ne") return "सिंगल स्टुडियो रूम प्रति रात NPR 1,500 वा प्रति महिना NPR 37,000 हो।";
    if (lang === "bo") return "Single Studio Room གི་གོང་ཚད་ནི་མཚན་མོ་རེར་ NPR 1,500 ཡང་ན་ཟླ་བ་རེར་ NPR 37,000 ཡིན།";
    return "The Single Studio Room is NPR 1,500 per night or NPR 37,000 per month.";
  }
  if (matchesAny(text, rm.monthly)) {
    if (lang === "ne") return "हो, महिनावारी मूल्य यस्तो छ:\n\n* Single Studio Room: NPR 37,000 प्रति महिना\n* Double Studio Room: NPR 47,000 प्रति महिना\n* 2BHK Family Room: NPR 65,000 प्रति महिना।";
    if (lang === "bo") return "རེད། ཟླ་རེའི་གོང་ཚད་ནི། Single Studio Room: NPR 37,000, Double Studio Room: NPR 47,000, 2BHK Family Room: NPR 65,000 ཡིན།";
    return "Yes, we do:\n\n* Single Studio Room: NPR 37,000 per month\n* Double Studio Room: NPR 47,000 per month\n* 2BHK Family Room: NPR 65,000 per month.";
  }
  if (lang === "ne") return "Single Studio Room प्रति रात NPR 1,500, Double Studio Room प्रति रात NPR 2,500, र 2BHK Family Room प्रति रात NPR 4,000 हो।";
  if (lang === "bo") return "Single Studio Room མཚན་མོ་རེར་ NPR 1,500, Double Studio Room མཚན་མོ་རེར་ NPR 2,500, 2BHK Family Room མཚན་མོ་རེར་ NPR 4,000 ཡིན།";
  return "Single Studio Room is NPR 1,500 per night, Double Studio Room is NPR 2,500 per night, and 2BHK Family Room is NPR 4,000 per night.";
}

function laundryReply(lang: Lang, text: string): string {
  if (matchesAny(text, ["included", "include"]) || (lang === "ne" && matchesAny(text, ["समावेश"])) || (lang === "bo" && matchesAny(text, ["included"]))) {
    if (lang === "ne") return "होइन, लुगा धुने सेवा छुट्टै शुल्कमा उपलब्ध छ — प्रति लोड NPR 200।";
    if (lang === "bo") return "མིན། འཁྲུད་ཞབས་ཞུར་གོང་ཚད་སྒེར་པ་ཡོད། Load རེར་ NPR 200 ཡིན།";
    return "No, laundry is charged separately at NPR 200 per load.";
  }
  if (matchesAny(text, ["kg", "kilo", "once", "load", "hold"]) || (lang === "ne" && matchesAny(text, ["केजी", "लोड"])) || (lang === "bo" && matchesAny(text, ["kg", "load"]))) {
    if (lang === "ne") return "प्रत्येक लोडमा लगभग 8-9 केजी अटाउँछ।";
    if (lang === "bo") return "Load རེར་ཀི་ལོ 8-9 ཙམ་ཐུབ།";
    return "Each load can hold approximately 8-9 kg.";
  }
  if (matchesAny(text, ["how much", "cost", "price", "charge"]) || (lang === "ne" && matchesAny(text, ["कति", "मूल्य"])) || (lang === "bo" && matchesAny(text, ["ག་ཚོད"]))) {
    if (lang === "ne") return "यो प्रति लोड NPR 200 हो।";
    if (lang === "bo") return "Load རེར་ NPR 200 ཡིན།";
    return "It's NPR 200 per load.";
  }
  if (matchesAny(text, ["clothes", "wash"]) || (lang === "ne" && matchesAny(text, ["लुगा", "धुने"])) || (lang === "bo" && matchesAny(text, ["འཁྲུད"]))) {
    if (lang === "ne") return "हो! तपाईं हाम्रो सेल्फ-सर्भिस वासिङ मेसिन प्रयोग गर्न सक्नुहुन्छ। यो प्रति लोड NPR 200 हो, र प्रत्येक लोडमा लगभग 8-9 केजी अटाउँछ।";
    if (lang === "bo") return "རེད། ཁྱེད་ཀྱིས་རང་ཉིད་ཀྱིས་བེད་སྤྱོད་བྱེད་པའི་འཁྲུད་འཕྲུལ་བེད་སྤྱོད་བྱེད་ཆོག Load རེར་ NPR 200 དང་། Load རེར་ཀི་ལོ 8-9 ཙམ་ཐུབ།";
    return "Yes! You can use our self-service washing machine. It's NPR 200 per load, and each load can hold about 8-9 kg.";
  }
  if (lang === "ne") return "हो, हाम्रा पाहुनाहरूको लागि सेल्फ-सर्भिस वासिङ मेसिन उपलब्ध छ।";
  if (lang === "bo") return "རེད། ང་ཚོར་མགྲོན་པོའི་ཆེད་དུ་རང་ཉིད་ཀྱིས་བེད་སྤྱོད་བྱེད་པའི་འཁྲུད་འཕྲུལ་ཡོད།";
  return "Yes, we have a self-service washing machine available for our guests.";
}

function roomDetailsReply(lang: Lang, text: string): string {
  const rm = ROOM_MATCH[lang];
  if (matchesAny(text, rm.single)) {
    if (lang === "ne") return "Single Studio Room 1-2 पाहुनाको लागि उपयुक्त छ। यसमा क्वीन बेड, निजी बाथरूम, भान्सा, टेबल र कुर्सी, फ्रिज, पंखा, र भाँडाकुँडा छन्।";
    if (lang === "bo") return "Single Studio Room ནི་མགྲོན་པོ 1-2 ལ་འོས་པ་ཡིན། Queen bed, སྒེར་གྱི་འཁྲུས་ཁང་, ཐབ་ཚང་, ཅོག་ཙེ་དང་ཁྲི, fridge, fan, དང་ཟླུམ་ཆས་ཚང་མ་ཡོད།";
    return "The Single Studio Room is best for 1-2 guests. It has a queen bed, private bathroom, kitchen, table and chair, fridge, fan, and utensils.";
  }
  if (matchesAny(text, rm.double)) {
    if (lang === "ne") return "Double Studio Room 2-3 पाहुनाको लागि उपयुक्त छ। यसमा 2 ट्विन बेड, निजी बाथरूम, भान्सा, टेबल र कुर्सी, सोफा, फ्रिज, पंखा, र भाँडाकुँडा छन्।";
    if (lang === "bo") return "Double Studio Room ནི་མགྲོན་པོ 2-3 ལ་འོས་པ་ཡིན། Twin bed 2, སྒེར་གྱི་འཁྲུས་ཁང་, ཐབ་ཚང་, ཅོག་ཙེ་དང་ཁྲི, sofa, fridge, fan, དང་ཟླུམ་ཆས་ཚང་མ་ཡོད།";
    return "The Double Studio Room is best for 2-3 guests. It has 2 twin beds, private bathroom, kitchen, table and chair, sofa, fridge, fan, and utensils.";
  }
  if (matchesAny(text, rm.family)) {
    if (lang === "ne") return "2BHK Family Room 4-5 पाहुनाको लागि उपयुक्त छ। यसमा किंग-साइज बेड भएका 2 शयनकक्ष, भान्सा, 2 बाथरूम, सोफा, फ्रिज, कुर्सी, टेबल, र डाइनिङ क्षेत्र छन्।";
    if (lang === "bo") return "2BHK Family Room ནི་མགྲོན་པོ 4-5 ལ་འོས་པ་ཡིན། King-size bed ཡོད་པའི་ཉལ་ཁང 2, ཐབ་ཚང་, འཁྲུས་ཁང 2, sofa, fridge, ཁྲི, ཅོག་ཙེ, དང་ཟས་སྐོམ་ཟའི་ས་ཁུལ་ཡོད།";
    return "The 2BHK Family Room is best for 4-5 guests. It has 2 bedrooms with king-size beds, kitchen, 2 bathrooms, sofa, fridge, chair, table, and dining area.";
  }
  if (lang === "ne") return "हामीसँग 2 Single Studio Room, 2 Double Studio Room, र 1 2BHK Family Room छन्।";
  if (lang === "bo") return "ང་ཚོར Single Studio Room 2, Double Studio Room 2, དང་ 2BHK Family Room 1 ཡོད།";
  return "We have 2 Single Studio Rooms, 2 Double Studio Rooms, and 1 2BHK Family Room.";
}

function facilitiesReply(lang: Lang): string {
  if (lang === "ne") return "सुविधाहरूमा वाइफाइ, तातो पानी, हप्तामा दुई पटक सरसफाइ, रुफटप दृश्य, बाइक पार्किङ, सीसीटीभी, र लुगा धुने सेवा समावेश छन्।";
  if (lang === "bo") return "ཞབས་ཞུའི་ནང་དུ WiFi, ཆུ་ཚན, བདུན་ཕྲག་རེར་ལན་གཉིས་བསང་བཟོ, rooftop view, bike parking, CCTV, དང་འཁྲུད་ཞབས་ཞུ་བཅས་ཚང་མ་ཡོད།";
  return "Facilities include WiFi, hot water, cleaning twice a week, rooftop view, bike parking, CCTV, and laundry service.";
}

function locationReply(lang: Lang): string {
  if (lang === "ne") return "जिकमिस अपार्टमेन्ट बौद्ध, काठमाडौंमा छ, बौद्धनाथ स्तूपाबाट लगभग 5-10 मिनेटको पैदल दूरीमा। विमानस्थल लगभग 5 किमी टाढा छ, ट्राफिकअनुसार गाडीमा लगभग 15-20 मिनेट लाग्छ। Google Maps: https://maps.app.goo.gl/8GBvpWXkh6NiQihz8?g_st=ic";
  if (lang === "bo") return "Jikmis Apartment ནི་ Boudha, Kathmandu ནང་དུ་ཡོད། Boudhanath Stupa ནས་རྐང་ཐང་གིས་སྐར་མ 5-10 ཙམ་གྱི་ཐག་ཉེ་བ་ཡིན། Airport ནི་ཉེ་འཁོར kilometre 5 ཙམ་ཡིན་ཞིང་། Car གྱིས་འགྲོ་ན་འགྲུལ་འགྲོའི་གནས་སྟངས་ལ་བརྟེན་ནས་སྐར་མ 15-20 ཙམ་འགོར། Google Maps: https://maps.app.goo.gl/8GBvpWXkh6NiQihz8?g_st=ic";
  return "Jikmis Apartment is in Boudha, Kathmandu, about 5-10 minutes' walk from Boudhanath Stupa. The airport is about 5 km away, around 15-20 minutes by car depending on traffic. Google Maps: https://maps.app.goo.gl/8GBvpWXkh6NiQihz8?g_st=ic";
}

function contactReply(lang: Lang): string {
  if (lang === "ne") return "तपाईं हामीलाई 9708538395 / 9869035191 मा व्हाट्सएप वा फोन गर्न सक्नुहुन्छ। इमेल: jikmisdonkhang@gmail.com।";
  if (lang === "bo") return "ཁྱེད་ཀྱིས་ང་ཚོར 9708538395 / 9869035191 ཐོག་ WhatsApp or Call བྱེད་ཆོག Email: jikmisdonkhang@gmail.com";
  return "You can WhatsApp or call us at 9708538395 / 9869035191. Email: jikmisdonkhang@gmail.com.";
}

function bookingReply(lang: Lang): string {
  if (lang === "ne") return `${BOOKING_DETAILS_PROMPT.ne} विवरण पाएपछि, म तपाईंको लागि स्पष्ट सारांश बनाउनेछु। बुकिङ पुष्टि गर्न 50% अग्रिम भुक्तानी आवश्यक छ, र बाँकी 50% चेक-इनको 2 दिनभित्र तिर्नुपर्छ।`;
  if (lang === "bo") return `${BOOKING_DETAILS_PROMPT.bo} Details ཐོབ་རྗེས་ང་ཚོས་ཁྱེད་ཆེད་ Summary གསལ་པོ་ཞིག་བཟོ་ཆོག Booking ངོས་འཛིན་ཆེད་ 50% Advance payment དགོས་ཤིང་། ལྷག་མ 50% Check-in ཉིན་ནས་ཉིན 2 ནང་ཚུད་སྤྲོད་དགོས།`;
  return `${BOOKING_DETAILS_PROMPT.en} After I have the details, I can make a clear summary for you. A 50% advance payment is needed to confirm booking, and the remaining 50% should be paid within 2 days of check-in.`;
}

function paymentReply(lang: Lang): string {
  if (lang === "ne") return "बुकिङको लागि, 50% अग्रिम भुक्तानी आवश्यक छ। बाँकी 50% चेक-इनको 2 दिनभित्र तिर्नुपर्छ। भुक्तानी विधिहरू नगद, बैंक ट्रान्सफर, eSewa, र Khalti हुन्। च्याटभित्र भुक्तानी स्वीकार गरिँदैन।";
  if (lang === "bo") return "Booking ཆེད་དུ 50% Advance payment དགོས། ལྷག་མ 50% Check-in ཉིན་ནས་ཉིན 2 ནང་ཚུད་སྤྲོད་དགོས། Payment method ནི Cash, Bank transfer, eSewa, དང Khalti ཡིན། Chat ནང་དུ Payment ལེན་གྱི་མེད།";
  return "For booking, 50% advance payment is required. The remaining 50% should be paid within 2 days of check-in. Payment methods are cash, bank transfer, eSewa, and Khalti. Payment is not accepted inside chat.";
}

function rulesReply(lang: Lang): string {
  if (lang === "ne") return "चेक-इन दिउँसो 2:00 बजेदेखि हो र चेक-आउट बिहान 12:00 बजे अगाडि हो। शान्त समय राति 10:00 बजेदेखि बिहान 7:00 बजेसम्म हो। भित्र धुम्रपान गर्न पाइँदैन, घरपालुवा जनावर ल्याउन पाइँदैन, र पाहुनालाई चेक-इनको बेला मान्य परिचय-पत्र, नागरिकता, वा राहदानी चाहिन्छ।";
  if (lang === "bo") return "Check-in ནི་ཉིན་གུང་ 2:00 ནས་ཡིན་ཞིང Check-out ནི་སྔ་དྲོ 12:00 གོང་ལ་ཡིན་དགོས། Quiet hours ནི་མཚན་མོ 10:00 ནས་སྔ་དྲོ 7:00 བར་ཡིན། ནང་དུ་ཐ་མག་འཐེན་མི་ཆོག ཁྱི་བྱི་སོགས་སེམས་ཅན་ཁྲིད་མི་ཆོག མགྲོན་པོས Check-in སྐབས་ ID, Citizenship, or Passport ཞིག་བཀོལ་དགོས།";
  return "Check-in is from 2:00 PM and check-out is before 12:00 PM. Quiet hours are 10:00 PM to 7:00 AM. Smoking is not allowed inside, pets are not allowed, and guests need a valid ID, citizenship, or passport at check-in.";
}

function discountReply(lang: Lang, text: string): string {
  const rm = ROOM_MATCH[lang];
  if (matchesAny(text, rm.single)) {
    if (lang === "ne") return "महिनावारी बसाइका लागि, Single Studio Room 1 पाहुनाको लागि NPR 37,000 बाट NPR 35,000 सम्म मिलाउन सकिन्छ। अन्तिम स्वीकृति स्टाफ वा मालिकद्वारा हुन्छ।";
    if (lang === "bo") return "ཟླ་རེའི་སྡོད་ཆ་ལ, Single Studio Room མགྲོན་པོ་གཅིག་ལ NPR 37,000 ནས NPR 35,000 བར་འགྱུར་ཐུབ། མཐའ་མའི་ཆོག་མཆན་ནི Staff or Owner ནས་ཡིན།";
    return "For monthly stays, Single Studio may be negotiable from NPR 37,000 to NPR 35,000 if it is for 1 guest. Final approval is by staff or owner.";
  }
  if (matchesAny(text, rm.double)) {
    if (lang === "ne") return "महिनावारी बसाइका लागि, Double Studio Room 3 भन्दा कम पाहुना भएमा NPR 47,000 बाट NPR 45,000 सम्म मिलाउन सकिन्छ। अन्तिम स्वीकृति स्टाफ वा मालिकद्वारा हुन्छ।";
    if (lang === "bo") return "ཟླ་རེའི་སྡོད་ཆ་ལ, Double Studio Room མགྲོན་པོ 3 ལས་ཉུང་ན NPR 47,000 ནས NPR 45,000 བར་འགྱུར་ཐུབ། མཐའ་མའི་ཆོག་མཆན་ནི Staff or Owner ནས་ཡིན།";
    return "For monthly stays, Double Studio may be negotiable from NPR 47,000 to NPR 45,000 if there are fewer than 3 guests. Final approval is by staff or owner.";
  }
  if (matchesAny(text, rm.family)) {
    if (lang === "ne") return "महिनावारी बसाइका लागि, 2BHK Family Room 2-3 पाहुनाको लागि NPR 65,000 बाट NPR 60,000 सम्म, वा 1 पाहुनाको लागि NPR 55,000 सम्म मिलाउन सकिन्छ। अन्तिम स्वीकृति स्टाफ वा मालिकद्वारा हुन्छ।";
    if (lang === "bo") return "ཟླ་རེའི་སྡོད་ཆ་ལ, 2BHK Family Room མགྲོན་པོ 2-3 ལ NPR 65,000 ནས NPR 60,000 བར, ཡང་ན མགྲོན་པོ 1 ལ NPR 55,000 བར་འགྱུར་ཐུབ། མཐའ་མའི་ཆོག་མཆན་ནི Staff or Owner ནས་ཡིན།";
    return "For monthly stays, 2BHK Family Room may be negotiable from NPR 65,000 to NPR 60,000 for 2-3 guests, or NPR 55,000 for 1 guest. Final approval is by staff or owner.";
  }
  if (lang === "ne") return "महिनावारी मूल्य पाहुना संख्या र स्टाफ/मालिकको स्वीकृतिमा निर्भर गरी मिलाउन सकिन्छ। दैनिक मूल्यमा मोलमोलाइ हुँदैन।";
  if (lang === "bo") return "ཟླ་རེའི་གོང་ཚད་ནི་མགྲོན་པོའི་གྲངས་དང Staff/Owner ཆོག་མཆན་ལ་བརྟེན་ནས་འགྱུར་སྲིད། ཉིན་རེའི་གོང་ཚད་ལ་འགྱུར་བ་མེད།";
  return "Monthly prices may be negotiable depending on guest count and staff/owner approval. Daily prices are not negotiable.";
}

function airportReply(lang: Lang): string {
  if (lang === "ne") return `हामी च्याटमा एयरपोर्ट पिकअपको ग्यारेन्टी दिन सक्दैनौं। कृपया पुष्टि गर्न हामीलाई प्रत्यक्ष सम्पर्क गर्नुहोस्। ${CONTACT_LINE.ne}`;
  if (lang === "bo") return `ང་ཚོས Chat ནང་ Airport pickup ངེས་གཏན་བྱེད་མི་ཐུབ། ངེས་པར་དུ ང་ཚོར་འབྲེལ་བ་གནང་རོགས། ${CONTACT_LINE.bo}`;
  return `We cannot promise airport pickup in chat. Please contact us directly to confirm. ${CONTACT_LINE.en}`;
}

function stayTypeReply(lang: Lang): string {
  if (lang === "ne") return "जिकमिस अपार्टमेन्ट छोटो अवधिको बसाइ र लामो अवधिको महिनावारी भाडा दुवैका लागि उपयुक्त छ। कृपया तपाईंको बसाइको अवधि, मिति, र पाहुना संख्या बताउनुहोस् ताकि हामी उत्तम कोठा सुझाव दिन सकौं।";
  if (lang === "bo") return "Jikmis Apartment ནི་སྡོད་ཐུང་དང་ཟླ་རེའི་སྡོད་རིང་གཉིས་ཀ་ལ་འོས་པ་ཡིན། ཁྱེད་ཀྱི་སྡོད་དུས་ཡུན, Date, དང་མགྲོན་པོའི་གྲངས་བཤད་རོགས་ང་ཚོས་ Room ལེགས་ཤོས་འོས་སྦྱོར་ཞུ་ཆོག";
  return "Jikmis Apartment is suitable for both short-term stays and long-term monthly rentals. Please share your stay length, dates, and number of guests so we can suggest the best room.";
}

function humanReply(lang: Lang): string {
  if (lang === "ne") return `अवश्य। ${CONTACT_LINE.ne}`;
  if (lang === "bo") return `ལེགས་སོ། ${CONTACT_LINE.bo}`;
  return `Of course. ${CONTACT_LINE.en}`;
}

export function greetingReply(lang: Lang, knownName?: string | null): string {
  if (lang === "ne") {
    return knownName
      ? `नमस्ते, ${knownName} जी! जिकमिस अपार्टमेन्ट, बौद्धमा फेरि स्वागत छ। म उपलब्धता, मूल्य, बुकिङ, सुविधा, र स्थानको बारेमा सहयोग गर्न सक्छु। आज म तपाईंलाई कसरी सहयोग गर्न सक्छु?`
      : "नमस्ते! जिकमिस अपार्टमेन्ट, बौद्धमा स्वागत छ। म उपलब्धता, मूल्य, बुकिङ, सुविधा, र स्थानको बारेमा सहयोग गर्न सक्छु। आज म तपाईंलाई कसरी सहयोग गर्न सक्छु?";
  }
  if (lang === "bo") {
    return knownName
      ? `བཀྲ་ཤིས་བདེ་ལེགས, ${knownName} ལགས! Jikmis Apartment ལ་ཡང་བསྐྱར་ཕེབས་པར་དགའ་བསུ་ཞུ། ང་ཚོས་ཁང་མིག་སྟོང་ཡོད་མེད་དང་གོང་ཚད, ཐོ་འགོད, ཞབས་ཞུ, ས་གནས་སོགས་ལ་རོགས་རམ་བྱེད་ཐུབ། དེ་རིང་ང་ཚོས་ཁྱེད་ལ་ཇི་ལྟར་རོགས་རམ་བྱེད་དགོས་སམ།`
      : "བཀྲ་ཤིས་བདེ་ལེགས། Jikmis Apartment ལ་ཕེབས་པར་དགའ་བསུ་ཞུ། ང་ཚོས་ཁང་མིག་སྟོང་ཡོད་མེད་དང་། གོང་ཚད། ཐོ་འགོད (booking)། ཞབས་ཞུའི་གྲངས། དེ་བཞིན་ས་གནས་སོགས་ལ་རོགས་རམ་བྱེད་ཐུབ། དེ་རིང་ང་ཚོས་ཁྱེད་ལ་ཇི་ལྟར་རོགས་རམ་བྱེད་དགོས་སམ།";
  }
  return knownName
    ? `Hello, ${knownName}! Welcome back to Jikmis Apartment in Boudha. I can help with availability, pricing, bookings, facilities, and location. How can I help you today?`
    : "Hello! Welcome to Jikmis Apartment in Boudha. I can help with availability, pricing, bookings, facilities, and location. How can I help you today?";
}

/**
 * Main entry point. Detects language by script (see lib/language.ts), then
 * walks the SAME priority-ordered decision tree regardless of language —
 * only the underlying keyword lists and reply text change per language, so
 * the logic itself can never drift out of sync between languages.
 */
export function localReceptionistReply(message: string, knownName?: string | null): { reply: string; lang: Lang } {
  const lang = detectLanguage(message);
  const text = message.toLowerCase();

  const reply = (() => {
    if (isIntent(text, lang, "price") && isAvailabilityQuestion(text, lang)) {
      return `${priceReply(lang, text)} ${availabilityReply(lang, text, true)}`;
    }
    if (isIntent(text, lang, "price") && isIntent(text, lang, "roomDetails")) {
      return `${priceReply(lang, text)} ${roomDetailsReply(lang, text)}`;
    }
    if (isIntent(text, lang, "location") && isIntent(text, lang, "facilities")) {
      return `${locationReply(lang)} ${facilitiesReply(lang)}`;
    }
    if (isAvailabilityQuestion(text, lang)) {
      return availabilityReply(lang, text);
    }
    if (isIntent(text, lang, "greeting")) {
      return greetingReply(lang, knownName);
    }
    if (isIntent(text, lang, "laundry")) {
      return laundryReply(lang, text);
    }
    if (isIntent(text, lang, "contact")) {
      return contactReply(lang);
    }
    if (isIntent(text, lang, "discount")) {
      return discountReply(lang, text);
    }
    if (isIntent(text, lang, "booking")) {
      return matchesAny(text, KEYWORDS[lang].paymentSub) ? paymentReply(lang) : bookingReply(lang);
    }
    if (isIntent(text, lang, "airport")) {
      return airportReply(lang);
    }
    if (isIntent(text, lang, "price")) {
      return priceReply(lang, text);
    }
    if (isIntent(text, lang, "roomDetails")) {
      return roomDetailsReply(lang, text);
    }
    if (isIntent(text, lang, "roomGeneric")) {
      return roomDetailsReply(lang, text);
    }
    if (isIntent(text, lang, "facilities")) {
      return facilitiesReply(lang);
    }
    if (isIntent(text, lang, "location")) {
      return locationReply(lang);
    }
    if (isIntent(text, lang, "rules")) {
      return rulesReply(lang);
    }
    if (isIntent(text, lang, "stayType")) {
      return stayTypeReply(lang);
    }
    if (isIntent(text, lang, "human")) {
      return humanReply(lang);
    }
    return unknownReply(lang);
  })();

  return { reply, lang };
}

// ---------------------------------------------------------------------
// Guest name recognition (best-effort, conservative on purpose — a false
// positive here would put a wrong "name" in the guest's mouth for the rest
// of the conversation, which is worse than not recognizing a name at all).
// Only fires on an explicit self-introduction pattern, not on every message.
// ---------------------------------------------------------------------

const NAME_PATTERNS: Record<Lang, RegExp[]> = {
  en: [
    // No literal "." inside these character classes on purpose: a guest's
    // sentence very often continues right after the name ("My name is
    // Dolma. What's the price...") and "." would otherwise get greedily
    // swallowed into the captured name, running the match past the intended
    // 40-character cap and silently failing extraction entirely — a real
    // bug caught during testing.
    /\bmy name is\s+([A-Za-z][A-Za-z '-]{1,40})/i,
    // Prefix ("i'm"/"this is") is matched case-insensitively via explicit
    // [Ii]/[Tt] — NOT a whole-pattern /i flag, which would also make the
    // [A-Z] capitalized-name check below match lowercase and defeat the
    // point of requiring it (a deliberate, tested distinction — see
    // extractGuestName's "I'm fine" false-positive test).
    /\b[Ii]'?m\s+([A-Z][A-Za-z'-]{1,40})(?=\s|$|[,.])/,
    /\b[Tt]his is\s+([A-Z][A-Za-z'-]{1,40})(?=\s|$|[,.])/
  ],
  ne: [/मेरो नाम\s+([^\s,।]{1,40})/, /म\s+([^\s,।]{1,40})\s+हुँ/],
  bo: [/ངའི་མིང་\s*([^\s,།]{1,40})/, /ང་\s*([^\s,།]{1,40})\s*ཡིན/]
};

const NAME_BLACKLIST = new Set([
  "fine", "good", "great", "ok", "okay", "sorry", "here", "back", "done",
  "ready", "busy", "tired", "happy", "sure", "not", "well", "interested",
  "looking", "trying", "planning", "hoping", "thinking", "glad"
]);

/**
 * Extracts a self-introduced name from a message, or null if none is
 * confidently found. Deliberately conservative: for English, requires a
 * capitalized token right after "I'm"/"this is"/"my name is" and rejects
 * common non-name words (so "I'm fine" or "I'm interested" don't get
 * mistaken for a name). Not a general-purpose NER model — a rule-based
 * heuristic consistent with this project's "never guess" philosophy applied
 * to a lower-stakes feature (misreading a name is embarrassing, not unsafe,
 * so a conservative heuristic — rather than an LLM call — is the right tool).
 */
export function extractGuestName(message: string, lang: Lang): string | null {
  for (const pattern of NAME_PATTERNS[lang]) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;
    const candidate = match[1].trim().replace(/[.,!?]+$/, "");
    if (candidate.length < 2 || candidate.length > 40) continue;
    if (lang === "en") {
      if (NAME_BLACKLIST.has(candidate.toLowerCase())) continue;
      if (!/^[A-Za-z][A-Za-z .'-]*$/.test(candidate)) continue;
      return candidate.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return candidate;
  }
  return null;
}

export function nameAcknowledgment(name: string, lang: Lang): string {
  if (lang === "ne") return `${name} जी, भेटेर खुशी लाग्यो! `;
  if (lang === "bo") return `${name} ལགས, ཐུགས་རྗེ་ཆེ། `;
  return `Nice to meet you, ${name}! `;
}
