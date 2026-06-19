# ALB Targets in "Unused AZ" — Troubleshooting Guide

**Audience**: DevOps / SRE on call for EKS + AWS Load Balancer Controller stacks.
**Last incident**: 2026-05-11, point STG (account `471112755246`, cluster `point`).
**Severity when it strikes**: HIGH if all replicas land in the unused AZ (full outage); MEDIUM-to-LOW if only a subset (latent capacity loss, hidden AZ-failure risk).

---

## 1. Symptoms

In the AWS Console → **EC2 → Load Balancers → `point-alb` → Resource map**, you see backend pods registered as targets but flagged:

> **Unused: Target is in an Availability Zone that is not enabled for the load balancer**

Typical signature on `point-stg`:

| Target IP        | Health                                                  |
|------------------|---------------------------------------------------------|
| `10.51.187.134`  | Healthy                                                 |
| `10.51.187.145`  | Healthy                                                 |
| `10.51.187.177`  | Healthy                                                 |
| `10.51.187.204`  | **Unused — AZ not enabled for the load balancer**       |
| `10.51.187.210`  | **Unused — AZ not enabled for the load balancer**       |
| `10.51.187.244`  | **Unused — AZ not enabled for the load balancer**       |

The pod is `Running` and passes its `livenessProbe` / `readinessProbe`, but the ALB refuses to forward traffic to it.

> **What it is NOT**: this is not a "the pod IP has run out" condition, not a security-group block, and not a target-group health-check failure. It is a **topology mismatch** between the AZs where pods are scheduled and the AZs the ALB has subnets in.

---

## 2. Root Cause

An Application Load Balancer can only route traffic to targets in **Availability Zones where the ALB itself has an attached subnet**. With `target-type: ip` (the default for AWS Load Balancer Controller), the controller registers pod IPs directly. If a pod lands in an AZ that the ALB does not cover, the controller still registers the IP — and the ALB tags it `Unused`.

The AWS Load Balancer Controller picks ALB subnets via **auto-discovery from VPC subnet tags**:

| Tag                                              | Meaning                          |
|--------------------------------------------------|----------------------------------|
| `kubernetes.io/role/elb = 1`                     | Public subnet — internet-facing  |
| `kubernetes.io/role/internal-elb = 1`            | Private subnet — internal ALB    |

For each AZ, the controller picks one tagged subnet. It then enforces an AWS-side requirement: **each subnet must have at least 8 free IP addresses** at ALB-creation time (otherwise the AZ is silently skipped).

Common upstream causes that produce this symptom:

1. **Subnet too small / IP-exhausted**: a tagged public subnet exists in the AZ, but has fewer than 8 free IPs — controller skips the AZ.
2. **Missing subnet tag**: the public subnet in that AZ was never tagged `kubernetes.io/role/elb=1`.
3. **No public subnet at all in the AZ**: the VPC simply does not cover that AZ.
4. **Subnet tagged after ALB creation**: the controller computes subnets at create-time only; tagging after-the-fact does not retroactively add the AZ. A `SetSubnets` call (e.g. via `alb.ingress.kubernetes.io/subnets`) is required.

---

## 3. Case Study: point-stg, 2026-05-11

### 3.1 What the ALB actually had

```bash
aws elbv2 describe-load-balancers \
  --profile point-operator-stg --region ap-northeast-1 \
  --names point-alb \
  --output text \
  --query 'LoadBalancers[0].AvailabilityZones[*].[ZoneName,SubnetId]'
```

```text
ap-northeast-1d  subnet-03aa1eb1583c3a2f9
ap-northeast-1c  subnet-0fa8d131a943e0202
```

→ Only 2 of the 3 AZs the cluster spans were attached. `ap-northeast-1a` was missing.

### 3.2 Where the "Unused" pods were scheduled

```bash
aws ec2 describe-network-interfaces \
  --profile point-operator-stg --region ap-northeast-1 \
  --filters "Name=addresses.private-ip-address,Values=10.51.187.204,10.51.187.210,10.51.187.244" \
  --output text \
  --query 'NetworkInterfaces[*].[PrivateIpAddress,AvailabilityZone,SubnetId]'
```

All three unused IPs were ENIs in `ap-northeast-1a` — the AZ the ALB was missing.

### 3.3 Why the ALB controller had skipped `ap-northeast-1a`

```bash
aws ec2 describe-subnets \
  --profile point-operator-stg --region ap-northeast-1 \
  --subnet-ids subnet-0fa8d131a943e0202 subnet-03aa1eb1583c3a2f9 subnet-0973ab8c16808fb9c \
  --output text \
  --query 'Subnets[*].[AvailabilityZone,SubnetId,CidrBlock,AvailableIpAddressCount,Tags[?Key==`Name`].Value|[0]]'
```

```text
ap-northeast-1a  subnet-0973ab8c16808fb9c  10.51.187.32/28  7  point-public-subnet-apne1-az4
ap-northeast-1c  subnet-0fa8d131a943e0202  10.51.187.0/28   8  point-public-subnet-apne1-az1
ap-northeast-1d  subnet-03aa1eb1583c3a2f9  10.51.187.16/28  9  point-public-subnet-apne1-az2
```

The AZ-1a public subnet was a `/28` (16 IPs total → 11 usable after AWS reserves 5) and had only **7 free IPs** — below the 8-IP ALB threshold. The controller had skipped it.

ENIs already consuming addresses in that subnet:

```bash
aws ec2 describe-network-interfaces \
  --profile point-operator-stg --region ap-northeast-1 \
  --filters "Name=subnet-id,Values=subnet-0973ab8c16808fb9c" \
  --output text \
  --query 'NetworkInterfaces[*].[PrivateIpAddress,Status,InterfaceType,Description]'
```

→ 3× Redshift cluster ENIs + 1× VPC endpoint = 4 ENIs that cannot be freed without disrupting other services.

### 3.4 Who owns this ALB

```bash
aws elbv2 describe-tags \
  --profile point-operator-stg --region ap-northeast-1 \
  --resource-arns "$ALB_ARN" \
  --output text \
  --query 'TagDescriptions[0].Tags[*].[Key,Value]'
```

```text
elbv2.k8s.aws/cluster     point
ingress.k8s.aws/resource  LoadBalancer
ingress.k8s.aws/stack     default/point-ingress
```

→ ALB was created by **AWS Load Balancer Controller** from the `point-ingress` Ingress resource. It is NOT directly managed by Terraform — the fix must go through the Ingress manifest (or, for subnet capacity, through the Terraform VPC component).

---

## 4. Diagnosis Checklist

When you suspect this issue, run these read-only checks in order:

```bash
# 0. Account guard — confirm correct AWS account
aws sts get-caller-identity --profile <profile>

# 1. Which AZs does the ALB cover?
aws elbv2 describe-load-balancers --profile <profile> --region <region> \
  --names <alb-name> \
  --output text \
  --query 'LoadBalancers[0].AvailabilityZones[*].[ZoneName,SubnetId]'

# 2. Where are the "Unused" pod IPs scheduled?
aws ec2 describe-network-interfaces --profile <profile> --region <region> \
  --filters "Name=addresses.private-ip-address,Values=<ip1>,<ip2>,<ip3>" \
  --output text \
  --query 'NetworkInterfaces[*].[PrivateIpAddress,AvailabilityZone,SubnetId]'

# 3. Are there ELB-tagged public subnets in every AZ?
VPC_ID=$(aws elbv2 describe-load-balancers --profile <profile> --region <region> \
  --names <alb-name> --output text --query 'LoadBalancers[0].VpcId')

aws ec2 describe-subnets --profile <profile> --region <region> \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --output text \
  --query 'Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,AvailableIpAddressCount,Tags[?Key==`Name`].Value|[0],Tags[?Key==`kubernetes.io/role/elb`].Value|[0],Tags[?Key==`kubernetes.io/role/internal-elb`].Value|[0]]'

# 4. Identify ALB ownership (k8s controller vs Terraform)
aws elbv2 describe-tags --profile <profile> --region <region> \
  --resource-arns "$ALB_ARN" \
  --output text \
  --query 'TagDescriptions[0].Tags[*].[Key,Value]'
```

**Decision tree from the results of step 3**:

| Result for the missing AZ                            | Likely cause                                       |
|------------------------------------------------------|----------------------------------------------------|
| No row at all                                        | No subnet exists in that AZ. Create one.           |
| Row exists, `elb` column = `None`                    | Subnet missing `kubernetes.io/role/elb=1` tag.     |
| Row exists, tag = `1`, `AvailableIpAddressCount < 8` | IP exhaustion — controller skipped it.             |
| Row exists, tag = `1`, free IPs ≥ 8                  | Misconfiguration: explicit `subnets` annotation pinning the wrong subnets, or stale ALB that was created before the tag/subnet existed. |

---

## 5. Resolution

### 5.1 Triage (stop the bleeding in minutes — applied in the 2026-05-11 incident)

**Goal**: keep all backend pods inside AZs the ALB already covers, so 100% of replicas receive traffic.

**Pre-flight read-only checks**:

```bash
# Backend deployments must NOT have a strict topologySpreadConstraint that forces an AZ-1a replica
for d in point-api-deployment point-admin-deployment point-app-deployment point-mmh-deployment point-worker-deployment; do
  echo "--- $d ---"
  kubectl get deploy "$d" -o jsonpath='{.spec.template.spec.topologySpreadConstraints}'
  echo
done

# HPA min replicas must fit within remaining (1c+1d) node capacity
kubectl get hpa
kubectl top nodes
```

**Apply (single AZ — `ap-northeast-1a` in this case)**:

```bash
# 1) Cordon every Ready node in the affected AZ
for n in $(kubectl get nodes -l topology.kubernetes.io/zone=ap-northeast-1a \
            -o jsonpath='{.items[?(@.status.conditions[-1].type=="Ready")].metadata.name}'); do
  kubectl cordon "$n"
done

# 2) Rolling restart of every Deployment whose pods are registered as ALB targets
for d in point-api-deployment point-admin-deployment point-app-deployment point-mmh-deployment point-worker-deployment; do
  kubectl rollout restart deployment/"$d"
done

# 3) Wait for rollouts to converge
for d in point-api-deployment point-admin-deployment point-app-deployment point-mmh-deployment point-worker-deployment; do
  kubectl rollout status deployment/"$d" --timeout=300s
done
```

> Use `rollout restart` rather than `kubectl drain`. `drain` evicts pods one at a time and can race the scheduler back onto the same cordoned node if a sibling pod terminates first; `rollout restart` recreates the entire replica set under the new (cordoned) constraint and never schedules onto the cordoned AZ.

### 5.2 Verification

```bash
# Pod distribution — expect zero pods on the cordoned AZ
kubectl get pods -o wide --no-headers \
  | grep -E 'point-(api|admin|app|mmh|worker)-deployment' \
  | awk '{print $7}' | sort | uniq -c

# ALB target health — expect zero "Unused"
TG_ARNS=$(aws elbv2 describe-target-groups --profile <profile> --region <region> \
  --output text \
  --query 'TargetGroups[?starts_with(TargetGroupName, `k8s-default-point`)].TargetGroupArn')

for tg in $TG_ARNS; do
  echo "--- $(basename "$tg") ---"
  aws elbv2 describe-target-health --profile <profile> --region <region> \
    --target-group-arn "$tg" --output text \
    --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State,TargetHealth.Reason]'
done
```

Success criteria: every target is `healthy`, no target reports state `unused`.

### 5.3 Rollback

If pods refuse to schedule on the surviving AZs (Pending due to insufficient CPU/memory or other anti-affinity rules):

```bash
# Uncordon the AZ — pods will reschedule back, restoring previous (degraded) state
for n in $(kubectl get nodes -l topology.kubernetes.io/zone=ap-northeast-1a -o name); do
  kubectl uncordon "$n"
done

kubectl get pods -A | grep Pending
```

### 5.4 Permanent fix (long-term)

Triage leaves the cluster running on N−1 AZs, which means:

- **Reduced AZ resilience**: if one of the two surviving AZs fails, you lose 50% capacity with no fallback.
- **Wasted node-group capacity**: nodes in the cordoned AZ are paid for but unused.

The permanent fix must restore N AZs to the ALB. Pick whichever of these matches your case:

| Scenario                                            | Fix                                                                                                                                                                                                                                                                       |
|-----------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Public subnet is tagged but **IP-exhausted** (point-stg `/28` case) | Add new VPC secondary CIDR (avoid overlap with peered VPCs — check route table first). Create three new public subnets `/27` or larger, tag `kubernetes.io/role/elb=1`. Pin the Ingress to them via `alb.ingress.kubernetes.io/subnets: subnet-a,subnet-c,subnet-d` so the controller calls `SetSubnets` (non-disruptive — ALB is not recreated). |
| Public subnet exists but **untagged**               | Apply tag `kubernetes.io/role/elb=1`. Force the controller to re-discover by setting the explicit `alb.ingress.kubernetes.io/subnets` annotation on the Ingress (delete-and-recreate is NOT required).                                                                    |
| **No subnet** at all in the AZ                      | Create one in Terraform, tag it, then pin via the Ingress annotation.                                                                                                                                                                                                     |
| Resources in the public subnet that shouldn't be there (e.g. Redshift) | Move them to a private subnet to free public IPs and improve the security posture.                                                                                                                                                                                        |

In all cases, finish by uncordoning the previously cordoned nodes:

```bash
for n in $(kubectl get nodes -l topology.kubernetes.io/zone=<AZ> -o name); do
  kubectl uncordon "$n"
done
```

---

## 6. Prevention

### 6.1 Subnet sizing

The minimum public subnet for an internet-facing ALB is `/28` (11 usable IPs), but `/28` is **fragile**: any unrelated ENI placed in the subnet (Redshift, VPC endpoint, RDS proxy, NAT, third-party SaaS appliance) eats from the same pool and can drop free IPs below 8. **Prefer `/27` or larger for ALB-eligible public subnets** when the VPC CIDR allows.

### 6.2 Keep public subnets exclusive to ALBs

Avoid placing stateful services (Redshift, RDS, ElastiCache) in subnets tagged `kubernetes.io/role/elb=1`. Use private subnets for them. The point-stg incident root cause was Redshift ENIs squatting in the only public subnet of AZ-1a.

### 6.3 CloudWatch alarms

Add an alarm on the ALB metric `UnHealthyHostCount` and on the target-group metric `UnHealthyHostCount` per AZ. The `Unused` state shows up as unhealthy hosts in the AZ-disaggregated CloudWatch view.

### 6.4 Periodic checks

Once a month, or whenever subnet topology changes, run section 4 step 3 and confirm every AZ has a public subnet with ≥ 8 free IPs and the `kubernetes.io/role/elb=1` tag.

---

## 7. References

- AWS docs — [Subnets for your load balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-subnets.html) (8-IP minimum, subnet-tag rules)
- AWS Load Balancer Controller — [Subnet auto-discovery](https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.6/deploy/subnet_discovery/)
- AWS Load Balancer Controller — [Ingress annotations: subnets](https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.6/guide/ingress/annotations/#subnets)
- Internal: `docs/guides/K8S_TROUBLESHOOTING.md` — general EKS troubleshooting
- Internal: `docs/guides/K8S_OPERATIONS_GUIDE.md` — operational procedures
- Internal: `CLAUDE.md` § "VPC Snapshot (DEV/STG)" — VPC IDs and CIDR layout per environment
