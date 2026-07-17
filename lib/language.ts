/**
 * Shared language detection for the AI receptionist. Deliberately tiny and
 * deterministic (no ML/LLM) — it only looks at which Unicode script a
 * message is written in, per ai-knowledge-base's "never invent / never
 * silently degrade" philosophy: a guest either wrote Devanagari, Tibetan, or
 * neither (treated as English), never a guess.
 *
 * Used by both lib/receptionistReplies.ts (the deterministic Q&A engine) and
 * lib/bookingAssistant.ts (the conversational booking flow) so a guest's
 * detected language is consistent across the whole conversation.
 *
 * Known limitation (flagged, not silently hidden): guests who type Nepali in
 * Romanized/Latin script (e.g. "kati parcha" for "how much") will NOT be
 * detected as Nepali by script alone — they fall through to English. A small
 * set of common romanized Nepali keywords is layered on top in
 * receptionistReplies.ts's English intent lists as a best-effort bonus, but
 * this is not comprehensive. See ai-knowledge-base for the full caveat.
 */

export type Lang = "en" | "ne" | "bo";

// Tibetan block: U+0F00–U+0FFF. Unambiguous — never overlaps Devanagari.
const TIBETAN_RANGE = /[ༀ-࿿]/;
// Devanagari block: U+0900–U+097F. Shared by Nepali and Hindi; this project
// treats any Devanagari text as Nepali since Hindi isn't in scope.
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/**
 * Detects the language of a single guest message by script. Tibetan is
 * checked first (unambiguous), then Devanagari, else English.
 */
export function detectLanguage(text: string): Lang {
  if (TIBETAN_RANGE.test(text)) return "bo";
  if (DEVANAGARI_RANGE.test(text)) return "ne";
  return "en";
}
