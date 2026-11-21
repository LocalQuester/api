import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { authRoutes } from './auth/routes.js';

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

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
