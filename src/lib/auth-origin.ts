const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

export function authOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  // Next.js can put its bind hostname in the request URL. Keep local auth
  // redirects on the browser's hostname so its host-only cookies still apply.
  if (host && loopback.test(url.host) && loopback.test(host)) url.host = host;
  return url.origin;
}
