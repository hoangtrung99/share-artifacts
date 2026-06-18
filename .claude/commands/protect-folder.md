---
description: Đặt/đổi/gỡ mật khẩu Basic Auth cho một folder (project) trên artifacts.hoangtrung.dev
argument-hint: <folder> [password]   (hoặc --list | --unprotect <folder>)
---

Người dùng muốn quản lý mật khẩu cho folder trên trang `artifacts.hoangtrung.dev`.
Cơ chế: Cloudflare Pages Functions middleware (`functions/_middleware.js`) chặn Basic Auth
theo folder cấp 1; mật khẩu lưu dạng secret Cloudflare `PW_<FOLDER>` (KHÔNG nằm trong git).

Tham số nhận được: `$ARGUMENTS`

Quy trình:
1. Nếu là `--list`: chạy `./protect.sh --list` và báo kết quả.
2. Nếu là `--unprotect <folder>`: chạy `./protect.sh --unprotect <folder>`, rồi hỏi xác nhận trước khi `./deploy.sh`.
3. Ngược lại (đặt/đổi mật khẩu):
   - Đối số 1 = tên folder (trùng tên thư mục trong `public/`). Nếu thiếu, hỏi lại.
   - Đối số 2 = mật khẩu. Nếu người dùng KHÔNG cung cấp, chạy `./protect.sh <folder>` (không kèm pw)
     để wrangler tự hỏi giá trị — KHÔNG tự bịa mật khẩu, KHÔNG in mật khẩu ra output/log.
   - Sau khi set xong, hỏi xác nhận rồi chạy `./deploy.sh` để cập nhật badge 🔒 trên trang duyệt.
4. Báo lại: folder nào đã được bảo vệ và URL truy cập. Nhắc rằng lần truy cập tới sẽ hiện popup đăng nhập
   của trình duyệt (để trống user, nhập mật khẩu vào ô password).

Ràng buộc bắt buộc:
- KHÔNG commit mật khẩu vào git. Mật khẩu chỉ tồn tại dưới dạng secret Cloudflare.
- KHÔNG echo/in mật khẩu ra terminal.
- Yêu cầu tiên quyết: đã `npx wrangler login` (hoặc có `CLOUDFLARE_API_TOKEN`) và project `artifacts` đã tồn tại.
