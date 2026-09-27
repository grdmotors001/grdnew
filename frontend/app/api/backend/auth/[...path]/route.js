import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function proxy(request, context) {
  const { path = [] } = await context.params;
  const authPath = path.map((part) => encodeURIComponent(part)).join('/');
  const incomingUrl = new URL(request.url);
  const target = new URL(`/api/auth/${authPath}${incomingUrl.search}`, incomingUrl.origin);

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (['host', 'content-length', 'connection'].includes(key.toLowerCase())) continue;
    headers.set(key, value);
  }

  let body;
  if (!['GET', 'HEAD'].includes(request.method)) body = await request.arrayBuffer();

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[node-auth-bridge]', request.method, target, error);
    return NextResponse.json({ error: `Node auth unavailable: ${error?.message || 'request failed'}` }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
