import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { authorizationUrl, fetchProfile, isProvider } from './providers.js';
import { createLoginTicket, deleteSession, exchangeLoginTicket, findOrCreateUser, getSessionUser } from './store.js';

function config() {
  const api = process.env.PUBLIC_API_URL;
  const web = process.env.WEB_ORIGIN;
  if (!api || !web) throw new Error('PUBLIC_API_URL and WEB_ORIGIN are required');
  return { api: new URL(api).origin, web: new URL(web).origin };
}

function bearer(header: string | undefined) {
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export async function authRoutes(app: FastifyInstance) {
  app.get<{ Params: { provider: string }; Querystring: { challenge?: string } }>('/auth/:provider/start', async (request, reply) => {
    if (!isProvider(request.params.provider)) return reply.code(404).send({ error: 'unknown_provider' });
    const { api } = config();
    const challenge = request.query.challenge;
    if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge)) return reply.code(400).send({ error: 'invalid_challenge' });
    reply.setCookie('lq_oauth_challenge', challenge, { httpOnly: true, secure: api.startsWith('https:'), sameSite: 'lax', path: '/auth', maxAge: 600 });
    const state = randomBytes(32).toString('base64url');
    reply.setCookie('lq_oauth_state', state, {
      httpOnly: true, secure: api.startsWith('https:'), sameSite: 'lax', path: '/auth', maxAge: 600,
    });
    return reply.redirect(authorizationUrl(request.params.provider, state, `${api}/auth/${request.params.provider}/callback`));
  });

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/:provider/callback', async (request, reply) => {
      if (!isProvider(request.params.provider)) return reply.code(404).send({ error: 'unknown_provider' });
      const { api, web } = config();
      const { code, state, error } = request.query;
      const expected = request.cookies.lq_oauth_state;
      const challenge = request.cookies.lq_oauth_challenge;
      reply.clearCookie('lq_oauth_state', { path: '/auth' });
      reply.clearCookie('lq_oauth_challenge', { path: '/auth' });
      if (error) return reply.redirect(`${web}/login?error=provider`);
      if (typeof code !== 'string' || typeof state !== 'string' || !expected || !challenge || Buffer.byteLength(state) !== Buffer.byteLength(expected) ||
          !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
        return reply.code(400).send({ error: 'invalid_oauth_state' });
      }
      try {
        const profile = await fetchProfile(request.params.provider, code, `${api}/auth/${request.params.provider}/callback`);
        const userId = await findOrCreateUser(request.params.provider, profile);
        const ticket = await createLoginTicket(userId, challenge);
        return reply.redirect(`${web}/api/auth/callback?ticket=${encodeURIComponent(ticket)}`);
      } catch (cause) {
        request.log.error({ err: cause }, 'OAuth callback failed');
        return reply.redirect(`${web}/login?error=login`);
      }
    },
  );

  app.post<{ Body: { ticket?: string; verifier?: string } }>('/auth/exchange', async (request, reply) => {
    const ticket = request.body?.ticket;
    if (typeof ticket !== 'string' || ticket.length > 128) return reply.code(400).send({ error: 'invalid_ticket' });
    const verifier = request.body?.verifier;
    if (typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) return reply.code(400).send({ error: 'invalid_verifier' });
    const session = await exchangeLoginTicket(ticket, verifier);
    if (!session) return reply.code(401).send({ error: 'expired_ticket' });
    return session;
  });

  app.get('/auth/me', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: 'unauthorized' });
    const user = await getSessionUser(token);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return { user };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = bearer(request.headers.authorization);
    if (token) await deleteSession(token);
    return reply.code(204).send();
  });
}
