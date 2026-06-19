# Giải thích chi tiết plan — component `eks`, nhánh `eks/1.31`, env `dev`

> Đọc kèm: `plan-output.txt` (raw plan) và `risk-assessment.md` (đánh giá rủi ro) trong cùng thư mục.
> Plan summary: **28 add / 18 change / 13 destroy** — branch `eks/1.31` @ `ba83cb3a`, account `905418018638`.

Plan này gộp **4 nhóm thay đổi có chủ đích**:

| Nhóm | Nguồn gốc | Tác động chính |
|---|---|---|
| 1. Nâng module EKS v17 → v21 | đổi `terraform-aws-modules/eks` từ bản cũ sang v21 | đổi cấu trúc state (moved blocks), drop 4 policy attachment cũ, thêm scaffolding mới |
| 2. Auth Stage 1 | `authentication_mode = "API_AND_CONFIG_MAP"` | bật chế độ kép, tạo 7 access entries |
| 3. Cutover IRSA | bỏ quyền AWS khỏi node role, tạo 4 IRSA role | pod lấy quyền AWS qua ServiceAccount thay vì node |
| 4. Hardening | IMDSv2 bắt buộc, hop_limit=1, deletion protection, private endpoint | roll toàn bộ node, chặn pod truy cập IMDS |

Dưới đây đi qua **từng resource trong plan**, theo nhóm.

---

## 1. Các thao tác chỉ-đổi-state (`moved` blocks) — KHÔNG đụng AWS

Khi nâng module v17 → v21, tên resource trong state đổi. Các block `has moved to` chỉ ghi lại địa chỉ mới trong tfstate, **không có API call nào tới AWS**:

| Cũ (v17) | Mới (v21 / root) |
|---|---|
| `module.eks.aws_iam_role.workers[0]` | `aws_iam_role.worker` (kéo ra root module) |
| `module.eks.aws_iam_role.cluster[0]` | `module.eks.aws_iam_role.this[0]` |
| `module.eks...workers_AmazonEKSWorkerNodePolicy[0]` | `aws_iam_role_policy_attachment.worker_amazon_eks_worker_node_policy` |
| `module.eks...workers_AmazonEC2ContainerRegistryReadOnly[0]` | `aws_iam_role_policy_attachment.worker_amazon_ec2_container_registry_read_only` |
| `module.eks...cluster_AmazonEKSClusterPolicy[0]` | `module.eks...this["AmazonEKSClusterPolicy"]` |
| `module.eks.module.node_groups.aws_eks_node_group.workers["0".."4"]` | `module.eks.module.eks_managed_node_group["admin"/"api"/"app"/"worker"/"mmh"]...` |
| `aws_eks_addon.coredns/kube_proxy/vpc_cni[0]` | `module.eks.aws_eks_addon.this["..."]` |

→ **Rủi ro: không.** Đây là lý do node group "update in-place" thay vì bị destroy/recreate — moved block giữ nguyên identity.

## 2. Cluster — `module.eks.aws_eks_cluster.this[0]` (update in-place)

4 thay đổi trên chính cluster `point`:

1. **`authentication_mode: "CONFIG_MAP" → "API_AND_CONFIG_MAP"`** — trái tim của Stage 1. Bật chế độ auth kép: access entries (mới) hoạt động song song với `aws-auth` ConfigMap (cũ). **One-way**: AWS không cho quay về `CONFIG_MAP`. Không gián đoạn — control plane update online.
2. **`deletion_protection: false → true`** — chặn xóa cluster nhầm. Thuần phòng thủ.
3. **`endpoint_private_access: false → true`** — tạo private endpoint ENI trong VPC; kubectl từ bastion/trong VPC resolve nội bộ. Public endpoint **vẫn bật** nên không client nào bị đứt.
4. **Tag `terraform-aws-modules = "eks"`** + bỏ block `timeouts` cũ — cosmetic.

## 3. Access entries — 7 × `aws_eks_access_entry` (create)

Chỉ tạo được vì auth mode đã rời `CONFIG_MAP` (cùng apply — Terraform tự xử lý thứ tự vì entries phụ thuộc cluster). Mỗi entry map một IAM principal vào Kubernetes group:

| Key | Principal | K8s group |
|---|---|---|
| `administrator` | role `custodian-AdministratorRole` | `admin` |
| `operator` | role `custodian-OperatorRole` | `operator` |
| `viewer` | role `custodian-ViewerRole` | `viewer` |
| `cicd` | role `custodian-CICDRole` | `cicd` |
| `bastion` | role `point-bastion-role` | `admin` |
| `cd_runner` | role `point-cd-runner-role` | `cicd` |
| `named_user` | user `bs-developer` | `admin` |

⚠️ **BLOCKER**: `point-cd-runner-role` chưa tồn tại trên account (verify 2026-06-10) → entry `cd_runner` sẽ fail khi apply. Phải apply component `ec2-cd-runner` trước. Lưu ý các entry chỉ map vào **group** — quyền thực tế vẫn do RBAC (ClusterRoleBinding cho `admin`/`operator`/`viewer`/`cicd`) quyết định; entry không kèm access policy ARN nào.

## 4. IAM cluster role — `eks-cluster-role`

- **Trust policy thêm `sts:TagSession`** (update in-place): chuẩn mới của module v21, additive, vô hại.
- **4 attachment bị destroy** (gate "policy-drop" của v21 — module mới chỉ giữ `AmazonEKSClusterPolicy`):
  - `AmazonEKSServicePolicy` — obsolete từ khi AWS gộp quyền vào `AmazonEKSClusterPolicy` (~2020). Bỏ an toàn.
  - `AmazonEKSVPCResourceController` — chỉ cần cho **security-groups-for-pods** hoặc Windows nodes. Cluster này không dùng cả hai → bỏ an toàn.
  - `point-deny-log-group...` — policy **Deny** `logs:CreateLogGroup` (kèm destroy chính policy đó). Bỏ một Deny không cấp thêm quyền thực thi nào mới về phía workload; log group `/aws/eks/point/cluster` đã tồn tại và do Terraform quản. An toàn.
  - `point-elb-sl-role-creation...` — quyền tạo service-linked role cho ELB (kèm destroy policy). SLR `AWSServiceRoleForElasticLoadBalancing` đã tồn tại từ lâu → không còn cần.

## 5. IAM node role — `eks-worker-role`: cốt lõi của cutover IRSA

**7 attachment bị detach (destroy)** khỏi node role:

| Policy bị detach | Ai dùng quyền này | Đi đâu sau cutover |
|---|---|---|
| `AmazonS3FullAccess` | app pods | → `point-app-irsa-role` |
| `AmazonSQSFullAccess` | app pods | → `point-app-irsa-role` |
| `AmazonSNSFullAccess` | app pods | → `point-app-irsa-role` |
| `AmazonSESFullAccess` | app pods | → `point-app-irsa-role` |
| `AmazonKinesisFullAccess` | app pods | → `point-app-irsa-role` |
| `AmazonEKSClusterAutoscalerPolicy` | cluster-autoscaler pod | → `point-cluster-autoscaler-irsa-role` |
| `AmazonEKS_CNI_Policy` | `aws-node` DaemonSet (vpc-cni) | → `point-vpc-cni-aws-node` (gắn qua addon, mục 9) |

**Giữ nguyên trên node role** (không nằm trong destroy list): `AmazonEKSWorkerNodePolicy`, `AmazonEC2ContainerRegistryReadOnly` (node cần để join cluster + pull image) và `CloudWatchAgentServerPolicy` — giữ lại **có chủ đích** cho fluent-bit (chạy hostNetwork, vẫn dùng node role qua IMDS).

Ý nghĩa: trước đây **mọi pod trên node** đều thừa hưởng S3/SQS/SES FullAccess qua IMDS — quá rộng. Sau apply, chỉ pod mount đúng ServiceAccount mới có quyền, theo least-privilege.

## 6. IRSA roles mới — 4 × `aws_iam_role` (create) + attachments

Cả 4 role đều có trust policy kiểu **AssumeRoleWithWebIdentity** trỏ vào OIDC provider của cluster, điều kiện `:sub` khóa chặt vào đúng `namespace:serviceaccount`:

1. **`point-app-irsa-role`** — sub = `system:serviceaccount:default:point-app-sa`. Nhận 7 attachment: S3/SQS/SNS/SES/Kinesis FullAccess, SecretsManagerReadWrite, CloudWatchAgentServerPolicy + **inline policy `AthenaWafQueryAccess`** (athena workgroup `waf-logs-*` + Glue catalog `waf_logs_*` read-only) — phục vụ app query WAF logs qua Athena.
2. **`point-cluster-autoscaler-irsa-role`** — sub = `kube-system:cluster-autoscaler`, nhận `AmazonEKSClusterAutoscalerPolicy`.
3. **`point-cloudwatch-agent-irsa-role`** — sub = `amazon-cloudwatch:cloudwatch-agent`, nhận `CloudWatchAgentServerPolicy`.
4. **`point-vpc-cni-aws-node`** — sub = `kube-system:aws-node`, nhận `AmazonEKS_CNI_Policy`.

Điều kiện để hoạt động: ServiceAccount tương ứng trong cluster phải có annotation `eks.amazonaws.com/role-arn` (đã có sẵn trong `k8s-manifests/point/dev/` — cần verify đã apply vào cluster live trước khi terraform apply, xem `risk-assessment.md` gate H2).

## 7. ALB controller policy — `AWSLoadBalancerControllerIAMPolicy` (update in-place)

Policy document được fetch trực tiếp từ GitHub upstream (`data.http`, tag v3.1.0). Các thay đổi:

- **Thêm quyền describe mới**: `ec2:GetSecurityGroupsForVpc`, `ec2:DescribeIpamPools`, `ec2:DescribeRouteTables`, `elasticloadbalancing:DescribeTrustStores/DescribeListenerAttributes/DescribeCapacityReservation`, `elasticloadbalancing:SetRulePriorities`, `ModifyListenerAttributes`, `ModifyCapacityReservation`, `ModifyIpPools`.
- **Hoán đổi 2 statement** (nhìn như đổi lớn nhưng thực ra là restructure theo policy chính chủ mới): statement `AddTags` (điều kiện `RequestTag` + `CreateAction`) và statement `Modify*/Delete*` (điều kiện `ResourceTag`) đổi chỗ Resource/Condition cho nhau. Kết quả cuối **tương đương ngữ nghĩa** với policy cũ + quyền mới.

Lưu ý vận hành: vì nguồn là URL GitHub, nội dung có thể đổi giữa plan và apply (apply sẽ re-fetch). Rủi ro thấp.

## 8. Launch templates + node groups — nguyên nhân ROLL toàn bộ node

**5 × `aws_launch_template` (update)** — mỗi template tạo version mới với:
- `http_tokens = "required"` — **bắt buộc IMDSv2** (chống SSRF lấy credential).
- `http_put_response_hop_limit: 2 → 1` — gói trả lời IMDS chỉ đi được 1 hop → **pod (2 hops qua pod network) bị chặn hẳn IMDS**, chỉ process trên host/hostNetwork còn truy cập được. Đây là "chốt khóa" buộc pod phải dùng IRSA.

**5 × `aws_eks_node_group` (update in-place)** — mỗi group:
- `launch_template.version` trỏ sang version mới ở trên → **rolling replacement** node.
- `release_version: 1.31.14-20260512 → 1.31.14-20260529` — module v21 resolve AMI qua SSM parameter `recommended` tại plan time; pointer đã nhảy so với live. Cũng trigger roll (gộp chung 1 lần roll với LT).
- Tag `Name` thêm vào — cosmetic.

Vẫn **cùng version 1.31** — không phải upgrade Kubernetes, chỉ là AMI patch + LT mới. Roll diễn ra theo cơ chế managed node group (tạo node mới → drain node cũ), mỗi group desired=1 nên mỗi app có khoảng trống reschedule ngắn.

## 9. EKS addons — 3 × `aws_eks_addon` (update in-place)

Version addon **không đổi** (tfvars pin khớp live: vpc-cni `v1.20.5`, kube-proxy `v1.31.14`, coredns `v1.11.4`). Thay đổi:

- **Cả 3**: thêm thuộc tính quản trị `preserve=false`, `resolve_conflicts_on_create/update="OVERWRITE"` — nghĩa là từ giờ update addon sẽ **ghi đè mọi chỉnh tay** (`kubectl edit`) trên resource do addon quản.
- **Riêng vpc-cni**:
  - `service_account_role_arn = point-vpc-cni-aws-node` — EKS tự annotate SA `aws-node` và restart DaemonSet → `aws-node` chuyển sang IRSA (khớp với việc detach `AmazonEKS_CNI_Policy` khỏi node role ở mục 5).
  - `configuration_values = {"enableNetworkPolicy": "true"}` — bật network-policy agent của VPC CNI. Chưa có object `NetworkPolicy` nào trong cluster nên **không chặn traffic nào**, chỉ là bật khả năng enforce về sau.

## 10. OIDC provider — `aws_iam_openid_connect_provider` (update in-place)

`thumbprint_list` được tính lại từ `data.tls_certificate` (known after apply). Chỉ là cập nhật metadata trên provider hiện hữu — **không** tạo provider mới, IRSA token đang chạy không bị ảnh hưởng. (Từ 2023 AWS tự tin tưởng root CA của các OIDC endpoint phổ biến nên thumbprint gần như không còn vai trò thực tế.)

## 11. CloudWatch log group — `/aws/eks/point/cluster` (update in-place)

Chỉ thêm tag `Name`. Retention 731 ngày giữ nguyên.

## 12. Scaffolding của module v21 (create — vô hại)

- `module.eks.time_sleep.this[0]` — chờ 30s sau khi cluster sẵn sàng trước khi tạo các resource phụ thuộc (addon/entries). Chỉ là timer trong Terraform.
- 5 × `null_resource.validate_cluster_service_cidr` — guard validate `service_cidr` (10.100.0.0/16) cho user_data của node group. Không tạo gì trên AWS.

## 13. Data sources "read during apply"

`aws_eks_addon_version` ×3 + `tls_certificate` bị hoãn đọc tới lúc apply vì phụ thuộc resource có pending change. Bình thường — không phải dấu hiệu lỗi.

## 14. Outputs mới

`addon_versions`, `ami_type`, `cluster_id/name/version`, và 4 ARN của IRSA role (`point_app_irsa_role_arn`, ...) — để component khác / runbook tham chiếu. Không tác động hạ tầng.

---

## Tổng kết đếm số

| Loại | Số lượng | Gồm |
|---|---|---|
| **28 add** | 7 access entries + 4 IRSA roles + 11 attachments/inline policy + 1 time_sleep + 5 null_resource | toàn bộ là IAM/scaffolding — không resource stateful |
| **18 change** | cluster (auth/protection/endpoint) + 5 LT + 5 node groups + 3 addons + OIDC + log group + cluster role trust + ALB policy | node group change ⇒ **roll node** |
| **13 destroy** | 7 detach khỏi node role + 4 detach khỏi cluster role + 2 IAM policy obsolete | **không có** destroy stateful nào |

Kết luận vận hành: xem `risk-assessment.md` — blocker `point-cd-runner-role` phải xử lý trước, gate ServiceAccount phải verify trước, và chấp nhận 1 lần roll toàn bộ node fleet trong DEV.
