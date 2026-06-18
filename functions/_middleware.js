// Cloudflare Pages Functions middleware — chạy trên MỌI request ở edge.
// Bảo vệ Basic Auth theo từng folder (project) cấp 1 của đường dẫn.
//
// Một folder "X" cần mật khẩu khi:
//   - X nằm trong protected-folders.js (sinh từ protected.list), HOẶC
//   - tồn tại secret env "PW_<X>"
//   trong đó <X> = tên folder viết HOA, mọi ký tự ngoài [A-Z0-9] đổi thành "_"
//   (vd: /reports/.. -> PW_REPORTS ; /project-a/.. -> PW_PROJECT_A).
//
// FAIL-CLOSED: nếu folder được đánh dấu bảo vệ nhưng THIẾU secret -> trả 403 (KHÔNG để public).
// Đây là điểm an toàn quan trọng: không bao giờ "hiện 🔒 nhưng thực ra public".
//
// Set/đổi mật khẩu: ./protect.sh <folder> [password]  (lưu dạng secret, KHÔNG vào git).

import PROTECTED from './protected-folders.js';
const protectedFolders = new Set(PROTECTED);

const keyFor = (seg) =>
  'PW_' + decodeURIComponent(seg).toUpperCase().replace(/[^A-Z0-9]/g, '_');

function passwordFromHeader(header) {
  try {
    const bin = atob(header.slice(6).trim()); // bỏ "Basic "
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes); // "user:pass" (UTF-8 an toàn)
    const i = text.indexOf(':');
    return i >= 0 ? text.slice(i + 1) : '';
  } catch {
    return '';
  }
}

// So sánh hằng thời gian, tránh timing attack.
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let r = 0;
  for (let i = 0; i < ab.length; i++) r |= ab[i] ^ bb[i];
  return r === 0;
}

const baseHeaders = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

function needPassword(folder) {
  const realm = folder.replace(/["\\]/g, '');
  return new Response('🔒 Cần mật khẩu để xem thư mục này.', {
    status: 401,
    headers: { ...baseHeaders, 'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"` },
  });
}

function misconfigured() {
  // Đánh dấu bảo vệ nhưng chưa có secret -> khoá hẳn, không hiện popup vô nghĩa.
  return new Response('🔒 Thư mục này được bảo vệ nhưng chưa cấu hình mật khẩu. Vui lòng liên hệ chủ trang.', {
    status: 403,
    headers: baseHeaders,
  });
}

export const onRequest = async ({ request, env, next }) => {
  const { pathname } = new URL(request.url);
  const seg = pathname.split('/').filter(Boolean)[0];
  if (!seg) return next(); // trang gốc: public

  const folder = decodeURIComponent(seg);
  const expected = env[keyFor(seg)];
  const mustAuth = protectedFolders.has(folder) || !!expected;
  if (!mustAuth) return next(); // folder không bảo vệ

  if (!expected) return misconfigured(); // fail-closed

  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Basic ') && safeEqual(passwordFromHeader(auth), expected)) {
    return next();
  }
  return needPassword(folder);
};
