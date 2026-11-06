/** Deployment configuration: reject mistakes before opening the listener. */
export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const values = env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [];
  if (env.NODE_ENV === 'production' && !values.length) {
    throw new Error('ALLOWED_ORIGINS is required in production. Set it to the actual public HTTPS origin; see docs/BONTO.md.');
  }
  const allowedOrigins = [...new Set(values.map(value => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('ALLOWED_ORIGINS must contain HTTP(S) origins, not wildcards or paths'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('ALLOWED_ORIGINS must contain HTTP(S) origins, not wildcards or paths');
    }
    return url.origin;
  }))];
  return { port, allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined };
}
