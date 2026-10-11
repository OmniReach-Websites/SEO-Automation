import { createHash } from 'node:crypto';

import { z } from 'zod';

const stableId = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u)
  .max(100);
const relativeDirectory = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => !value.startsWith('/') && !value.includes('..') && !value.includes('\\'));
const routePath = z
  .string()
  .startsWith('/')
  .max(300)
  .refine((value) => !value.includes('..') && !value.includes('\\') && !value.includes('?'));
const editorRole = z.enum([
  'platform_owner',
  'platform_admin',
  'staff',
  'customer_owner',
  'customer_editor',
]);

const fieldSchema = z.object({
  aiMode: z.enum(['auto', 'suggestion', 'disabled']).default('disabled'),
  componentId: stableId,
  editableBy: z.array(editorRole).min(1),
  factRef: stableId.optional(),
  id: stableId,
  label: z.string().min(1).max(120),
  protected: z.boolean().default(false),
  type: z.enum([
    'text',
    'richText',
    'image',
    'link',
    'cards',
    'metadata',
    'theme',
    'visibility',
    'sectionOrder',
  ]),
});

export const siteContractSchema = z
  .object({
    build: z.object({
      outputDirectory: relativeDirectory,
      workspace: z.string().regex(/^@omnireach\/site-[a-z0-9-]+$/u),
    }),
    components: z
      .array(z.object({ id: stableId, type: z.enum(['page', 'section', 'collection']) }))
      .min(1),
    contactForms: z
      .array(
        z.object({
          consentFieldId: stableId,
          destinationRef: stableId,
          fields: z
            .array(
              z.object({
                id: stableId,
                required: z.boolean(),
                type: z.enum(['text', 'email', 'textarea', 'consent']),
              }),
            )
            .min(1)
            .max(20),
          id: stableId,
          retentionCategory: z.enum(['contact-operational']),
        }),
      )
      .max(5)
      .default([]),
    facts: z
      .array(
        z.object({ id: stableId, kind: z.enum(['price', 'hours', 'address', 'contact', 'legal']) }),
      )
      .default([]),
    fields: z.array(fieldSchema).min(1),
    locales: z
      .array(z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u))
      .min(1)
      .max(20),
    preview: z.object({ entryRoute: stableId }),
    routes: z.array(z.object({ componentId: stableId, id: stableId, path: routePath })).min(1),
    site: z.object({ id: stableId, sourcePath: relativeDirectory }),
    version: z.literal('1.0'),
  })
  .superRefine((contract, context) => {
    for (const [name, values] of [
      ['component', contract.components],
      ['field', contract.fields],
      ['route', contract.routes],
      ['fact', contract.facts],
      ['contact form', contract.contactForms],
    ] as const) {
      const seen = new Set<string>();
      for (const value of values) {
        if (seen.has(value.id))
          context.addIssue({ code: 'custom', message: `duplicate ${name} id: ${value.id}` });
        seen.add(value.id);
      }
    }

    const components = new Set(contract.components.map(({ id }) => id));
    const facts = new Set(contract.facts.map(({ id }) => id));
    const routes = new Set(contract.routes.map(({ id }) => id));
    if (!routes.has(contract.preview.entryRoute)) {
      context.addIssue({
        code: 'custom',
        message: `preview route does not exist: ${contract.preview.entryRoute}`,
      });
    }
    for (const route of contract.routes) {
      if (!components.has(route.componentId)) {
        context.addIssue({
          code: 'custom',
          message: `route references missing component: ${route.componentId}`,
        });
      }
    }
    for (const field of contract.fields) {
      if (!components.has(field.componentId)) {
        context.addIssue({
          code: 'custom',
          message: `field references missing component: ${field.componentId}`,
        });
      }
      if (field.protected && (!field.factRef || !facts.has(field.factRef))) {
        context.addIssue({
          code: 'custom',
          message: `protected field requires a declared fact reference: ${field.id}`,
        });
      }
      if (field.protected && field.aiMode !== 'disabled') {
        context.addIssue({
          code: 'custom',
          message: `protected field cannot enable AI: ${field.id}`,
        });
      }
    }
    for (const form of contract.contactForms) {
      const fields = new Set(form.fields.map(({ id }) => id));
      if (!fields.has(form.consentFieldId)) {
        context.addIssue({
          code: 'custom',
          message: `contact form consent field is missing: ${form.id}`,
        });
      }
    }
  });

export type SiteContract = z.infer<typeof siteContractSchema>;

export const siteContractJsonSchema = z.toJSONSchema(siteContractSchema, {
  target: 'draft-2020-12',
});

export interface ContractCompatibilityIssue {
  id: string;
  kind:
    | 'field-removed'
    | 'field-type-changed'
    | 'protection-weakened'
    | 'route-removed'
    | 'route-path-changed'
    | 'site-identity-changed';
  message: string;
}

export function contractCompatibilityIssues(
  previous: SiteContract,
  next: SiteContract,
): ContractCompatibilityIssue[] {
  const issues: ContractCompatibilityIssue[] = [];
  if (previous.site.id !== next.site.id || previous.site.sourcePath !== next.site.sourcePath) {
    issues.push({
      id: previous.site.id,
      kind: 'site-identity-changed',
      message: 'Site identity/source path cannot change through a contract upgrade',
    });
  }

  const nextFields = new Map(next.fields.map((field) => [field.id, field]));
  for (const field of previous.fields) {
    const replacement = nextFields.get(field.id);
    if (!replacement) {
      issues.push({ id: field.id, kind: 'field-removed', message: 'Stable field was removed' });
      continue;
    }
    if (replacement.type !== field.type) {
      issues.push({
        id: field.id,
        kind: 'field-type-changed',
        message: `Field type changed from ${field.type} to ${replacement.type}`,
      });
    }
    if (field.protected && !replacement.protected) {
      issues.push({
        id: field.id,
        kind: 'protection-weakened',
        message: 'A protected field cannot become unprotected through a contract upgrade',
      });
    }
  }

  const nextRoutes = new Map(next.routes.map((route) => [route.id, route]));
  for (const route of previous.routes) {
    const replacement = nextRoutes.get(route.id);
    if (!replacement) {
      issues.push({ id: route.id, kind: 'route-removed', message: 'Stable route was removed' });
    } else if (replacement.path !== route.path) {
      issues.push({
        id: route.id,
        kind: 'route-path-changed',
        message: `Route path changed from ${route.path} to ${replacement.path}`,
      });
    }
  }
  return issues;
}

export function assertContractUpgradeCompatible(previous: SiteContract, next: SiteContract): void {
  const issues = contractCompatibilityIssues(previous, next);
  if (issues.length > 0) {
    throw new Error(
      `Contract upgrade requires an explicit content/redirect migration: ${issues
        .map((issue) => `${issue.kind}:${issue.id}`)
        .join(', ')}`,
    );
  }
}

const secretPattern =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/u;

export function validateSiteContract(input: unknown): SiteContract {
  const serialized = JSON.stringify(input);
  if (secretPattern.test(serialized))
    throw new Error('manifest contains credential-shaped content');
  return siteContractSchema.parse(input);
}

export function contractHash(contract: SiteContract): string {
  return createHash('sha256').update(stableStringify(contract)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
