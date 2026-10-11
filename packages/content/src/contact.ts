export interface ContactSubmission {
  confirmationEnabled: boolean;
  consent: true;
  email?: string;
  fields: Record<string, string | true>;
  formId: string;
  message?: string;
  name?: string;
  recipientEmail: string;
  siteId: string;
}

export interface ContactFieldDefinition {
  id: string;
  required: boolean;
  type: 'consent' | 'email' | 'text' | 'textarea';
}

export interface ContactDeliveryAdapter {
  deliver(
    submission: ContactSubmission,
  ): Promise<{ confirmationFailed?: boolean; providerReference: string }>;
}

export class MockContactDelivery implements ContactDeliveryAdapter {
  readonly deliveries: ContactSubmission[] = [];
  async deliver(submission: ContactSubmission): Promise<{ providerReference: string }> {
    this.deliveries.push(structuredClone(submission));
    return { providerReference: `mock-${this.deliveries.length}` };
  }
}

export function validateContactSubmission(input: {
  allowedOrigin: string;
  body: Record<string, unknown>;
  confirmationEnabled?: boolean;
  enabledFieldIds: readonly string[];
  expectedFormId: string;
  fields: readonly ContactFieldDefinition[];
  honeypot?: string;
  origin: string | undefined;
  recipientEmail: string;
  siteId: string;
}): ContactSubmission {
  if (input.origin !== input.allowedOrigin) throw new Error('Contact origin is not allowed');
  if (input.honeypot) throw new Error('Contact submission rejected');
  if (input.body.formId !== input.expectedFormId) throw new Error('Contact form is not allowed');

  const enabled = new Set(input.enabledFieldIds);
  const definitions = new Map(input.fields.map((field) => [field.id, field]));
  const submittedIds = Object.keys(input.body).filter((id) => id !== 'formId');
  if (submittedIds.some((id) => !enabled.has(id) || !definitions.has(id))) {
    throw new Error('Contact submission contains an unsupported field');
  }

  const normalized: Record<string, string | true> = {};
  for (const field of input.fields) {
    if (!enabled.has(field.id)) continue;
    const value = input.body[field.id];
    if (field.type === 'consent') {
      if (value !== true && value !== 'on') throw new Error('Contact consent is required');
      normalized[field.id] = true;
      continue;
    }
    if (value === undefined || value === '') {
      if (field.required) throw new Error(`Contact ${field.id} is required`);
      continue;
    }
    if (typeof value !== 'string') throw new Error(`Contact ${field.id} is invalid`);
    const text = value.trim();
    const maximum = field.type === 'textarea' ? 5_000 : field.type === 'email' ? 320 : 500;
    if ((!text && field.required) || text.length > maximum) {
      throw new Error(`Contact ${field.id} is invalid`);
    }
    if (!text) continue;
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text)) {
      throw new Error(`Contact ${field.id} is invalid`);
    }
    normalized[field.id] = field.type === 'email' ? text.toLowerCase() : text;
  }

  const emailField = input.fields.find(({ type }) => type === 'email');
  const email = emailField ? normalized[emailField.id] : undefined;
  const name = normalized.name;
  const message = normalized.message;
  return {
    confirmationEnabled: input.confirmationEnabled ?? false,
    consent: true,
    ...(typeof email === 'string' ? { email } : {}),
    fields: normalized,
    formId: input.expectedFormId,
    ...(typeof message === 'string' ? { message } : {}),
    ...(typeof name === 'string' ? { name } : {}),
    recipientEmail: input.recipientEmail,
    siteId: input.siteId,
  };
}
