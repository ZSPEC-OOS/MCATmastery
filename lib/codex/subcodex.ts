// Sub-Codex text format:
//
//   Subject: Biology
//   MS-1: Molecular Biology and Genetics
//   MS-2: <title>
//
// Titles are authoritative: they are never invented, renamed or reordered. Anything that does not
// parse is reported with its line number. Pure (no I/O) so the browser and the server run the same rules.

export const SUBCODEX_LIMITS = {
  maxBytes: 256 * 1024,
  maxLines: 5_000,
  maxSections: 500,
  maxSubjectLength: 200,
  maxTitleLength: 300,
} as const;

export interface LineIssue {
  line: number | null;
  code: string;
  message: string;
  excerpt?: string;
}

export interface ParsedSection {
  number: number;
  id: string;
  title: string;
  line: number;
}

export interface ParsedSubCodex {
  ok: boolean;
  subject: string | null;
  sections: ParsedSection[];
  errors: LineIssue[];
}

const FORBIDDEN = /(?!\t)[\p{Cc}\p{Cf}\u2028\u2029\uFFFD]/u; // controls, invisible/bidi characters, replacement char
const normalizeText = (s: string) => s.normalize("NFC").replace(/\s+/gu, " ").trim();
const titleKey = (s: string) => normalizeText(s).toLocaleLowerCase("en-US");

function safeExcerpt(line: string, max = 80): string {
  const cleaned = line.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "·");
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

const SUBJECT_RE = /^subject\s*:(.*)$/iu;
const SECTION_RE = /^ms-(\d+)\s*:(.*)$/iu;
const MALFORMED_SECTION_RE = /^ms(?![a-z])/iu;
const PLACEHOLDER_RE = /^\[.*\]$|^<.*>$|^\{.*\}$/u;

export function parseSubCodex(input: string): ParsedSubCodex {
  const errors: LineIssue[] = [];
  const sections: ParsedSection[] = [];
  const add = (line: number | null, code: string, message: string, raw?: string) =>
    errors.push({ line, code, message, ...(raw !== undefined ? { excerpt: safeExcerpt(raw) } : {}) });

  if (new TextEncoder().encode(input).byteLength > SUBCODEX_LIMITS.maxBytes) {
    add(null, "TOO_LARGE", `Input exceeds ${SUBCODEX_LIMITS.maxBytes / 1024} KiB`);
    return { ok: false, subject: null, sections, errors };
  }

  const lines = (input.charCodeAt(0) === 0xfeff ? input.slice(1) : input).split(/\r\n|\n|\r/u);
  if (lines.length > SUBCODEX_LIMITS.maxLines) {
    add(null, "TOO_MANY_LINES", `Input has more than ${SUBCODEX_LIMITS.maxLines} lines`);
    return { ok: false, subject: null, sections, errors };
  }

  let subject: string | null = null;
  let subjectLine: number | null = null;
  let sectionLines = 0;
  const seenNumbers = new Map<number, number>();
  const seenTitles = new Map<string, { line: number; number: number }>();

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    if (FORBIDDEN.test(raw)) {
      if (MALFORMED_SECTION_RE.test(raw.trim())) sectionLines++;
      add(line, "INVALID_CHARACTER", "Line contains a control, invisible, bidirectional-formatting or undecodable character", raw);
      return;
    }
    const text = raw.trim();

    const subjectMatch = SUBJECT_RE.exec(text);
    if (subjectMatch) {
      const value = normalizeText(subjectMatch[1]);
      if (subjectLine !== null) {
        add(line, "DUPLICATE_SUBJECT", `Subject is already defined on line ${subjectLine}`, raw);
        return;
      }
      subjectLine = line;
      if (value === "") add(line, "EMPTY_SUBJECT", "Subject must not be empty", raw);
      else if (PLACEHOLDER_RE.test(value)) add(line, "PLACEHOLDER_SUBJECT", "Subject is an unfilled placeholder", raw);
      else if (value.length > SUBCODEX_LIMITS.maxSubjectLength) add(line, "SUBJECT_TOO_LONG", `Subject exceeds ${SUBCODEX_LIMITS.maxSubjectLength} characters`, raw);
      else subject = value;
      return;
    }

    const sectionMatch = SECTION_RE.exec(text);
    if (sectionMatch) {
      sectionLines++;
      if (sectionLines > SUBCODEX_LIMITS.maxSections) {
        if (sectionLines === SUBCODEX_LIMITS.maxSections + 1) add(line, "TOO_MANY_SECTIONS", `More than ${SUBCODEX_LIMITS.maxSections} major sections`, raw);
        return;
      }
      const digits = sectionMatch[1];
      const number = Number(digits);
      const title = normalizeText(sectionMatch[2]);
      let valid = true;
      const fail = (code: string, message: string) => {
        valid = false;
        add(line, code, message, raw);
      };

      if (!Number.isSafeInteger(number) || number < 1) fail("INVALID_NUMBER", "Major section numbers start at 1");
      else if (digits.length > 1 && digits.startsWith("0")) fail("INVALID_NUMBER", `Use MS-${number}, without leading zeros`);
      else if (seenNumbers.has(number)) fail("DUPLICATE_NUMBER", `MS-${number} is already defined on line ${seenNumbers.get(number)}`);
      else if (number !== sectionLines) fail("NON_SEQUENTIAL", `Expected MS-${sectionLines} here but found MS-${number}; numbers must be sequential from MS-1`);
      if (Number.isSafeInteger(number) && number >= 1 && !seenNumbers.has(number)) seenNumbers.set(number, line);

      if (title === "") fail("EMPTY_TITLE", `MS-${digits} has no title`);
      else if (PLACEHOLDER_RE.test(title)) fail("PLACEHOLDER_TITLE", `MS-${digits} still has a placeholder title`);
      else if (title.length > SUBCODEX_LIMITS.maxTitleLength) fail("TITLE_TOO_LONG", `Title exceeds ${SUBCODEX_LIMITS.maxTitleLength} characters`);
      else {
        const key = titleKey(title);
        const prior = seenTitles.get(key);
        if (prior) fail("DUPLICATE_TITLE", `Title duplicates MS-${prior.number} on line ${prior.line}`);
        else seenTitles.set(key, { line, number });
      }

      if (valid) sections.push({ number, id: `MS-${number}`, title, line });
      return;
    }

    if (MALFORMED_SECTION_RE.test(text)) {
      sectionLines++;
      add(line, "MALFORMED_SECTION", "Expected the form 'MS-<number>: <title>'", raw);
    } else add(line, "UNRECOGNIZED_LINE", "Expected 'Subject: …' or 'MS-<number>: <title>'", raw);
  });

  if (subjectLine === null) add(null, "MISSING_SUBJECT", "A 'Subject:' line is required");
  if (sectionLines === 0) add(null, "NO_SECTIONS", "At least one 'MS-<number>: <title>' line is required");

  errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { ok: errors.length === 0 && subject !== null, subject, sections, errors };
}
