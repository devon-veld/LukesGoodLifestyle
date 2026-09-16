/* /api/img?f=<hash>.<ext> — serves an uploaded product image from Blobs.
   The filename is the image's own content hash, so a given URL always returns
   the same bytes and is safe to cache for a year. */
import { store } from './lib/util.mjs';

const TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };
const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

export default async (req) => {
  const f = new URL(req.url).searchParams.get('f') || '';
  if (!/^[a-f0-9]{16,64}\.(webp|jpg|png)$/.test(f)) return notFound();

  const data = await store().get('img/' + f, { type: 'arrayBuffer' });
  if (!data) return notFound();

  return new Response(data, {
    status: 200,
    headers: {
      'content-type': TYPES[f.split('.').pop()],
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
};

export const config = { path: '/api/img' };
