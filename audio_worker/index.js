export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    if (!key) return new Response('audio.ainovalife.com', { status: 200 });

    const obj = await env.ainovalife_music.get(key);
    if (!obj) return new Response('Not found', { status: 404 });

    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'audio/mpeg',
        'Content-Length': String(obj.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'ETag': obj.httpEtag,
      }
    });
  }
};
