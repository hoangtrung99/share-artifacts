---
description: Đặt/đổi/gỡ mật khẩu cho một project trên artifacts.hoangtrung.dev (login + signed cookie)
argument-hint: <project> [password]   (hoặc --list | --unprotect <project>)
---

Người dùng muốn quản lý mật khẩu cho project trên trang `artifacts.hoangtrung.dev`.

Cơ chế:
- Cloudflare Pages Functions middleware (`functions/_middleware.js`) chặn theo **project** (segment URL
  cấp 1 / tên project trên R2). Chưa có cookie hợp lệ → redirect sang **trang `/login` có style**.
- Đăng nhập đúng → `functions/login.js` đặt signed cookie `cf_auth_<project>` (HMAC trên
  `COOKIE_SECRET`, TTL **180 ngày**).
- Mật khẩu lưu dạng secret Cloudflare `PW_<PROJECT>` (KHÔNG nằm trong git).
- Registry runtime: `meta/protected.json` trên R2. Local `protected.list` chỉ là cache tùy chọn.
- **Không cần** `./deploy.sh` sau protect/unprotect — secrets + registry R2 là đủ. Badge 🔒 trên
  home lấy từ `/api/catalog` (đọc registry R2; edge cache ~45s).

Tham số nhận được: `$ARGUMENTS`

`protect.sh` tự `cd` về thư mục của nó nên gọi bằng absolute path chạy được từ **bất kỳ** thư mục nào.
Vị trí repo khác nhau tùy máy — tìm một lần rồi dùng lại:

```bash
REPO=$(find ~/Work ~ -maxdepth 4 -type d -name share-artifacts -not -path '*/node_modules/*' 2>/dev/null | head -1)
```

Quy trình (thay `./protect.sh` bằng `"$REPO"/protect.sh`):
1. Nếu là `--list`: chạy `"$REPO"/protect.sh --list` và báo kết quả.
2. Nếu là `--unprotect <project>`: chạy `"$REPO"/protect.sh --unprotect <project>`. **Không** chạy
   `./deploy.sh` (registry R2 cập nhật ngay; badge có thể trễ tối đa ~45s do edge cache).
3. Ngược lại (đặt/đổi mật khẩu):
   - Đối số 1 = **tên project** = segment đầu của URL / tên project trên R2 (ví dụ `cost-review`
     cho `https://artifacts.hoangtrung.dev/cost-review/...`). Không phải thư mục local. Nếu thiếu, hỏi lại.
   - Đối số 2 = mật khẩu. Nếu người dùng KHÔNG cung cấp, chạy `./protect.sh <project>` (không kèm pw)
     để wrangler tự hỏi giá trị — **KHÔNG tự bịa mật khẩu**, KHÔNG in mật khẩu ra output/log.
   - `protect.sh` tự tạo `COOKIE_SECRET` (khoá ký cookie) nếu chưa có — cần để login hoạt động.
   - Sau khi set xong: **không** chạy `./deploy.sh`. Báo rằng registry + secret đã cập nhật;
     truy cập tới sẽ vào `/login`.
4. Báo lại: project nào đã được bảo vệ và URL truy cập. Nhắc rằng lần truy cập tới sẽ chuyển sang
   trang `/login` có style — nhập mật khẩu vào form (không có popup trình duyệt). Cookie project
   sống **180 ngày**.

Ràng buộc bắt buộc:
- KHÔNG commit mật khẩu vào git. Mật khẩu chỉ tồn tại dưới dạng secret Cloudflare.
- KHÔNG echo/in mật khẩu ra terminal.
- KHÔNG bịa mật khẩu khi user không cung cấp.
- Yêu cầu tiên quyết: đã `npx wrangler login` (hoặc có `CLOUDFLARE_API_TOKEN`) và Pages project
  `artifacts` đã tồn tại; bucket R2 `artifacts-content` đã bật.
