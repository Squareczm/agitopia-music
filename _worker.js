export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /audio/* → R2 proxy with CORS
    if (url.pathname.startsWith('/audio/')) {
      const key = url.pathname.slice(7);
      const obj = await env.ainovalife_music.get(key);
      if (!obj) return new Response('Not found', { status: 404 });

      const headers = {
        'Content-Type': obj.httpMetadata?.contentType || 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'ETag': obj.httpEtag,
      };

      if (request.headers.has('range')) {
        const range = request.headers.get('range');
        const parts = range.replace('bytes=', '').split('-');
        const start = parseInt(parts[0]);
        const end = parts[1] ? parseInt(parts[1]) : obj.size - 1;
        headers['Content-Range'] = `bytes ${start}-${end}/${obj.size}`;
        headers['Content-Length'] = String(end - start + 1);
        return new Response(obj.body.slice(start, end + 1), { status: 206, headers });
      }

      headers['Content-Length'] = String(obj.size);
      return new Response(obj.body, { headers });
    }

    // Everything else → static assets
    return env.ASSETS.fetch(request);
  }
};
