import {
  assertContractUpgradeCompatible,
  contractCompatibilityIssues,
  contractHash,
  siteContractJsonSchema,
  validateSiteContract,
} from '@omnireach/contracts';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const valid = {
  version: '1.0',
  site: { id: 'fictional-site', sourcePath: 'sites/fictional-site' },
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
  build: { workspace: '@omnireach/site-fictional', outputDirectory: 'dist' },
  contactForms: [],
} as const;

describe('versioned site contract', () => {
  it('validates and deterministically hashes a V1 manifest', () => {
    const contract = validateSiteContract(valid);
    expect(contractHash(contract)).toMatch(/^[a-f0-9]{64}$/u);
    expect(contractHash(contract)).toBe(contractHash(validateSiteContract(structuredClone(valid))));
  });

  it.each([
    ['duplicate field IDs', { ...valid, fields: [valid.fields[0], valid.fields[0]] }],
    ['traversal source path', { ...valid, site: { ...valid.site, sourcePath: '../outside' } }],
    [
      'missing fact reference',
      { ...valid, fields: [{ ...valid.fields[1], factRef: 'business.missing' }] },
    ],
    ['protected AI mode', { ...valid, fields: [{ ...valid.fields[1], aiMode: 'auto' }] }],
  ])('rejects %s', (_name, manifest) => {
    expect(() => validateSiteContract(manifest)).toThrow();
  });

  it('rejects credential-shaped manifest values without storing a credential fixture', () => {
    const synthetic = ['s', 'k'].join('') + '-proj-' + 'A'.repeat(32);
    expect(() => validateSiteContract({ ...valid, unexpected: synthetic })).toThrow(
      'credential-shaped content',
    );
  });

  it('exports a machine-readable JSON Schema for developer tooling', () => {
    expect(siteContractJsonSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
    });
    expect(JSON.stringify(siteContractJsonSchema)).toContain('contactForms');
  });

  it('permits additive evolution but rejects stable field, route, and protection breaks', () => {
    const previous = validateSiteContract(valid);
    const additive = validateSiteContract({
      ...valid,
      fields: [
        ...valid.fields,
        {
          aiMode: 'suggestion',
          componentId: 'home',
          editableBy: ['customer_owner'],
          id: 'home.subtitle',
          label: 'Subtitle',
          protected: false,
          type: 'text',
        },
      ],
    });
    expect(() => assertContractUpgradeCompatible(previous, additive)).not.toThrow();

    const breaking = validateSiteContract({
      ...valid,
      fields: [{ ...valid.fields[1], protected: false, factRef: undefined }],
      routes: [{ ...valid.routes[0], path: '/welcome' }],
    });
    expect(contractCompatibilityIssues(previous, breaking).map(({ kind }) => kind)).toEqual([
      'field-removed',
      'protection-weakened',
      'route-path-changed',
    ]);
    expect(() => assertContractUpgradeCompatible(previous, breaking)).toThrow(
      'explicit content/redirect migration',
    );
  });
});

describe('OmniReach public legal routes', () => {
  it('exposes protected owner-only terms content on only the OmniReach public site', () => {
    const sitesRoot = resolve(import.meta.dirname, '../../sites');
    const manifests = readdirSync(sitesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        directory: entry.name,
        contract: validateSiteContract(
          JSON.parse(
            readFileSync(resolve(sitesRoot, entry.name, 'site.manifest.json'), 'utf8'),
          ) as unknown,
        ),
      }));
    const termsSites = manifests.filter(({ contract }) =>
      contract.routes.some(({ path }) => path === '/tos/'),
    );

    expect(termsSites.map(({ directory }) => directory)).toEqual(['omnireach']);
    const termsContract = termsSites[0]?.contract;
    expect(termsContract?.routes).toContainEqual({
      componentId: 'terms',
      id: 'terms',
      path: '/tos/',
    });
    expect(termsContract?.fields).toContainEqual({
      aiMode: 'disabled',
      componentId: 'terms',
      editableBy: ['platform_owner'],
      factRef: 'legal.terms',
      id: 'terms.content',
      label: 'Terms of Service',
      protected: true,
      type: 'richText',
    });
  });
});
