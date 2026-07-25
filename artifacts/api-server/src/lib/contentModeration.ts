/**
 * Content moderation module.
 *
 * Scans AI-generated articles for policy violations before publishing.
 * Flagged articles are queued for manual review and do NOT auto-publish.
 *
 * Flags content touching on:
 * - Sectarian conflict framing
 * - Calls to violence
 * - Unverified casualty figures presented as fact
 * - Defamatory content about named individuals
 */

interface FlagPattern {
  pattern: RegExp;
  reason: string;
}

const FLAG_PATTERNS: FlagPattern[] = [
  // Sectarian conflict framing
  {
    pattern: /\b(shia|sunni|ahmadi)\s*(vs\.?|versus|against|enemy of)\s*(shia|sunni|ahmadi|muslim)\b/gi,
    reason: "Sectarian conflict framing detected",
  },
  {
    pattern: /\bsectarian\s+(violence|war|clash|conflict|riot)\b/gi,
    reason: "Sectarian conflict language detected",
  },

  // Calls to violence
  {
    pattern: /\b(kill|murder|massacre|slaughter|exterminate)\s+the\s+(infidel|kuffar|non.?muslim|disbeliever)\b/gi,
    reason: "Potential call to violence against religious group",
  },
  {
    pattern: /\bcall(ing|s)?\s+(for|to)\s+(kill|attack|violence|jihad against)\b/gi,
    reason: "Potential incitement to violence",
  },

  // Specific defamatory claims about named individuals
  {
    pattern: /[A-Z][a-z]+\s+[A-Z][a-z]+\s+is\s+(a\s+)?(terrorist|murderer|criminal|fraud|war criminal)\b/gi,
    reason: "Potentially defamatory statement about a named individual",
  },

  // Fabricated highly specific casualty figures
  {
    pattern: /\b(exactly\s+)?\d{3,}\s+(civilians?\s+)?(killed|massacred|murdered|executed)\s+by\s+[A-Z]/gi,
    reason: "Highly specific casualty figures that may be fabricated",
  },
];

export interface ModerationResult {
  flagged: boolean;
  reason: string | null;
}

/**
 * Check article content for policy violations.
 * Returns { flagged: true, reason } if the content should be held for review.
 */
export function moderateContent(title: string, body: string): ModerationResult {
  const fullText = `${title} ${body}`;

  for (const { pattern, reason } of FLAG_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state for global flags
    const match = pattern.exec(fullText);
    if (match) {
      return {
        flagged: true,
        reason: `${reason} (excerpt: "${match[0].substring(0, 60)}")`,
      };
    }
  }

  return { flagged: false, reason: null };
}
