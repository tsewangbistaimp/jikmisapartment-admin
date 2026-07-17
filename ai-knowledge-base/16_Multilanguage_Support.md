# Jikmis Apartment — AI Receptionist Multi-Language Support

This file documents the multi-language support added to the AI receptionist's **deterministic** reply engine (`lib/receptionistReplies.ts`) and conversational booking flow (`lib/bookingAssistant.ts`). See `10_AI_Guidelines.md`, sections 2, 15, and 16 for the guest-facing behavior summary; this file is the deeper technical/decision write-up.

## 1. Why This Exists

This project's core philosophy — stated throughout `10_AI_Guidelines.md` and enforced in code — is that factual answers (price, availability, rules) must never be invented or guessed. Before this change, that guarantee only held in English: the deterministic rule engine that provides guaranteed-correct answers when no OpenAI key is configured (or when a question is a "source of truth" question — see `12_System_Logic.md`, section 2) was entirely English-language, in both its keyword matching and its reply text. A Nepali- or Tibetan-speaking guest asking "the same" factual questions the English-language engine already answers correctly would either get no match at all (falling through to a generic "I don't understand" reply) or, if an OpenAI key happened to be configured, an LLM-generated answer with no deterministic guarantee.

The decision made for this project (see the property owner's explicit choice when this was scoped) was **full deterministic translation**: the reply *templates themselves* are translated into Nepali and Tibetan, not just an instruction telling an LLM to reply in those languages. This means the "never invent" guarantee now holds in all three languages, with or without an OpenAI key.

## 2. Languages Supported

| Language | Script | Status |
|---|---|---|
| English | Latin | Original, fully verified (this is the source engine the other two are translated from) |
| Nepali | Devanagari (नेपाली) | Translated with reasonable confidence |
| Tibetan | Tibetan script (བོད་ཡིག) | Translated as a good-faith first pass — **not verified by a native Tibetan speaker** |

Hindi is mentioned in the LLM system prompt (`BASE_INSTRUCTIONS` in `app/api/chat/route.ts`) as a language the LLM path may reply in if configured, but it is **not** part of the deterministic engine — Hindi and Nepali share the Devanagari script, and since Hindi wasn't in the explicit scope for full translation, any Devanagari-script message is treated as Nepali by the deterministic engine.

## 3. How Language Is Detected

`lib/language.ts`'s `detectLanguage()` checks which Unicode script block a message contains: Tibetan (U+0F00–U+0FFF) first, then Devanagari (U+0900–U+097F), else English. This is a deliberately simple, deterministic check — no ML model, no guessing — consistent with the project's "never invent" philosophy applied to language detection itself.

**Known, flagged limitation:** Nepali speakers very commonly type in Romanized/Latin script in everyday chat (e.g. "kati parcha" instead of "कति पर्छ"). Script-based detection cannot catch this — a romanized-Nepali message is treated as English. A handful of common romanized words (e.g. "kati", "paisa") are layered into the English keyword lists in `lib/receptionistReplies.ts` as a best-effort bonus, but this is not a comprehensive solution. A more complete fix would require either a maintained romanized-Nepali dictionary or a small language-ID model, both out of scope for this change.

## 4. What's Translated

- **The deterministic Q&A engine** (`lib/receptionistReplies.ts`): every reply-generating function (price, availability, laundry, room details, facilities, location, contact, booking, payment, rules, discount, greeting, unknown/fallback, airport-pickup redirect, stay-type, human-assistance-request) and every intent-detection keyword list, for all three languages. The priority order in which intents are checked (e.g. "price + availability combined" before "price alone") is shared across all languages — only the keyword lists and output text differ — so the decision logic itself cannot drift out of sync between languages.
- **The conversational booking flow** (`lib/bookingAssistant.ts`): every step prompt (`questionFor`), the confirmation summary, and every validation/error message (invalid date, invalid phone, invalid email, room unavailable, etc.), plus the final booking-confirmed and booking-failed messages. The flow detects language once, from the very first message that starts the booking, and keeps that language for the entire flow (a guest pasting an English phone number mid-conversation doesn't flip the whole flow to English).
- **NOT translated:** the structured booking form on the homepage (`app/page.tsx`) — it's a fixed English UI with no natural-language input to detect a language from, so its confirmation messages stay in English. This is a deliberate scope boundary, not an oversight — see `10_AI_Guidelines.md`, section 2.

## 5. What's Deliberately Identical Across Languages

Room proper nouns (e.g. "Single Studio Room", "2BHK Family Room"), NPR amounts, and dates are kept byte-identical across English, Nepali, and Tibetan replies. This is intentional: it guarantees no factual drift is possible even if a translation's surrounding grammar isn't perfect, and it matches how these are commonly written in real bilingual/trilingual hospitality contexts in Kathmandu (proper nouns and figures usually stay in their original form even inside a Nepali or Tibetan sentence).

## 6. Testing

Covered by the mocked dry-run test harness (test file `test16_multilanguage.mjs` in the project's private test environment, not committed to the repo — see `12_System_Logic.md`'s testing section for context on this harness): script-based language detection, Nepali and Tibetan deterministic replies preserving exact NPR amounts/dates, source-of-truth question recognition in all three languages, and a full end-to-end Nepali booking conversation that successfully creates a real booking.
