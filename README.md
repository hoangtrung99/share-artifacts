# artifacts.hoangtrung.dev

Host artifact Markdown và HTML lên Cloudflare Pages để chia sẻ. Site là một app **Astro tĩnh**
(gallery + trang viewer), kèm Cloudflare Pages Functions chạy ở edge để bảo vệ một số project
bằng **trang login + signed cookie**.

- `src/artifacts/<project>/<file>.(md|html)` → publish:
  - viewer (toolbar + nội dung): `https://artifacts.hoangtrung.dev/<project>/<file>`
  - raw (file gốc, link cũ vẫn chạy): `https://artifacts.hoangtrung.dev/<project>/<file>.(md|html)`
- Trang chủ `https://artifacts.hoangtrung.dev/` là **gallery** (có Pagefind full-text search, filter theo tag).

## Cấu trúc

```
.
├── src/
│   ├── artifacts/<project>/*.(md|html)   # SOURCE OF TRUTH — tất cả artifact nằm ở đây
│   ├── pages/                            # index.astro (gallery), [...path].astro (viewer), login.astro
│   ├── layouts/Base.astro
│   ├── lib/artifacts.mjs                 # enumerate + metadata (dùng chung gallery & viewer)
│   └── styles/global.css
├── scripts/prepare-static.mjs            # prebuild: copy raw artifact -> public/, sinh protected-folders.js
├── functions/                            # Pages Functions (chạy mọi request, ở repo ROOT — KHÔNG trong dist)
│   ├── _middleware.js                    # chặn project được bảo vệ -> /login nếu chưa có cookie hợp lệ
│   ├── _auth.js                          # helper dùng chung: SNAKE key, HMAC token, constant-time compare
│   ├── login.js                          # POST /login: verify mật khẩu, set signed cookie
│   ├── logout.js                         # xoá cookie
│   └── protected-folders.js              # AUTO-SINH từ protected.list (đừng sửa tay)
├── public/                               # DERIVED — prepare-static wipe & sinh lại mỗi build (đừng commit)
├── dist/                                 # BUILD OUTPUT — astro build + pagefind (đừng commit)
├── deploy.sh                             # npm run build (prepare-static + astro + pagefind) rồi deploy
├── deliver.sh                            # publish 1 artifact bằng 1 lệnh
├── protect.sh                            # đặt/đổi/gỡ mật khẩu cho project
├── unpublish.sh                          # gỡ artifact (file hoặc cả project)
├── protected.list                        # TÊN project được bảo vệ (để hiện 🔒) — KHÔNG chứa mật khẩu
└── wrangler.jsonc                        # name=artifacts, pages_build_output_dir=./dist
```

Quy trình build (`pnpm run build`):

1. `scripts/prepare-static.mjs` — copy mỗi `src/artifacts/<project>/<file>.(md|html)` sang `public/` ở
   đúng đường dẫn tương đối (để phục vụ verbatim tại `/<project>/<file>.(md|html)`), và sinh
   `functions/protected-folders.js` từ `protected.list`.
2. `astro build` — build gallery + viewer pages vào `./dist`.
3. `pagefind --site dist` — index full-text search vào `dist/pagefind/`.

## Cài đặt một lần

```bash
pnpm install                                                   # cài Astro + pagefind + wrangler
npx wrangler login                                            # xác thực Cloudflare (mở browser)
npx wrangler pages project create artifacts --production-branch=main

# Khoá ký cookie cho auth (chỉ chạy nếu CHƯA có — sinh lại sẽ vô hiệu mọi cookie đang còn hạn).
# protect.sh cũng tự tạo COOKIE_SECRET khi thiếu, nhưng có thể đặt thủ công ở đây:
openssl rand -base64 32 | npx wrangler pages secret put COOKIE_SECRET --project-name=artifacts

./deploy.sh                                                   # build + deploy lần đầu
```

Sau đó gắn subdomain (làm 1 lần trên dashboard, DNS đã ở Cloudflare nên tự tạo CNAME + SSL):
**Workers & Pages → `artifacts` → Custom domains → `artifacts.hoangtrung.dev`**.

## Workflow hằng ngày

```bash
# thêm artifact (md hoặc html) vào source rồi build + deploy
mkdir -p src/artifacts/my-project
cp ~/somewhere/report.html src/artifacts/my-project/
./deploy.sh
# → viewer: https://artifacts.hoangtrung.dev/my-project/report
# → raw:    https://artifacts.hoangtrung.dev/my-project/report.html
```

`src/artifacts/` là source of truth. `public/` và `dist/` là output (build sinh lại, không commit).
Xoá file khỏi `src/artifacts/` → lần deploy sau page sẽ biến mất.

### Metadata artifact

- **Markdown:** frontmatter `title`, `description`, `tags`, `date`.
- **HTML:** lấy từ `<title>` và `<meta name="description">`.
- Thiếu thì fallback về tên file. Gallery hiển thị title/tags/date và cho filter theo tag.

## Mật khẩu theo từng project (login + signed cookie)

Auth **không còn dùng popup Basic Auth**. Thay vào đó: khi truy cập một project được bảo vệ mà chưa có
cookie hợp lệ, middleware (`functions/_middleware.js`) chuyển hướng sang **trang `/login` có style**
(hiện tên project + ô mật khẩu). Đăng nhập đúng → `functions/login.js` đặt signed cookie
`cf_auth_<project>` (HMAC-SHA256 trên `COOKIE_SECRET`, HttpOnly/Secure/SameSite=Lax, hết hạn 12h) → quay
lại trang gốc. Có nút **Logout** để xoá cookie.

Một project được bảo vệ khi tồn tại secret `PW_<PROJECT>` (tên project viết hoa, ký tự ngoài `[A-Z0-9]`
đổi thành `_`; vd `project-a` → `PW_PROJECT_A`) và tên có trong `protected.list`. Project không có secret thì public.

**Fail-closed:** project được liệt kê bảo vệ nhưng thiếu `PW_<PROJECT>` *hoặc* thiếu `COOKIE_SECRET` →
middleware trả 403 (không bao giờ phục vụ thầm lặng). Mật khẩu **không bao giờ nằm trong git** — chỉ là
secret trên Cloudflare. `protected.list` chỉ lưu *tên* project để gallery hiện badge 🔒 và để middleware
fail-closed (qua `protected-folders.js` sinh khi build).

```bash
./protect.sh my-project              # đặt mật khẩu (wrangler sẽ hỏi giá trị); tự tạo COOKIE_SECRET nếu thiếu
./protect.sh my-project 's3cret'     # hoặc truyền thẳng mật khẩu
./protect.sh --list                  # xem project nào đang được bảo vệ
./protect.sh --unprotect my-project  # gỡ bảo vệ (xoá secret + bỏ khỏi protected.list)
./deploy.sh                          # build + deploy lại để cập nhật badge 🔒 và middleware
```

Khi truy cập project được bảo vệ, trình duyệt mở **trang login** — nhập mật khẩu vào form, không có popup.

### Dành cho agent (Claude) cập nhật mật khẩu

Gõ `/protect-folder <project> [password]` trong Claude Code (định nghĩa ở `.claude/commands/protect-folder.md`),
hoặc yêu cầu agent chạy `./protect.sh`. Quy tắc bắt buộc khi agent thao tác:

- KHÔNG tự bịa mật khẩu; nếu người dùng không cung cấp, để `./protect.sh <project>` (không kèm pw) tự hỏi.
- KHÔNG in/echo mật khẩu ra terminal hay log.
- KHÔNG commit mật khẩu vào git.
- Sau khi set secret xong, chạy `./deploy.sh` để cập nhật badge 🔒 và đẩy middleware.

## Dùng trên máy khác (vd MacBook)

Repo này chỉ là **file + 1 tài khoản cloud**, đồng bộ giữa các máy bằng git.
Remote: `git@github.com:hoangtrung99/share-artifacts.git` (private).

Trên máy mới:

```bash
git clone git@github.com:hoangtrung99/share-artifacts.git
cd share-artifacts
pnpm install
```

Xác thực Cloudflare bằng **API token** (chạy headless, không cần browser — `wrangler login`
qua SSH thường hỏng):

1. Dashboard → My Profile → API Tokens → Create Token → Custom Token →
   Permissions: `Account` · `Cloudflare Pages` · **Edit** → tạo token.
2. Đặt biến môi trường (cho vào `~/.zshrc`):
   ```bash
   export CLOUDFLARE_API_TOKEN='<token>'
   export CLOUDFLARE_ACCOUNT_ID='a921107437f45254a6fd280a25e0c617'
   ```
3. `./deploy.sh` và `./protect.sh` chạy bình thường.

Quy trình giữa 2 máy: `git pull` → thêm artifact vào `src/artifacts/` → `./deploy.sh` → `git commit && git push`.
Luôn `git pull` trước khi deploy để `src/artifacts/` (source of truth) không bị lệch.

## Delivery nhanh (cho agent / từ mọi nơi)

Sau khi tạo một artifact (md hoặc html) ở bất kỳ đâu, publish bằng **một lệnh**:

```bash
# Từ trong repo này:
./deliver.sh ./report.html cost-review
# → viewer: https://artifacts.hoangtrung.dev/cost-review/report
# → raw:    https://artifacts.hoangtrung.dev/cost-review/report.html

# Từ thư mục/repo khác (gọi bằng đường dẫn tuyệt đối tới script):
~/Local/Work/solashi/share-artifacts/deliver.sh ./notes.md research --protect 's3cret'
```

`deliver.sh <file.(html|md)> [project] [--name x.(html|md)] [--protect [pw]] [--open]` sẽ: copy file vào
`src/artifacts/<project>/`, (tuỳ chọn) bảo vệ project, build (prepare-static + astro + pagefind), deploy,
in cả URL viewer và URL raw. Project mặc định là `shared`. Chỉ hỗ trợ `.html` và `.md`.

### Cho agent (Claude) sau khi tạo artifact
- **Skill `deploy-artifacts`** (`.claude/skills/`): agent tự **phân loại** artifact vào project (hỏi nếu không rõ),
  deploy, và trả về link chia sẻ. Kích hoạt khi nói "deploy artifact này" / "publish lên site".
- Trong repo này: gõ `/deliver <file.(html|md)> [project] [--protect]`.
- Từ session/agent ở repo khác (cùng máy): bảo agent chạy
  `~/Local/Work/solashi/share-artifacts/deliver.sh <file> <project>` rồi báo lại URL.
- Để **mọi** session Claude tự biết cách publish, thêm 1 dòng vào `~/.claude/CLAUDE.md`, ví dụ:
  > "Để publish một artifact lên web, chạy `~/Local/Work/solashi/share-artifacts/deliver.sh <file> <project>` rồi đưa URL cho người dùng."

### Sửa / xoá page
- **Sửa:** deliver lại cùng tên file (ghi đè) — tự deploy.
- **Xoá 1 page:** `./unpublish.sh <project>/<file>` (tên có thể kèm `.html`/`.md` hoặc bỏ đuôi)
- **Xoá cả project:** `./unpublish.sh <project>` (tự gỡ mật khẩu nếu project có)

(Build sinh lại `public/` + `dist/` từ `src/artifacts`, deploy upload atomic, nên xoá khỏi source + deploy là page biến mất khỏi web.)
