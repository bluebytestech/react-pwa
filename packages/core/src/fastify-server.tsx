import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import Fastify, { RouteHandler } from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { handler, webmanifestHandler } from './server.js';
import { ChunksMap } from './utils/asset-extract.js';
import { notBoolean } from './utils/not-boolean.js';

const fastifyServer = Fastify({
  trustProxy: true,
});

let webChunksMap: ChunksMap = {
  chunks: [],
};
try {
  const jsonStatsContent = readFileSync(
    path.resolve(__dirname, 'chunks-map.json'),
    {
      encoding: 'utf-8',
    },
  );
  webChunksMap = JSON.parse(jsonStatsContent);
} catch {
  // web-chunks's map not found
}

// Enable compression
await fastifyServer.register(fastifyCompress);

await fastifyServer.register(fastifyCookie, {
  hook: 'onRequest',
  parseOptions: {},
});

const publicFolderExists = existsSync(path.resolve(__dirname, 'public'));
fastifyServer.register(fastifyStatic, {
  root: [
    publicFolderExists && path.resolve(__dirname, 'public'),
    path.resolve(__dirname, 'build'),
  ].filter(notBoolean),
  prefix: '/',
  wildcard: false,
  setHeaders: (res, pathname) => {
    if (pathname.indexOf('/build/') && pathname.indexOf('sw.js') === -1) {
      // We ask the build assets to be cached for 1 year as it would be immutable
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
});

const requestHandler: RouteHandler = (request, reply) => {
  try {
    handler(request, reply, webChunksMap);
  } catch (ex) {
    reply.send('Error');
    // eslint-disable-next-line no-console
    console.log(ex);
  }
};

const init = async () => {
  const manigestRouteExists = fastifyServer.hasRoute({
    url: '/manifest.webmanifest',
    method: 'GET',
  });
  if (!manigestRouteExists) {
    fastifyServer.get('/manifest.webmanifest', webmanifestHandler);
  }

  fastifyServer.get('*', requestHandler);
  fastifyServer.post('*', requestHandler);
  return fastifyServer;
};

if (require.main === module) {
  const port = +(process?.env?.PORT ?? '0') || 3000;
  // Add host from env
  const host = (process?.env?.HOST ?? '0.0.0.0') || '0.0.0.0';
  const initedServer = await init();
  await initedServer.listen({
    port,
    host,
  });
  // eslint-disable-next-line no-console
  console.info(`Server now listening on http://${host}:${port}`);
}

export default init;
