import { ResendContactDelivery } from '@omnireach/integrations';
import { describe, expect, it, vi } from 'vitest';

const submission = {
  confirmationEnabled: false,
  email: 'person@example.test',
  fields: {
    consent: true as const,
    email: 'person@example.test',
    message: 'Hello',
    name: 'Fictional Person',
  },
  formId: 'general-inquiry',
  recipientEmail: 'inbox@example.test',
  siteId: 'site-a',
};

describe('Resend contact adapter', () => {
  it('sends only to the verified recipient when confirmation is disabled', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockResolvedValue(Response.json({ id: 'resend-primary' }, { status: 200 }));
    const adapter = new ResendContactDelivery({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'forms@updates.omnireach.cloud',
    });
    await expect(adapter.deliver(submission)).resolves.toEqual({
      providerReference: 'resend-primary',
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const request = fetchImplementation.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      reply_to: 'person@example.test',
      to: ['inbox@example.test'],
    });
  });

  it('sends a second bounded message only when confirmation is enabled', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'resend-primary' }))
      .mockResolvedValueOnce(Response.json({ id: 'resend-confirmation' }));
    const adapter = new ResendContactDelivery({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'forms@updates.omnireach.cloud',
    });
    await adapter.deliver({ ...submission, confirmationEnabled: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body))).toMatchObject({
      to: ['person@example.test'],
    });
  });

  it('does not report the primary delivery as failed when optional confirmation fails', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'resend-primary' }))
      .mockResolvedValueOnce(Response.json({ message: 'failed' }, { status: 503 }));
    const adapter = new ResendContactDelivery({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'forms@updates.omnireach.cloud',
    });
    await expect(adapter.deliver({ ...submission, confirmationEnabled: true })).resolves.toEqual({
      confirmationFailed: true,
      providerReference: 'resend-primary',
    });
  });

  it('rejects invalid sender and recipient addresses before provider delivery', async () => {
    expect(
      () =>
        new ResendContactDelivery({
          apiKey: 'fictional-resend-key',
          from: 'invalid',
        }),
    ).toThrow('sender');
    const fetchImplementation = vi.fn<typeof fetch>();
    const adapter = new ResendContactDelivery({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'forms@updates.omnireach.cloud',
    });
    await expect(adapter.deliver({ ...submission, recipientEmail: 'invalid' })).rejects.toThrow(
      'recipient',
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
