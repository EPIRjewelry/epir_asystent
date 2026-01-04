import { createRequestHandler } from '@shopify/remix-oxygen';
import * as build from '@remix-run/dev/server-build';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const handler = createRequestHandler({ build, mode: env.MODE });
    return handler(request, env, ctx);
  },
};
