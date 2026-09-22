import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const backend =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'https://grdnew-backend.vercel.app';

async function proxy(request, context) {
  const { path = [] } = await context.params;
  const backendPath = path.map((part) => encodeURIComponent(part)).join('/');
  const incomingUrl = new URL(request.url);
  const target = `${backend.replace(/\\/$/, '')}/api/auth/${backendPath}${incomingUrl.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (['host', 'content-length', 'connection'].includes(key.toLowerCase())) continue;
    headers.set(key, value);
  }

  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);

  let body;
  if (!['GET', 'HEAD'].includes(request.method)) {
    body = await request.arrayBuffer();
  }

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
    console.error('[backend-auth-proxy]', request.method, target, error);
    return NextResponse.json(
      { error: `Backend unavailable: ${error?.message || 'request failed'}` },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
