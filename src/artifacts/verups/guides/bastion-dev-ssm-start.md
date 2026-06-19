# Khởi động SSM Bastion DEV từ Local

Hướng dẫn kết nối tới bastion môi trường **DEV** (`point-bastion`) qua AWS Systems Manager
Session Manager từ máy local. Bao gồm: start EC2 instance nếu đang stopped, mở shell SSM,
port forward tới Aurora/Redis, và stop instance khi xong để tiết kiệm chi phí.

> Nếu cần tạo Linux user + SSH key pair trên bastion, đọc tiếp
> [`bastion-ssh-user-setup.md`](./bastion-ssh-user-setup.md). Tài liệu này chỉ cover
> "làm sao connect được vào bastion DEV từ máy local".

---

## Thông tin Bastion DEV

| Thuộc tính | Giá trị |
|------------|---------|
| AWS Account | `845131030484` (DEV) |
| Region | `ap-northeast-1` |
| VPC | `point` (`vpc-0e139c5a0789db4c0`) |
| Tag Name | `point-bastion` |
| Hostname | `bs-point-dev` |
| Private IP | `172.18.21.50` |
| Subnet | `point-private-subnet-apne1-az1` (private, không có Public IP) |
| Instance Type | `t2.medium` |
| OS | Ubuntu 20.04 LTS |
| Kết nối | **SSM Session Manager only** — không có SSH port 22 mở ra internet |
| IAM Role | `point-bastion-role` (đã attach `AmazonSSMManagedInstanceCore`) |

Nguồn: [`bs-exchange-infra/terraform/components/ec2-bastion/tfvars/dev-ex.tfvars`](../../bs-exchange-infra/terraform/components/ec2-bastion/tfvars/dev-ex.tfvars),
[`terraform.tfvars`](../../bs-exchange-infra/terraform/components/ec2-bastion/terraform.tfvars).

---

## Prerequisites

Kiểm tra nhanh trên **macOS Terminal** (hoặc zsh):

```bash
aws --version                      # Expect: aws-cli/2.x.x
session-manager-plugin --version   # Expect: 1.2.x trở lên
```

Nếu thiếu:

```bash
# AWS CLI v2
brew install awscli

# Session Manager Plugin
brew install --cask session-manager-plugin
```

### IAM Permissions yêu cầu

Trên account DEV `845131030484`, IAM user/role bạn đang dùng cần tối thiểu:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ssm:StartSession",
        "ssm:TerminateSession",
        "ssm:DescribeSessions",
        "ssm:DescribeInstanceInformation"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## Bước 1. Cấu hình AWS credentials cho DEV

Nếu dùng AWS SSO:

```bash
aws configure sso --profile bs-point-dev
# SSO start URL: <do admin cung cấp>
# SSO region:    ap-northeast-1
# Account ID:    845131030484
# Region:        ap-northeast-1
```

Login và export profile:

```bash
aws sso login --profile bs-point-dev
export AWS_PROFILE=bs-point-dev
export AWS_REGION=ap-northeast-1
```

Verify đang đúng account:

```bash
aws sts get-caller-identity
# Expect Account: 845131030484
```

---

## Bước 2. Lấy Instance ID của bastion DEV

```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=point-bastion" \
  --query "Reservations[].Instances[].[InstanceId,State.Name,PrivateIpAddress]" \
  --output table
```

Output mẫu:

```text
-------------------------------------------------------
|                  DescribeInstances                  |
+---------------------+-----------+-------------------+
|  i-0abc123def45678  |  stopped  |  172.18.21.50     |
+---------------------+-----------+-------------------+
```

Ghi nhớ `<INSTANCE_ID>` (ví dụ `i-0abc123def45678`) để dùng cho các bước sau.

> **Tip**: Gán vào biến shell cho đỡ copy:
>
> ```bash
> export BASTION_ID=$(aws ec2 describe-instances \
>   --filters "Name=tag:Name,Values=point-bastion" \
>             "Name=instance-state-name,Values=running,stopped" \
>   --query "Reservations[0].Instances[0].InstanceId" --output text)
> echo $BASTION_ID
> ```

---

## Bước 3. Start bastion nếu đang stopped

Bastion DEV thường được **stop để tiết kiệm chi phí** khi không ai dùng. Nếu bước 2 thấy
`State=stopped`, start lên:

```bash
aws ec2 start-instances --instance-ids $BASTION_ID
```

Đợi instance pass status checks (khoảng 60–120 giây):

```bash
aws ec2 wait instance-status-ok --instance-ids $BASTION_ID
echo "Bastion ready"
```

> **Tại sao phải chờ `instance-status-ok`?**
> EC2 chuyển sang `running` rất nhanh, nhưng SSM Agent cần thêm vài chục giây để
> register lại với SSM service sau mỗi lần boot. Nếu `aws ssm start-session` quá sớm sẽ
> báo `TargetNotConnected`. Lệnh `wait instance-status-ok` đảm bảo cả system
> + instance checks đã pass.

Verify SSM Agent đã online:

```bash
aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=$BASTION_ID" \
  --query "InstanceInformationList[].[InstanceId,PingStatus,AgentVersion]" \
  --output table
# Cột PingStatus phải là "Online"
```

---

## Bước 4. Mở SSM shell session

```bash
aws ssm start-session --target $BASTION_ID
```

Nếu thành công, shell sẽ đổi prompt:

```text
Starting session with SessionId: hoangtrung-0a1b2c3d4e5f6g7h8

$ whoami
ssm-user
$ hostname
bs-point-dev
```

Thoát bằng `exit` hoặc `Ctrl+D`.

### Công cụ có sẵn trên bastion

User data đã cài sẵn (tham chiếu [`user_data.sh`](../../bs-exchange-infra/terraform/components/ec2-bastion/user_data.sh)):

| Tool | Version | Dùng để |
|------|---------|---------|
| `awscli` | v2 | Gọi AWS API từ bastion |
| `kubectl` | v1.30.14 | Truy cập EKS cluster DEV |
| `helm` | v3.20.0 | Quản lý Helm charts |
| `mariadb-client` | — | Connect Aurora MySQL (`mysql -h ...`) |
| `redis-tools` | — | Connect ElastiCache (`redis-cli -h ...`) |
| `postgresql-12` / `psql` | 12 | Connect Redshift |
| `jq` | — | Parse JSON |

---

## Bước 5. (Tuỳ chọn) Port forward tới Aurora / Redis / Redshift

Bastion có thể làm proxy để bạn connect database từ client trên local (DBeaver, TablePlus,
redis-cli, ...) mà không cần SSH vào bastion.

### 5.0. Secret IDs của DEV

Endpoint Aurora / Redis / Redshift được lưu trong AWS Secrets Manager của account DEV.
Dùng pattern naming nhất quán `point/<SPRING_PROPERTY>`:

| Service | Secret ID | Key chứa endpoint |
|---------|-----------|--------------------|
| Aurora MySQL (master) | `point/SPRING_DATASOURCE_MASTER` | `SPRING_DATASOURCE_MASTER_URL` (JDBC URL) |
| Aurora MySQL (editor) | `point/aurora/editor_service` | — (chỉ chứa credentials) |
| Aurora MySQL (viewer) | `point/aurora/viewer_service` | — (chỉ chứa credentials) |
| Redshift | `point/SPRING_DATASOURCE_HISTORICAL` | `SPRING_DATASOURCE_HISTORICAL_URL` |
| ElastiCache Redis | `point/SPRING_DATA_REDIS` | `SPRING_DATA_REDIS_HOST` |

Nguồn: [`bs-exchange-infra/terraform/components/secrets_manager/locals.tf`](../../bs-exchange-infra/terraform/components/secrets_manager/locals.tf),
[`bs-exchange-infra/k8s-manifests/point/base/secret-provider-class.yaml`](../../bs-exchange-infra/k8s-manifests/point/base/secret-provider-class.yaml).

> **Inspect thử 1 secret**:
>
> ```bash
> aws secretsmanager get-secret-value \
>   --secret-id point/SPRING_DATASOURCE_MASTER \
>   --query SecretString --output text | jq .
> ```

### 5.1. Port forward tới Aurora MySQL (port 3306)

Lấy Aurora writer endpoint từ Secrets Manager. JDBC URL có dạng
`jdbc:mariadb://<host>:3306/<db>?...` — ta cần extract `<host>`:

```bash
AURORA_HOST=$(aws secretsmanager get-secret-value \
  --secret-id point/SPRING_DATASOURCE_MASTER \
  --query SecretString --output text \
  | jq -r '.SPRING_DATASOURCE_MASTER_URL' \
  | sed -E 's|^jdbc:[^:]+://([^:/?]+).*|\1|')

echo "Aurora host: $AURORA_HOST"
# Ví dụ: point.cluster-c52ii6s666k9.ap-northeast-1.rds.amazonaws.com
```

Mở port forward (Aurora DEV listen port `13306`, xem
[`terraform/components/aurora/tfvars/dev-ex.tfvars`](../../bs-exchange-infra/terraform/components/aurora/tfvars/dev-ex.tfvars)):

```bash
aws ssm start-session \
  --target $BASTION_ID \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$AURORA_HOST\"],\"portNumber\":[\"13306\"],\"localPortNumber\":[\"13306\"]}"
```

> **Lưu ý**: Port Aurora DEV là **13306** (non-standard), không phải 3306. `localPortNumber`
> có thể chọn số khác nếu bạn đang có service dùng port 13306 trên local.

Sau đó từ **terminal khác** (giữ terminal trên còn chạy session):

```bash
# Lấy username/password
aws secretsmanager get-secret-value \
  --secret-id point/aurora/editor_service \
  --query SecretString --output text | jq .

# Connect qua port local (cùng port với remote cho đỡ nhầm)
mysql -h 127.0.0.1 -P 13306 -u <username> -p
```

### 5.2. Port forward tới ElastiCache Redis (port 6379)

```bash
REDIS_HOST=$(aws secretsmanager get-secret-value \
  --secret-id point/SPRING_DATA_REDIS \
  --query SecretString --output text \
  | jq -r '.SPRING_DATA_REDIS_HOST')

echo "Redis host: $REDIS_HOST"
# Ví dụ: master.point.bh8fpu.apne1.cache.amazonaws.com

aws ssm start-session \
  --target $BASTION_ID \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$REDIS_HOST\"],\"portNumber\":[\"6379\"],\"localPortNumber\":[\"16379\"]}"
```

Từ terminal khác:

```bash
redis-cli -h 127.0.0.1 -p 16379
# Ví dụ lệnh:
#   127.0.0.1:16379> PING
#   PONG
```

### 5.3. Port forward tới Redshift (port 5439)

```bash
REDSHIFT_HOST=$(aws secretsmanager get-secret-value \
  --secret-id point/SPRING_DATASOURCE_HISTORICAL \
  --query SecretString --output text \
  | jq -r '.SPRING_DATASOURCE_HISTORICAL_URL' \
  | sed -E 's|^jdbc:[^:]+://([^:/?]+).*|\1|')

echo "Redshift host: $REDSHIFT_HOST"
# Ví dụ: point.cz0jq6asdiym.ap-northeast-1.redshift.amazonaws.com

aws ssm start-session \
  --target $BASTION_ID \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$REDSHIFT_HOST\"],\"portNumber\":[\"5439\"],\"localPortNumber\":[\"15439\"]}"
```

Từ terminal khác:

```bash
psql -h 127.0.0.1 -p 15439 -U <username> -d <db>
```

> **Lưu ý port local**: Chọn port local ≠ port chuẩn (13306, 16379, 15439) để không
> xung đột với service đang chạy trên máy bạn.

> **Endpoint có thể thay đổi**: Các giá trị endpoint ví dụ ở trên chỉ để minh hoạ
> *shape*. Luôn query lại qua Secrets Manager như snippet trên — endpoint thật có
> thể đổi khi Aurora/Redis bị recreate.

---

## Bước 6. Stop bastion khi xong việc

Để tránh tốn chi phí EC2 khi không dùng, stop instance lại:

```bash
aws ec2 stop-instances --instance-ids $BASTION_ID
aws ec2 wait instance-stopped --instance-ids $BASTION_ID
echo "Bastion stopped"
```

> **Quy ước team**: Bastion DEV là shared resource. Trước khi stop, hãy check xem có ai
> đang dùng không (ví dụ hỏi nhanh trên Slack channel team). Nếu không chắc, cứ để
> running — chi phí `t2.medium` DEV không đáng kể.

---

## Troubleshooting

| Lỗi | Nguyên nhân | Cách fix |
|------|-------------|----------|
| `TargetNotConnected` | SSM Agent chưa online hoặc instance đang stopped/pending | Chờ `instance-status-ok`, kiểm tra `describe-instance-information` cột `PingStatus` |
| `An error occurred (AccessDeniedException) ... ssm:StartSession` | IAM thiếu permission | Gắn policy `ssm:StartSession` (xem mục Prerequisites) |
| `SessionManagerPlugin is not found` | Chưa cài hoặc shell chưa reload PATH | `brew install --cask session-manager-plugin`, mở terminal mới |
| `Unable to start command: ... AWS-StartPortForwardingSessionToRemoteHost` | Region chưa có SSM document này, hoặc plugin cũ | Kiểm tra `--region ap-northeast-1`, update plugin lên v1.2.x+ |
| `ExpiredToken: The security token included in the request is expired` | SSO session hết hạn | `aws sso login --profile bs-point-dev` |
| Instance không xuất hiện trong `describe-instances` | Sai AWS profile hoặc sai region | `echo $AWS_PROFILE $AWS_REGION`, chạy `aws sts get-caller-identity` |
| Kết nối Aurora/Redis qua port forward bị `Connection refused` | Port forward session bị đóng, hoặc SG bastion chưa cho phép egress | Check lệnh `aws ssm start-session` còn chạy; SG bastion đã cho phép egress 3306/6379/5439 trong VPC CIDR |

### Lấy log SSM session

Nếu SSM document chạy nhưng có lỗi, lấy session ID từ output rồi check:

```bash
aws ssm describe-sessions --state History \
  --filters "key=Target,value=$BASTION_ID" \
  --max-results 5
```

---

## Checklist nhanh

- [ ] Cài `awscli` + `session-manager-plugin` trên local
- [ ] `aws sso login --profile bs-point-dev` → `aws sts get-caller-identity` trả về account `845131030484`
- [ ] Lấy `BASTION_ID` qua `describe-instances` với tag `point-bastion`
- [ ] Nếu `stopped`: `start-instances` → `wait instance-status-ok`
- [ ] `aws ssm start-session --target $BASTION_ID` → vào được shell với user `ssm-user`
- [ ] Xong việc: `stop-instances` → `wait instance-stopped`

---

## Tham chiếu

- Terraform source: [`bs-exchange-infra/terraform/components/ec2-bastion/`](../../bs-exchange-infra/terraform/components/ec2-bastion/)
- DEV tfvars: [`bs-exchange-infra/terraform/components/ec2-bastion/tfvars/dev-ex.tfvars`](../../bs-exchange-infra/terraform/components/ec2-bastion/tfvars/dev-ex.tfvars)
- SSH user setup trên bastion: [`bastion-ssh-user-setup.md`](./bastion-ssh-user-setup.md)
- AWS docs — Session Manager: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html>
- AWS docs — Port forwarding via SSM: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html#sessions-start-port-forwarding>
