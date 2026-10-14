import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('email delivery activation boundaries', () => {
  it('never activates public inquiry delivery from credential presence alone', () => {
    const source = readFileSync('apps/api/src/main.ts', 'utf8');
    expect(source).toContain(
      'const platformInquiryDeliveryEnabled = config.CONTACT_DELIVERY_ENABLED;',
    );
    expect(source).not.toContain(
      'const platformInquiryDeliveryEnabled = Boolean(config.RESEND_API_KEY)',
    );
    expect(source).toContain('deliveryEnabled: config.CONTACT_DELIVERY_ENABLED');
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
    expect(worker).toContain('new ResendUrgentEmailAdapter');
  });
});
