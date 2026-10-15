import { renderOrapTierEditor } from '@omnireach/ui';
import { describe, expect, it } from 'vitest';

describe('ORAP tier editor', () => {
  it('renders exact owner-approved values and blocks nondeployable approved features', () => {
    const html = renderOrapTierEditor(
      {
        features: [
          {
            description: 'Structured editing',
            enabled: true,
            key: 'content.edit',
            overrideable: true,
            planId: '91000000-0000-4000-8000-000000000001',
            readiness: 'deployable',
            version: 1,
          },
          {
            description: 'Contact forms',
            enabled: false,
            key: 'contact.forms',
            overrideable: true,
            planId: '91000000-0000-4000-8000-000000000001',
            readiness: 'tested',
            version: 1,
          },
        ],
        plans: [
          {
            aiReviewCyclesPerMonth: 2,
            businessLocationLimit: 1,
            code: 'STARTER',
            commercialStatus: 'approved',
            currency: 'USD',
            customerSeatLimit: 2,
            id: '91000000-0000-4000-8000-000000000001',
            monthlyPriceCents: 50_000,
            name: 'Starter',
            pendingInvitationsCountAsSeats: true,
            seoAuditIntervalHours: 168,
            standardPageLimit: 5,
            version: 2,
          },
        ],
      },
      ['plans'],
    );

    expect(html).toContain('value="500.00"');
    expect(html).toContain('immutable version 3');
    expect(html).toMatch(/value="content\.edit:1" checked/u);
    expect(html).toMatch(/value="contact\.forms:1" disabled/u);
    expect(html).toContain('Tier editor');
  });
});
