// JSON 404 for unknown /api/* paths (otherwise Pages falls back to index.html with 200).
import { jsonResponse } from '../_http.js';

export const onRequest = async () => jsonResponse({ error: 'Not found.' }, 404);
