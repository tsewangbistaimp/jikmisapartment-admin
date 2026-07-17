#!/usr/bin/env node
/**
 * Reads every markdown file in /ai-knowledge-base and emits
 * lib/knowledgeBase.generated.ts as plain string constants.
 *
 * Why generate instead of reading the .md files at runtime with fs?
 * The site can be deployed as a Next.js "standalone" build (see next.config.mjs)
 * or on serverless/edge runtimes. Those environments only bundle files that are
 * statically imported — arbitrary fs.readFileSync calls against markdown files
 * are not guaranteed to be included in the deployed bundle. Generating a normal
 * .ts module keeps the knowledge base 100% bundle-safe everywhere, while the
 * markdown files in /ai-knowledge-base remain the single human-editable source
 * of truth.
 *
 * Run this after editing any file in /ai-knowledge-base:
 *   npm run knowledge:build
 * It also runs automatically before `npm run dev` and `npm run build`.
 */
const fs = require("fs");
const path = require("path");

const KNOWLEDGE_DIR = path.join(__dirname, "..", "ai-knowledge-base");
const OUTPUT_FILE = path.join(__dirname, "..", "lib", "knowledgeBase.generated.ts");

const FILES = [
  "01_Apartment_Overview.md",
  "02_Room_Types.md",
  "03_Pricing.md",
  "04_Amenities.md",
  "05_Booking_Policies.md",
  "06_House_Rules.md",
  "07_Checkin_Checkout.md",
  "08_FAQ.md",
  "09_Email_Templates.md",
  "10_AI_Guidelines.md",
  "11_Local_Guide.md",
  "12_System_Logic.md",
  "13_Database_Summary.md",
  "14_API_Documentation.md",
  "15_Admin_Guide.md",
  "16_Multilanguage_Support.md"
];

function titleFromContent(content, fallback) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function escapeForTemplateLiteral(text) {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function build() {
  const missing = [];
  const entries = FILES.map((filename) => {
    const fullPath = path.join(KNOWLEDGE_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      missing.push(filename);
      return null;
    }
    const content = fs.readFileSync(fullPath, "utf8");
    const id = filename.replace(/\.md$/, "");
    const title = titleFromContent(content, id);
    return { id, filename, title, content };
  }).filter(Boolean);

  if (missing.length > 0) {
    console.warn(
      `[knowledge-base] Warning: missing expected file(s) in /ai-knowledge-base: ${missing.join(", ")}`
    );
  }

  const entriesTs = entries
    .map(
      (entry) => `  {
    id: ${JSON.stringify(entry.id)},
    filename: ${JSON.stringify(entry.filename)},
    title: ${JSON.stringify(entry.title)},
    content: \`${escapeForTemplateLiteral(entry.content)}\`
  }`
    )
    .join(",\n");

  const output = `// AUTO-GENERATED FILE — DO NOT EDIT DIRECTLY.
// Source of truth: the markdown files in /ai-knowledge-base.
// Regenerate with: npm run knowledge:build
// Generated at: ${new Date().toISOString()}

export type KnowledgeFile = {
  id: string;
  filename: string;
  title: string;
  content: string;
};

export const KNOWLEDGE_FILES: KnowledgeFile[] = [
${entriesTs}
];
`;

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, output, "utf8");
  console.log(`[knowledge-base] Generated ${entries.length} file(s) -> ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

build();
