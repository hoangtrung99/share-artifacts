---
description: Đặt/đổi/gỡ mật khẩu cho một project trên artifacts.hoangtrung.dev (login + signed cookie)
argument-hint: <project> [password]   (hoặc --list | --unprotect <project>)
---

Người dùng muốn quản lý mật khẩu cho project trên trang `artifacts.hoangtrung.dev`.
Cơ chế: Cloudflare Pages Functions middleware (`functions/_middleware.js`) chặn project cấp 1; chưa có
cookie hợp lệ → chuyển hướng sang **trang `/login` có style** (không còn popup Basic Auth). Đăng nhập đúng →
`functions/login.js` đặt signed cookie `cf_auth_<project>` (HMAC trên `COOKIE_SECRET`, hết hạn 12h).
Mật khẩu lưu dạng secret Cloudflare `PW_<PROJECT>` (KHÔNG nằm trong git).

Tham số nhận được: `$ARGUMENTS`

Quy trình:
1. Nếu là `--list`: chạy `./protect.sh --list` và báo kết quả.
2. Nếu là `--unprotect <project>`: chạy `./protect.sh --unprotect <project>`, rồi hỏi xác nhận trước khi `./deploy.sh`.
3. Ngược lại (đặt/đổi mật khẩu):
   - Đối số 1 = tên project (trùng tên thư mục trong `src/artifacts/`). Nếu thiếu, hỏi lại.
   - Đối số 2 = mật khẩu. Nếu người dùng KHÔNG cung cấp, chạy `./protect.sh <project>` (không kèm pw)
     để wrangler tự hỏi giá trị — KHÔNG tự bịa mật khẩu, KHÔNG in mật khẩu ra output/log.
   - `protect.sh` tự tạo `COOKIE_SECRET` (khoá ký cookie) nếu project chưa có — cần để login hoạt động.
   - Sau khi set xong, hỏi xác nhận rồi chạy `./deploy.sh` để cập nhật badge 🔒 và đẩy middleware.
4. Báo lại: project nào đã được bảo vệ và URL truy cập. Nhắc rằng lần truy cập tới sẽ chuyển sang trang
   `/login` có style — nhập mật khẩu vào form (không có popup trình duyệt).

Ràng buộc bắt buộc:
- KHÔNG commit mật khẩu vào git. Mật khẩu chỉ tồn tại dưới dạng secret Cloudflare.
- KHÔNG echo/in mật khẩu ra terminal.
- Yêu cầu tiên quyết: đã `npx wrangler login` (hoặc có `CLOUDFLARE_API_TOKEN`) và project `artifacts` đã tồn tại.
