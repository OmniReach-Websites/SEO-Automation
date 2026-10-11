import {
  alertFingerprint,
  type AlertInput,
  type AlertRecord,
  type UrgentEmailAdapter,
} from '@omnireach/observability';
import {
  withWorkerTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

export interface AlertWorkerScope {
  readonly jobId: string;
  readonly siteId: string;
  readonly tenantId: string;
}

interface AlertRow {
  email_escalation: number;
  fingerprint: string;
  first_seen_at: Date;
  id: string;
  last_seen_at: Date;
  occurrences: number;
  remediation_url: string | null;
  safe_message: string;
  severity: AlertRecord['severity'];
  source: string;
  state: AlertRecord['state'];
}

export class PostgresAlertCenter {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly options: {
      readonly emailAttempts?: number;
      readonly sleep?: (milliseconds: number) => Promise<void>;
    } = {},
  ) {}

  async report(
    scope: AlertWorkerScope,
    input: AlertInput,
    email?: UrgentEmailAdapter,
  ): Promise<AlertRecord> {
    validateInput(input);
    const fingerprint = alertFingerprint(input);
    const row = await withWorkerTransaction(this.pool, scope, async (client) =>
      required(
        (
          await query<AlertRow>(
            client,
            `INSERT INTO alerts
               (tenant_id, site_id, fingerprint, severity, state, source, safe_message,
                remediation_url, first_seen_at, last_seen_at)
             VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, now(), now())
             ON CONFLICT (tenant_id, site_id, fingerprint) DO UPDATE
               SET occurrences = alerts.occurrences + 1,
                   severity = EXCLUDED.severity,
                   last_seen_at = EXCLUDED.last_seen_at,
                   remediation_url = EXCLUDED.remediation_url,
                   state = CASE WHEN alerts.state = 'resolved' THEN 'open' ELSE alerts.state END,
                   acknowledged_at = CASE WHEN alerts.state = 'resolved' THEN NULL ELSE alerts.acknowledged_at END,
                   resolved_at = CASE WHEN alerts.state = 'resolved' THEN NULL ELSE alerts.resolved_at END,
                   email_escalation = CASE WHEN alerts.state = 'resolved'
                                           THEN alerts.email_escalation + 1
                                           ELSE alerts.email_escalation END
             RETURNING id, fingerprint, severity, state, source, safe_message, occurrences,
                       remediation_url, first_seen_at, last_seen_at, email_escalation`,
            [
              scope.tenantId,
              scope.siteId,
              fingerprint,
              input.severity,
              input.source,
              input.message,
              input.remediationUrl ?? null,
            ],
          )
        ).rows[0],
        'Alert upsert failed',
      ),
    );

    if (email && ['critical', 'error'].includes(row.severity) && row.state === 'open') {
      await this.deliver(scope, row, input.scope, email);
    }
    return mapAlert(row, input.scope);
  }

  private async deliver(
    scope: AlertWorkerScope,
    alert: AlertRow,
    alertScope: string,
    email: UrgentEmailAdapter,
  ): Promise<void> {
    const attempts = this.options.emailAttempts ?? 4;
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 4) {
      throw new Error('Alert email attempts must be between 1 and 4');
    }
    const sleep =
      this.options.sleep ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    for (let index = 0; index < attempts; index += 1) {
      const delivery = await this.reserveDelivery(
        scope,
        alert.id,
        alert.email_escalation,
        attempts,
      );
      if (!delivery) return;
      try {
        const sent = await email.send({
          alertFingerprint: alert.fingerprint,
          safeBody: `${alert.source}: ${alert.safe_message}\nScope: ${alertScope}`,
          subject: `[OmniReach ${alert.severity.toUpperCase()}] ${alert.source}`,
        });
        await this.finalizeDelivery(scope, delivery.id, 'sent', sent.providerReference);
        return;
      } catch {
        await this.finalizeDelivery(scope, delivery.id, 'failed');
        if (index + 1 < attempts) await sleep(250 * 2 ** index);
      }
    }
  }

  private reserveDelivery(
    scope: AlertWorkerScope,
    alertId: string,
    escalation: number,
    maximumAttempts: number,
  ): Promise<{ attempt: number; id: string } | undefined> {
    return withWorkerTransaction(this.pool, scope, async (client) => {
      await client.query('SELECT id FROM alerts WHERE id = $1 FOR UPDATE', [alertId]);
      const state = await query<{ attempt: number; state: string }>(
        client,
        `SELECT attempt, state FROM alert_deliveries
          WHERE alert_id = $1 AND channel = 'email' AND escalation = $2
          ORDER BY attempt DESC`,
        [alertId, escalation],
      );
      if (
        state.rows.some(({ state: deliveryState }) => ['pending', 'sent'].includes(deliveryState))
      ) {
        return undefined;
      }
      const attempt = (state.rows[0]?.attempt ?? 0) + 1;
      if (attempt > maximumAttempts) return undefined;
      return required(
        (
          await query<{ attempt: number; id: string }>(
            client,
            `INSERT INTO alert_deliveries (alert_id, channel, state, escalation, attempt)
             VALUES ($1, 'email', 'pending', $2, $3)
             RETURNING id, attempt`,
            [alertId, escalation, attempt],
          )
        ).rows[0],
        'Alert delivery reservation failed',
      );
    });
  }

  private async finalizeDelivery(
    scope: AlertWorkerScope,
    deliveryId: string,
    state: 'failed' | 'sent',
    providerReference?: string,
  ): Promise<void> {
    await withWorkerTransaction(this.pool, scope, async (client) => {
      await client.query(
        `UPDATE alert_deliveries d
            SET state = $2::varchar(20), provider_reference = $3::varchar(200),
                error_code = CASE WHEN $2::text = 'failed'
                                  THEN 'provider_failure'::varchar(100) ELSE NULL END
          WHERE d.id = $1
            AND EXISTS (SELECT 1 FROM alerts a
                         WHERE a.id = d.alert_id AND a.tenant_id = $4 AND a.site_id = $5)`,
        [deliveryId, state, providerReference ?? null, scope.tenantId, scope.siteId],
      );
    });
  }
}

function mapAlert(row: AlertRow, scope: string): AlertRecord {
  return {
    fingerprint: row.fingerprint,
    firstSeenAt: row.first_seen_at.toISOString(),
    id: row.id,
    message: row.safe_message,
    occurrences: row.occurrences,
    ...(row.remediation_url ? { remediationUrl: row.remediation_url } : {}),
    scope,
    severity: row.severity,
    source: row.source,
    state: row.state,
    updatedAt: row.last_seen_at.toISOString(),
  };
}

function validateInput(input: AlertInput): void {
  if (!input.message || input.message.length > 500) throw new Error('Alert message is invalid');
  if (!input.source || input.source.length > 80) throw new Error('Alert source is invalid');
  if (!input.scope || input.scope.length > 200) throw new Error('Alert scope is invalid');
  if (input.remediationUrl && input.remediationUrl.length > 500) {
    throw new Error('Alert remediation URL is invalid');
  }
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

async function query<T>(
  client: TenantTransactionClient,
  text: string,
  values?: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
