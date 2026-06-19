# Cấu Hình ACM Hiện Tại Trong Code

Phạm vi: code hiện tại dưới `bs-exchange-infra/` tại thời điểm kiểm tra ngày 2026-03-08, kết hợp với các ảnh chụp màn hình ACM của môi trường STG do user cung cấp.

## Tóm tắt nhanh

- Code STG hiện đang tạo hai certificate theo môi trường cho `stg-ex.backseat-service.com`:
  - một certificate ở `us-east-1` cho CloudFront
  - một certificate ở `ap-northeast-1` cho ALB
- Code frontend của STG hiện **không** sử dụng certificate CloudFront theo môi trường đó.
- Code frontend của STG hiện đang sử dụng shared wildcard certificate `*.backseat-service.com` ở `us-east-1`.
- Phần ALB của STG hiện cũng **chưa** sử dụng certificate dành cho ALB, vì Ingress vẫn chỉ expose `HTTP:80` và chưa khai báo `certificate-arn`.
- Vì vậy, các ảnh ACM console của STG là phù hợp với code hiện tại:
  - `*.backseat-service.com` có `In use = Yes`
  - `stg-ex.backseat-service.com` có `In use = No` ở cả hai region

## 1. Ảnh STG đang cho thấy điều gì

Từ các ảnh chụp màn hình:

| Region | Certificate hiển thị trong ACM | Type | In use | Cách hiểu |
| --- | --- | --- | --- | --- |
| Tokyo (`ap-northeast-1`) | `stg-ex.backseat-service.com` | Amazon Issued | No | Certificate tồn tại ở app region nhưng chưa thấy được attach vào ALB đang phục vụ traffic |
| N. Virginia (`us-east-1`) | `*.backseat-service.com` | Imported | Yes | Đây là certificate mà CloudFront đang dùng thực tế |
| N. Virginia (`us-east-1`) | `stg-ex.backseat-service.com` | Amazon Issued | No | Certificate CloudFront theo môi trường có tồn tại, nhưng code frontend hiện không tham chiếu tới nó |

Điểm quan trọng: ACM list view thường hiển thị certificate theo primary domain name. Trong code bên dưới, certificate được request với:

- primary domain: `stg-ex.backseat-service.com`
- SAN: `*.stg-ex.backseat-service.com`

Vì vậy, nếu trên console hiển thị một dòng `stg-ex.backseat-service.com` thì điều đó vẫn phù hợp với việc certificate đó có thêm wildcard SAN.

## 2. Code đang tạo certificate như thế nào

Logic tạo certificate nằm ở `terraform/init/acm`.

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

STG đang bật cả hai nhánh tạo certificate:

```hcl
# bs-exchange-infra/terraform/init/acm/tfvars/stg-ex.tfvars
enable_certificate_for_cloudfront = true
enable_certificate_for_alb        = true

zone_name        = "stg-ex.backseat-service.com"
certificate_name = "*.stg-ex.backseat-service.com"
```

Điều đó có nghĩa là:

- `module.for_cloudfront` sẽ tạo một ACM certificate ở `us-east-1`
- `module.for_alb` sẽ tạo một ACM certificate ở `ap-northeast-1`
- cả hai cùng dùng bộ tên theo môi trường STG:
  - exact domain: `stg-ex.backseat-service.com`
  - wildcard SAN: `*.stg-ex.backseat-service.com`

## 3. Frontend thực tế đang dùng certificate nào

### 3.1 Frontend customer

Frontend customer của STG **không** request `*.stg-ex.backseat-service.com`.
Nó đang request `*.backseat-service.com`.

```hcl
# bs-exchange-infra/terraform/components/frontend-customer/tfvars/stg-ex.tfvars
cloudfront_domain      = "stg-ex.backseat-service.com"
cloudfront_certificate = "*.backseat-service.com"
```

Sau đó module lookup một ACM certificate đã `ISSUED` trong `us-east-1`:

```hcl
# bs-exchange-infra/terraform/components/frontend-customer/data.tf
data "aws_acm_certificate" "this" {
  provider = aws.us
  domain   = var.cloudfront_certificate
  statuses = ["ISSUED"]
}
```

Và attach certificate đó vào CloudFront:

```hcl
# bs-exchange-infra/terraform/components/frontend-customer/cloudfront.tf
viewer_certificate {
  cloudfront_default_certificate = false
  acm_certificate_arn            = data.aws_acm_certificate.this.arn
  minimum_protocol_version       = "TLSv1.2_2021"
  ssl_support_method             = "sni-only"
}
```

### 3.2 Frontend admin

Frontend admin cũng dùng đúng pattern đó:

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

Kết luận cho CloudFront:

- cả customer frontend và admin frontend đều đang wired vào shared wildcard cert `*.backseat-service.com`
- không module nào đang wired vào env-specific cert `stg-ex.backseat-service.com`
- đó là lý do imported wildcard cert ở `us-east-1` hiển thị `In use = Yes`
- và cũng là lý do env-specific cert ở `us-east-1` hiển thị `In use = No`

## 4. Vì sao certificate dành cho ALB cũng chưa được dùng

Mặc dù STG bật `enable_certificate_for_alb = true`, Ingress hiện tại vẫn chỉ expose HTTP.

```yaml
# bs-exchange-infra/k8s-manifests/point/stg-ex/ingress.yaml
annotations:
  alb.ingress.kubernetes.io/load-balancer-name: point-alb
  alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}]'
```

Hiện chưa có các annotation như:

- `alb.ingress.kubernetes.io/certificate-arn`
- `alb.ingress.kubernetes.io/ssl-redirect`
- `alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'`

Code Terraform của frontend cũng vẫn đang giả định ALB chạy HTTP:

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

Đó là lý do ảnh ACM ở Tokyo của STG hiển thị như vậy:

- certificate ở app region vẫn được tạo bởi `terraform/init/acm`
- nhưng luồng traffic hiện tại giữa Ingress, ALB và frontend không attach hoặc sử dụng certificate đó
- nên ACM hiển thị `In use = No`

## 5. Hình dạng traffic và TLS hiện tại

Code hiện tại đang hàm ý mô hình traffic như sau:

1. User -> CloudFront: HTTPS, dùng `*.backseat-service.com`
2. CloudFront -> ALB: HTTP
3. ALB -> Kubernetes services/pods: HTTP

Vì vậy, thiết kế hiện tại là:

- viewer-side TLS: đã bật
- CloudFront certificate: shared wildcard cert ở `us-east-1`
- TLS từ CloudFront đến ALB: chưa bật
- certificate dành cho ALB: đã có đường tạo trong code, nhưng chưa có đường sử dụng

## 6. Vì sao ảnh chụp màn hình khớp với code

Không có mâu thuẫn giữa ảnh chụp màn hình và code hiện tại. Ngược lại, đây đúng là trạng thái mà code hiện tại sẽ tạo ra:

- `*.backseat-service.com` ở `us-east-1` có `In use = Yes`
  - vì cả customer và admin CloudFront module đều tham chiếu tới nó
- `stg-ex.backseat-service.com` ở `us-east-1` có `In use = No`
  - vì `terraform/init/acm` có tạo ra nó, nhưng frontend modules không dùng
- `stg-ex.backseat-service.com` ở `ap-northeast-1` có `In use = No`
  - vì `terraform/init/acm` có tạo ra nó, nhưng ALB hiện vẫn chỉ expose HTTP và chưa attach certificate

## 7. Điểm drift thực sự cần lưu ý

Điểm drift chính không phải là "runtime lệch với code".
Điểm drift thực sự là "đường code tạo certificate" đang khác với "đường code sử dụng certificate".

Cụ thể:

- `terraform/init/acm` cho thấy STG nên có env-specific certificates
- `frontend-customer` và `frontend-admin` vẫn đang dùng shared imported wildcard cert
- `k8s-manifests/point/stg-ex/ingress.yaml` vẫn chưa bật HTTPS cho ALB

Nói cách khác, repo hiện tại đang có:

- một **create path** cho env-specific certs
- nhưng chưa có **consume path** tương ứng để đưa các cert đó vào traffic thực tế

## 8. Monitoring ACM trong code

Repo cũng có phần cảnh báo expiration cho ACM:

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

Pattern tương tự cũng tồn tại trong `terraform/components/notification-global/acm.tf`.

Điều này có nghĩa là ACM không chỉ được provision trong code; expiration event cũng đã được nối vào flow notification.

## 9. Ghi chú về `work-eks` và `bs-exchange-infra`

Tài liệu này dùng `bs-exchange-infra/` làm source canonical vì đây là đường dẫn repo phù hợp hơn cho tài liệu lâu dài.

Giữa `.worktrees/work-eks` và `bs-exchange-infra` có một vài diff nhỏ, nhưng kết luận về ACM không thay đổi:

- các đường dẫn ACM quan trọng trong `terraform/init/acm` và tfvars của STG là tương đương
- logic chọn certificate ở frontend vẫn là `*.backseat-service.com`
- path ALB vẫn là HTTP-only

## Kết luận cuối cùng

Code STG hiện đang ở trạng thái chuyển tiếp:

- repo đã có phần provision env-specific certificates cho STG
- repo vẫn đang phục vụ CloudFront bằng shared imported wildcard certificate
- repo vẫn đang phục vụ ALB qua HTTP

Vì vậy, các ảnh ACM của STG là hoàn toàn phù hợp với code hôm nay:

- env-specific certs có tồn tại
- shared wildcard cert mới là cert đang được dùng thực tế
- cert phía ALB có tồn tại nhưng chưa được attach
