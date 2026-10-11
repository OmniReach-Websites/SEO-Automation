export type HealthComponent =
  | 'admin'
  | 'api'
  | 'backup'
  | 'database'
  | 'disk'
  | 'domain'
  | 'provider'
  | 'queue'
  | 'site'
  | 'worker';

export interface HealthSignal {
  readonly checkedAt: string;
  readonly component: HealthComponent;
  readonly detail: string;
  readonly status: 'degraded' | 'down' | 'healthy' | 'unknown';
}

export async function collectHealth(
  component: HealthComponent,
  check: () => Promise<boolean>,
): Promise<HealthSignal> {
  const checkedAt = new Date().toISOString();
  try {
    const healthy = await check();
    return {
      checkedAt,
      component,
      detail: healthy ? 'check passed' : 'check returned unhealthy',
      status: healthy ? 'healthy' : 'down',
    };
  } catch {
    return { checkedAt, component, detail: 'check failed safely', status: 'unknown' };
  }
}

export { PostgresAlertCenter, type AlertWorkerScope } from './postgres-alerts.ts';
