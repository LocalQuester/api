import type { FastifyInstance } from 'fastify';
import { getSessionUser } from '../auth/store.js';
import { nicknameExists } from './store.js';
import { normalizeNickname, validateNickname } from './validation.js';

type Dependencies = {
  findSessionUser: (token: string) => Promise<{ id: string } | null | undefined>;
  nicknameExists: (nickname: string) => Promise<boolean>;
};

export async function nicknameRoutes(app: FastifyInstance, options: Partial<Dependencies>) {
  const findUser = options.findSessionUser ?? getSessionUser;
  const exists = options.nicknameExists ?? nicknameExists;
  app.get<{ Querystring: { nickname?: unknown } }>('/members/nickname/availability', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token || !await findUser(token)) return reply.code(401).send({ error: 'unauthorized' });

    const nickname = request.query.nickname;
    if (typeof nickname !== 'string') return reply.code(400).send({ error: 'invalid_nickname', reason: 'empty' });
    const validation = validateNickname(nickname);
    if (validation !== 'valid') return reply.code(400).send({ error: 'invalid_nickname', reason: validation });
    const taken = await exists(normalizeNickname(nickname));
    return { available: !taken, reason: taken ? 'taken' : null };
  });
}
