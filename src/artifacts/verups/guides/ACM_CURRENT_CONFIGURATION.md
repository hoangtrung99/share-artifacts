# ACM Current Configuration In Code

Scope: current code under `bs-exchange-infra/` as checked on 2026-03-08, plus the STG ACM console screenshots provided by the user.

## TL;DR

- STG code currently creates two environment-specific certificates for `stg-ex.backseat-service.com`:
  - one in `us-east-1` for CloudFront
  - one in `ap-northeast-1` for ALB
- STG frontend code does **not** consume that environment-specific CloudFront certificate.
- STG frontend code currently consumes the shared wildcard certificate `*.backseat-service.com` in `us-east-1`.
- STG ALB code also does **not** consume the ALB certificate yet, because the Ingress still exposes only `HTTP:80` and does not specify `certificate-arn`.
- Therefore the ACM console screenshots are consistent with the current code:
  - `*.backseat-service.com` is `In use = Yes`
  - `stg-ex.backseat-service.com` is `In use = No` in both regions

## 1. What The STG Screenshots Show

From the screenshots:

| Region | Certificate shown in ACM | Type | In use | Interpretation |
| --- | --- | --- | --- | --- |
| Tokyo (`ap-northeast-1`) | `stg-ex.backseat-service.com` | Amazon Issued | No | Cert exists in app region, but no current ALB attachment is visible |
| N. Virginia (`us-east-1`) | `*.backseat-service.com` | Imported | Yes | This is the certificate CloudFront is actually using |
| N. Virginia (`us-east-1`) | `stg-ex.backseat-service.com` | Amazon Issued | No | Env-specific CloudFront cert exists, but current frontend code does not reference it |

Important nuance: ACM list view shows the certificate by its primary domain name. The code below requests:

- primary domain: `stg-ex.backseat-service.com`
- SAN: `*.stg-ex.backseat-service.com`

So a console row showing `stg-ex.backseat-service.com` is still consistent with the wildcard SAN being present.

## 2. How The Code Creates Certificates

The certificate creation logic lives in `terraform/init/acm`.

```hcl
# bs-exchange-infra/terraform/init/acm/main.tf
provider "aws" {
  region = var.region
}

# CloudFront certificates must be in us-east-1.
provider "aws" {
  region = "us-east-1"
  alias  = "us"
}

module "for_cloudfront" {
  count = var.enable_certificate_for_cloudfront ? 1 : 0
  providers = {
    aws = aws.us
  }
  domain_name       = var.zone_name
  validation_method = "DNS"
  subject_alternative_names = [
    var.certificate_name
  ]
}

module "for_alb" {
  count = var.enable_certificate_for_alb ? 1 : 0
  domain_name       = var.zone_name
  validation_method = "DNS"
  subject_alternative_names = [
    var.certificate_name
  ]
}
```

STG enables both certificate paths:

```hcl
# bs-exchange-infra/terraform/init/acm/tfvars/stg-ex.tfvars
enable_certificate_for_cloudfront = true
enable_certificate_for_alb        = true

zone_name        = "stg-ex.backseat-service.com"
certificate_name = "*.stg-ex.backseat-service.com"
```

What this means in practice:

- `module.for_cloudfront` creates an ACM certificate in `us-east-1`
- `module.for_alb` creates an ACM certificate in `ap-northeast-1`
- both use the same STG env-specific naming pair:
  - exact domain: `stg-ex.backseat-service.com`
  - wildcard SAN: `*.stg-ex.backseat-service.com`

## 3. Which Certificate The Frontend Code Actually Uses

### 3.1 Customer frontend

STG customer frontend does **not** ask for `*.stg-ex.backseat-service.com`.
It explicitly asks for `*.backseat-service.com`.

```hcl
# bs-exchange-infra/terraform/components/frontend-customer/tfvars/stg-ex.tfvars
cloudfront_domain      = "stg-ex.backseat-service.com"
cloudfront_certificate = "*.backseat-service.com"
```

Then the module looks up an already-issued ACM certificate in `us-east-1`:

```hcl
# bs-exchange-infra/terraform/components/frontend-customer/data.tf
data "aws_acm_certificate" "this" {
  provider = aws.us
  domain   = var.cloudfront_certificate
  statuses = ["ISSUED"]
}
```

And attaches that certificate to CloudFront:

```hcl
# bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf
viewer_certificate {
  cloudfront_default_certificate = false
  acm_certificate_arn            = data.aws_acm_certificate.this.arn
  minimum_protocol_version       = "TLSv1.2_2021"
  ssl_support_method             = "sni-only"
}
```

### 3.2 Admin frontend

The admin frontend uses the same pattern:

```hcl
# bs-exchange-infra/terraform/components/frontend-admin/tfvars/stg-ex.tfvars
cloudfront_enabled  = true
dns-for-alb_enabled = false

cloudfront_certificate = "*.backseat-service.com"
```

```hcl
# bs-exchange-infra/terraform/components/frontend-admin/module-for-cloudfront/data.tf
data "aws_acm_certificate" "this" {
  provider = aws.us
  domain   = var.cloudfront_certificate
  statuses = ["ISSUED"]
}
```

```hcl
# bs-exchange-infra/terraform/components/frontend-admin/module-for-cloudfront/cloudfront.tf
viewer_certificate {
  cloudfront_default_certificate = false
  acm_certificate_arn            = data.aws_acm_certificate.this.arn
  minimum_protocol_version       = "TLSv1.2_2021"
  ssl_support_method             = "sni-only"
}
```

Conclusion for CloudFront:

- both customer and admin frontend modules are wired to the shared wildcard cert `*.backseat-service.com`
- neither module is wired to the env-specific cert `stg-ex.backseat-service.com`
- that is why the imported wildcard cert in `us-east-1` appears as `In use = Yes`
- that is also why the env-specific cert in `us-east-1` appears as `In use = No`

## 4. Why The ALB Certificate Is Also Not In Use

Even though STG enables `enable_certificate_for_alb = true`, the current Ingress still exposes only HTTP.

```yaml
# bs-exchange-infra/k8s-manifests/point/stg-ex/ingress.yaml
annotations:
  alb.ingress.kubernetes.io/load-balancer-name: point-alb
  alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}]'
```

There is no annotation such as:

- `alb.ingress.kubernetes.io/certificate-arn`
- `alb.ingress.kubernetes.io/ssl-redirect`
- `alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'`

The Terraform frontend code also still assumes HTTP on the ALB side:

```hcl
# bs-exchange-infra/terraform/components/frontend-customer/data.tf
data "aws_alb_listener" "point-alb-http" {
  load_balancer_arn = data.aws_lb.point-alb.arn
  port              = "80"
}
```

```hcl
# bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf
origin {
  domain_name = data.aws_lb.point-alb.dns_name
  origin_id   = "alb_origin"

  custom_origin_config {
    http_port              = "80"
    https_port             = "443"
    origin_protocol_policy = "http-only"
  }
}
```

```hcl
# bs-exchange-infra/terraform/components/frontend-admin/module-for-cloudfront/cloudfront.tf
origin {
  domain_name = data.aws_lb.this.dns_name
  origin_id   = "alb_origin"

  custom_origin_config {
    http_port              = "80"
    https_port             = "443"
    origin_protocol_policy = "http-only"
  }
}
```

That explains the STG Tokyo screenshot:

- the ALB-region certificate exists because `terraform/init/acm` creates it
- but the current Ingress and frontend traffic path never attach or use it
- therefore ACM shows `In use = No`

## 5. Current Traffic And TLS Shape

The current code implies this traffic model:

1. User -> CloudFront: HTTPS, using `*.backseat-service.com`
2. CloudFront -> ALB: HTTP
3. ALB -> Kubernetes services/pods: HTTP

So the current design is:

- viewer-side TLS: enabled
- CloudFront certificate: shared wildcard cert in `us-east-1`
- CloudFront-to-ALB TLS: not enabled yet
- ALB certificate creation: prepared in code, but not consumed

## 6. Why The Screenshots Match The Code

There is no contradiction between the screenshots and the current code. The screenshots are exactly what we should expect from the current configuration:

- `*.backseat-service.com` in `us-east-1` is `In use = Yes`
  - because both customer and admin CloudFront modules explicitly reference it
- `stg-ex.backseat-service.com` in `us-east-1` is `In use = No`
  - because `terraform/init/acm` creates it, but frontend modules do not use it
- `stg-ex.backseat-service.com` in `ap-northeast-1` is `In use = No`
  - because `terraform/init/acm` creates it, but the ALB still exposes only HTTP and has no certificate attachment

## 7. The Real Drift To Be Aware Of

The main drift is not "runtime vs code".
The real drift is "certificate creation code vs certificate consumption code".

Specifically:

- `terraform/init/acm` says STG should have env-specific certificates
- `frontend-customer` and `frontend-admin` still consume a shared imported wildcard cert
- `k8s-manifests/point/stg-ex/ingress.yaml` still does not enable HTTPS on ALB

So the repo currently has:

- a **create path** for env-specific certs
- but not yet a matching **consume path** for those certs

## 8. ACM Monitoring In Code

The repo also contains ACM expiration alerting:

```hcl
# bs-exchange-infra/terraform/components/notification/acm.tf
resource "aws_cloudwatch_event_rule" "acm_expiration" {
  name        = "notification-certificate"
  description = "ACM Certificate Approaching Expiration"

  event_pattern = <<EOF
{
  "source": ["aws.acm"],
  "detail-type": ["ACM Certificate Approaching Expiration"]
}
EOF
}
```

The same pattern also exists in `terraform/components/notification-global/acm.tf`.

This means ACM is not only provisioned in code; expiration events are also wired into the notification flow.

## 9. Note About `work-eks` vs `bs-exchange-infra`

This document uses `bs-exchange-infra/` as the canonical source because that is the repo path meant for long-lived documentation.

There are small diffs between `.worktrees/work-eks` and `bs-exchange-infra`, but the ACM conclusion above does not change:

- the important ACM paths in `terraform/init/acm` and STG tfvars match
- the frontend certificate selection logic remains `*.backseat-service.com`
- the ALB path remains HTTP-only in both versions

## Final Conclusion

Current STG code is in an intermediate state:

- the repo already provisions env-specific certificates for STG
- the repo still serves CloudFront with the shared imported wildcard certificate
- the repo still serves ALB over HTTP only

So the STG ACM screenshots are consistent with the code today:

- env-specific certs exist
- shared wildcard cert is the one actually in use
- ALB-side cert exists but is not attached
