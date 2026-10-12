import type { OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';

/** Matches Baguette `seedLunaroutePiOAuthCredential` expiry. */
const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

async function loginWithPaste(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const key = (
    await callbacks.onPrompt({
      message:
        'Paste your LunaRoute API key (lr_…), or set it on your Baguette agent configuration.',
    })
  ).trim();
  if (!key) throw new Error('No API key provided');
  return { access: key, refresh: '', expires: Date.now() + FAR_FUTURE_MS };
}

export const lunarouteOAuth = {
  name: 'LunaRoute',
  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    return loginWithPaste(callbacks);
  },
  async refreshToken(creds: OAuthCredentials, _signal: AbortSignal): Promise<OAuthCredentials> {
    return creds;
  },
  getApiKey(creds: OAuthCredentials): string {
    return creds.access;
  },
};
