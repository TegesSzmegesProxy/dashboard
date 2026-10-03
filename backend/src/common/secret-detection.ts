/**
 * Best-effort detection of credentials in text. Detection is a safety net,
 * not a guarantee: customers remain responsible for not committing secrets.
 * Rule ids are safe to log and store; matched values never are.
 */
interface SecretRule {
  id: string;
  pattern: RegExp;
  /** Capture group holding the secret; 0 redacts the whole match. */
  group: number;
}

const SECRET_RULES: readonly SecretRule[] = [
  {
    id: 'private-key-block',
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    group: 0,
  },
  {
    id: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    group: 0,
  },
  {
    id: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    group: 0,
  },
  {
    id: 'github-fine-grained-token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g,
    group: 0,
  },
  {
    id: 'slack-token',
    pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
    group: 0,
  },
  {
    id: 'stripe-secret-key',
    pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/g,
    group: 0,
  },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, group: 0 },
  {
    id: 'anthropic-api-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    group: 0,
  },
  {
    id: 'openai-api-key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
    group: 0,
  },
  {
    id: 'tessera-machine-key',
    pattern: /\bts_(?:col|dep)_[a-f0-9]{24}_[A-Za-z0-9_-]{20,}\b/g,
    group: 0,
  },
  {
    id: 'jwt',
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    group: 0,
  },
  {
    id: 'url-credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:([^/\s@]{3,})@/gi,
    group: 1,
  },
  {
    id: 'credential-assignment',
    pattern:
      /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']?([^\s"'`,;)}]{8,})/gi,
    group: 1,
  },
];

/** Values that are placeholders or references, not literal secrets. */
const PLACEHOLDER =
  /^(?:<redacted|\*{3,}|x{6,}|\$\{|\$[A-Z_]|process\.env|os\.environ|env\(|getenv|changeme|example|your[_-]|<)/i;

export interface SecretFinding {
  ruleId: string;
}

export interface RedactionResult {
  text: string;
  /** Redaction count per rule id. */
  counts: Record<string, number>;
}

export function detectSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of SECRET_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      if (isLiteralSecret(match, rule)) {
        findings.push({ ruleId: rule.id });
      }
    }
  }
  return findings;
}

export function redactSecrets(text: string): RedactionResult {
  const counts: Record<string, number> = {};
  let redacted = text;
  for (const rule of SECRET_RULES) {
    redacted = redacted.replace(rule.pattern, (...args: unknown[]) => {
      const match = args.slice(0, -2) as unknown as RegExpMatchArray;
      const whole = match[0];
      if (!isLiteralSecret(match, rule)) return whole;
      counts[rule.id] = (counts[rule.id] ?? 0) + 1;
      const marker = `<redacted:${rule.id}>`;
      if (rule.group === 0) return marker;
      const secret = match[rule.group];
      return whole.replace(secret, marker);
    });
  }
  return { text: redacted, counts };
}

export function containsPrivateKeyBlock(text: string): boolean {
  return /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/.test(text);
}

function isLiteralSecret(match: RegExpMatchArray, rule: SecretRule): boolean {
  const value = match[rule.group];
  return value !== undefined && !PLACEHOLDER.test(value);
}
