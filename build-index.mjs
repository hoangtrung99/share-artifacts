#!/usr/bin/env node
// Sinh index.html "file browser" cho MỖI thư mục con của public/.
// - Vào artifacts.hoangtrung.dev/        -> liệt kê project + file
// - Vào .../project-a/                    -> liệt kê file trong project-a
// - Link .html trực tiếp vẫn xem bình thường
//
// An toàn: chỉ ghi đè index.html nếu file đó KHÔNG tồn tại, hoặc do chính
// script này sinh ra (nhận diện qua MARKER). index.html "thật" của bạn được giữ nguyên.
//
// Dùng: node build-index.mjs [public_dir]

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'public');
const MARKER = '<!-- auto-index:v1 -->';

if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`❌ Không tìm thấy thư mục: ${ROOT}`);
  process.exit(1);
}

// Danh sách folder được bảo vệ (chỉ TÊN folder, KHÔNG phải mật khẩu) -> hiển thị badge 🔒.
// Nguồn sự thật về bảo vệ là secret Cloudflare; file này chỉ để render UI.
const PROTECTED_LIST = path.resolve(ROOT, '..', 'protected.list');
const protectedSet = fs.existsSync(PROTECTED_LIST)
  ? new Set(fs.readFileSync(PROTECTED_LIST, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))
  : new Set();

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const fmtSize = (b) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const iconFor = (name, isDir) => {
  if (isDir) return '📁';
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'html' || ext === 'htm') return '📄';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(ext)) return '🖼️';
  if (ext === 'pdf') return '📕';
  if (['json', 'csv', 'txt', 'md'].includes(ext)) return '📃';
  return '📎';
};

// Đếm số file .html (đệ quy) bên trong 1 thư mục — hiển thị badge.
function countHtml(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) n += countHtml(full);
    else if (/\.html?$/i.test(e.name) && e.name !== 'index.html') n += 1;
  }
  return n;
}

function listDir(dir) {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .filter((e) => !(e.isFile() && e.name === 'index.html'));
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const files = entries.filter((e) => e.isFile()).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  return { dirs, files };
}

function breadcrumb(parts) {
  const depth = parts.length;
  let html = `<a href="${depth === 0 ? './' : '../'.repeat(depth)}">🏠 artifacts</a>`;
  parts.forEach((p, i) => {
    const up = depth - 1 - i;
    const href = up === 0 ? './' : '../'.repeat(up);
    html += `<span class="sep">/</span><a href="${href}">${esc(p)}</a>`;
  });
  return html;
}

function rowHtml({ name, href, icon, meta }) {
  return `<li class="row" data-name="${esc(name.toLowerCase())}">
      <a href="${esc(href)}"><span class="ico">${icon}</span><span class="nm">${esc(name)}</span><span class="meta">${meta}</span></a>
    </li>`;
}

function renderPage(dir) {
  const parts = path.relative(ROOT, dir) === '' ? [] : path.relative(ROOT, dir).split(path.sep);
  const { dirs, files } = listDir(dir);
  const title = parts.length ? parts.join('/') : 'artifacts';

  const rows = [];
  for (const d of dirs) {
    const c = countHtml(path.join(dir, d));
    const locked = parts.length === 0 && protectedSet.has(d); // chỉ folder cấp 1 mới khoá
    rows.push(
      rowHtml({
        name: d,
        href: encodeURIComponent(d) + '/',
        icon: locked ? '🔒' : '📁',
        meta: locked ? 'cần mật khẩu' : c ? `${c} file` : '—',
      })
    );
  }
  for (const f of files) {
    const st = fs.statSync(path.join(dir, f));
    rows.push(
      rowHtml({
        name: f,
        href: encodeURIComponent(f),
        icon: iconFor(f, false),
        meta: `${fmtSize(st.size)} · ${fmtDate(st.mtime)}`,
      })
    );
  }

  const total = dirs.length + files.length;
  const body = total
    ? `<ul class="list">${rows.join('\n')}</ul>`
    : `<p class="empty">Thư mục trống.</p>`;

  return `${MARKER}
<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · artifacts</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --muted:#6b7280; --line:#e5e7eb; --hover:#f3f4f6; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --fg:#e6e6e6; --muted:#9ca3af; --line:#262b33; --hover:#1a1d24; --accent:#60a5fa; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  .wrap { max-width: 56rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  .crumb { display:flex; flex-wrap:wrap; align-items:center; gap:.35rem; font-size:.95rem; margin-bottom:1rem; }
  .crumb a { color:var(--accent); text-decoration:none; }
  .crumb a:hover { text-decoration:underline; }
  .sep { color:var(--muted); }
  .bar { display:flex; align-items:center; gap:.75rem; margin-bottom:.75rem; }
  .bar h1 { font-size:1.15rem; margin:0; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .count { color:var(--muted); font-size:.85rem; white-space:nowrap; }
  #q { width:100%; padding:.55rem .75rem; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; font:inherit; margin-bottom:1rem; }
  #q:focus { outline:none; border-color:var(--accent); }
  .list { list-style:none; margin:0; padding:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .row + .row { border-top:1px solid var(--line); }
  .row a { display:flex; align-items:center; gap:.7rem; padding:.65rem .9rem; text-decoration:none; color:inherit; }
  .row a:hover { background:var(--hover); }
  .ico { font-size:1.05rem; width:1.4rem; text-align:center; flex:none; }
  .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .meta { color:var(--muted); font-size:.8rem; white-space:nowrap; flex:none; }
  .empty { color:var(--muted); padding:2rem; text-align:center; border:1px dashed var(--line); border-radius:10px; }
  .foot { margin-top:1.5rem; color:var(--muted); font-size:.78rem; }
  .hidden { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <nav class="crumb">${breadcrumb(parts)}</nav>
  <div class="bar">
    <h1>${esc('/' + title.replace(/^artifacts$/, ''))}</h1>
    <span class="count">${total} mục</span>
  </div>
  ${total ? `<input id="q" type="search" placeholder="Lọc theo tên…" autocomplete="off">` : ''}
  ${body}
  <p class="foot">artifacts.hoangtrung.dev — tự sinh khi deploy</p>
</div>
<script>
  const q = document.getElementById('q');
  if (q) {
    q.addEventListener('input', () => {
      const v = q.value.trim().toLowerCase();
      for (const li of document.querySelectorAll('.row')) {
        li.classList.toggle('hidden', v && !li.dataset.name.includes(v));
      }
    });
  }
</script>
</body>
</html>
`;
}

// Đệ quy: sinh index cho ROOT và mọi thư mục con.
let written = 0,
  skipped = 0,
  dirsSeen = 0;

function walk(dir) {
  dirsSeen += 1;
  const indexPath = path.join(dir, 'index.html');
  let canWrite = true;
  if (fs.existsSync(indexPath)) {
    const head = fs.readFileSync(indexPath, 'utf8').slice(0, 64);
    canWrite = head.includes(MARKER); // chỉ ghi đè file do chính mình sinh
  }
  if (canWrite) {
    fs.writeFileSync(indexPath, renderPage(dir));
    written += 1;
  } else {
    skipped += 1;
    console.log(`  ⏭  giữ nguyên index.html thật: ${path.relative(ROOT, indexPath) || 'index.html'}`);
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.')) walk(path.join(dir, e.name));
  }
}

walk(ROOT);

// Sinh danh sách folder bảo vệ cho middleware (để fail-closed) — đồng bộ từ protected.list.
const fnDir = path.resolve(ROOT, '..', 'functions');
if (fs.existsSync(fnDir)) {
  fs.writeFileSync(
    path.join(fnDir, 'protected-folders.js'),
    `// AUTO-GENERATED từ protected.list bởi build-index.mjs — ĐỪNG sửa tay.\nexport default ${JSON.stringify([...protectedSet].sort())};\n`
  );
}

console.log(`✅ index đã sinh: ${written} | bỏ qua (index thật): ${skipped} | thư mục: ${dirsSeen} | tổng .html: ${countHtml(ROOT)} | folder bảo vệ: ${protectedSet.size}`);
