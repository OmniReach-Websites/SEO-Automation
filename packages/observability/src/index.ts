import { createHash, randomUUID } from 'node:crypto';

import pino, { type DestinationStream, type Logger } from 'pino';

const redactedPaths = [
  'password',
  '*.password',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'sessionSecret',
  '*.sessionSecret',
  'token',
  '*.token',
  'recoveryCode',
  '*.recoveryCode',
];

export function createLogger(level = 'info', destination?: DestinationStream): Logger {
  const options = {
    base: null,
    level,
    redact: { censor: '[REDACTED]', paths: redactedPaths },
  };
  return destination ? pino(options, destination) : pino(options);
}

export function createTraceId(candidate?: string): string {
  return candidate && /^[A-Za-z0-9_-]{16,128}$/.test(candidate) ? candidate : randomUUID();
}

export type AlertSeverity = 'critical' | 'error' | 'info' | 'warning';
export type AlertState = 'acknowledged' | 'open' | 'resolved';

export interface AlertInput {
  readonly message: string;
  readonly remediationUrl?: string;
  readonly scope: string;
  readonly severity: AlertSeverity;
  readonly source: string;
}

export interface AlertRecord extends AlertInput {
  readonly fingerprint: string;
  readonly firstSeenAt: string;
  readonly id: string;
  readonly occurrences: number;
  readonly state: AlertState;
  readonly updatedAt: string;
}

export function alertFingerprint(input: AlertInput): string {
  return createHash('sha256')
    .update(`${input.source}\0${input.scope}\0${input.message}`)
    .digest('hex');
}

export interface UrgentEmail {
  readonly alertFingerprint: string;
  readonly safeBody: string;
  readonly subject: string;
}

export interface UrgentEmailAdapter {
  send(message: UrgentEmail): Promise<{ readonly providerReference: string }>;
}

export class MemoryUrgentEmailAdapter implements UrgentEmailAdapter {
  readonly delivered: UrgentEmail[] = [];

  constructor(
    readonly options: { readonly failuresBeforeSuccess?: number; readonly recipient?: string } = {},
  ) {}

  #attempts = 0;

  async send(message: UrgentEmail): Promise<{ readonly providerReference: string }> {
    this.#attempts += 1;
    if (this.options.recipient !== undefined && !/^\S+@\S+\.\S+$/u.test(this.options.recipient)) {
      throw new Error('Invalid urgent-email recipient configuration');
    }
    if (this.#attempts <= (this.options.failuresBeforeSuccess ?? 0)) {
      throw new Error('Mock email provider timeout');
    }
    if (!message.subject || /token|password|secret=/iu.test(message.safeBody)) {
      throw new Error('Invalid or sensitive urgent email');
    }
    this.delivered.push(message);
    return { providerReference: `mock-email-${this.delivered.length}` };
  }
}

export function shouldRetainOperationalRecord(
  createdAt: Date,
  now: Date,
  options: {
    readonly activeIncident: boolean;
    readonly hold: boolean;
    readonly kind: 'audit' | 'log';
  },
): boolean {
  if (options.activeIncident || options.hold) return true;
  const retentionDays = options.kind === 'audit' ? 365 : 30;
  return now.getTime() - createdAt.getTime() < retentionDays * 86_400_000;
}

export class AlertCenter {
  readonly alerts = new Map<string, AlertRecord>();
  readonly emailFailures = new Map<
    string,
    { readonly attempts: number; readonly lastFailedAt: string; readonly message: string }
  >();
  readonly emailed = new Set<string>();

  async report(input: AlertInput, email?: UrgentEmailAdapter): Promise<AlertRecord> {
    const fingerprint = alertFingerprint(input);
    const existing = this.alerts.get(fingerprint);
    const now = new Date().toISOString();
    const alert: AlertRecord = existing
      ? {
          ...existing,
          occurrences: existing.occurrences + 1,
          state: existing.state === 'resolved' ? 'open' : existing.state,
          updatedAt: now,
        }
      : {
          ...input,
          fingerprint,
          firstSeenAt: now,
          id: randomUUID(),
          occurrences: 1,
          state: 'open',
          updatedAt: now,
        };
    this.alerts.set(fingerprint, alert);
    if (
      email &&
      ['critical', 'error'].includes(alert.severity) &&
      alert.state === 'open' &&
      !this.emailed.has(fingerprint)
    ) {
      try {
        await email.send({
          alertFingerprint: fingerprint,
          safeBody: `${alert.source}: ${alert.message}\nScope: ${alert.scope}`,
          subject: `[OmniReach ${alert.severity.toUpperCase()}] ${alert.source}`,
        });
        this.emailed.add(fingerprint);
        this.emailFailures.delete(fingerprint);
      } catch {
        const previous = this.emailFailures.get(fingerprint);
        this.emailFailures.set(fingerprint, {
          attempts: (previous?.attempts ?? 0) + 1,
          lastFailedAt: now,
          message: 'Urgent email delivery failed',
        });
      }
    }
    return alert;
  }

  acknowledge(fingerprint: string): AlertRecord {
    return this.#transition(fingerprint, 'acknowledged');
  }

  resolve(fingerprint: string): AlertRecord {
    const result = this.#transition(fingerprint, 'resolved');
    this.emailed.delete(fingerprint);
    return result;
  }

  #transition(fingerprint: string, state: AlertState): AlertRecord {
    const existing = this.alerts.get(fingerprint);
    if (!existing) throw new Error('Unknown alert');
    const result = { ...existing, state, updatedAt: new Date().toISOString() };
    this.alerts.set(fingerprint, result);
    return result;
  }
}
