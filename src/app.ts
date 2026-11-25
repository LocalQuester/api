import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { authRoutes } from './auth/routes.js';
import { nicknameRoutes } from './nickname/routes.js';

export function buildApp() {
  const app = Fastify({
    logger: {
      serializers: {
        req: (request) => ({ method: request.method }),
      },
    },
  });

  app.register(cookie);
  app.register(authRoutes);
  app.register(nicknameRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
