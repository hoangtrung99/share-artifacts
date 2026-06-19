# NFS Provisioner Removal — App-side Verification Guide

## Background

The `nfs-subdir-external-provisioner` pod on the STG cluster is **NOT used** by the HULFT volume.
HULFT uses a static PV/PVC (`storageClassName: manual`), not dynamic provisioning.

**Confirmed by:**
- Diagnostic script `check_hulft_nfs.sh` (2026-04-09): 0 PVCs use `nfs-client`
- `kubectl get pvc --all-namespaces`: only `nfs-hulft-pvc` exists (class: `manual`)

## Why is NFS critical to the app?

NFS is the **only bridge** for batch point transfers between the Point app and Ponta:

```
User requests point transfer to Ponta
  │
  ▼
① API creates PointTransfer (PROCESSING, uploadStatus=PENDING)
   Locks user balance (amount + fee)
  │
  ▼
② Upload worker (00:00 JST) → writes batch file to /nfs/hulft/snddata/
  │
  ▼
③ HULFT transfers file → Ponta processes → returns result to /nfs/hulft/rcvdata/
  │
  ▼
④ Parse worker (10:05 JST) → reads result file
   ├─ Success → status=COMPLETED, deduct user balance
   └─ Failure → status=FAILED, record error code
```

**If NFS mount is lost**: transactions stuck at PROCESSING, user funds locked permanently.

**If only the provisioner pod is removed**: NO impact. PV/PVC are already Bound. NFS mount operates directly between kubelet and NFS server — provisioner is not involved.

---

## Verification Plan

### Before removing the provisioner

#### Check 1: Confirm no PVC uses dynamic provisioning

```bash
kubectl get pvc --all-namespaces -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name} class={.spec.storageClassName}{"\n"}{end}'
```

**Expected:** Only `default/nfs-hulft-pvc class=manual`. No PVC uses `nfs-client`.

#### Check 2: Confirm PV is static (not created by provisioner)

```bash
kubectl get pv nfs-hulft-pv -o jsonpath='{.metadata.annotations}'
```

**Expected:** No `pv.kubernetes.io/provisioned-by` annotation. If present, the PV was created by the provisioner — do NOT remove.

#### Check 3: Confirm PV/PVC are Bound

```bash
kubectl get pv nfs-hulft-pv -o jsonpath='PV status: {.status.phase}{"\n"}'
kubectl get pvc nfs-hulft-pvc -o jsonpath='PVC status: {.status.phase}{"\n"}'
```

**Expected:** Both `Bound`.

#### Check 4: Record baseline snapshot

```bash
echo "=== BASELINE SNAPSHOT ==="
echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""
echo "--- PV/PVC ---"
kubectl get pv,pvc
echo ""
echo "--- StorageClass ---"
kubectl get storageclass
echo ""
echo "--- NFS mount in worker ---"
kubectl exec $(kubectl get pods -o name | grep point-worker | head -1 | sed 's|pod/||') -- cat /proc/mounts | grep nfs
echo ""
echo "--- HULFT files ---"
kubectl exec $(kubectl get pods -o name | grep point-worker | head -1 | sed 's|pod/||') -- ls -la /nfs/hulft/snddata/ /nfs/hulft/rcvdata/
echo ""
echo "--- Write test ---"
kubectl exec $(kubectl get pods -o name | grep point-worker | head -1 | sed 's|pod/||') -- sh -c 'echo test > /nfs/hulft/.verify_test && rm /nfs/hulft/.verify_test && echo "Write: OK"'
```

Save this output for comparison after removing the provisioner.

### Remove the provisioner

**Recommended timing:** After the Upload worker finishes (after 00:30 JST), before the Parse worker runs (before 10:00 JST). This ensures a full cycle for verification.

```bash
# Remove provisioner deployment
helm uninstall nfs-subdir-external-provisioner

# Remove unused StorageClass (optional cleanup)
kubectl delete storageclass nfs-client
```

### After removal — Infra checks (immediately)

#### Check 5: PV/PVC still Bound

```bash
kubectl get pv nfs-hulft-pv -o jsonpath='PV status: {.status.phase}{"\n"}'
kubectl get pvc nfs-hulft-pvc -o jsonpath='PVC status: {.status.phase}{"\n"}'
```

**Expected:** Still `Bound`. If not → rollback immediately.

#### Check 6: NFS mount still works inside worker pod

```bash
WORKER=$(kubectl get pods -o name | grep point-worker | head -1 | sed 's|pod/||')

# Check mount
kubectl exec $WORKER -- cat /proc/mounts | grep nfs

# Check read
kubectl exec $WORKER -- ls -la /nfs/hulft/snddata/

# Check write
kubectl exec $WORKER -- sh -c 'echo test > /nfs/hulft/.verify_test && rm /nfs/hulft/.verify_test && echo "Write: OK"'
```

**Expected:** Same as baseline. If different → rollback immediately.

### After removal — App checks (wait for worker runs)

#### Check 7: Upload worker still writes files successfully

**When to check:** After 00:00 JST (15:00 UTC) the next day.

**CloudWatch Logs Insights** (log group: `/aws/containerinsights/point/application`):

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftUpload/ and @message not like /subscribe/
| sort @timestamp desc
| limit 20
```

**Or via bastion CLI (jq):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "1 day ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftUpload/ and @message not like /subscribe/ | sort @timestamp desc | limit 20' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"

sleep 10

aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

**Expected:**

| Log message | Meaning |
|-------------|---------|
| `----------------- Start ----------------` | Worker started |
| `header_length:427` | Header written |
| `File written successfully` | File write succeeded |
| `hulft File content: ...` | File content logged |
| `end` | Worker finished normally |

**Red flags (rollback needed):**

| Log message | Meaning |
|-------------|---------|
| `Read-only file system` | NFS mount lost |
| `Failed to prepare file` | Cannot create directory |
| No logs at all | Worker not running |

#### Check 8: Parse worker still reads files and processes results

**When to check:** After 10:05 JST (01:05 UTC).

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftParse/ and @message not like /subscribe/
| sort @timestamp desc
| limit 20
```

**Expected:**

| Log message | Meaning |
|-------------|---------|
| `-----------------Hulft rcvdata Start` | Parse started |
| `File exists: true` | Result file from Ponta exists |
| `Hulft data: {...}` | Parsing individual records |
| `-----------------Hulft Completed` | Parse completed |

#### Check 9: End-to-end transaction completion (critical check)

```
fields @timestamp, @message
| filter @message like /transferOperationToPonta/
| sort @timestamp desc
| limit 20
```

**Expected:** `transferOperationToPontaSuccess` or `transferOperationToPontaSuccess_m` — Ponta point transfers still completing successfully.

**This is the most important check** — if Parse processes results successfully, the entire chain (NFS mount → file I/O → business logic) is working.

#### Check 10: DB — no stuck transactions

```sql
-- Stuck transactions (PROCESSING > 2 days)
SELECT count(*) as stuck_count
FROM point_transfer
WHERE status = 'PROCESSING'
  AND upload_status IN ('PENDING', 'PROCESSING')
  AND request_time < NOW() - INTERVAL 2 DAY;
```

**Expected:** `0` — no stuck transactions.

```sql
-- Latest task status
SELECT id, task_name, parsing_status, parsing_start_time, parsing_end_time, error_message
FROM point_hulft_task_status
ORDER BY id DESC
LIMIT 5;
```

**Expected:** Most recent record has `parsing_status = SUCCESS`.

---

## Rollback

If any check fails:

```bash
# Reinstall provisioner
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner
helm upgrade --install nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --set nfs.server="10.51.187.138" \
  --set nfs.path="/mnt/hulft/tmp"
```

However, if PV/PVC are still Bound (Check 5) and NFS mount still works (Check 6), rollback is **not necessary** since the provisioner is unrelated to the static PV.

---

## Cleanup after successful verification

After all checks pass (at least 1 full Upload + Parse cycle completed):

### 1. Remove unused StorageClass

```bash
kubectl delete storageclass nfs-client
```

### 2. Update `k8s_apply.sh`

Remove the `helm install nfs-subdir-external-provisioner` block from `k8s-manifests/bin/k8s_apply.sh` to prevent reinstalling the provisioner on future deploys.

### 3. Update documentation

Record that the provisioner was removed, the date, and verification results.

---

## Quick Summary

| Step | When | Action | Expected |
|------|------|--------|----------|
| Pre-check 1-4 | Before removal | Confirm static PV, PVC Bound, 0 dynamic PVCs | All pass |
| Remove provisioner | After 00:30 JST | `helm uninstall` | Pod removed |
| Post-check 5-6 | Immediately after | PV/PVC Bound, NFS mount OK | Same as baseline |
| **App check 7** | **After 00:00 JST** | CloudWatch: Upload log | `File written successfully` |
| **App check 8** | **After 10:05 JST** | CloudWatch: Parse log | `Hulft Completed` |
| **App check 9** | **After 10:05 JST** | CloudWatch: transfer result | `transferOperationToPontaSuccess` |
| App check 10 | Anytime | DB query stuck transfers | 0 stuck |
| Cleanup | After verify OK | Remove StorageClass, update script | Clean state |

**Critical path**: Check 9 is sufficient — if `transferOperationToPontaSuccess` appears after removing the provisioner, the application is fully functional.
