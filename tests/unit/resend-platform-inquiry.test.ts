import { ResendPlatformInquiryDelivery } from '@omnireach/integrations';
import { describe, expect, it, vi } from 'vitest';

describe('Resend platform inquiry adapter', () => {
  it('sends one replyable message to every unique active owner recipient', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: 'resend-inquiry' }));
    const delivery = new ResendPlatformInquiryDelivery({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'forms@updates.omnireach.cloud',
    });

    await expect(
      delivery.deliver({
        businessName: 'Fictional Bakery',
        email: 'visitor@example.test',
        message: 'We need a new website for our neighborhood bakery.',
        name: 'Fictional Visitor',
        recipients: ['owner-one@example.test', 'OWNER-ONE@example.test', 'owner-two@example.test'],
      }),
    ).resolves.toEqual({ providerReference: 'resend-inquiry' });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body))).toMatchObject({
      from: 'forms@updates.omnireach.cloud',
      reply_to: 'visitor@example.test',
      to: ['owner-one@example.test', 'owner-two@example.test'],
    });
  });

  it('rejects an empty or invalid owner recipient set before provider delivery', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = new ResendPlatformInquiryDelivery({
      apiKey: 'fictional-resend-key',
      fetchImplementation,
      from: 'forms@updates.omnireach.cloud',
    });
    await expect(
      delivery.deliver({
        email: 'visitor@example.test',
        message: 'A sufficiently long inquiry.',
        name: 'Visitor',
        recipients: [],
      }),
    ).rejects.toThrow('recipients');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
