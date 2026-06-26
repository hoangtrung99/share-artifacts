# Verup AWS Environments Inventory

Last updated: 2026-03-18
Scope: Three separate systems — Point運用 (current production), Point/Verup (version-up project), and Exchange/Coinbook — from Confluence `bse`/`UNYO` spaces and Slack.

## 1) Summary

Three separate systems exist with independent AWS accounts:

| System | Description | Jira | Slack | Confluence |
| --- | --- | --- | --- | --- |
| **Point運用** | Current production Point system (Ponta LM integration) | `POUH-xxx` | `#backseat_maintenance_point` | Not documented |
| **Point (Verup)** | Version-up project merging Point + Exchange + new features | `BB-xxx` | — | BSE space |
| **Exchange (Coinbook)** | Current exchange system at coinbook.co.jp | `UNYO-xxx` | — | UNYO space |

- Ver-up は、既存の Point システムと Exchange システムの機能また新規機能を統合したアプリケーション (source: BSE インフラリリース計画)
- Ver-up will be deployed to Point PRD (existing production), NOT to a new environment.
- Point PRD has unique Ponta LM connection (VPN Gateway, HULFT NFS, CoreDNS) that ver-up must be compatible with.
- IAM management model is centralized via custodian accounts, then switch-role into environment accounts.
- All infrastructure runs in `ap-northeast-1` (Tokyo).

## 2) AWS Account Mapping

### Point運用 (Current Production)

Source: Slack DM (Duc Nghia Pham, 2026-03-18) + #backseat_maintenance_point logs.
Not documented on Confluence.

| Category | Environment | AWS Account ID | Status | Notes |
| --- | --- | --- | --- | --- |
| Runtime | `dev` | `905418018638` | Confirmed | From Duc Nghia DM |
| Runtime | `stg` | `471112755246` | Confirmed | From DM + ECR URIs in Slack logs |
| Runtime | `prd` | `211125716602` | Confirmed | From DM + AWS notifications (CloudShell, ElastiCache) |

IAM Access:
- Role: `custodian-OperatorRole`
- Switch Role example (STG): Account ID `471112755246`, Role `custodian-OperatorRole`
- Display name: 任意 (e.g., STG, PRD, DEV)
- ESS Server (PRD access): `172.25.137.7`

### Point (Verup)

| Category | Environment | AWS Account ID | Status | Notes |
| --- | --- | --- | --- | --- |
| Management | custodian | `590183696997` | Confirmed | Account name: `bs-custodian`, MFA required |
| Runtime | `dev` | `845131030484` | Confirmed | Seen in IAM page + DEV ECR URIs |
| Runtime | `stg` | `520411743393` | Confirmed | Seen in IAM page + STG ECR URIs |
| Runtime | `prd` | N/A (not documented for Verup yet) | Pending | BSE IAM page does not list a PRD account ID |

### Exchange (Coinbook)

| Category | Environment | AWS Account ID | Account Name | Status |
| --- | --- | --- | --- | --- |
| Runtime | `dev` | `552482368916` | `cb-exchange-dev` | Confirmed |
| Runtime | `dev3` | `600477414503` | `cb-exchange-dev3` | Confirmed |
| Runtime | `stg` | `713950700730` | `cb-exchange-stg` | Confirmed |
| Runtime | `prd` | — | — | See UNYO prd接続情報 |

## 3) VPC / Network

### Point (Verup)

| Env | VPC Name | VPC ID | CIDR | Public Subnets | Private Subnets |
| --- | --- | --- | --- | --- | --- |
| `dev` | `point` | `vpc-0e139c5a0789db4c0` | `172.18.0.0/16` | `172.18.11.0/24`, `172.18.12.0/24`, `172.18.14.0/24` | `172.18.21.0/24`, `172.18.22.0/24`, `172.18.24.0/24` |
| `stg` | `point` | `vpc-0a806cde70882e30a` | `172.19.0.0/16` | `172.19.11.0/24`, `172.19.12.0/24`, `172.19.14.0/24` | `172.19.21.0/24`, `172.19.22.0/24`, `172.19.24.0/24` |

NAT Gateway IPs:

| Env | NAT Gateway IPs | Notes |
| --- | --- | --- |
| `dev` | `52.198.175.250` | Single NAT, az1 |
| `stg` | `54.95.228.180` (az1), `57.180.161.41` (az2), `13.158.200.57` (az4) | Multi NAT |

### Exchange (Coinbook)

Exchange VPC details are embedded in Confluence images/macros on UNYO pages and could not be fully extracted as text. Refer to:
- stg接続情報: `https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/937165203`
- prd接続情報: `https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/937165225`
- dev接続情報: `https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/937165149`

## 4) EKS Cluster

### Point (Verup)

| Property | DEV | STG | PRD |
| --- | --- | --- | --- |
| Cluster Name | `point` | `point` | `point` (planned) |
| K8s Version | `1.30` | `1.30` | TBD |
| Terraform Env | `dev-ex` | `stg-ex` | `prd-ex` |
| Terraform Path | `bs-exchange-infra/terraform/components/eks` | same | same |
| K8s Manifests | `k8s-manifests/point/dev-ex/` | `k8s-manifests/point/stg-ex/` | `k8s-manifests/point/prd-ex/` |
| Region | `ap-northeast-1` | `ap-northeast-1` | `ap-northeast-1` |
| EKS EOS | 2026-07-23 | 2026-07-23 | — |

Node Groups (both DEV and STG):

| Node Group | Deployment | DEV Instance Type | STG Instance Type |
| --- | --- | --- | --- |
| `node-group-point-admin-{date}` | `point-admin-deployment` | `t3.medium` | `r5.xlarge` |
| `node-group-point-api-{date}` | `point-api-deployment` | `t3.medium` | `r5.xlarge` |
| `node-group-point-app-{date}` | `point-app-deployment` | `c6i.xlarge` | `c6i.2xlarge` |
| `node-group-point-mmh-{date}` | `point-mmh-deployment` | `t3.medium` | `r5.xlarge` |
| `node-group-point-worker-{date}-2` | `point-worker-deployment` | `t3.medium` | `r5.xlarge` |

EKS Addons (current):

| Addon | Version | Notes |
| --- | --- | --- |
| kube-proxy | `1.30.14-eksbuild.20` | |
| CoreDNS | `v1.11.4-eksbuild.28` | |
| Amazon VPC CNI | `v1.21.1-eksbuild.3` | |
| aws-ebs-csi-driver | `v1.55.0-eksbuild.2` | |
| GuardDuty EKS Runtime Monitoring | `v1.12.1-eksbuild.2` | |
| Cluster Autoscaler | `v1.28.7` | Outdated — should match K8s minor version |
| Terraform EKS module | `~> 21.1.0` | |

IRSA Roles:

| Role | ServiceAccount | Namespace | Policies |
| --- | --- | --- | --- |
| `point-vpc-cni-aws-node` | `aws-node` | `kube-system` | AmazonEKS_CNI_Policy |
| `point-app-irsa-role` | `point-app-sa` | `default` | SQS, S3, SES, SNS, Kinesis, CloudWatch |
| `point-aws-load-balancer-controller` | `aws-load-balancer-controller` | `kube-system` | ALB Controller policies |
| `point-cluster-autoscaler-irsa-role` | `cluster-autoscaler` | `kube-system` | AmazonEKSClusterAutoscalerPolicy |
| `point-cloudwatch-agent-irsa-role` | `cloudwatch-agent` | `amazon-cloudwatch` | CloudWatchAgentServerPolicy |

## 5) Aurora MySQL (RDS)

### Point (Verup)

| Property | DEV | STG |
| --- | --- | --- |
| Hostname | `point.cluster-c52ii6s666k9.ap-northeast-1.rds.amazonaws.com` | `point.cluster-c5ccu4omkyf1.ap-northeast-1.rds.amazonaws.com` |
| DB Name | `point` | `point` |
| DB Users | `master`, `point`, `point_viewer`, `editor`, `viewer` | same |
| Driver | `org.mariadb.jdbc.Driver` | same |
| Max Pool Size | 150 | 150 |
| Backup | Daily, 7 days retention | Daily, 7 days retention |

### Exchange (Coinbook)

| Property | Dev | Dev3 | STG | PRD |
| --- | --- | --- | --- | --- |
| RDS Hostname | `exchange.cluster-cxki5qyn8glt...rds.amazonaws.com` | `exchange.cluster-cijgzbzqcwlh...rds.amazonaws.com` | `exchange.cluster-ccbv44nzmujk...rds.amazonaws.com` | `exchange.cluster-cm1xgbbpeyvo...rds.amazonaws.com` |

## 6) Redshift

### Point (Verup)

| Property | DEV | STG |
| --- | --- | --- |
| Hostname | `point.cz0jq6asdiym.ap-northeast-1.redshift.amazonaws.com` | `point.cltrnlzpnwbn.ap-northeast-1.redshift.amazonaws.com` |
| DB Name | `point` | `point` |
| Port | 5439 | 5439 |
| Backup | Daily, 7 days retention | Daily, 7 days retention |

### Exchange (Coinbook)

| Property | Dev | Dev3 | STG | PRD |
| --- | --- | --- | --- | --- |
| Redshift Hostname | `exchange.cypfkgrxbyzh...redshift.amazonaws.com` | `exchange.clhgqv8gmvvl...redshift.amazonaws.com` | `exchange.chep7s0lkwmq...redshift.amazonaws.com` | `exchange.cenfz6rhmqqi...redshift.amazonaws.com` |

## 7) ElastiCache (Redis)

### Point (Verup)

| Property | DEV | STG |
| --- | --- | --- |
| Cluster Name | `point` | `point` |
| Primary Node | `point-001.bh8fpu.0001.apne1.cache.amazonaws.com:6379` | `point-001.48u1zj.0001.apne1.cache.amazonaws.com:6379` |
| Replica Node | `point-002.bh8fpu.0001.apne1.cache.amazonaws.com:6379` | `point-002.48u1zj.0001.apne1.cache.amazonaws.com:6379` |

### Exchange (Coinbook)

| Env | Redis Endpoint |
| --- | --- |
| Dev | `exchange.uu4mza.ng.0001.apne1.cache.amazonaws.com:6379` |
| Dev3 | `exchange.o4xn2y.ng.0001.apne1.cache.amazonaws.com:6379` |
| STG | `exchange.0ikgu8.ng.0001.apne1.cache.amazonaws.com:6379` |
| PRD | `exchange.npmwnj.ng.0001.apne1.cache.amazonaws.com:6379` |

## 8) ECR Repositories (Point)

| Repository | DEV URI | STG URI |
| --- | --- | --- |
| `point-admin` | `845131030484.dkr.ecr.ap-northeast-1.amazonaws.com/point-admin` | `520411743393.dkr.ecr.ap-northeast-1.amazonaws.com/point-admin` |
| `point-api` | `845131030484.dkr.ecr.ap-northeast-1.amazonaws.com/point-api` | `520411743393.dkr.ecr.ap-northeast-1.amazonaws.com/point-api` |
| `point-app` | `845131030484.dkr.ecr.ap-northeast-1.amazonaws.com/point-app` | `520411743393.dkr.ecr.ap-northeast-1.amazonaws.com/point-app` |
| `point-mmh` | `845131030484.dkr.ecr.ap-northeast-1.amazonaws.com/point-mmh` | `520411743393.dkr.ecr.ap-northeast-1.amazonaws.com/point-mmh` |
| `point-worker` | `845131030484.dkr.ecr.ap-northeast-1.amazonaws.com/point-worker` | `520411743393.dkr.ecr.ap-northeast-1.amazonaws.com/point-worker` |

## 9) CloudFront Distributions

| Env | Distribution ID | Domain | Purpose |
| --- | --- | --- | --- |
| DEV | `E3LZQ1PTPQC053` | `bo.dev-ex.backseat-service.com` | Admin front |
| DEV | `E1K6SY01O8V7JV` | `dev-ex.backseat-service.com` | Exchange front |
| STG | `E2DK8XRG9W1KY4` | `bo.stg-ex.backseat-service.com` | Admin front |
| STG | `E2C1CVQWGCIC1T` | `stg-ex.backseat-service.com` | Exchange front |

## 10) S3 Buckets

Pattern: `{purpose}.bs-point-{env}` (where env = `dev-ex` or `stg-ex`)

| Bucket Purpose | Pattern |
| --- | --- |
| Terraform state | `tfstate.bs-point-{env}` |
| K8s/CloudWatch/CloudFront logs | `logs.bs-point-{env}` |
| Redshift audit logs | `audit-logs-receiver.bs-point-{env}` |
| VPC flow logs | `audit-logs.bs-point-{env}` |
| AWS Config | `config.bs-point-{env}` |
| Redshift archive | `redshift-archive.bs-point-{env}` |
| CloudFront maintenance | `maintenance.bs-point-{env}` |
| KYC documents | `kyc.bs-point-{env}` |
| WAF logs | `aws-waf-logs-bs-point-{env}` |
| CloudFront docs | `doc.bs-point-{env}` |
| Admin front build | `admin.bs-point-{env}` |
| Point front build | `point.bs-point-{env}` |
| Exchange front build | `exchange.bs-point-{env}` |
| Game app build | `choice.bs-point-{env}` |
| Reports | `year-report.bs-point-{env}` |

## 11) Secrets Manager

| Secret Path | Contents |
| --- | --- |
| `point/base` | AWS_CREDENTIALS_*, AWS_SES_*, SPRING_RECAPTCHA_* |
| `point/exc` | ekyc_*, refinitiv_*, sms_*, gmo_*, jwt_secret, ponta_*, exchange_pos_*, fireblocks_* (deprecated), geoip_api_key |
| `point/lambda/sns-to-slack` | SLACK_WEBHOOK_URL, SUBJECT_PREFIX |

## 12) Domains

| Env | Customer URL | Admin URL |
| --- | --- | --- |
| DEV | `dev-ex.backseat-service.com` | `bo.dev-ex.backseat-service.com` |
| STG | `stg-ex.backseat-service.com` | `bo.stg-ex.backseat-service.com` |

## 13) Other Services

- **SES SMTP**: `email-smtp.ap-northeast-1.amazonaws.com:587`
- **STG Proxy** (Ponta LM system): IP `10.51.187.96`, port `3128`

## 14) Audit Logs (CloudWatch)

| Log Group | DEV Retention | STG Retention | PRD Retention |
| --- | --- | --- | --- |
| `/aws/ssm` (bastion commands) | 30 days | 90 days | 365 days |
| `/aws/cloudtrail/management-events` | 30 days | 90 days | 365 days |

## 15) IAM Access Model

Roles:

- `custodian-AdministratorRole` — Infra engineers, full EC2/VPC/EKS access
- `custodian-OperatorRole` — Operators, limited write + ReadOnlyAccess
- `custodian-ViewerRole` — Console viewing only

Control model:

- `dev`/`stg`: Cloudflare-based restriction
- `prd`:
  - Admin/Operator: ESS + user restriction
  - Viewer: Cloudflare + user restriction

## 16) Whitelist / Access IP Notes

From BSE Infra/IP pages:

- Cloudflare Proxy GIP: `104.30.164.185`, `104.30.177.101`
- BPO webhook source IPs: `54.95.228.180`, `104.30.164.185`, `104.30.177.101`, `13.115.34.254`

Note: Presence in application/network whitelist does not automatically mean IAM console access is granted.

## 17) User-Specific Check (Current Reference)

Inputs:

- IP: `104.30.164.185`
- Corporate email: `trungnh@solashi.com`
- Claimed IAM principal: `arn:aws:iam::571540283362:user/trungnh`

Observed:

- `104.30.164.185` is present in BSE IP-related docs.
- In BSE docs, no direct mapping found for `trungnh`, `trungnh@solashi.com`, or account `571540283362`.
- A record for `trungnh@solashi.com` / `trungnh` exists in UNYO operation member page (outside BSE).

Action to confirm:

1. Ask infra owner to confirm whether `arn:aws:iam::571540283362:user/trungnh` is still valid in current custodian model.
2. If model has migrated to `590183696997` (`bs-custodian`), request official replacement principal/role mapping.
3. Validate IAM policy conditions for source IP and required role.

## 18) Source References

### BSE Space

| Page | ID | URL |
| --- | --- | --- |
| BSE overview | — | https://coinbook.atlassian.net/wiki/spaces/bse/overview |
| 03_Infra関連 | 1227390977 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1227390977/03_Infra |
| IAM | 1770749953 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1770749953/IAM |
| IP アドレス | 1500119041 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1500119041/IP |
| dev環境 | 1227292674 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1227292674/dev |
| stg環境 | 1291943937 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1291943937/stg |
| 05_DEV/STG環境のアクセス情報 | 1490124801 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1490124801/05_DEV+STG |
| Secrets-Key | 1684275204 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1684275204/Secrets-Key |
| EKS Version Upgrade Runbook | 1796964380 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1796964380/EKS+Version+Upgrade+Runbook |
| Version Management | 1791623169 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1791623169/Version+Management |
| バックアップとリストア | 1769504769 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1769504769 |
| K8s RBAC | 1783136257 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1783136257/K8s+RBAC |
| K8s IRSA | 1786970122 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1786970122/K8s+IRSA |
| Environment Variables Guide | 1795719169 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1795719169 |
| インフラリリース計画 (Point) | 1588625417 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1588625417/Point |
| 07.Wallet環境について | 1708097538 | https://coinbook.atlassian.net/wiki/spaces/bse/pages/1708097538/07.Wallet |

### UNYO Space

| Page | ID | URL |
| --- | --- | --- |
| 取引所AWSアクセス情報 | 923731101 | https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/923731101/AWS |
| 取引所DBアクセス情報 | 923731120 | https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/923731120/DB |
| prd接続情報 | 937165225 | https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/937165225/prd |
| stg接続情報 | 937165203 | https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/937165203/stg |
| dev接続情報 | 937165149 | https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/937165149/dev |
| cb-custodian IAM | 923730601 | https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/923730601/cb-custodian+IAM |
| Operation member matrix | 1048150017 | https://coinbook.atlassian.net/wiki/spaces/UNYO/pages/1048150017 |

## 19) Point運用 Infrastructure (from Slack logs)

Source: `#backseat_maintenance_point` channel logs + DM with Duc Nghia Pham.
This section documents the current production Point system, separate from the Verup dev/stg environments.

### VPC / Network

| Property | Observed Value | Source |
| --- | --- | --- |
| Private Subnet | `10.51.187.x/24` (observed pod IPs) | Slack logs (pod host IPs) |
| Ponta Proxy (STG) | `10.51.187.96:3128` | BSE stg環境 page |

Note: VPC CIDR `10.51.x.x` is different from Verup (`172.18/19.x.x`) and Exchange (`172.18/19/20.x.x`).

### EKS Deployments

Same deployment names as Verup:

| Deployment | ECR Image (STG) | Confirmed |
| --- | --- | --- |
| `point-app-deployment` | `471112755246.dkr.ecr.ap-northeast-1.amazonaws.com/point-app:latest` | Slack logs |
| `point-mmh-deployment` | `471112755246.dkr.ecr.ap-northeast-1.amazonaws.com/point-mmh:latest` | Slack logs |
| `point-admin-deployment` | Expected: `471112755246.dkr.ecr...amazonaws.com/point-admin` | Not yet confirmed |
| `point-api-deployment` | Expected: `471112755246.dkr.ecr...amazonaws.com/point-api` | Not yet confirmed |
| `point-worker-deployment` | Expected: `471112755246.dkr.ecr...amazonaws.com/point-worker` | Not yet confirmed |

### Application Code (Java packages from logs)

- `point.pos.service.PosAmberBestPriceService` — Amber/Whalefin best price integration
- `point.operate.service.OperateOrderService` — Order service
- `point.common.util.JsonUtil` — JSON utility
- `point.common.entity.Symbol` — Symbol entity

### External Integrations

| Service | Endpoint | Notes |
| --- | --- | --- |
| Amber/Whalefin API | `https://aws-private-alpha.whalefin.com/api/v2/trade/rfq` | Best price quotes |
| Ponta LM | Via VPN Gateway + Proxy `10.51.187.96:3128` | STG; PRD has direct VPN |
| ESS (PRD access) | `172.25.137.7` | RFC-based access control |

### PRD-Specific (from BSE インフラリリース計画)

Point PRD has unique infrastructure not present in dev/stg:

- **VPN Gateway** — Connection to Ponta LM system
- **HULFT NFS Server** — File transfer
- **CoreDNS custom config** — DNS resolution for Ponta

Migration strategy: ver-up app must adapt to existing Point PRD infra, not vice versa.

### AWS Notifications (from Slack)

- EKS 1.30 extended support ends 2026-07-23 (affects PRD account `211125716602`)
- CloudShell data deletion scheduled for 2026-03-12 (PRD account)
- ElastiCache service update `elasticache-20260105-intel` pending (PRD account)

## Notes

- **Three systems, three sets of AWS accounts.** Point運用 (905418018638/471112755246/211125716602), Point Verup (845131030484/520411743393), Exchange (552482368916/713950700730). Do not confuse them.
- Exchange VPC details (CIDR, subnet layout) are embedded in Confluence images/macros on UNYO接続情報 pages — not extractable as text. View those pages directly in browser.
- PRD environment for Point/Verup has not been deployed yet. PRD data in this doc mostly comes from Exchange (coinbook) legacy system.
- Cluster Autoscaler version (`v1.28.7`) is outdated relative to EKS `1.30` — tracked for upgrade.
- Point運用 information is NOT on Confluence. Sources: Slack DMs, `#backseat_maintenance_point`, AWS notifications, Jira POUH project.
- Point運用 uses the same application code and deployment names as Verup, but on completely separate AWS accounts and VPC (`10.51.x.x` vs `172.x.x.x`).
