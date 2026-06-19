# HULFT Log Investigation Guide on CloudWatch

## Overview

The Ponta Grant Point system uses **HULFT** to transfer batch files with Ponta (Loyalty Marketing).
There are 2 related workers:

| Worker | Function | Schedule (estimated) |
|--------|----------|----------------------|
| `PontaGrantPointHulftUpload` | Creates the file for requesting Ponta point grants | ~15:00 UTC (00:00 JST) |
| `PontaGrantPointHulftParse` | Reads the result file returned from Ponta | ~01:05 UTC (10:05 JST) |

### File paths on pod

| Type | Path | File name |
|------|------|-----------|
| Send file (upstream) | `/nfs/hulft/snddata/` | `LPFT0007_106242_000010` |
| Receive file (downstream) | `/nfs/hulft/rcvdata/` | `LPFT0008_000010_106242` |

### CloudWatch information

| Env | AWS Account | Log Group | Profile (CLI) |
|-----|-------------|-----------|---------------|
| DEV | `845131030484` | `/aws/containerinsights/point/application` | `bs-point-dev` |
| STG | `520411743393` | `/aws/containerinsights/point/application` | `bs-point-stg` |

---

## Background Knowledge: HULFT, NFS, and Kubernetes Storage

### What is HULFT?

**HULFT** (Huge fiLe Transfer) is an enterprise file transfer software widely used in Japan, especially in the finance and loyalty industries.
Rather than calling APIs in real-time, transactions are batched into files and transferred via HULFT. This is a standard B2B pattern in Japan.

In the Point project, the HULFT flow works as follows:

```
Point System                              Ponta (Loyalty Marketing)
┌──────────────────┐                     ┌──────────────────┐
│ Upload worker    │                     │                  │
│ creates batch    │──── HULFT ────────►│ Processes point  │
│ file             │     file transfer   │ grants           │
│ (point grant     │                     │                  │
│  requests)       │                     │                  │
│                  │                     │                  │
│ Parse worker     │◄─── HULFT ─────────│ Returns results  │
│ reads results    │     file transfer   │ (success/error)  │
└──────────────────┘                     └──────────────────┘
```

The batch file uses **fixed-width** format (426 bytes per line), **Shift_JIS** encoding, consisting of a header + body (N records) + footer.

### What is NFS?

**NFS** (Network File System) is a protocol for sharing files over a network. Multiple machines (or multiple pods) can mount the same NFS directory and read/write files as if it were a local disk.

In the Point project:
- **NFS Server** (`10.51.187.138`) resides in the **Peer VPC** (account `471112755246`) — this is the HULFT/Ponta infrastructure side
- **Point worker pod** mounts the NFS share at path `/nfs/hulft/`
- The worker writes the send file to `snddata/`, the HULFT daemon on the peer side picks up the file and transfers it to Ponta
- After Ponta finishes processing, the HULFT daemon drops the result file into `rcvdata/`, which the worker reads and parses

```
Peer VPC (10.51.1.0/24)              Point STG VPC (172.19.0.0/16)
┌───────────────────────┐            ┌───────────────────────────────┐
│ NFS Server            │            │ point-worker pod              │
│ 10.51.187.138         │◄──NFS────►│   /nfs/hulft/                 │
│ /mnt/hulft/tmp/       │  (NFS v4) │     ├─ snddata/ (write file) │
│   ├─ snddata/         │            │     ├─ rcvdata/ (read file)  │
│   ├─ rcvdata/         │            │     └─ log/                  │
│   └─ log/             │            │                               │
│                       │            │                               │
│ HULFT Daemon          │            │                               │
│ (transfers ↔ Ponta)   │            │                               │
└───────────────────────┘            └───────────────────────────────┘
         ↕ VPC Peering (pcx-0ce5c02bb35a7bd32 / to_point_stg)
```

### Kubernetes Storage: PV, PVC, and StorageClass

Kubernetes does not allow pods to mount storage directly. Instead, 3 layers of abstraction are used:

#### PersistentVolume (PV) — "The disk"

A PV declares **an existing storage resource** (NFS share, EBS volume, EFS, etc.). It is a **cluster-level** resource, created by an admin.

In the Point project, the `aws-nfs-pv.yaml` file declares:

```yaml
kind: PersistentVolume
metadata:
  name: nfs-hulft-pv
spec:
  capacity:
    storage: 30Gi                        # Capacity
  accessModes:
    - ReadWriteMany                      # Multiple pods read/write simultaneously
  persistentVolumeReclaimPolicy: Retain  # Retain data when PVC is deleted (important!)
  storageClassName: manual               # ← Created manually, not via provisioner
  nfs:
    server: 10.51.187.138               # NFS server IP (Peer VPC)
    path: /mnt/hulft/tmp                 # Directory on NFS server
```

#### PersistentVolumeClaim (PVC) — "The request to use a disk"

A PVC is a request from the application side: "I need X GB of storage, type Y". Kubernetes automatically finds a matching PV to bind.

File `aws-nfs-pvc.yaml`:

```yaml
kind: PersistentVolumeClaim
metadata:
  name: nfs-hulft-pvc
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: manual    # Must match the PV above
  resources:
    requests:
      storage: 30Gi           # Must match PV capacity
```

#### Deployment — Mounting into the Pod

File `worker/deployment.yaml` references the PVC:

```yaml
# In container spec:
volumeMounts:
  - name: nfs-storage
    mountPath: /nfs/hulft        # Path inside the container
# In pod spec:
volumes:
  - name: nfs-storage
    persistentVolumeClaim:
      claimName: nfs-hulft-pvc   # Reference to PVC
```

#### The 3-layer relationship

```
aws-nfs-pv.yaml          aws-nfs-pvc.yaml         worker/deployment.yaml
┌──────────────┐         ┌──────────────┐         ┌──────────────────────┐
│ PV           │  bind   │ PVC          │  mount  │ Pod                  │
│ nfs-hulft-pv │◄───────►│ nfs-hulft-pvc│◄────────│   mountPath:         │
│              │         │              │         │   /nfs/hulft         │
│ storageClass:│         │ storageClass:│         │                      │
│   manual     │         │   manual     │         │ Upload writes snddata/│
│              │         │              │         │ Parse reads rcvdata/ │
└──────────────┘         └──────────────┘         └──────────────────────┘
  "The disk exists"      "I need a disk"          "Mount into container"
  (created by admin)     (requested by app)        (used by pod)
```

Why split into 3 layers?
- **Separation of concerns**: The admin knows the infrastructure (IP, path) → creates the PV. The developer only needs to know "I need 30Gi ReadWriteMany" → creates the PVC. The pod only needs to know the mount path.
- **Portability**: When changing environments (STG → PRD), only the PV needs to be updated (pointing to a different NFS server); the PVC and Deployment remain unchanged.

### Static Provisioning vs Dynamic Provisioning

There are 2 ways to create PVs in Kubernetes:

#### Static Provisioning (currently used for HULFT)

The admin **creates the PV manually** in advance, explicitly declaring the NFS server IP and path. The PVC binds to the existing PV.

```
Admin creates PV ──→ PVC binds ──→ Pod mounts
  (aws-nfs-pv.yaml)
  storageClassName: manual
```

**Advantages:** Tight control, exact knowledge of where storage resides.
**Disadvantages:** Each new volume requires a manually created PV.

#### Dynamic Provisioning (nfs-subdir-external-provisioner)

The provisioner **automatically creates a PV** when a new PVC is created. The admin only needs to deploy the provisioner and declare a StorageClass.

```
PVC is created ──→ Provisioner detects ──→ Auto-creates PV ──→ Binds ──→ Pod mounts
  storageClassName: nfs-client
```

**Advantages:** No manual PV creation needed, auto-scales.
**Disadvantages:** Less control, depends on the provisioner pod.

### Pod `nfs-subdir-external-provisioner` — Is it needed?

`nfs-subdir-external-provisioner` is an open-source controller ([github.com/kubernetes-sigs/nfs-subdir-external-provisioner](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner)). It watches PVCs with `storageClassName: nfs-client`, then automatically creates a subdirectory on the NFS server and binds a PV.

**On the current STG cluster:**

| Check | Result |
|---|---|
| StorageClass `nfs-client` exists? | Yes (provisioner already registered) |
| Any PVC using `nfs-client`? | **No** — only `nfs-hulft-pvc` uses `manual` |
| Does the HULFT volume use the provisioner? | **No** — uses static PV |

**Conclusion (confirmed by Reishi-san + verification script):**

- The `nfs-subdir-external-provisioner` pod is **NOT used** by the HULFT volume
- No PVCs on the cluster use dynamic provisioning
- This pod can be safely deleted if there are no plans to use dynamic NFS provisioning in the future
- The HULFT volume operates entirely via static PV/PVC (`storageClassName: manual`)

### DEV vs STG Comparison

| | DEV | STG |
|---|---|---|
| `aws-nfs-pv.yaml` | Not present | Present (points to `10.51.187.138`) |
| `aws-nfs-pvc.yaml` | Not present | Present |
| Volume mount in deployment | Not present | Present (`/nfs/hulft`) |
| NFS provisioner pod | Not present | Present (but unused) |
| VPC Peering to HULFT | Not present | Present (`pcx-0ce5c02bb35a7bd32`) |
| Write file result | `Read-only file system` | `File written successfully` |
| Read file result | `File does not exist` | Readable (487KB response) |

DEV has no NFS infrastructure → the worker runs but fails gracefully. This is expected behavior because DEV is not connected to Ponta.

---

## Part 1: Investigation Using CloudWatch Console

### 1.1 Accessing CloudWatch Logs Insights

1. Log in to the correct AWS Console account (DEV or STG)
2. Select region **Tokyo (ap-northeast-1)**
3. Find the **CloudWatch** service → left sidebar select **Logs** → **Logs Insights**
4. In the **Select log group(s)** dropdown, select:
   ```
   /aws/containerinsights/point/application
   ```
5. Select a time range in the upper right (e.g., "Last 7 days" or a custom range)
6. Enter a query in the editor field → click **Run query**

### 1.2 Useful Queries

#### Query 1: View all Upload worker logs (file send)

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftUpload/
  and @message not like /subscribe/
| sort @timestamp desc
| limit 100
```

**Purpose:** View all logs related to the Upload worker, excluding SQS subscribe logs (which are only queue registration logs, not actual executions).

#### Query 2: View all Parse worker logs (file receive)

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftParse/
  and @message not like /subscribe/
| sort @timestamp desc
| limit 100
```

#### Query 3: View the content of the sent file

```
fields @timestamp, @message
| filter @message like /hulft File content/
| sort @timestamp desc
| limit 20
```

**Purpose:** The Upload worker logs the entire file content after writing. If results are returned → the file was created successfully.

#### Query 4: View parsed results per record (received file)

```
fields @timestamp, @message
| filter @message like /Hulft data/
| sort @timestamp desc
| limit 50
```

**Purpose:** The Parse worker logs each parsed record in JSON format. Includes the processing status (success/failure) for each transaction.

#### Query 5: Trace a full Upload session (header → body → footer)

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftUpload/
  and @message not like /subscribe/
| filter @message like /Start|header_length|tradeNumber|requestData|footer_length|hulft File content|Failed|error/
| sort @timestamp asc
| limit 100
```

#### Query 6: Trace a full Parse session

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulftParse/
  and @message not like /subscribe/
| filter @message like /rcvdata Start|File exists|header:|detail:|Hulft data|Completed|Failed|error/
| sort @timestamp asc
| limit 100
```

#### Query 7: View HULFT errors only

```
fields @timestamp, @message
| filter @message like /pontaGrantPointHulft/
| filter @message like /error|ERROR|failed|FAILED|exception/
| sort @timestamp desc
| limit 50
```

#### Query 8: View success/failure results per transaction

```
fields @timestamp, @message
| filter @message like /transferOperationToPonta/
| sort @timestamp desc
| limit 50
```

**Purpose:** After Parse completes, the service updates the transaction status. Keywords:
- `transferOperationToPontaSuccess` → transaction succeeded (batch only, type B)
- `transferOperationToPontaSuccess_m` → transaction succeeded (real + batch matched, type M)
- `transferOperationToPontaFailed` → transaction failed

### 1.3 Reading Results in the Console

Results are displayed as a table. Click on each row to expand details. Log structure:

```json
{
  "time": "2026-04-07T20:32:19.481Z",
  "log_processed": {
    "@timestamp": "2026-04-07T20:32:19.481Z",
    "message": "main log content here",
    "logger_name": "point.worker.worker.PontaGrantPointHulftUpload",
    "level": "INFO",
    "worker": "pontaGrantPointHulftUpload",
    "workerSession": "dev-pontaGrantPointHulftUpload-1775593939479"
  },
  "kubernetes": {
    "pod_name": "point-worker-deployment-xxx",
    "namespace_name": "default"
  }
}
```

**Important fields:**
- `log_processed.message` — main log content
- `log_processed.worker` — worker name
- `log_processed.workerSession` — session ID (used to group logs from the same run)
- `log_processed.level` — log level (INFO / ERROR / WARN)

### 1.4 Console Usage Tips

- **Export results**: Click the **Export results** button → choose CSV or clipboard
- **Save query**: Click **Save** to store frequently used queries, e.g., "HULFT Upload Logs"
- **Time range**: Use **Custom** time range when you know the exact time to investigate
- **Visualize**: The **Visualization** tab displays a chart of log volume over time — useful for viewing schedule run patterns

---

## Part 2: Investigation Using AWS CLI

### 2.1 General Syntax

```bash
# Step 1: Submit query
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time <epoch_start> \
  --end-time <epoch_end> \
  --query-string '<query>' \
  --profile <profile> \
  --region ap-northeast-1 \
  --output text --query 'queryId')

# Step 2: Wait for query to complete, then retrieve results
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" \
  --profile <profile> \
  --region ap-northeast-1
```

**Calculating epoch time:**

| Purpose | macOS | Linux (bastion) |
|---------|-------|-----------------|
| 7 days ago | `date -v-7d +%s` | `date -d "7 days ago" +%s` |
| 30 days ago | `date -v-30d +%s` | `date -d "30 days ago" +%s` |
| Current time | `date +%s` | `date +%s` |
| Specific time | `date -j -f "%Y-%m-%dT%H:%M:%S" "2026-04-07T00:00:00" +%s` | `date -d "2026-04-07T00:00:00" +%s` |

**Notes when running on bastion (SSM):**
- **No `--profile` needed** — the instance already has an IAM role, omit `--profile`
- Use `date -d` syntax instead of `date -v`
- **Do NOT use inline multi-line Python** — SSM terminal adds leading spaces per line, causing `IndentationError`. Use a script file instead (see section 2.2)

### 2.2 Result Parser

There are 2 ways to parse CloudWatch results. Use the one that fits your environment.

#### Option A: jq (recommended for bastion/SSM)

`jq` does not have indentation issues on SSM. Use the following command after each `start-query`:

```bash
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

If `jq` is not installed on the bastion, install it with: `sudo yum install -y jq` (Amazon Linux) or `sudo apt install -y jq` (Ubuntu).

#### Option B: Python script file (fallback if jq is not available)

Create the script once:

```bash
cat > /tmp/parse_cw.py << 'PYEOF'
import sys, json
resp = json.load(sys.stdin)
print('Status:', resp.get('status'))
print('Matched:', resp.get('statistics',{}).get('recordsMatched'))
print('---')
for row in resp.get('results', []):
    for field in row:
        if field['field'] == '@message':
            try:
                outer = json.loads(field['value'])
                inner = json.loads(outer.get('log','{}'))
                ts = inner.get('@timestamp','?')
                msg = inner.get('message','?')
                lvl = inner.get('level','?')
                print(f'{ts}  [{lvl}]  {msg[:250]}')
            except:
                print(field['value'][:250])
PYEOF
```

Reuse for all queries:

```bash
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

**Note:** Do NOT use inline `python3 -c "..."` multi-line on SSM — the terminal will add leading spaces causing `IndentationError`.

### 2.3 Ready-to-Use Commands

There are 2 variants for each command: **macOS (local)** and **Linux (bastion/SSM)**.
The only differences are `date` syntax and `--profile`.

#### Upload worker — last 7 days

**macOS (local):** replace `$PROFILE` with `bs-point-dev` or `bs-point-stg`

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -v-7d +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftUpload/ and @message not like /subscribe/ | sort @timestamp desc | limit 50' \
  --profile $PROFILE \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Linux (bastion/SSM):** no `--profile` needed

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "7 days ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftUpload/ and @message not like /subscribe/ | sort @timestamp desc | limit 50' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Retrieve results (same for both):**

```bash
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

On macOS if `/tmp/parse_cw.py` has not been created, add `--profile $PROFILE` and pipe through inline python:

```bash
aws logs get-query-results --query-id "$QUERY_ID" --profile $PROFILE --region ap-northeast-1 --output json | python3 -c "
import sys, json
resp = json.load(sys.stdin)
print('Status:', resp.get('status'))
print('Matched:', resp.get('statistics',{}).get('recordsMatched'))
for row in resp.get('results', []):
    for field in row:
        if field['field'] == '@message':
            try:
                outer = json.loads(field['value'])
                inner = json.loads(outer.get('log','{}'))
                print(inner.get('@timestamp','?') + '  [' + inner.get('level','?') + ']  ' + inner.get('message','?')[:250])
            except:
                print(field['value'][:250])
"
```

#### Parse worker — last 7 days

**macOS (local):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -v-7d +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftParse/ and @message not like /subscribe/ | sort @timestamp desc | limit 50' \
  --profile $PROFILE \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Linux (bastion/SSM):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "7 days ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulftParse/ and @message not like /subscribe/ | sort @timestamp desc | limit 50' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Retrieve results:** (same as Upload — use `parse_cw.py` or inline python)

```bash
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

#### Sent file content — last 30 days

**macOS (local):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -v-30d +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /hulft File content/ | sort @timestamp desc | limit 10' \
  --profile $PROFILE \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Linux (bastion/SSM):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "30 days ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /hulft File content/ | sort @timestamp desc | limit 10' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Retrieve results:**

```bash
sleep 15
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

#### HULFT errors only

**macOS (local):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -v-7d +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulft/ | filter @message like /error|ERROR|failed|FAILED|exception/ | sort @timestamp desc | limit 50' \
  --profile $PROFILE \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Linux (bastion/SSM):**

```bash
QUERY_ID=$(aws logs start-query \
  --log-group-name '/aws/containerinsights/point/application' \
  --start-time $(date -d "7 days ago" +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /pontaGrantPointHulft/ | filter @message like /error|ERROR|failed|FAILED|exception/ | sort @timestamp desc | limit 50' \
  --region ap-northeast-1 \
  --output text --query 'queryId') && echo "OK: $QUERY_ID"
```

**Retrieve results:**

```bash
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

### 2.4 Handling Queries That Are Not Yet Complete

If `Status: Running`, wait a bit more and then retrieve results again:

```bash
# Check status
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output text --query 'status'

# If still Running, wait and retrieve results
sleep 10
aws logs get-query-results --query-id "$QUERY_ID" --region ap-northeast-1 --output json \
  | jq -r '.status as $s | .statistics.recordsMatched as $m | "Status: \($s)\nMatched: \($m)", (.results[] | .[1].value | fromjson | .log | fromjson | "\(.["@timestamp"])  [\(.level)]  \(.message)")'
```

Scan time depends on log volume — a 7-day range typically takes 5-10 seconds, while 30-90 days may take 15-30 seconds.

On macOS, add `--profile $PROFILE` to each `aws` command.

---

## Part 3: Investigation Checklist

### When Upload is not working

1. [ ] Check if the worker is running → Query 1 (look for `Start` log)
2. [ ] Check NFS mount → Look for log `Failed to prepare file directory`
3. [ ] Check previous task → Look for log `Previous task not completed successfully`
4. [ ] Check if there is data to send → Look for log `Failed to fetch transfer list`
5. [ ] Check file content → Query 3 (if present = file written successfully)

### When Parse is not working

1. [ ] Check if the worker is running → Query 2 (look for `rcvdata Start` log)
2. [ ] Check if file exists → Look for log `File exists: true/false`
3. [ ] Check task status → Look for log `status is null` or `content is null`
4. [ ] Check parse results → Query 4 (look for `Hulft data`)
5. [ ] Check success/failure processing → Query 8

### Common Errors

| Log message | Cause | Action |
|-------------|-------|--------|
| `Read-only file system` | NFS mount not ready or read-only | Check NFS PV/PVC on K8s |
| `File does not exist in path` | Result file from Ponta not yet available | Check HULFT daemon and connectivity to Ponta |
| `Previous task not completed successfully` | Previous task is FAILED/PENDING | Check `ponta_hulft_task_status` table in DB |
| `Failed to fetch transfer list` | No transactions waiting to be sent | Check `point_transfer` table — any PENDING records? |
| `Error occurred while parsing the file` | Result file has a format error | Review the detailed error message, check file content |

---

## Part 4: Quick Reference

### Important Keywords to Search For

| Keyword | Appears when |
|---------|-------------|
| `----------------- Start ----------------` | Upload worker starts |
| `-----------------Hulft rcvdata Start` | Parse worker starts |
| `hulft File content` | Sent file content (full) |
| `header_length` | Header written, with length |
| `footer_length` | Footer written, with length |
| `tradeNumber` | Transaction code in body |
| `requestData_content` | Length of each body record |
| `Hulft data` | Parse result per record (JSON) |
| `Hulft Completed` | Parse completed |
| `transferOperationToPontaSuccess` | Transaction succeeded |
| `transferOperationToPontaFailed` | Transaction failed |

### HULFT File Structure (fixed-width, Shift_JIS)

```
[Header]  IF_ID + "00101" + YYYYMMDD + HHMMSS + record_count(12) + padding  (426 bytes + \n)
[Body]    Each record on one line: date, time, FROM_CODE, memberId, tradeNumber, amount
[Footer]  IF_ID + "00103" + YYYYMMDD + HHMMSS + padding                     (426 bytes + \n)
```

### Source Code Reference

| File | Description |
|------|-------------|
| `point-worker/.../worker/PontaGrantPointHulftUpload.java` | Worker that creates the send file |
| `point-worker/.../worker/PontaGrantPointHulftParse.java` | Worker that reads the result file |
| `point-worker/.../sqssubscriber/PontaGrantPointUploadSqsSubscriber.java` | SQS trigger for Upload |
| `point-worker/.../sqssubscriber/PontaGrantPointHulftParseSqsSubscriber.java` | SQS trigger for Parse |
| `point-worker/src/main/resources/application.yaml` (lines 196-200) | HULFT paths config |
| `point-common/.../entity/PontaHulftTaskStatus.java` | Entity for managing task status |
| `point-common/.../service/PontaHufltTaskStatusService.java` | Service for managing task status |
