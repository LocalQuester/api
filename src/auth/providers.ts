export type Provider = 'google' | 'kakao';

export type Profile = { id: string; displayName: string | null; avatarUrl: string | null };

export function isProvider(value: string): value is Provider {
  return value === 'google' || value === 'kakao';
}

function credentials(provider: Provider) {
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) throw new Error(`${prefix} OAuth is not configured`);
  return { clientId, clientSecret };
}

export function authorizationUrl(provider: Provider, state: string, callbackUrl: string) {
  const { clientId } = credentials(provider);
  const url = new URL(provider === 'google'
    ? 'https://accounts.google.com/o/oauth2/v2/auth'
    : 'https://kauth.kakao.com/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (provider === 'google') {
    url.searchParams.set('scope', 'openid profile');
  }
  return url.toString();
}

export async function fetchProfile(provider: Provider, code: string, callbackUrl: string): Promise<Profile> {
  const { clientId, clientSecret } = credentials(provider);
  const tokenUrl = provider === 'google'
    ? 'https://oauth2.googleapis.com/token'
    : 'https://kauth.kakao.com/oauth/token';
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: clientId,
      client_secret: clientSecret, redirect_uri: callbackUrl, code,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`${provider} token exchange failed`);
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error(`${provider} access token missing`);

  const profileResponse = await fetch(provider === 'google'
    ? 'https://openidconnect.googleapis.com/v1/userinfo'
    : 'https://kapi.kakao.com/v2/user/me', {
    signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) throw new Error(`${provider} profile request failed`);
  const data = await profileResponse.json() as Record<string, unknown>;
  if (provider === 'google') {
    if (typeof data.sub !== 'string') throw new Error('Google profile id missing');
    return {
      id: data.sub,
      displayName: typeof data.name === 'string' ? data.name : null,
      avatarUrl: typeof data.picture === 'string' ? data.picture : null,
    };
  }
  const kakao = data.properties as Record<string, unknown> | undefined;
  if (typeof data.id !== 'number' && typeof data.id !== 'string') throw new Error('Kakao profile id missing');
  return {
    id: String(data.id),
    displayName: typeof kakao?.nickname === 'string' ? kakao.nickname : null,
    avatarUrl: typeof kakao?.profile_image === 'string' ? kakao.profile_image : null,
  };
}
