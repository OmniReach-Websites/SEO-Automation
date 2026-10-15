import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('email delivery activation boundaries', () => {
  it('never activates public inquiry delivery from credential presence alone', () => {
    const source = readFileSync('apps/api/src/main.ts', 'utf8');
    expect(source).toContain(
      'const platformInquiryDeliveryEnabled = config.PLATFORM_INQUIRY_ENABLED;',
    );
    expect(source).not.toContain(
      'const platformInquiryDeliveryEnabled = Boolean(config.RESEND_API_KEY)',
    );
    expect(source).toContain('deliveryEnabled: config.CONTACT_DELIVERY_ENABLED');
    const productionCompose = readFileSync('infrastructure/compose/production.compose.yml', 'utf8');
    expect(productionCompose).toContain("PLATFORM_INQUIRY_ENABLED: 'true'");
  });

  it('keeps email quota records free of recipients and message content', () => {
    const migration = readFileSync(
      'packages/database/prisma/migrations/20261014110000_email_delivery_operations/migration.sql',
      'utf8',
    );
    expect(migration).not.toMatch(/recipient|subject|message_body|content/u);
    expect(migration).toContain('email monthly quota exhausted');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('REVOKE ALL ON FUNCTION reserve_email_delivery');
  });

  it('wires urgent provider delivery only through the explicit alert flag and quota ledger', () => {
    const worker = readFileSync('workers/runner/src/job-handlers.ts', 'utf8');
    expect(worker).toContain("ALERT_EMAIL_DELIVERY_ENABLED !== 'true'");
    expect(worker).toContain('new PostgresEmailDeliveryQuota');
    expect(worker).toContain('new ResendAccountUsageProvider({ apiKey })');
    expect(worker).toContain('new ResendUrgentEmailAdapter');
    expect(worker).toContain('active_platform_owner_alert_recipients()');
    expect(worker).not.toContain('ALERT_EMAIL_RECIPIENT');
  });

  it('requires account-wide daily and monthly usage before admitting a provider send', () => {
    const quota = readFileSync('packages/database/src/email-delivery-quota.ts', 'utf8');
    const migration = readFileSync(
      'packages/database/prisma/migrations/20261015033000_resend_account_quota/migration.sql',
      'utf8',
    );
    expect(quota).toContain('Account-wide email usage guard is not configured');
    expect(quota).toContain('usage.daily.used');
    expect(quota).toContain('usage.monthly.used');
    expect(migration).toContain('GREATEST(sent_count, provider_used_count)');
    expect(migration).toContain("RAISE EXCEPTION 'email daily quota exhausted'");
    expect(migration).toContain("RAISE EXCEPTION 'email monthly quota exhausted'");
  });

  it('resolves only active owner identities through a worker-only database function', () => {
    const migration = readFileSync(
      'packages/database/prisma/migrations/20261015050000_owner_alert_recipients/migration.sql',
      'utf8',
    );
    expect(migration).toContain("staff.identity_kind = 'platform_owner'");
    expect(migration).toContain("staff.status = 'active'");
    expect(migration).toContain("users.status = 'active'");
    expect(migration).toContain("legacy.role = 'platform_owner'");
    expect(migration).toContain('REVOKE ALL ON FUNCTION active_platform_owner_alert_recipients()');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION active_platform_owner_alert_recipients() TO omnireach_worker',
    );
    expect(migration).toContain('sum(units)');
  });
});
