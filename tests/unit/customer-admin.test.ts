import {
  canPublish,
  editorFields,
  renderCustomerDashboard,
  renderEditor,
  renderRevisionHistory,
  type EditorField,
} from '@omnireach/customer-admin';
import { validateSiteContract } from '@omnireach/contracts';
import { describe, expect, it } from 'vitest';

const contract = validateSiteContract({
  version: '1.0',
  site: { id: 'site-a', sourcePath: 'sites/site-a' },
  locales: ['en-US'],
  components: [{ id: 'home', type: 'page' }],
  facts: [{ id: 'business.hours', kind: 'hours' }],
  fields: [
    {
      id: 'home.heading',
      componentId: 'home',
      label: 'Heading',
      type: 'text',
      editableBy: ['customer_owner', 'customer_editor'],
      protected: false,
      aiMode: 'auto',
    },
    {
      id: 'home.hours',
      componentId: 'home',
      label: 'Hours',
      type: 'text',
      editableBy: ['customer_owner'],
      protected: true,
      factRef: 'business.hours',
      aiMode: 'disabled',
    },
  ],
  routes: [{ id: 'home', path: '/', componentId: 'home' }],
  preview: { entryRoute: 'home' },
  build: { workspace: '@omnireach/site-site-a', outputDirectory: 'dist' },
  contactForms: [],
});

describe('customer dashboard and editor', () => {
  it('renders honest unavailable states and escapes site names', () => {
    const html = renderCustomerDashboard({
      features: [{ enabled: false, label: 'Automation', reason: 'Plan disabled' }],
      integrations: [{ label: 'Analytics', status: 'not-connected' }],
      publication: { status: 'never-published' },
      siteName: '<script>bad</script>',
    });
    expect(html).toContain('not-connected');
    expect(html).toContain('never-published');
    expect(html).not.toContain('<script>');
  });

  it('renders only policy-permitted editability and never unlocks protected facts', () => {
    const fields = editorFields({
      contract,
      editingEnabled: true,
      role: 'customer_editor',
      values: { 'home.heading': 'Hello', 'home.hours': 'Always' },
    });
    expect(fields[0]?.editable).toBe(true);
    expect(fields[1]?.editable).toBe(false);
    expect(renderEditor(fields, 4)).toContain('expectedVersion');
    expect(renderEditor(fields, 4)).toContain('Verified business fact');
  });

  it('renders bounded controls for every supported structured field type', () => {
    const html = renderEditor(
      [
        'text',
        'richText',
        'image',
        'link',
        'cards',
        'metadata',
        'theme',
        'visibility',
        'sectionOrder',
      ].map((type, index) => ({
        aiMode: 'disabled' as const,
        editable: true,
        id: `field.${index}`,
        label: `Field ${index}`,
        protected: false,
        type: type as EditorField['type'],
        value: type === 'visibility' ? true : '',
      })),
      1,
    );
    for (const type of [
      'text',
      'richText',
      'image',
      'link',
      'cards',
      'metadata',
      'theme',
      'visibility',
      'sectionOrder',
    ]) {
      expect(html).toContain(`data-field-type="${type}"`);
    }
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('type="file"');
  });

  it('enforces owner/editor/viewer publication rules', () => {
    expect(canPublish('customer_owner', false)).toBe(true);
    expect(canPublish('customer_editor', false)).toBe(false);
    expect(canPublish('customer_editor', true)).toBe(true);
    expect(canPublish('customer_viewer', true)).toBe(false);
  });

  it('renders immutable revision history and exposes restore only to authorized users', () => {
    const entries = [
      {
        active: true,
        actorLabel: '<script>Customer</script>',
        createdAt: '2026-10-10T20:00:00.000Z',
        number: 3,
        origin: 'restore' as const,
        publicationPending: false,
        publicationStatus: 'published' as const,
        restoreEligible: true,
        restoredFrom: 1,
        summary: 'Restored homepage copy',
      },
    ];
    const authorized = renderRevisionHistory(entries, {
      canRestore: true,
      csrfToken: 'csrf-token',
      restoreIdempotencyKeys: { 3: '00000000-0000-4000-8000-000000000003' },
    });
    expect(authorized).toContain('restored from revision 1');
    expect(authorized).toContain('Published (active)');
    expect(authorized).toContain('Restore revision 3');
    expect(authorized).not.toContain('<script>');

    const viewer = renderRevisionHistory(entries, {
      canRestore: false,
      csrfToken: 'unused',
    });
    expect(viewer).toContain('Restore unavailable');
    expect(viewer).not.toContain('action="/history/3/restore"');
  });

  it('labels in-flight and failed publications truthfully and never offers them as restore targets', () => {
    const html = renderRevisionHistory(
      [
        {
          active: false,
          actorLabel: 'Customer',
          createdAt: '2026-10-10T20:00:00.000Z',
          number: 4,
          origin: 'customer',
          publicationPending: false,
          publicationStatus: 'failed',
          restoreEligible: false,
          summary: 'Publication failed; live content unchanged',
        },
        {
          active: false,
          actorLabel: 'Customer',
          createdAt: '2026-10-10T19:00:00.000Z',
          number: 3,
          origin: 'customer',
          publicationPending: true,
          publicationStatus: 'building',
          restoreEligible: false,
          summary: 'Publication build in progress',
        },
      ],
      { canRestore: true },
    );
    expect(html).toContain('Failed');
    expect(html).toContain('Building');
    expect(html).toContain('authoritative initial baseline');
    expect(html).not.toContain('action="/history/4/restore"');
    expect(html).not.toContain('action="/history/3/restore"');
  });
});
