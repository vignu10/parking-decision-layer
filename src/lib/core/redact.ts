/**
 * NFR privacy: send only the minimum text, with personal data redacted, to an external model.
 * Pattern-based and conservative. Names are NOT detected — that needs an NER step before production.
 */
const RULES: { label: string; re: RegExp }[] = [
  { label: "[EMAIL]", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  // 13–19 digit card numbers, optionally grouped by spaces or dashes
  { label: "[CARD]", re: /\b(?:\d[ -]?){12,18}\d\b/g },
  // Indian mobile numbers, optional +91 / 0 prefix
  { label: "[PHONE]", re: /(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g },
  // Indian vehicle registration plates (uppercase only, to avoid eating dates like "on 15 Sep 2026"), e.g. TN 09 AB 1234, KA01MX4321, 22 BH 1234 AA
  { label: "[PLATE]", re: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{4}\b/g },
  { label: "[PLATE]", re: /\b\d{2}[\s-]?BH[\s-]?\d{4}[\s-]?[A-Z]{1,2}\b/g },
  // UPI handles
  { label: "[UPI]", re: /\b[\w.-]{2,}@(?:ok\w+|ybl|paytm|upi|apl|ibl|axl)\b/gi },
];

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const { label, re } of RULES) {
    out = out.replace(re, () => {
      count++;
      return label;
    });
  }
  return { text: out, count };
}
