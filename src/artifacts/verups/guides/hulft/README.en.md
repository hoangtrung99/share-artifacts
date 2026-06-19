# HULFT & NFS Documentation

Documentation for the HULFT file transfer system between the Point app and Ponta (Loyalty Marketing).

## Documents

| File | Description |
|------|-------------|
| [1562_HULFT_EXPLAINED.en.md](1562_HULFT_EXPLAINED.en.md) | Detailed explanation of the entire HULFT system: architecture, data flow, server code, infrastructure, PV/PVC/StorageClass, diagnostic results |
| [HULFT_LOG_INVESTIGATION_GUIDE.en.md](HULFT_LOG_INVESTIGATION_GUIDE.en.md) | Guide for investigating HULFT logs on CloudWatch (Console + AWS CLI), query templates, troubleshooting checklist |
| [NFS_PROVISIONER_REMOVAL_VERIFICATION.en.md](NFS_PROVISIONER_REMOVAL_VERIFICATION.en.md) | Verification plan for removing `nfs-subdir-external-provisioner`: pre-check, post-check infra, app-side verification, rollback |
| [check_hulft_nfs.sh](check_hulft_nfs.sh) | Diagnostic script to run on bastion — checks PV/PVC, NFS mount, HULFT files, provisioner usage, worker logs |
| [NFS_PROVISIONER_HULFT_EXPLAINED.html](NFS_PROVISIONER_HULFT_EXPLAINED.html) | Visual explanation (HTML) of NFS provisioner and HULFT |
| [hulft.txt](hulft.txt) | Raw output from diagnostic script (STG, 2026-04-09) |

## Quick Reference

### Connection Information

| | DEV | STG |
|---|---|---|
| NFS Server | None | `10.51.187.138:/mnt/hulft/tmp` |
| VPC Peering | None | `pcx-0ce5c02bb35a7bd32` (account `471112755246`) |
| CloudWatch Log Group | `/aws/containerinsights/point/application` | `/aws/containerinsights/point/application` |
| AWS Account | `845131030484` | `520411743393` |

### Worker Schedule

| Worker | Time (JST) | Time (UTC) |
|--------|-----------|-----------|
| Upload (write outbound file) | 00:00 | 15:00 |
| Parse (read inbound file) | 10:05 | 01:05 |

### HULFT Files

| File | Path in Pod | Direction |
|------|------------|-----------|
| `LPFT0007_106242_000010` | `/nfs/hulft/snddata/` | Outbound (Point -> Ponta) |
| `LPFT0008_000010_106242` | `/nfs/hulft/rcvdata/` | Inbound (Ponta -> Point) |

### NFS Provisioner Conclusion (2026-04-09)

The `nfs-subdir-external-provisioner` pod is **NOT used** by the HULFT volume. HULFT uses a static PV/PVC (`storageClassName: manual`). The provisioner can be safely removed — see [NFS_PROVISIONER_REMOVAL_VERIFICATION.en.md](NFS_PROVISIONER_REMOVAL_VERIFICATION.en.md) for the verification plan.
