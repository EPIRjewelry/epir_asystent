import { RemixServer } from '@remix-run/react';
import type { EntryContext } from '@remix-run/server-runtime';
import { renderToReadableStream } from 'react-dom/server';

export default async function handleRequest(
  request: Request,
  statusCode: number,
  headers: Headers,
  remixContext: EntryContext
) {
  const body = await renderToReadableStream(
    <RemixServer context={remixContext} url={request.url} />,
    { signal: request.signal }
  );

  headers.set('Content-Type', 'text/html');
  return new Response(body, { status: statusCode, headers });
}
