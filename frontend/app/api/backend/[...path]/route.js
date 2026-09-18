import { NextResponse } from 'next/server';

const backend = process.env.BACKEND_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:5000' : '');

async function proxy(request, context) {
  if (!backend) {
    return NextResponse.json({ error: 'Backend is not configured. Set BACKEND_URL in the Vercel Production environment.' }, { status: 500 });
  }
  const { path = [] } = await context.params;
  const backendPath = path.map((part) => encodeURIComponent(part)).join('/');
  const incomingUrl = new URL(request.url);
  const target = `${backend.replace(/\/$/, '')}/api/${backendPath}${incomingUrl.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    // Hop-by-hop / host headers must not be forwarded to Flask.
    if (['host', 'content-length', 'connection'].includes(key.toLowerCase())) continue;
    headers.set(key, value);
  }

  // Explicitly forward the bearer token used by the Flask API.
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
    console.error(`[backend-proxy] ${request.method} ${target}`, error);
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
