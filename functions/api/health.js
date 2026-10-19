// GET /api/health — tiny liveness/config check (no auth, no R2 read).
import { jsonResponse } from '../_http.js';

export const onRequestGet = async ({ env }) => {
  const ok = !!env.ARTIFACTS;
  return jsonResponse(
    { ok, service: 'artifacts', time: new Date().toISOString() },
    ok ? 200 : 503,
  );
};
