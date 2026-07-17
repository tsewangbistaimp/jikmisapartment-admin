/**
 * Guest booking creation logic — both the AI receptionist's conversational
 * slot-filling assistant (handleBookingTurn/finalizeBooking below) AND, as
 * of the public website booking form integration (see createDirectBooking
 * near the bottom of this file), a single-shot, non-conversational path for
 * a guest who fills in every field at once and clicks "Book Now" on
 * app/page.tsx. Both are exactly the kind of high-stakes, structured
 * operation where a guaranteed, never-invents flow is the right tool,
 * consistent with ai-knowledge-base/10_AI_Guidelines.md ("never invent
 * information") — never an LLM.
 *
 * Uses the EXISTING Prisma schema/database (Room, Booking models) via
 * lib/prisma.ts — no parallel booking table or second database is created.
 * Guest (non-authenticated) bookings leave Booking.userId null and are
 * recorded through the guest* fields added to the Booking model instead of
 * requiring a fake user account. This is also what makes "the website and
 * admin dashboard use the same database" concretely true, not just a claim
 * — a booking made through the homepage form shows up in /admin and
 * /admin/calendar immediately, the same Postgres row either page reads.
 */
import { prisma } from "@/lib/prisma";
import { FORMSPREE_ENDPOINT, INQUIRY_EMAIL } from "@/lib/site";
// Plain JS module (see lib/guestMessaging.js for why it isn't TypeScript) —
// sends the booking confirmation email and builds the WhatsApp confirmation
// link, shared with the legacy Express booking path.
import { sendBookingConfirmation } from "@/lib/guestMessaging";
// Shared script-based language detection (see lib/language.ts) — the
// conversational booking flow detects the guest's language once, at the
// moment a booking starts, and carries it in BookingState.lang for every
// subsequent turn so prompts stay in the same language throughout. See
// lib/receptionistReplies.ts for the equivalent translation for general
// (non-booking) Q&A, including the same Tibetan/Romanized-Nepali caveats.
import { type Lang, detectLanguage } from "@/lib/language";

export type BookingStep =
  | "roomType"
  | "checkIn"
  | "checkOut"
  | "guests"
  | "fullName"
  | "phone"
  | "whatsapp"
  | "email"
  | "specialRequests"
  | "confirm";

export type BookingSlots = {
  roomTypeQuery?: string;
  roomId?: string;
  roomTitle?: string;
  pricePerNight?: number;
  maxGuests?: number;
  checkIn?: string; // ISO yyyy-mm-dd
  checkOut?: string; // ISO yyyy-mm-dd
  guests?: number;
  capacityNote?: string;
  fullName?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  specialRequests?: string;
  nights?: number;
  totalPrice?: number;
};

export type BookingState = {
  step: BookingStep;
  slots: BookingSlots;
  // Detected once, from whichever message started this booking flow, and
  // carried unchanged for the rest of the flow (see handleBookingTurn).
  // Defaults to "en" for older client-carried state that predates this
  // field, so existing in-flight bookings don't break.
  lang: Lang;
};

export type BookingTurnResult = {
  reply: string;
  state: BookingState | null; // null once the flow finishes (booked or cancelled) or was never started
  bookingId?: string;
  // Pre-filled wa.me confirmation link, present only right when a booking is
  // created. The client auto-opens this in a new tab — see
  // components/ApartmentChatbot.tsx and lib/guestMessaging.js for context on
  // why this is a link the guest sends themselves, not a silent server push.
  whatsappUrl?: string | null;
};

// Mirrors ai-knowledge-base/03_Pricing.md / prisma/seed.js. Used only if the
// database is unreachable when the room list is needed, so the flow can
// still ask guests which room they want rather than failing outright.
const FALLBACK_ROOM_TYPES = [
  { title: "Single Studio Room", pricePerNight: 1500, maxGuests: 2 },
  { title: "Double Studio Room", pricePerNight: 2500, maxGuests: 3 },
  { title: "Family Room", pricePerNight: 4000, maxGuests: 5 }
];

const ROOM_TYPE_ALIASES: { match: string[]; title: string }[] = [
  { match: ["single", "सिंगल"], title: "Single Studio Room" },
  { match: ["double", "डबल"], title: "Double Studio Room" },
  { match: ["family", "2bhk", "2 bhk", "फ्यामिली", "पारिवारिक"], title: "Family Room" }
];

const START_BOOKING_PHRASES: Record<Lang, string[]> = {
  en: [
    "book a room",
    "book the",
    "i want to book",
    "i'd like to book",
    "id like to book",
    "i want to reserve",
    "i'd like to reserve",
    "make a reservation",
    "make a booking",
    "reserve a room",
    "reserve the",
    "book now",
    "start a booking",
    "start booking",
    "let's book",
    "lets book"
  ],
  // Common Devanagari phrasings for "I want to book" / "reserve a room" /
  // "let's book now". Not exhaustive — see lib/language.ts's Romanized-Nepali
  // caveat, which applies here too.
  ne: [
    "बुक गर्न चाहन्छु",
    "बुकिङ गर्न चाहन्छु",
    "आरक्षण गर्न चाहन्छु",
    "बुक गर्ने",
    "बुकिङ सुरु गरौं",
    "अहिले बुक गर्छु",
    "कोठा बुक गर्नुपर्छ"
  ],
  bo: ["booking བྱེད་འདོད", "ད་ལྟ Book བྱེད་འདོད", "Booking འགོ་འཛུགས", "ཁང་མིག་ Book བྱེད་འདོད"]
};

export function isStartBookingIntent(message: string): boolean {
  const lang = detectLanguage(message);
  const text = lang === "en" ? message.toLowerCase() : message;
  return START_BOOKING_PHRASES[lang].some((phrase) => text.includes(phrase));
}

async function listRoomChoices(): Promise<{ title: string; pricePerNight: number; maxGuests: number }[]> {
  try {
    const rooms = await prisma.room.findMany({
      where: { isAvailable: true },
      orderBy: { pricePerNight: "asc" },
      select: { title: true, pricePerNight: true, maxGuests: true }
    });
    if (rooms.length > 0) return rooms;
    return FALLBACK_ROOM_TYPES;
  } catch {
    return FALLBACK_ROOM_TYPES;
  }
}

function matchRoomType(text: string): string | null {
  const lower = text.toLowerCase();
  for (const alias of ROOM_TYPE_ALIASES) {
    if (alias.match.some((m) => lower.includes(m))) return alias.title;
  }
  return null;
}

// Formats using local calendar fields, NOT toISOString() (which converts to
// UTC first and can silently shift the date by a day depending on the
// server's timezone offset — a real bug caught during testing).
function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];

/** Best-effort natural-language date parser for common guest phrasing. Returns null (never a guess) if it can't confidently parse a date. */
function parseDate(text: string, today: Date): string | null {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === "today") return toIso(today);
  if (trimmed === "tomorrow") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return toIso(d);
  }

  const iso = trimmed.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return toIso(d);
  }

  const dmy = trimmed.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!Number.isNaN(d.getTime())) return toIso(d);
  }

  const dayMonth = trimmed.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const monthIdx = MONTH_NAMES.findIndex((m) => m.startsWith(dayMonth[2]));
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      const year = dayMonth[3] ? Number(dayMonth[3]) : today.getFullYear();
      let d = new Date(year, monthIdx, day);
      if (!dayMonth[3] && d < today) d = new Date(year + 1, monthIdx, day);
      if (!Number.isNaN(d.getTime())) return toIso(d);
    }
  }

  const monthDay = trimmed.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  if (monthDay) {
    const monthIdx = MONTH_NAMES.findIndex((m) => m.startsWith(monthDay[1]));
    const day = Number(monthDay[2]);
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      const year = monthDay[3] ? Number(monthDay[3]) : today.getFullYear();
      let d = new Date(year, monthIdx, day);
      if (!monthDay[3] && d < today) d = new Date(year + 1, monthIdx, day);
      if (!Number.isNaN(d.getTime())) return toIso(d);
    }
  }

  return null;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?977[-\s]?)?9\d{9}|\+?\d[\d\-\s]{7,14}\d/;

function extractPhone(text: string): string | null {
  const match = text.match(PHONE_REGEX);
  return match ? match[0].replace(/[\s-]/g, "") : null;
}

function extractEmail(text: string): string | null {
  const match = text.match(EMAIL_REGEX);
  return match ? match[0] : null;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  const nights = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  return Math.max(nights, 0);
}

function formatCurrency(amount: number): string {
  return `NPR ${amount.toLocaleString("en-US")}`;
}

// Statuses that still "occupy" a room for conflict-checking purposes.
// CHECKED_OUT and CANCELLED bookings free up the room. Kept in sync with
// server/src/services/bookingService.js's OCCUPYING_STATUSES.
const OCCUPYING_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"];

/**
 * Counts overlapping occupying bookings for a room against its totalUnits.
 * This generalizes the legacy single-unit conflict check
 * (server/src/services/bookingService.js hasBookingConflict) to properties
 * with multiple physical units of the same room type (Jikmis Apartment has
 * 2 Single Studio and 2 Double Studio units sharing one Room record each).
 */
async function countOverlappingBookings(roomId: string, checkIn: string, checkOut: string): Promise<number> {
  return prisma.booking.count({
    where: {
      roomId,
      status: { in: OCCUPYING_STATUSES },
      checkIn: { lt: new Date(`${checkOut}T00:00:00`) },
      checkOut: { gt: new Date(`${checkIn}T00:00:00`) }
    }
  });
}

async function checkRoomAvailability(
  roomId: string,
  totalUnits: number,
  checkIn: string,
  checkOut: string
): Promise<boolean> {
  const overlapping = await countOverlappingBookings(roomId, checkIn, checkOut);
  return overlapping < totalUnits;
}

/**
 * Formats one room choice line, e.g. "Single Studio Room (NPR 1,500/night,
 * up to 2 guests)". Room proper nouns and currency stay identical across
 * languages (see lib/receptionistReplies.ts's header comment for why); only
 * the surrounding "/night, up to N guests" phrasing is translated.
 */
function formatRoomChoice(lang: Lang, room: { title: string; pricePerNight: number; maxGuests: number }): string {
  const price = formatCurrency(room.pricePerNight);
  if (lang === "ne") return `${room.title} (${price}/रात, बढीमा ${room.maxGuests} पाहुना)`;
  if (lang === "bo") return `${room.title} (${price}/མཚན་མོ་རེར, མགྲོན་པོ མང་མཐའ་ ${room.maxGuests})`;
  return `${room.title} (${price}/night, up to ${room.maxGuests} guests)`;
}

function formatRoomChoicesText(lang: Lang, choices: { title: string; pricePerNight: number; maxGuests: number }[]): string {
  return choices.map((r) => formatRoomChoice(lang, r)).join("; ");
}

function questionFor(lang: Lang, step: BookingStep, slots: BookingSlots, roomChoicesText?: string): string {
  const choices = roomChoicesText ?? "Single Studio, Double Studio, or Family Room";
  switch (step) {
    case "roomType":
      if (lang === "ne") return `बुकिङमा सहयोग गर्न पाउँदा खुशी लाग्छ। तपाईं कुन कोठा रोज्नुहुन्छ: ${choices}?`;
      if (lang === "bo") return `ཁྱེད་ཀྱི Booking ལ་རོགས་རམ་བྱེད་པར་དགའ། ཁྱེད་ཀྱིས་ཁང་མིག་གང་འདོད: ${choices}?`;
      return `I'd love to help you book. Which room would you like: ${choices}?`;
    case "checkIn":
      if (lang === "ne") return "तपाईंको चेक-इन मिति के हो? (उदाहरण: 2026-07-20 वा 20 July)";
      if (lang === "bo") return "ཁྱེད་ཀྱི Check-in Date ག་རེ་རེད། (དཔེར་ན 2026-07-20 ཡང་ན 20 July)";
      return "What's your check-in date? (for example, 2026-07-20 or 20 July)";
    case "checkOut":
      if (lang === "ne") return "र तपाईंको चेक-आउट मिति नि?";
      if (lang === "bo") return "ཁྱེད་ཀྱི Check-out Date ག་རེ་རེད།";
      return "And your check-out date?";
    case "guests":
      if (lang === "ne") return "कति जना पाहुना बस्नुहुन्छ?";
      if (lang === "bo") return "མགྲོན་པོ ག་ཚོད་བསྡད་ཀྱི་རེད།";
      return "How many guests will be staying?";
    case "fullName":
      if (lang === "ne") return "अगाडि बढ्न तपाईंको पूरा नाम पाउन सक्छु?";
      if (lang === "bo") return "མུ་མཐུད་ཆེད་ཁྱེད་ཀྱི་མིང་ཚང་ཞིག་སྤྲོད་རོགས།";
      return "Could I get your full name to continue?";
    case "phone":
      if (lang === "ne") return `धन्यवाद${slots.fullName ? `, ${slots.fullName}` : ""}! तपाईंलाई सम्पर्क गर्न उत्तम फोन नम्बर के हो?`;
      if (lang === "bo") return `ཐུགས་རྗེ་ཆེ${slots.fullName ? `, ${slots.fullName}` : ""}! ཁྱེད་ལ་འབྲེལ་བ་བྱེད་ས་ཡག་ཤོས་ཀྱི་ཁ་པར་ཨང་གྲངས་ག་རེ་རེད།`;
      return `Thanks${slots.fullName ? `, ${slots.fullName}` : ""}! What's the best phone number to reach you on?`;
    case "whatsapp":
      if (lang === "ne") return "र तपाईंको व्हाट्सएप नम्बर नि? (फोन नम्बरसँगै भए \"same\" भनेर जवाफ दिनुहोस्)";
      if (lang === "bo") return "ཁྱེད་ཀྱི WhatsApp ཨང་གྲངས་ག་རེ་རེད། (ཁ་པར་ཨང་གྲངས་དང་གཅིག་པ་ཡིན་ན \"same\" ཞེས་ལན་སྤྲོད་རོགས)";
      return "And your WhatsApp number? (reply \"same\" if it's the same as your phone number)";
    case "email":
      if (lang === "ne") return "तपाईंको इमेल ठेगाना के हो? हामी त्यहाँ पनि तपाईंको बुकिङ विवरण पठाउनेछौं।";
      if (lang === "bo") return "ཁྱེད་ཀྱི Email ཁ་བྱང་ག་རེ་རེད། ང་ཚོས་ཁྱེད་ཀྱི Booking Details དེར་ཡང་བཏང་ཆོག";
      return "What's your email address? We'll send your booking details there too.";
    case "specialRequests":
      if (lang === "ne") return "तपाईंको बसाइका लागि कुनै विशेष अनुरोध छ? (नभए \"none\" भन्नुहोस्)";
      if (lang === "bo") return "ཁྱེད་ཀྱི་སྡོད་སྐབས་ Special request གང་ཡང་ཡོད་དམ། (མེད་ན \"none\" ཞེས་ལན་སྤྲོད)";
      return "Any special requests for your stay? (or just say \"none\")";
    case "confirm":
      return buildConfirmationSummary(lang, slots);
    default:
      if (lang === "ne") return "के तपाईं मलाई थप बताउन सक्नुहुन्छ?";
      if (lang === "bo") return "ཁྱེད་ཀྱིས་ང་ལ་ཅུང་ཟད་མང་བ་བཤད་ཐུབ་བམ།";
      return "Could you tell me a bit more?";
  }
}

function buildConfirmationSummary(lang: Lang, slots: BookingSlots): string {
  const price = formatCurrency(slots.totalPrice ?? 0);
  const lines: string[] =
    lang === "ne"
      ? [
          `यहाँ तपाईंको बुकिङ अनुरोध छ: ${slots.roomTitle}, ${slots.checkIn} देखि ${slots.checkOut} सम्म (${slots.nights} रात), ${slots.guests} पाहुनाको लागि।`,
          `जम्मा: ${price}। 50% अग्रिम भुक्तानीले बुकिङ पुष्टि गर्छ, बाँकी चेक-इनको 2 दिनभित्र तिर्नुपर्छ (नगद, बैंक ट्रान्सफर, eSewa, वा Khalti)।`
        ]
      : lang === "bo"
        ? [
            `ཁྱེད་ཀྱི Booking Request འདི་རེད: ${slots.roomTitle}, ${slots.checkIn} ནས ${slots.checkOut} བར (མཚན་མོ ${slots.nights}), མགྲོན་པོ ${slots.guests}`,
            `Total: ${price}. 50% Advance payment གྱིས Booking ངོས་འཛིན་བྱེད་ཅིང་, ལྷག་མ Check-in ཉིན་ནས་ཉིན 2 ནང་ཚུད་སྤྲོད་དགོས (Cash, Bank transfer, eSewa, or Khalti).`
          ]
        : [
            `Here's your booking request: ${slots.roomTitle} from ${slots.checkIn} to ${slots.checkOut} (${slots.nights} night${slots.nights === 1 ? "" : "s"}), for ${slots.guests} guest${slots.guests === 1 ? "" : "s"}.`,
            `Total: ${price}. A 50% advance payment confirms the booking, with the rest due within 2 days of check-in (cash, bank transfer, eSewa, or Khalti).`
          ];

  if (slots.capacityNote) lines.push(slots.capacityNote);
  if (slots.specialRequests) {
    if (lang === "ne") lines.push(`विशेष अनुरोध नोट गरियो: ${slots.specialRequests}।`);
    else if (lang === "bo") lines.push(`Special request ཟིན་བྲིས་བྱས: ${slots.specialRequests}`);
    else lines.push(`Special request noted: ${slots.specialRequests}.`);
  }
  if (lang === "ne") lines.push("के म यो बुकिङ अनुरोध पुष्टि गरूँ? (yes/no)");
  else if (lang === "bo") lines.push("ང་ Booking Request འདི་ངོས་འཛིན་བྱེད་དགོས་སམ། (yes/no)");
  else lines.push("Shall I confirm this booking request? (yes/no)");
  return lines.join(" ");
}

async function handleRoomTypeStep(lang: Lang, text: string, slots: BookingSlots): Promise<{ reply: string; slots: BookingSlots; step: BookingStep }> {
  const matchedTitle = matchRoomType(text);
  const choices = await listRoomChoices();

  if (!matchedTitle) {
    const choicesText = formatRoomChoicesText(lang, choices);
    const reply =
      lang === "ne"
        ? `मैले बुझिनँ तपाईं कुन कोठा चाहनुहुन्छ। विकल्पहरू: ${choicesText}। तपाईं कुन रोज्नुहुन्छ?`
        : lang === "bo"
          ? `ཁྱེད་ཀྱིས་ཁང་མིག་གང་འདོད་ང་ལ་གོ་མ་སོང༌། Options: ${choicesText}. ཁྱེད་ཀྱིས་གང་འདོད།`
          : `I didn't catch which room you'd like. Options: ${choicesText}. Which one would you like?`;
    return { reply, slots, step: "roomType" };
  }

  const chosen = choices.find((r) => r.title === matchedTitle) ?? FALLBACK_ROOM_TYPES.find((r) => r.title === matchedTitle);
  const updatedSlots: BookingSlots = {
    ...slots,
    roomTypeQuery: text,
    roomTitle: matchedTitle,
    pricePerNight: chosen?.pricePerNight,
    maxGuests: chosen?.maxGuests
  };
  return { reply: questionFor(lang, "checkIn", updatedSlots), slots: updatedSlots, step: "checkIn" };
}

function handleDateStep(
  lang: Lang,
  step: "checkIn" | "checkOut",
  text: string,
  slots: BookingSlots
): { reply: string; slots: BookingSlots; step: BookingStep } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parsed = parseDate(text, today);

  if (!parsed) {
    const reply =
      lang === "ne"
        ? "मैले त्यो मिति ठ्याक्कै बुझिनँ — के तपाईं यसरी दिन सक्नुहुन्छ: 2026-07-20 वा 20 July?"
        : lang === "bo"
          ? "ཐང་དེ་ང་ལ་ལེགས་པོར་གོ་མ་སོང་ — 2026-07-20 ཡང་ན 20 July ལྟ་བུ་སྤྲོད་རོགས་ཐུབ་བམ།"
          : "I couldn't quite read that date — could you share it like 2026-07-20 or 20 July?";
    return { reply, slots, step };
  }

  if (step === "checkIn") {
    if (parsed < toIso(today)) {
      const reply =
        lang === "ne"
          ? "त्यो चेक-इन मिति पहिले नै बितिसकेको छ — के तपाईं आजदेखि पछिको चेक-इन मिति दिन सक्नुहुन्छ?"
          : lang === "bo"
            ? "Check-in Date དེ་ཧེ་བག་འདས་ཟིན། དེ་རིང་ནས་བཟུང་གི Check-in Date ཞིག་སྤྲོད་རོགས་ཐུབ་བམ།"
            : "That check-in date has already passed — could you share a check-in date from today onward?";
      return { reply, slots, step };
    }
    const updated = { ...slots, checkIn: parsed };
    return { reply: questionFor(lang, "checkOut", updated), slots: updated, step: "checkOut" };
  }

  if (slots.checkIn && parsed <= slots.checkIn) {
    const reply =
      lang === "ne"
        ? "चेक-आउट तपाईंको चेक-इन मितिपछि हुनुपर्छ — तपाईं कुन मितिमा चेक-आउट गर्नुहुन्छ?"
        : lang === "bo"
          ? "Check-out ནི Check-in Date གི་རྗེས་སུ་ཡིན་དགོས — ཁྱེད་ Check-out ག་དུས་བྱེད་ཀྱི་རེད།"
          : "Check-out needs to be after your check-in date — what date will you be checking out?";
    return { reply, slots, step };
  }

  const updated = { ...slots, checkOut: parsed };
  return { reply: questionFor(lang, "guests", updated), slots: updated, step: "guests" };
}

async function handleGuestsStep(lang: Lang, text: string, slots: BookingSlots): Promise<{ reply: string; slots: BookingSlots; step: BookingStep }> {
  const match = text.match(/\d+/);
  const guests = match ? Number(match[0]) : NaN;

  if (!Number.isFinite(guests) || guests < 1 || guests > 20) {
    const reply =
      lang === "ne"
        ? "कति जना पाहुना बस्नुहुन्छ? (केवल संख्या भए पुग्छ)"
        : lang === "bo"
          ? "མགྲོན་པོ ག་ཚོད་བསྡད་ཀྱི་རེད། (Number གཅིག་པུ་ཆོག)"
          : "How many guests will be staying? (just the number is fine)";
    return { reply, slots, step: "guests" };
  }

  let updated: BookingSlots = { ...slots, guests };
  if (updated.maxGuests && guests > updated.maxGuests) {
    updated.capacityNote =
      lang === "ne"
        ? `नोट: ${updated.roomTitle} ले सामान्यतया ${updated.maxGuests} पाहुनासम्म अटाउँछ — तपाईंको पूरा समूहको लागि हाम्रो टिमले व्यवस्था पुष्टि गर्नेछ।`
        : lang === "bo"
          ? `ཟུར་བརྗོད: ${updated.roomTitle} ཡིས་མགྲོན་པོ ${updated.maxGuests} བར་ཡག་པོར་འཁྱུད་ཐུབ — ཁྱེད་ཀྱི Group ཆེད་ང་ཚོའི Team གྱིས་གོ་སྒྲིག་ངོས་འཛིན་བྱེད་ཆོག`
          : `Note: ${updated.roomTitle} comfortably fits up to ${updated.maxGuests} guests — our team will confirm arrangements for your full group.`;
  }

  // Resolve the actual Room record and run the real availability check now,
  // before collecting any personal details, so guests never fill out contact
  // info for a room that turns out to be unavailable for their dates.
  let room = null;
  try {
    room = await prisma.room.findFirst({ where: { title: updated.roomTitle } });
  } catch {
    room = null;
  }

  if (!room) {
    const reply =
      lang === "ne"
        ? `${updated.roomTitle} को लागि अहिले लाइभ उपलब्धता जाँच गर्न समस्या भइरहेको छ — म यो हाम्रो टिमबाट प्रत्यक्ष पुष्टि गराउँछु। कृपया 9708538395 / 9869035191 मा व्हाट्सएप वा कल गर्नुहोस्, वा ${INQUIRY_EMAIL} मा इमेल गर्नुहोस्।`
        : lang === "bo"
          ? `${updated.roomTitle} ཆེད་ད་ལྟ Live Availability ཞིབ་བཤེར་བྱེད་པར་དཀའ་ངལ་འཕྲད་སོང་ — ང་ཚོའི Team ལ་ངོས་འཛིན་ངེས་གཏན་བྱེད་དུ་འཇུག 9708538395 / 9869035191 ཐོག WhatsApp or Call, ཡང་ན ${INQUIRY_EMAIL} ལ Email གནང་རོགས།`
          : `I'm having trouble checking live availability for the ${updated.roomTitle} right now — let me have our team confirm it directly. Please WhatsApp or call 9708538395 / 9869035191, or email ${INQUIRY_EMAIL}.`;
    return { reply, slots: {}, step: "roomType" };
  }

  const checkIn = updated.checkIn!;
  const checkOut = updated.checkOut!;
  const available = await checkRoomAvailability(room.id, room.totalUnits, checkIn, checkOut);

  if (!available) {
    const reply =
      lang === "ne"
        ? `माफ गर्नुहोस्, ${updated.roomTitle} ${checkIn} देखि ${checkOut} सम्मको लागि पहिले नै पूरा बुक भइसकेको छ। तपाईं फरक मिति वा फरक कोठा प्रकार प्रयास गर्न चाहनुहुन्छ?`
        : lang === "bo"
          ? `དགོངས་དག, ${updated.roomTitle} ${checkIn} ནས ${checkOut} བར་ Fully Booked ཡིན། Date གཞན་ནམ Room type གཞན་ཞིག་བརྟག་དཔྱད་བྱེད་དགོས་སམ།`
          : `I'm sorry, the ${updated.roomTitle} is already fully booked for ${checkIn} to ${checkOut}. Would you like to try different dates, or a different room type?`;
    return { reply, slots: {}, step: "roomType" };
  }

  const nights = nightsBetween(checkIn, checkOut);
  const totalPrice = nights * room.pricePerNight;
  updated = {
    ...updated,
    roomId: room.id,
    roomTitle: room.title,
    pricePerNight: room.pricePerNight,
    nights,
    totalPrice
  };

  const priceText = formatCurrency(totalPrice);
  const preview =
    lang === "ne"
      ? `राम्रो खबर — ${room.title} ${checkIn} देखि ${checkOut} सम्म उपलब्ध छ (${nights} रात)। यसको जम्मा ${priceText} हुन्छ।`
      : lang === "bo"
        ? `Good news — ${room.title} ${checkIn} ནས ${checkOut} བར་སྟོང་ཡོད (མཚན་མོ ${nights})། Total: ${priceText}.`
        : `Good news — the ${room.title} is available for ${checkIn} to ${checkOut} (${nights} night${nights === 1 ? "" : "s"}). That comes to ${priceText} in total.`;
  return { reply: `${preview} ${questionFor(lang, "fullName", updated)}`, slots: updated, step: "fullName" };
}

function handleFullNameStep(lang: Lang, text: string, slots: BookingSlots): { reply: string; slots: BookingSlots; step: BookingStep } {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 80) {
    const reply =
      lang === "ne"
        ? "बुकिङको लागि तपाईंको पूरा नाम दिन सक्नुहुन्छ?"
        : lang === "bo"
          ? "Booking ཆེད་ཁྱེད་ཀྱི་མིང་ཚང་སྤྲོད་རོགས་ཐུབ་བམ།"
          : "Could you share your full name for the booking?";
    return { reply, slots, step: "fullName" };
  }
  const updated = { ...slots, fullName: trimmed };
  return { reply: questionFor(lang, "phone", updated), slots: updated, step: "phone" };
}

function handlePhoneStep(lang: Lang, text: string, slots: BookingSlots): { reply: string; slots: BookingSlots; step: BookingStep } {
  const phone = extractPhone(text);
  if (!phone) {
    const reply =
      lang === "ne"
        ? "त्यो मान्य फोन नम्बर जस्तो देखिँदैन — फेरि दिन सक्नुहुन्छ?"
        : lang === "bo"
          ? "དེ Valid Phone Number ལྟ་བུ་མིན་འདྲ — ཡང་བསྐྱར་སྤྲོད་རོགས་ཐུབ་བམ།"
          : "That doesn't look like a valid phone number — could you share it again?";
    return { reply, slots, step: "phone" };
  }
  const updated = { ...slots, phone };
  return { reply: questionFor(lang, "whatsapp", updated), slots: updated, step: "whatsapp" };
}

const WHATSAPP_SAME_WORDS: Record<Lang, string[]> = {
  en: ["same", "same number", "same as phone", "yes"],
  ne: ["same", "उस्तै", "फोन जस्तै", "फोनजस्तै"],
  bo: ["same"]
};

function handleWhatsappStep(lang: Lang, text: string, slots: BookingSlots): { reply: string; slots: BookingSlots; step: BookingStep } {
  const lower = lang === "en" ? text.trim().toLowerCase() : text.trim();
  let whatsapp: string | null = null;
  if (WHATSAPP_SAME_WORDS[lang].includes(lower)) {
    whatsapp = slots.phone ?? null;
  } else {
    whatsapp = extractPhone(text);
  }
  if (!whatsapp) {
    const reply =
      lang === "ne"
        ? "तपाईंको व्हाट्सएप नम्बर दिन सक्नुहुन्छ, वा फोन नम्बर नै प्रयोग गर्न \"same\" भन्नुहोस्?"
        : lang === "bo"
          ? "ཁྱེད་ཀྱི WhatsApp ཨང་གྲངས་སྤྲོད་རོགས, ཡང་ན ཁ་པར་ཨང་གྲངས་བེད་སྤྱོད་ཆེད \"same\" ཞེས་ལན་སྤྲོད།"
          : "Could you share your WhatsApp number, or reply \"same\" to use your phone number?";
    return { reply, slots, step: "whatsapp" };
  }
  const updated = { ...slots, whatsapp };
  return { reply: questionFor(lang, "email", updated), slots: updated, step: "email" };
}

function handleEmailStep(lang: Lang, text: string, slots: BookingSlots): { reply: string; slots: BookingSlots; step: BookingStep } {
  const email = extractEmail(text);
  if (!email) {
    const reply =
      lang === "ne"
        ? "त्यो मान्य इमेल ठेगाना जस्तो देखिँदैन — फेरि दिन सक्नुहुन्छ?"
        : lang === "bo"
          ? "དེ Valid Email ལྟ་བུ་མིན་འདྲ — ཡང་བསྐྱར་སྤྲོད་རོགས་ཐུབ་བམ།"
          : "That doesn't look like a valid email address — could you share it again?";
    return { reply, slots, step: "email" };
  }
  const updated = { ...slots, email };
  return { reply: questionFor(lang, "specialRequests", updated), slots: updated, step: "specialRequests" };
}

const NONE_PATTERNS: Record<Lang, RegExp> = {
  en: /^(none|no|n\/a|skip|nothing)$/i,
  ne: /^(none|छैन|केही छैन|होइन|skip)$/i,
  bo: /^(none|མེད)$/i
};

function handleSpecialRequestsStep(lang: Lang, text: string, slots: BookingSlots): { reply: string; slots: BookingSlots; step: BookingStep } {
  const trimmed = text.trim();
  const isNone = NONE_PATTERNS[lang].test(trimmed);
  const updated = { ...slots, specialRequests: isNone ? undefined : trimmed.slice(0, 400) };
  return { reply: questionFor(lang, "confirm", updated), slots: updated, step: "confirm" };
}

// Finds an existing Guest record to link this booking to (matched by phone,
// falling back to email), or creates a new one. Guest is a deduplicated
// identity separate from Booking's own guestName/guestPhone/etc. snapshot
// fields (see prisma/schema.prisma's Guest model comment) — this only ever
// enriches a matched Guest's missing contact fields, never overwrites ones
// it already has, and never touches the booking's own snapshot fields
// either way. Mirrored in server/src/services/bookingService.js's
// findOrCreateGuest for the legacy/admin-manual paths — kept in sync
// manually, same pattern as OCCUPYING_STATUSES/countOverlappingBookings.
async function findOrCreateGuest(slots: BookingSlots): Promise<string | null> {
  if (!slots.phone && !slots.email) return null;
  try {
    const existing = await prisma.guest.findFirst({
      where: slots.phone ? { phone: slots.phone } : { email: slots.email }
    });
    if (existing) {
      const updates: { whatsapp?: string; email?: string } = {};
      if (!existing.whatsapp && slots.whatsapp) updates.whatsapp = slots.whatsapp;
      if (!existing.email && slots.email) updates.email = slots.email;
      if (Object.keys(updates).length > 0) {
        await prisma.guest.update({ where: { id: existing.id }, data: updates });
      }
      return existing.id;
    }
    const created = await prisma.guest.create({
      data: { name: slots.fullName ?? "Guest", phone: slots.phone, whatsapp: slots.whatsapp, email: slots.email }
    });
    return created.id;
  } catch (error) {
    // A Guest-matching failure must never block the booking itself — the
    // booking still records the guest* snapshot fields regardless.
    console.error("[bookingAssistant] Guest lookup/create failed (booking still proceeds without a linked Guest):", error);
    return null;
  }
}

// Logs one Notification row per channel (email, whatsapp_link) for a guest
// messaging attempt, using the {emailResult, whatsappUrl, contact} shape
// every lib/guestMessaging.js send* function returns. This is a pure audit
// log, separate from Booking's confirmationSentAt/reminderSentAt/
// thankYouSentAt idempotency timestamps — see prisma/schema.prisma's
// Notification model comment. Mirrored in
// server/src/services/bookingService.js and app/api/cron/send-reminders/
// route.ts for the other places messaging is sent from.
async function logNotifications(
  bookingId: string,
  type: string,
  messageResult: { emailResult: { sent: boolean; reason?: string }; whatsappUrl: string | null; contact: { email: string | null; whatsapp: string | null } }
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        bookingId,
        type,
        channel: "email",
        recipient: messageResult.contact.email,
        status: messageResult.emailResult.sent ? "sent" : messageResult.emailResult.reason ?? "failed"
      }
    });
    if (messageResult.contact.whatsapp) {
      await prisma.notification.create({
        data: {
          bookingId,
          type,
          channel: "whatsapp_link",
          recipient: messageResult.contact.whatsapp,
          status: messageResult.whatsappUrl ? "sent" : "failed"
        }
      });
    }
  } catch (error) {
    // Logging failures must never mask that the underlying message itself
    // was already sent/attempted — this is best-effort audit trail only.
    console.error(`[bookingAssistant] Failed to log "${type}" notification:`, error);
  }
}

async function finalizeBooking(lang: Lang, slots: BookingSlots): Promise<{ reply: string; bookingId?: string; whatsappUrl?: string | null }> {
  if (!slots.roomId || !slots.checkIn || !slots.checkOut || !slots.totalPrice) {
    const reply =
      lang === "ne"
        ? "यो बुकिङ पूरा गर्न केही कुरा छुटेको छ — फेरि सुरु गरौं। जरुरी भए कृपया 9708538395 / 9869035191 मा व्हाट्सएप वा कल गर्नुहोस्।"
        : lang === "bo"
          ? "Booking འདི Finalize བྱེད་ཆེད་ཅིག་ལོག་ཡོད — ཡང་བསྐྱར་འགོ་འཛུགས་ཡ། Urgent ཡིན་ན 9708538395 / 9869035191 ཐོག WhatsApp or Call གནང་རོགས།"
          : "Something's missing to finalize this booking — let's start over. Please WhatsApp or call 9708538395 / 9869035191 if it's urgent.";
    return { reply };
  }

  try {
    // Re-check availability right before writing, in case another booking
    // was confirmed while this guest was filling in their details.
    const room = await prisma.room.findUnique({ where: { id: slots.roomId } });
    if (!room) throw new Error("Room no longer exists");

    const stillAvailable = await checkRoomAvailability(room.id, room.totalUnits, slots.checkIn, slots.checkOut);
    if (!stillAvailable) {
      const reply =
        lang === "ne"
          ? `माफ गर्नुहोस् — ${slots.roomTitle} ती मितिका लागि अर्को पाहुनाले भर्खरै बुक गरिसक्नुभयो। तपाईं फरक मिति वा फरक कोठा प्रकार प्रयास गर्न चाहनुहुन्छ?`
          : lang === "bo"
            ? `དགོངས་དག — ${slots.roomTitle} Date དེ་དག་ཆེད་མགྲོན་པོ་གཞན་ཞིག་གིས་ད་ལྟ Book བྱས་ཟིན། Date གཞན་ནམ་ Room type གཞན་ཞིག་བརྟག་དཔྱད་བྱེད་དགོས་སམ།`
            : `I'm sorry — the ${slots.roomTitle} was just booked for those dates by another guest. Would you like to try different dates or another room type?`;
      return { reply };
    }

    const guestId = await findOrCreateGuest(slots);

    const booking = await prisma.booking.create({
      data: {
        roomId: room.id,
        userId: null,
        guestId,
        guestName: slots.fullName,
        guestPhone: slots.phone,
        guestWhatsapp: slots.whatsapp,
        guestEmail: slots.email,
        specialRequests: slots.specialRequests ?? null,
        channel: "ai_chat",
        checkIn: new Date(`${slots.checkIn}T00:00:00`),
        checkOut: new Date(`${slots.checkOut}T00:00:00`),
        totalPrice: slots.totalPrice,
        guestCount: slots.guests ?? 1,
        status: "PENDING"
      }
    });

    await notifyTeam(slots, booking.id);

    // Send the guest their confirmation email + build a pre-filled WhatsApp
    // confirmation link (see lib/guestMessaging.js for what this can and
    // can't do automatically). Never let a messaging failure undo or mask
    // the fact that the booking itself was created successfully.
    let whatsappUrl: string | null = null;
    try {
      const bookingWithRoom = await prisma.booking.findUnique({ where: { id: booking.id }, include: { room: true } });
      if (bookingWithRoom) {
        const messageResult = await sendBookingConfirmation(bookingWithRoom);
        whatsappUrl = messageResult.whatsappUrl ?? null;
        await prisma.booking.update({ where: { id: booking.id }, data: { confirmationSentAt: new Date() } });
        await logNotifications(booking.id, "booking_confirmation", messageResult);
      }
    } catch (messagingError) {
      console.error("[bookingAssistant] Confirmation messaging failed (booking still created):", messagingError);
    }

    const price = formatCurrency(slots.totalPrice);
    const reply =
      lang === "ne"
        ? [
            `सबै तयार छ — बुकिङ अनुरोध पुष्टि भयो! सन्दर्भ: ${booking.id}।`,
            `${slots.roomTitle}, ${slots.checkIn} देखि ${slots.checkOut} सम्म (${slots.nights} रात), ${slots.guests} पाहुना।`,
            `जम्मा: ${price}।`,
            "तपाईंको कोठा पुष्टि गर्न, कृपया नगद, बैंक ट्रान्सफर, eSewa, वा Khalti मार्फत 50% अग्रिम भुक्तानी पठाउनुहोस्, र भुक्तानीको स्क्रिनसट व्हाट्सएपमा हामीलाई पठाउनुहोस्। बाँकी 50% चेक-इनको 2 दिनभित्र तिर्नुपर्छ।",
            `${slots.email ?? "तपाईंको इमेल"} मा पुष्टिकरण इमेल पठाइँदैछ, र म व्हाट्सएप खोल्दैछु ताकि तपाईं यो हाम्रो च्याटमा पनि सुरक्षित राख्न सक्नुहुन्छ। तपाईं हामीलाई जहिले पनि सम्पर्क गर्न सक्नुहुन्छ: व्हाट्सएप/कल 9708538395 / 9869035191।`
          ].join(" ")
        : lang === "bo"
          ? [
              `ཚང་མ་གྲ་སྒྲིག་ཟིན། Booking Request ངོས་འཛིན་བྱས་ཟིན། Reference: ${booking.id}`,
              `${slots.roomTitle}, ${slots.checkIn} ནས ${slots.checkOut} བར (མཚན་མོ ${slots.nights}), མགྲོན་པོ ${slots.guests}`,
              `Total: ${price}`,
              "ཁྱེད་ཀྱི Room ངོས་འཛིན་ཆེད Cash, Bank transfer, eSewa, ཡང་ན Khalti ནང་ 50% Advance payment བཏང་རོགས, དེ་བཞིན Payment Screenshot WhatsApp ཐོག་ང་ཚོར་སྤྲོད་རོགས། ལྷག་མ 50% Check-in ཉིན་ནས་ཉིན 2 ནང་ཚུད་སྤྲོད་དགོས།",
              `Confirmation Email ${slots.email ?? "khyed kyi email"} ལ་བཏང་བཞིན་ཡོད, ང་གིས WhatsApp ཡང་ཕྱེ་བཞིན་ཡོད་པས་ཁྱེད་ཀྱིས་འདི་ང་ཚོའི Chat ནང་ཉར་ཐུབ། ཁྱེད་ཀྱིས་ག་དུས་ཡིན་ཡང་ང་ཚོར་འབྲེལ་བ་ཐུབ: WhatsApp/Call 9708538395 / 9869035191`
            ].join(" ")
          : [
              `You're all set — booking request confirmed! Reference: ${booking.id}.`,
              `${slots.roomTitle}, ${slots.checkIn} to ${slots.checkOut} (${slots.nights} night${slots.nights === 1 ? "" : "s"}), ${slots.guests} guest${slots.guests === 1 ? "" : "s"}.`,
              `Total: ${price}.`,
              "To confirm your room, please send a 50% advance payment via cash, bank transfer, eSewa, or Khalti, and share the payment screenshot with us on WhatsApp. The remaining 50% is due within 2 days of check-in.",
              `A confirmation email is on its way to ${slots.email ?? "your email"}, and I'm opening WhatsApp so you can save this to your chat with us too. You can also reach us anytime: WhatsApp/call 9708538395 / 9869035191.`
            ].join(" ");

    return { reply, bookingId: booking.id, whatsappUrl };
  } catch (error) {
    // Never pretend a booking succeeded if it didn't. Best-effort notify the
    // team anyway so the lead isn't lost, and be transparent with the guest.
    await notifyTeam(slots, undefined, true).catch(() => undefined);
    const reply =
      lang === "ne"
        ? "मसँग तपाईंको सबै विवरण छ, तर अहिले यसलाई हाम्रो प्रणालीमा सेभ गर्न समस्या भइरहेको छ। मैले सबै कुरा हाम्रो टिमलाई पठाइदिएको छु ताकि उनीहरूले प्रत्यक्ष तपाईंसँग पुष्टि र अन्तिम रूप दिन सकून् — कृपया 9708538395 / 9869035191 मा व्हाट्सएप वा कल गर्नुहोस्, वा " +
          INQUIRY_EMAIL +
          " मा इमेल गर्नुहोस्।"
        : lang === "bo"
          ? "ཁྱེད་ཀྱི Details ཚང་མ ང་ལ་ཡོད, འོན་ཀྱང་ད་ལྟ་ང་ཚོའི System ནང་ Save བྱེད་པར་དཀའ་ངལ་འཕྲད་སོང་། ང་གིས་ཚང་མ་ང་ཚོའི Team ལ་བཏང་ཟིན་པས་ཁོང་ཚོས་ཁྱེད་དང་མཉམ་དུ་ངོས་འཛིན་དང་ Finalize བྱེད་ཐུབ — 9708538395 / 9869035191 ཐོག WhatsApp or Call གནང་རོགས, ཡང་ན " +
            INQUIRY_EMAIL +
            " ལ Email གནང་རོགས།"
          : "I've got all your details, but I'm having trouble saving this to our system right now. I've passed everything to our team so they can confirm and finalize it with you directly — please WhatsApp or call 9708538395 / 9869035191, or email " +
            INQUIRY_EMAIL +
            ".";
    return { reply };
  }
}

async function notifyTeam(slots: BookingSlots, bookingId?: string, saveFailed = false): Promise<void> {
  try {
    await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        _subject: saveFailed
          ? "Jikmis Apartment: AI booking COULD NOT BE SAVED — needs manual follow-up"
          : "New Jikmis Apartment booking created via AI receptionist",
        bookingId: bookingId ?? "(not saved)",
        roomTitle: slots.roomTitle,
        checkIn: slots.checkIn,
        checkOut: slots.checkOut,
        nights: slots.nights,
        guests: slots.guests,
        totalPrice: slots.totalPrice,
        name: slots.fullName,
        phone: slots.phone,
        whatsapp: slots.whatsapp,
        email: slots.email,
        specialRequests: slots.specialRequests ?? "",
        _replyto: slots.email
      })
    });
  } catch {
    // Best-effort only — the guest-facing reply already tells them to
    // contact the team directly if anything goes wrong.
  }
}

/**
 * Main entry point, called from app/api/chat/route.ts. `state` is null when
 * no booking flow is in progress; the caller decides whether to start one
 * via isStartBookingIntent(). The route is stateless between requests, so
 * the client is responsible for storing and re-sending `state` on the next
 * turn (see components/ApartmentChatbot.tsx).
 */
const CONFIRM_YES: Record<Lang, RegExp> = {
  en: /\b(yes|yeah|yep|confirm|correct|sure|ok|okay)\b/i,
  ne: /(हो|पुष्टि|ठिक छ|हुन्छ|yes)/,
  bo: /(ཡིན|ངོས་འཛིན|confirm|yes|ok)/i
};
const CONFIRM_NO: Record<Lang, RegExp> = {
  en: /\b(no|nope|cancel|stop)\b/i,
  ne: /(होइन|रद्द|पर्दैन|no)/,
  bo: /(མིན|cancel|stop|no)/i
};

// Exported so app/api/chat/route.ts can use the exact same wording when a
// guest cancels mid-flow BEFORE reaching the "confirm" step (that earlier
// cancel path lives in route.ts since it short-circuits before
// handleBookingTurn is even called — see isCancelMidFlow there).
export function cancelledBookingReply(lang: Lang): string {
  if (lang === "ne") return "कुनै समस्या छैन, मैले त्यो बुकिङ अनुरोध रद्द गरेको छु। फेरि सुरु गर्न चाहनुभयो वा अरू कुनै सहयोग चाहिन्छ भने भन्नुहोस्।";
  if (lang === "bo") return "དཀའ་ངལ་མེད། ང་གིས Booking Request དེ Cancel བཏང་ཡོད། ཡང་བསྐར་འགོ་འཛུགས་འདོད་ན་ཡང་ན་རོགས་རམ་གཞན་དགོས་ན་ང་ལ་ཤོད་རོགས།";
  return "No problem, I've cancelled that booking request. Let me know if you'd like to start again or if there's anything else I can help with.";
}

/**
 * Main entry point, called from app/api/chat/route.ts. `state` is null when
 * no booking flow is in progress; the caller decides whether to start one
 * via isStartBookingIntent(). The route is stateless between requests, so
 * the client is responsible for storing and re-sending `state` on the next
 * turn (see components/ApartmentChatbot.tsx).
 *
 * Language is detected once, from the very first message of the flow, and
 * stored on state.lang for every subsequent turn — see the BookingState.lang
 * comment above for why (a mid-flow script switch, e.g. a guest pasting an
 * English phone number into an otherwise-Nepali conversation, must not flip
 * the whole flow's language).
 */
export async function handleBookingTurn(message: string, state: BookingState | null): Promise<BookingTurnResult> {
  if (!state) {
    const lang = detectLanguage(message);
    const choices = await listRoomChoices();
    const choicesText = formatRoomChoicesText(lang, choices);
    const initialSlots: BookingSlots = {};
    return { reply: questionFor(lang, "roomType", initialSlots, choicesText), state: { step: "roomType", slots: initialSlots, lang } };
  }

  const { step, slots } = state;
  const lang: Lang = state.lang ?? "en";

  switch (step) {
    case "roomType": {
      const result = await handleRoomTypeStep(lang, message, slots);
      return { reply: result.reply, state: { step: result.step, slots: result.slots, lang } };
    }
    case "checkIn":
    case "checkOut": {
      const result = handleDateStep(lang, step, message, slots);
      return { reply: result.reply, state: { step: result.step, slots: result.slots, lang } };
    }
    case "guests": {
      const result = await handleGuestsStep(lang, message, slots);
      return { reply: result.reply, state: { step: result.step, slots: result.slots, lang } };
    }
    case "fullName": {
      const result = handleFullNameStep(lang, message, slots);
      return { reply: result.reply, state: { step: result.step, slots: result.slots, lang } };
    }
    case "phone": {
      const result = handlePhoneStep(lang, message, slots);
      return { reply: result.reply, state: { step: result.step, slots: result.slots, lang } };
    }
    case "whatsapp": {
      const result = handleWhatsappStep(lang, message, slots);
      return { reply: result.reply, state: { step: result.step, slots: result.slots, lang } };
    }
    case "email": {
      const result = handleEmailStep(lang, message, slots);
      return { reply: result.reply, state: { step: result.step, slots: result.slots, lang } };
    }
    case "specialRequests": {
      const result = handleSpecialRequestsStep(lang, message, slots);
      return { reply: result.reply, state: { step: result.step, slots: result.slots, lang } };
    }
    case "confirm": {
      const trimmed = message.trim();
      if (CONFIRM_YES[lang].test(trimmed)) {
        const result = await finalizeBooking(lang, slots);
        return { reply: result.reply, state: null, bookingId: result.bookingId, whatsappUrl: result.whatsappUrl };
      }
      if (CONFIRM_NO[lang].test(trimmed)) {
        return { reply: cancelledBookingReply(lang), state: null };
      }
      const reprompt =
        lang === "ne"
          ? "पुष्टि गर्न मात्र — के म यो बुकिङ अनुरोध पेश गरूँ? (yes/no)"
          : lang === "bo"
            ? "ངོས་འཛིན་ཆེད་གཏན་འཁེལ་བྱེད་ — ང་གིས Booking Request འདི Submit བྱེད་དགོས་སམ། (yes/no)"
            : "Just to confirm — should I go ahead and submit this booking request? (yes/no)";
      return { reply: reprompt, state };
    }
    default:
      return { reply: questionFor(lang, "roomType", slots), state: { step: "roomType", slots, lang } };
  }
}

/**
 * Returns the prompt for whatever step a booking flow is currently on,
 * WITHOUT advancing state. Used by app/api/chat/route.ts's "conversation
 * memory during booking" handling: if a guest asks an unrelated factual
 * question (price, facilities, rules, etc.) partway through a booking, the
 * route answers that question via lib/receptionistReplies.ts and then
 * re-asks this exact prompt, rather than feeding the guest's off-topic
 * question into whatever step's parser is currently active (which would
 * otherwise misread it as a bad answer and corrupt the flow).
 */
export function getCurrentBookingPrompt(state: BookingState): string {
  return questionFor(state.lang ?? "en", state.step, state.slots);
}

// ---------------------------------------------------------------------
// Direct (non-conversational) booking — the public website form's path.
// Called from app/api/bookings/route.ts. Guest submits every field at once
// (a real Room.id resolved client-side from GET /rooms, not a fuzzy title
// match), so this skips the step-by-step slot-filling above entirely, but
// deliberately reuses the same private helpers finalizeBooking() uses
// (checkRoomAvailability, findOrCreateGuest, logNotifications, notifyTeam,
// nightsBetween, EMAIL_REGEX, sendBookingConfirmation) rather than a second
// copy of that logic — this file, app/api/bookings/route.ts, and
// app/api/chat/route.ts all run in the same Next.js runtime against the
// same lib/prisma.ts Prisma client, so there's no cross-runtime boundary
// here to justify a duplicate the way bookingService.js's Express-side copy
// is justified (see 12_System_Logic.md, section 8b).
// ---------------------------------------------------------------------

export type DirectBookingInput = {
  roomId: string;
  checkIn: string; // ISO yyyy-mm-dd
  checkOut: string; // ISO yyyy-mm-dd
  guests: number;
  fullName: string;
  phone: string;
  whatsapp?: string;
  email: string;
  specialRequests?: string;
};

export type DirectBookingResult =
  | {
      ok: true;
      bookingId: string;
      whatsappUrl: string | null;
      roomTitle: string;
      nights: number;
      totalPrice: number;
      capacityNote?: string;
    }
  | { ok: false; status: number; message: string };

/**
 * Steps, in order (see ai-knowledge-base/12_System_Logic.md for the
 * write-up): 1) validate dates/fields, 2) check availability, 3) calculate
 * price, 4) create the booking, 5) send the guest's confirmation + notify
 * the team. The caller (app/api/bookings/route.ts) is responsible for step
 * 6, showing the success message, since that's presentation, not creation.
 */
export async function createDirectBooking(input: DirectBookingInput): Promise<DirectBookingResult> {
  // --- 1. Validate dates and the rest of the guest-submitted fields, all
  // up front, before touching the database. Mirrors the per-step validation
  // the conversational flow does above (handleDateStep, handleFullNameStep,
  // etc.), just collapsed into one pass since this is a single submission.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIso(today);

  const checkInValid = /^\d{4}-\d{2}-\d{2}$/.test(input.checkIn) && !Number.isNaN(new Date(`${input.checkIn}T00:00:00`).getTime());
  const checkOutValid = /^\d{4}-\d{2}-\d{2}$/.test(input.checkOut) && !Number.isNaN(new Date(`${input.checkOut}T00:00:00`).getTime());
  if (!checkInValid || !checkOutValid) {
    return { ok: false, status: 400, message: "Please provide valid check-in and check-out dates." };
  }
  if (input.checkIn < todayIso) {
    return { ok: false, status: 400, message: "Check-in date cannot be in the past." };
  }
  if (input.checkOut <= input.checkIn) {
    return { ok: false, status: 400, message: "Check-out date must be after the check-in date." };
  }
  if (!Number.isFinite(input.guests) || input.guests < 1 || input.guests > 20) {
    return { ok: false, status: 400, message: "Guest count must be between 1 and 20." };
  }
  const fullName = input.fullName?.trim() ?? "";
  if (fullName.length < 2 || fullName.length > 80) {
    return { ok: false, status: 400, message: "Please provide your full name." };
  }
  const phone = input.phone?.trim() ?? "";
  if (phone.length < 7) {
    return { ok: false, status: 400, message: "Please provide a valid phone number." };
  }
  const email = input.email?.trim() ?? "";
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, status: 400, message: "Please provide a valid email address." };
  }
  if (!input.roomId) {
    return { ok: false, status: 400, message: "Please select a room." };
  }

  // --- 2. Check availability — the exact same Room/Booking data and
  // conflict logic (OCCUPYING_STATUSES / checkRoomAvailability) the AI chat
  // and admin/calendar paths already use, so the public website form can
  // never disagree with what staff see in /admin.
  let room;
  try {
    room = await prisma.room.findUnique({ where: { id: input.roomId } });
  } catch (error) {
    console.error("[bookingAssistant] createDirectBooking: could not read room:", error);
    return { ok: false, status: 503, message: "We couldn't check availability right now — please try again shortly, or WhatsApp/call us at 9708538395 / 9869035191." };
  }
  if (!room || !room.isAvailable) {
    return { ok: false, status: 404, message: "This room isn't available for booking right now." };
  }

  const available = await checkRoomAvailability(room.id, room.totalUnits, input.checkIn, input.checkOut);
  if (!available) {
    return {
      ok: false,
      status: 409,
      message: `${room.title} is already booked for ${input.checkIn} to ${input.checkOut}. Please choose different dates or another room.`
    };
  }

  const capacityNote =
    input.guests > room.maxGuests
      ? `${room.title} comfortably fits up to ${room.maxGuests} guests — our team will confirm arrangements for your full group.`
      : undefined;

  // --- 3. Calculate price — nightly rate only, same as every other booking
  // path (see 05_Booking_Policies.md; monthly/negotiated rates always
  // require staff involvement, never computed automatically here).
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const totalPrice = nights * room.pricePerNight;

  const slotsLike: BookingSlots = {
    roomId: room.id,
    roomTitle: room.title,
    pricePerNight: room.pricePerNight,
    maxGuests: room.maxGuests,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    fullName,
    phone,
    whatsapp: input.whatsapp?.trim() || phone,
    email,
    specialRequests: input.specialRequests?.trim() || undefined,
    nights,
    totalPrice
  };

  // --- 4. Create the booking. channel: "website" distinguishes this from
  // "ai_chat" (conversational) and "legacy_form"/"admin_manual", while
  // writing to the exact same Booking table every other channel uses (see
  // 13_Database_Summary.md, section 5) — CHANNEL_LABELS in app/admin/page.tsx
  // already anticipated this value.
  const guestId = await findOrCreateGuest(slotsLike);

  let booking;
  try {
    booking = await prisma.booking.create({
      data: {
        roomId: room.id,
        userId: null,
        guestId,
        guestName: fullName,
        guestPhone: phone,
        guestWhatsapp: slotsLike.whatsapp,
        guestEmail: email,
        specialRequests: slotsLike.specialRequests ?? null,
        channel: "website",
        checkIn: new Date(`${input.checkIn}T00:00:00`),
        checkOut: new Date(`${input.checkOut}T00:00:00`),
        totalPrice,
        guestCount: input.guests,
        status: "PENDING"
      }
    });
  } catch (error) {
    console.error("[bookingAssistant] createDirectBooking: booking.create failed:", error);
    await notifyTeam(slotsLike, undefined, true).catch(() => undefined);
    return {
      ok: false,
      status: 500,
      message: "We couldn't save your booking automatically, but we've notified our team with your details — please also WhatsApp or call 9708538395 / 9869035191 to confirm."
    };
  }

  await notifyTeam(slotsLike, booking.id);

  // --- 5. Send the guest's confirmation (email + WhatsApp link) — the same
  // pattern finalizeBooking() uses above. A messaging failure never undoes
  // or masks that the booking itself was created successfully.
  let whatsappUrl: string | null = null;
  try {
    const bookingWithRoom = await prisma.booking.findUnique({ where: { id: booking.id }, include: { room: true } });
    if (bookingWithRoom) {
      const messageResult = await sendBookingConfirmation(bookingWithRoom);
      whatsappUrl = messageResult.whatsappUrl ?? null;
      await prisma.booking.update({ where: { id: booking.id }, data: { confirmationSentAt: new Date() } });
      await logNotifications(booking.id, "booking_confirmation", messageResult);
    }
  } catch (messagingError) {
    console.error("[bookingAssistant] createDirectBooking: confirmation messaging failed (booking still created):", messagingError);
  }

  return { ok: true, bookingId: booking.id, whatsappUrl, roomTitle: room.title, nights, totalPrice, capacityNote };
}
