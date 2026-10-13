export const googleOAuthCallbackCookieName = '__Secure-omnireach_google_oauth';

export const googleOAuthCallbackCookieOptions = {
  httpOnly: true as const,
  maxAge: 5 * 60,
  path: '/v1/orap/integrations/google/callback',
  sameSite: 'lax' as const,
  secure: true as const,
};
