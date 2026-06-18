# artifacts.hoangtrung.dev

Host các artifact HTML lên Cloudflare Pages để chia sẻ, có trang duyệt thư mục và
bảo vệ mật khẩu theo từng folder.

- `public/<project>/<file>.html`  →  `https://artifacts.hoangtrung.dev/<project>/<file>.html`
- Vào `https://artifacts.hoangtrung.dev/` (hoặc `/<project>/`) sẽ thấy **trang duyệt thư mục**.

## Cấu trúc

```
.
├── public/                 # source of truth — TẤT CẢ artifact nằm ở đây
│   └── <project>/*.html
├── functions/
│   └── _middleware.js      # Basic Auth theo folder (chạy ở edge)
├── build-index.mjs         # sinh index.html "file browser" cho mỗi thư mục
├── deploy.sh               # build index + deploy
├── protect.sh              # đặt/đổi/gỡ mật khẩu cho folder
├── protected.list          # TÊN folder được bảo vệ (để hiện 🔒) — KHÔNG chứa mật khẩu
└── wrangler.jsonc          # name=artifacts, pages_build_output_dir=./public
```

## Cài đặt một lần

```bash
npx wrangler login                                            # xác thực Cloudflare (mở browser)
npx wrangler pages project create artifacts --production-branch=main
./deploy.sh                                                   # deploy lần đầu
```

Sau đó gắn subdomain (làm 1 lần trên dashboard, DNS đã ở Cloudflare nên tự tạo CNAME + SSL):
**Workers & Pages → `artifacts` → Custom domains → `artifacts.hoangtrung.dev`**.

## Workflow hằng ngày

```bash
mkdir -p public/my-project
cp ~/somewhere/report.html public/my-project/
./deploy.sh
# → gửi link: https://artifacts.hoangtrung.dev/my-project/report.html
```

Lưu ý: mỗi lần `deploy.sh` upload **toàn bộ** `public/`. Giữ tất cả file trong `public/`;
xoá file local → lần deploy sau sẽ 404.

## Mật khẩu theo từng folder

Cơ chế: middleware ở `functions/_middleware.js` chặn mọi request vào `/<folder>/…`. Một folder
được bảo vệ **khi và chỉ khi** tồn tại secret Cloudflare `PW_<FOLDER>` (tên folder viết hoa,
ký tự ngoài `[A-Z0-9]` đổi thành `_`; vd `project-a` → `PW_PROJECT_A`). Folder không có secret thì public.

Mật khẩu **không bao giờ nằm trong git** — chỉ tồn tại dưới dạng secret trên Cloudflare.
`protected.list` chỉ lưu *tên* folder để trang duyệt hiển thị badge 🔒.

```bash
./protect.sh my-project              # đặt mật khẩu (wrangler sẽ hỏi giá trị)
./protect.sh my-project 's3cret'     # hoặc truyền thẳng mật khẩu
./protect.sh --list                  # xem folder nào đang được bảo vệ
./protect.sh --unprotect my-project  # gỡ bảo vệ
./deploy.sh                          # deploy lại để cập nhật badge 🔒
```

Khi truy cập folder được bảo vệ, trình duyệt hiện popup đăng nhập — **để trống ô user, nhập mật khẩu vào ô password**.

### Dành cho agent (Claude) cập nhật mật khẩu

Gõ `/protect-folder <folder> [password]` trong Claude Code (định nghĩa ở `.claude/commands/protect-folder.md`),
hoặc yêu cầu agent chạy `./protect.sh`. Quy tắc bắt buộc khi agent thao tác:

- KHÔNG tự bịa mật khẩu; nếu người dùng không cung cấp, để `./protect.sh <folder>` (không kèm pw) tự hỏi.
- KHÔNG in/echo mật khẩu ra terminal hay log.
- KHÔNG commit mật khẩu vào git.
- Sau khi set secret xong, chạy `./deploy.sh` để badge 🔒 cập nhật.

## Dùng trên máy khác (vd MacBook)

Repo này chỉ là **file + 1 tài khoản cloud**, đồng bộ giữa các máy bằng git.
Remote: `git@github.com:hoangtrung99/share-artifacts.git` (private).

Trên máy mới:

```bash
git clone git@github.com:hoangtrung99/share-artifacts.git
cd share-artifacts
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

Quy trình giữa 2 máy: `git pull` → thêm artifact vào `public/` → `./deploy.sh` → `git commit && git push`.
Luôn `git pull` trước khi deploy để `public/` (source of truth) không bị lệch.
