import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { pool } from '../../../lib/server/common';

// Vercel's file system is read-only, so logos are stored in the database (table umrn_logo)
// and served by /api/umrn-logo/<code>. Print views try that first, then the static /UMRN/ files.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const secret = process.env.JWT_SECRET || 'grd-node-change-this-secret';
// UMRN Code is used as the logo key, so only allow safe characters (letters, numbers, dash, underscore).
const CODE_RE = /^[A-Za-z0-9_-]+$/;
const MAX_SIZE = 3 * 1024 * 1024; // 3 MB (Vercel request body limit is ~4.5 MB)

export async function POST(request) {
  try {
    const h = request.headers.get('authorization') || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    try { jwt.verify(t, secret); } catch { return NextResponse.json({ error: 'Authentication required.' }, { status: 401 }); }

    const form = await request.formData();
    const code = String(form.get('umrn_code') || '').trim();
    const file = form.get('file');

    if (!code) return NextResponse.json({ error: 'Enter the UMRN Code first, then upload the logo.' }, { status: 400 });
    if (!CODE_RE.test(code)) return NextResponse.json({ error: 'UMRN Code can only contain letters, numbers, - and _.' }, { status: 400 });
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No image file received.' }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'Logo image must be under 3 MB.' }, { status: 400 });

    await pool.query(`CREATE TABLE IF NOT EXISTS umrn_logo (
      code_key text PRIMARY KEY, code text, content_type text, data bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    // The client already converts the image to JPEG before upload.
    const buffer = Buffer.from(await file.arrayBuffer());
    await pool.query(
      `INSERT INTO umrn_logo (code_key, code, content_type, data, updated_at) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (code_key) DO UPDATE SET code=EXCLUDED.code, content_type=EXCLUDED.content_type, data=EXCLUDED.data, updated_at=now()`,
      [code.toLowerCase(), code, 'image/jpeg', buffer]
    );
    return NextResponse.json({ ok: true, path: `/api/umrn-logo/${code}` });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Upload failed.' }, { status: 500 });
  }
}
