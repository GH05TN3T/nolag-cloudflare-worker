// Deploy from GitHub with Workers Builds, or locally with `npm run deploy`.
// This filters the supplied dumper's default Requests header profile. It is
// a bypassable heuristic, not proof of a client process or memory protection.
export function createGuard(fetchRequest = (...args) => fetch(...args)) {
  const reported = new Map();

  return {
    async fetch(request, env, context) {
      const url = new URL(request.url);
      const host = String(env.NOLAG_HOST || '').toLowerCase();
      const hosts = new Set([host, ...String(env.NOLAG_HOST_ALIASES || '').split(',').map(alias => alias.trim().toLowerCase()).filter(Boolean)]);
      const serverId = String(env.NOLAG_SERVER_ID || '');
      if (!host || !/^[1-9]\d*$/.test(serverId)) {
        return new Response('NOLAG edge configuration required', { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      const pathPrefix = `/servers/${serverId}/files/`;
      if (!hosts.has(url.hostname) || !url.pathname.startsWith(pathPrefix) ||
          !['GET', 'HEAD'].includes(request.method) || request.headers.get('User-Agent') !== 'CitizenFX/1') {
        return fetchRequest(request);
      }

      // Cloudflare rewrites Accept-Encoding/Connection before origin fetches.
      // cf.clientAcceptEncoding is trusted edge metadata; never substitute a
      // client-supplied X-Original-* header or the normalized origin header.
      const original = typeof request.cf?.clientAcceptEncoding === 'string'
        ? request.cf.clientAcceptEncoding.toLowerCase().trim() : '';
      const requestsProfile = /^gzip\s*,\s*deflate(?:\s*,\s*(?:br|zstd))*$/.test(original);
      if (!requestsProfile) return fetchRequest(request);

      const ip = request.headers.get('CF-Connecting-IP') || '';
      const now = Date.now();
      const reportKey = serverId + ':' + ip;
      // Report once per IP/server/minute; Requests retries must not flood the
      // panel. Each request is still rejected, independently of reporting.
      if (context && env.NOLAG_API_KEY && env.NOLAG_PANEL_URL &&
          (!reported.has(reportKey) || now - reported.get(reportKey) >= 60000)) {
        if (reported.size >= 1024) reported.delete(reported.keys().next().value);
        reported.set(reportKey, now);
        context.waitUntil((async () => {
          try {
            const panel = new URL(env.NOLAG_PANEL_URL);
            if (panel.protocol !== 'https:' || panel.username || panel.password) throw new Error('Invalid panel URL');
            const response = await fetchRequest(new URL('/api/report', panel).href, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': env.NOLAG_API_KEY,
                'X-CitizenFX-Token': request.headers.get('X-CitizenFX-Token') || '' },
              body: JSON.stringify({ player_name: 'HTTP client profile', identifiers: { ip },
                detection_type: 'http_client_profile_blocked',
                details: 'requests_accept_encoding | ' + url.pathname.slice(0, 1024),
                action_taken: 'blocked', severity: 'medium', enforce_ip_ban: false }),
              signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) console.warn('NOLAG edge report rejected:', response.status);
            if (response.body) await response.body.cancel();
          } catch (error) { console.warn('NOLAG edge report unavailable'); }
        })());
      }

      return new Response('HTTP client profile not permitted', { status: 403,
        headers: { 'Cache-Control': 'private, no-store', 'X-Nolag-Edge-Reason': 'requests_header_profile',
          'X-Nolag-Edge-Version': '1.3.0' } });
    },
  };
}

export default createGuard();
