/**
 * Knowledge base system for the Jikmis Apartment AI receptionist.
 *
 * The markdown files in /ai-knowledge-base are the single source of truth for
 * everything the AI receptionist knows about the property. This module loads
 * that content (via the generated, bundle-safe lib/knowledgeBase.generated.ts),
 * decides which files are relevant to a given guest question, and assembles a
 * bounded block of grounding text to inject into the AI's system prompt.
 *
 * Guest-facing files only: internal-only files (email templates, system
 * logic, database summary, API docs, admin guide) describe the site's own
 * implementation and must never be surfaced to guests or fed to the model as
 * something it could repeat back — they are intentionally excluded below.
 */
import { KNOWLEDGE_FILES, type KnowledgeFile } from "./knowledgeBase.generated";

export type { KnowledgeFile };

// Files that are safe and useful to ground guest-facing chat replies in.
const GUEST_FACING_IDS = [
  "01_Apartment_Overview",
  "02_Room_Types",
  "03_Pricing",
  "04_Amenities",
  "05_Booking_Policies",
  "06_House_Rules",
  "07_Checkin_Checkout",
  "08_FAQ",
  "10_AI_Guidelines",
  "11_Local_Guide"
];

// Internal-only files (staff/dev reference) — never injected into guest chat context.
const INTERNAL_ONLY_IDS = [
  "09_Email_Templates",
  "12_System_Logic",
  "13_Database_Summary",
  "14_API_Documentation",
  "15_Admin_Guide",
  "16_Multilanguage_Support"
];

const byId = new Map(KNOWLEDGE_FILES.map((file) => [file.id, file]));

export function getAllKnowledgeFiles(): KnowledgeFile[] {
  return KNOWLEDGE_FILES;
}

export function getKnowledgeFile(id: string): KnowledgeFile | undefined {
  return byId.get(id);
}

export function getGuestFacingKnowledgeFiles(): KnowledgeFile[] {
  return GUEST_FACING_IDS.map((id) => byId.get(id)).filter((file): file is KnowledgeFile => Boolean(file));
}

// Topic keyword routing. Mirrors the intent-matching vocabulary already used
// by the deterministic reply engine in app/api/chat/route.ts, so both layers
// agree on what counts as a "pricing question", "room question", etc.
const TOPIC_KEYWORDS: { id: string; keywords: string[] }[] = [
  {
    id: "02_Room_Types",
    keywords: [
      "room", "rooms", "studio", "single", "double", "family", "2bhk", "2 bhk", "bed", "beds",
      "capacity", "guest", "guests", "how many people", "sofa", "fridge", "utensil", "dining", "unit", "units"
    ]
  },
  {
    id: "03_Pricing",
    keywords: [
      "price", "prices", "cost", "rate", "rates", "expensive", "cheap", "monthly", "month", "night",
      "nightly", "daily", "rent", "charge", "how much", "per night", "per month", "discount", "negotiate",
      "negotiation", "deal", "cheaper", "lower", "reduce", "offer", "tax", "deposit"
    ]
  },
  {
    id: "04_Amenities",
    keywords: [
      "facility", "facilities", "amenity", "amenities", "wifi", "internet", "hot water", "kitchen",
      "clean", "cleaning", "housekeeping", "parking", "bike", "motorbike", "cctv", "security camera",
      "rooftop", "view", "laundry", "wash", "washing", "ac", "air condition", "elevator", "cafe", "café", "coffee"
    ]
  },
  {
    id: "05_Booking_Policies",
    keywords: [
      "book", "booking", "reserve", "reservation", "hold room", "confirm room", "viewing", "inspection",
      "visit room", "payment", "pay", "advance", "esewa", "khalti", "bank", "cash", "summary", "cancel",
      "cancellation", "refund", "modify", "change date", "no-show", "no show"
    ]
  },
  {
    id: "06_House_Rules",
    keywords: [
      "rule", "rules", "policy", "policies", "smoking", "smoke", "pet", "pets", "dog", "cat", "animal",
      "visitor", "visitors", "quiet", "alcohol", "party", "parties", "damage", "id", "passport",
      "citizenship", "security deposit"
    ]
  },
  {
    id: "07_Checkin_Checkout",
    keywords: [
      "check-in", "check in", "checkin", "checkout", "check-out", "check out", "arrival", "early check",
      "late check", "self check", "self-check", "access", "key", "documents needed"
    ]
  },
  {
    id: "11_Local_Guide",
    keywords: [
      "location", "where", "address", "boudha", "boudhanath", "stupa", "near", "nearby", "far", "distance",
      "map", "airport", "restaurant", "shop", "bank", "atm", "hospital", "transport", "pickup", "pick up"
    ]
  }
];

function normalize(text: string): string {
  return text.toLowerCase();
}

/**
 * Returns the knowledge files relevant to a guest's message, always
 * anchored by the overview and AI behavior guidelines, plus any topic
 * files whose keywords match the message. Falls back to the FAQ file
 * when no specific topic is detected, so open-ended questions still get
 * grounded context instead of an empty knowledge block.
 */
export function getRelevantKnowledge(message: string): KnowledgeFile[] {
  const text = normalize(message);
  const matchedIds = new Set<string>();

  for (const topic of TOPIC_KEYWORDS) {
    if (topic.keywords.some((keyword) => text.includes(keyword))) {
      matchedIds.add(topic.id);
    }
  }

  if (matchedIds.size === 0) {
    matchedIds.add("08_FAQ");
  }

  const ordered = ["01_Apartment_Overview", "10_AI_Guidelines", ...Array.from(matchedIds)];
  return ordered.map((id) => byId.get(id)).filter((file): file is KnowledgeFile => Boolean(file));
}

const DEFAULT_MAX_CHARS = 22000; // generous headroom for gpt-4o-mini's context window, keeps cost/latency sane

/**
 * Assembles the relevant knowledge files into a single delimited text block
 * suitable for inserting into an AI system prompt, bounded by maxChars so a
 * single request can never balloon the prompt size unexpectedly. Whole files
 * are dropped (lowest priority first) rather than truncated mid-content, so
 * the model never receives a half-finished table or policy.
 */
export function buildKnowledgeContext(message: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  const files = getRelevantKnowledge(message);

  const included: KnowledgeFile[] = [];
  let usedChars = 0;
  for (const file of files) {
    const blockSize = file.content.length + file.title.length + 40;
    if (included.length > 0 && usedChars + blockSize > maxChars) break;
    included.push(file);
    usedChars += blockSize;
  }

  return included
    .map((file) => `--- ${file.title} (${file.filename}) ---\n${file.content}`)
    .join("\n\n");
}

export const GUEST_FACING_KNOWLEDGE_IDS = GUEST_FACING_IDS;
export const INTERNAL_ONLY_KNOWLEDGE_IDS = INTERNAL_ONLY_IDS;
