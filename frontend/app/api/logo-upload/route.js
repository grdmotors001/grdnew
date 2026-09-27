import { NextResponse } from 'next/server';
import { writeFile, mkdir, readdir, unlink } from 'fs/promises';
import path from 'path';

// Runs on the Node.js server (not proxied to the Flask backend), because it
// needs direct filesystem access to write into /public/UMRN — the same
// folder the Delivery Challan / Invoice print views read logos from
// (see components/PrintDocs.jsx and public/UMRN/README.txt).
export const runtime = 'nodejs';

const UMRN_DIR = path.join(process.cwd(), 'public', 'UMRN');
// UMRN Code is used directly as a filename, so only allow safe characters
// (letters, numbers, dash, underscore) — this also blocks path traversal.
const CODE_RE = /^[A-Za-z0-9_-]+$/;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(request) {
  try {
    const form = await request.formData();
    const code = String(form.get('umrn_code') || '').trim();
    const file = form.get('file');

    if (!code) {
      return NextResponse.json({ error: 'Enter the UMRN Code first, then upload the logo.' }, { status: 400 });
    }
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: 'UMRN Code can only contain letters, numbers, - and _ (this becomes the filename).' }, { status: 400 });
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No image file received.' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Logo image must be under 5 MB.' }, { status: 400 });
    }

    await mkdir(UMRN_DIR, { recursive: true });

    // Clear out any previously uploaded logo for this code under a different
    // extension, so exactly one file (the new one) matches this UMRN Code.
    const existing = await readdir(UMRN_DIR).catch(() => []);
    const stale = existing.filter(
      (f) => f.toLowerCase() !== '_default.png' && f.toLowerCase().startsWith(code.toLowerCase() + '.')
    );
    await Promise.all(stale.map((f) => unlink(path.join(UMRN_DIR, f)).catch(() => {})));

    // The client already converts the image to JPEG before upload, so the
    // bytes here match the .jpg extension the print views expect.
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(UMRN_DIR, `${code}.jpg`), buffer);

    return NextResponse.json({ ok: true, path: `/UMRN/${code}.jpg` });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Upload failed.' }, { status: 500 });
  }
}
