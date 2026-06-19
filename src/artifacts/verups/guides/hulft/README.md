# HULFT & NFS Documentation

Tài liệu liên quan đến hệ thống truyền file HULFT giữa Point app và Ponta (Loyalty Marketing).

## Tài liệu

| File | Mô tả |
|------|-------|
| [1562_HULFT_EXPLAINED.md](1562_HULFT_EXPLAINED.md) | Giải thích chi tiết toàn bộ HULFT system: kiến trúc, luồng dữ liệu, server code, infrastructure, PV/PVC/StorageClass, diagnostic results |
| [HULFT_LOG_INVESTIGATION_GUIDE.md](HULFT_LOG_INVESTIGATION_GUIDE.md) | Hướng dẫn điều tra HULFT logs trên CloudWatch (Console + AWS CLI), query templates, checklist troubleshooting |
| [NFS_PROVISIONER_REMOVAL_VERIFICATION.md](NFS_PROVISIONER_REMOVAL_VERIFICATION.md) | Verification plan khi xóa `nfs-subdir-external-provisioner`: pre-check, post-check infra, app-side verification, rollback |
| [check_hulft_nfs.sh](check_hulft_nfs.sh) | Script diagnostic chạy trên bastion — kiểm tra PV/PVC, NFS mount, HULFT files, provisioner usage, worker logs |
| [NFS_PROVISIONER_HULFT_EXPLAINED.html](NFS_PROVISIONER_HULFT_EXPLAINED.html) | Giải thích visual (HTML) về NFS provisioner và HULFT |
| [hulft.txt](hulft.txt) | Kết quả raw output từ script diagnostic (STG, 2026-04-09) |

## Quick Reference

### Thông tin kết nối

| | DEV | STG |
|---|---|---|
| NFS Server | Không có | `10.51.187.138:/mnt/hulft/tmp` |
| VPC Peering | Không có | `pcx-0ce5c02bb35a7bd32` (account `471112755246`) |
| CloudWatch Log Group | `/aws/containerinsights/point/application` | `/aws/containerinsights/point/application` |
| AWS Account | `845131030484` | `520411743393` |

### Worker schedule

| Worker | Thời gian (JST) | Thời gian (UTC) |
|--------|----------------|-----------------|
| Upload (ghi file gửi) | 00:00 | 15:00 |
| Parse (đọc file nhận) | 10:05 | 01:05 |

### File HULFT

| File | Path trong pod | Chiều |
|------|---------------|-------|
| `LPFT0007_106242_000010` | `/nfs/hulft/snddata/` | Gửi (Point → Ponta) |
| `LPFT0008_000010_106242` | `/nfs/hulft/rcvdata/` | Nhận (Ponta → Point) |

### Kết luận về NFS Provisioner (2026-04-09)

Pod `nfs-subdir-external-provisioner` **KHÔNG được sử dụng** bởi HULFT volume. HULFT dùng static PV/PVC (`storageClassName: manual`). Provisioner có thể xóa an toàn — xem [NFS_PROVISIONER_REMOVAL_VERIFICATION.md](NFS_PROVISIONER_REMOVAL_VERIFICATION.md) cho verification plan.
