# K8s Troubleshooting — Log & Debug Commands

Quick reference cho việc xem log, debug pods trên EKS cluster.

---

## 1. Kiểm tra trạng thái pods

```bash
# Tất cả pods trong namespace default
kubectl get pods -n default

# Filter theo tên deployment
kubectl get pods -n default | grep point

# Xem chi tiết pod (events, conditions, node, IP)
kubectl describe pod <pod-name> -n default

# Pods không ở trạng thái Running
kubectl get pods -n default --field-selector=status.phase!=Running

# Xem pods trên tất cả namespaces
kubectl get pods -A
```

---

## 2. Xem logs

### Cơ bản

```bash
# Log gần nhất (100 dòng cuối)
kubectl logs deployment/<deployment-name> -n <namespace> --tail=100

# Follow log realtime
kubectl logs deployment/<deployment-name> -n <namespace> -f

# Log của pod cụ thể
kubectl logs <pod-name> -n <namespace> --tail=100

# Log từ container cụ thể (pod có nhiều containers)
kubectl logs <pod-name> -n <namespace> -c <container-name> --tail=100
```

### Lọc log theo pattern

```bash
# Tìm error
kubectl logs deployment/<deployment-name> -n <namespace> --tail=500 | grep -i "error\|exception\|fatal"

# Tìm credential/permission issues
kubectl logs deployment/<deployment-name> -n <namespace> --tail=500 | grep -i "credential\|unauthorized\|forbidden\|access.denied"

# Tìm connection issues
kubectl logs deployment/<deployment-name> -n <namespace> --tail=500 | grep -i "connection refused\|timeout\|unreachable"

# Tìm OOM / memory issues
kubectl logs deployment/<deployment-name> -n <namespace> --tail=500 | grep -i "out.of.memory\|oom\|heap"
```

### Log của pod đã crash (previous container)

```bash
kubectl logs <pod-name> -n <namespace> --previous
```

### Log theo thời gian

```bash
# Log trong 30 phút gần nhất
kubectl logs deployment/<deployment-name> -n <namespace> --since=30m

# Log trong 2 giờ gần nhất
kubectl logs deployment/<deployment-name> -n <namespace> --since=2h
```

---

## 3. Exec vào pod

```bash
# Shell vào pod
kubectl exec -it <pod-name> -n <namespace> -- /bin/sh

# Chạy 1 command
kubectl exec <pod-name> -n <namespace> -- <command>

# Ví dụ: check env vars
kubectl exec deployment/<deployment-name> -n <namespace> -- env | grep AWS

# Ví dụ: check network connectivity
kubectl exec deployment/<deployment-name> -n <namespace> -- curl -s --connect-timeout 5 <url>

# Ví dụ: check DNS
kubectl exec deployment/<deployment-name> -n <namespace> -- nslookup <hostname>

# Ví dụ: check file system
kubectl exec deployment/<deployment-name> -n <namespace> -- ls -la /path/to/check
```

---

## 4. Debug IRSA / AWS credentials

```bash
# Check IRSA token mounted
kubectl exec deployment/<deployment-name> -n <namespace> -- \
  ls -la /var/run/secrets/eks.amazonaws.com/serviceaccount/token

# Check IRSA env vars
kubectl exec deployment/<deployment-name> -n <namespace> -- \
  env | grep AWS_WEB_IDENTITY_TOKEN_FILE

# Check ServiceAccount annotations
kubectl get sa <sa-name> -n <namespace> -o jsonpath='{.metadata.annotations}' && echo

# Check IMDS accessibility (expected: timeout nếu hop_limit=1)
kubectl exec deployment/<deployment-name> -n <namespace> -- \
  curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/ || echo "IMDS blocked"

# Verify IAM role từ AWS CLI (chạy trên bastion, không phải trong pod)
aws iam list-attached-role-policies --role-name <role-name> --query 'AttachedPolicies[*].PolicyName' --output table
aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::<account-id>:role/<role-name>" --action-names "<action>" --output json
```

---

## 5. Events & Resource status

```bash
# Events gần nhất trong namespace (sorted by time)
kubectl get events -n <namespace> --sort-by='.lastTimestamp' | tail -30

# Events của 1 pod cụ thể
kubectl describe pod <pod-name> -n <namespace> | grep -A 20 "Events:"

# Xem resource usage (requires metrics-server)
kubectl top pods -n <namespace>
kubectl top nodes
```

---

## 6. Deployment & Rollout

```bash
# Xem rollout status
kubectl rollout status deployment/<deployment-name> -n <namespace>

# Xem rollout history
kubectl rollout history deployment/<deployment-name> -n <namespace>

# Rolling restart (zero-downtime — tạo pod mới trước, terminate cũ sau)
kubectl rollout restart deployment/<deployment-name> -n <namespace>

# Rollback về revision trước
kubectl rollout undo deployment/<deployment-name> -n <namespace>
```

---

## 7. System components

```bash
# Cluster autoscaler
kubectl logs deployment/cluster-autoscaler -n kube-system --tail=50
kubectl get pods -n kube-system | grep cluster-autoscaler

# CloudWatch agent
kubectl logs daemonset/cloudwatch-agent -n amazon-cloudwatch --tail=50
kubectl get pods -n amazon-cloudwatch | grep cloudwatch-agent

# Fluent Bit
kubectl logs daemonset/fluent-bit -n amazon-cloudwatch --tail=50

# CoreDNS
kubectl logs deployment/coredns -n kube-system --tail=50

# Nodes
kubectl get nodes -o wide
kubectl describe node <node-name>
```

---

## 8. Common patterns — Point project

```bash
# App deployments
kubectl get pods -n default | grep point
kubectl logs deployment/point-app-deployment -n default --tail=100
kubectl logs deployment/point-api-deployment -n default --tail=100
kubectl logs deployment/point-admin-deployment -n default --tail=100
kubectl logs deployment/point-worker-deployment -n default --tail=100
kubectl logs deployment/point-mmh-deployment -n default --tail=100

# Tìm lỗi trên tất cả point pods cùng lúc
for d in point-app point-api point-admin point-worker point-mmh; do
  echo "=== ${d}-deployment ==="
  kubectl logs deployment/${d}-deployment -n default --tail=50 | grep -i "error\|exception" | tail -5
done

# Check secrets
kubectl get secret -n default
kubectl get secret <secret-name> -n default -o jsonpath='{.data}' | python3 -c "import sys,json,base64; d=json.load(sys.stdin); [print(f'{k}: {base64.b64decode(v).decode()}') for k,v in d.items()]"
```

---

## 9. Networking debug

```bash
# Check service endpoints
kubectl get svc -n <namespace>
kubectl get endpoints -n <namespace>

# Check ingress
kubectl get ingress -n <namespace>
kubectl describe ingress <ingress-name> -n <namespace>

# Port-forward để test local
kubectl port-forward deployment/<deployment-name> -n <namespace> <local-port>:<container-port>
```

---

## Tips

- **Pod bị CrashLoopBackOff**: Dùng `kubectl logs <pod> --previous` để xem log của container trước khi crash.
- **Pod bị Pending**: Dùng `kubectl describe pod` → xem Events. Thường do thiếu resource hoặc node không đủ.
- **ImagePullBackOff**: Check ECR permissions, image tag tồn tại.
- **Pod Running nhưng app lỗi**: Dùng `kubectl logs` + `kubectl exec` để debug.
- **Muốn xem log nhiều pods cùng lúc**: Dùng label selector: `kubectl logs -l app=point-app -n default --tail=50`
