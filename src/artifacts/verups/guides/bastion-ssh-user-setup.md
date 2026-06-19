# Bastion SSH User Setup via SSM

Hướng dẫn tạo Linux user + SSH key pair trên bastion thông qua SSM Session Manager,
sau đó cấu hình SSH over SSM tunnel trên máy local.

> Tài liệu này mặc định máy local là **Windows 10/11** và thao tác bằng
> **PowerShell + OpenSSH Client built-in của Windows**.
> Nếu dùng macOS/Linux, xem phần tương đương ở cuối tài liệu.

## Prerequisites

| Yêu cầu | Chi tiết |
|----------|----------|
| Windows 10/11 | Dùng PowerShell 5.1 hoặc PowerShell 7 |
| OpenSSH Client | Kiểm tra bằng `ssh -V` và `ssh-keygen -?` |
| AWS CLI v2 | `aws --version` >= 2.x |
| Session Manager Plugin | [Install guide](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) |
| IAM Permission | `ssm:StartSession` trên bastion instance |
| Bastion Instance ID | Lấy từ AWS Console hoặc `aws ec2 describe-instances` |

### Kiểm tra OpenSSH Client trên Windows

Chạy trên PowerShell:

```powershell
ssh -V
ssh-keygen -?
```

Nếu chưa có `ssh` hoặc `ssh-keygen`, mở **PowerShell as Administrator** và cài:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

Sau đó đóng và mở lại PowerShell.

### Kiểm tra Session Manager Plugin

```powershell
session-manager-plugin --version
```

Nếu chưa có trên Windows, cài theo AWS install guide ở trên rồi mở lại PowerShell.

### Tìm Instance ID của bastion

```powershell
aws ec2 describe-instances --filters "Name=tag:Name,Values=*bastion*" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].[InstanceId,Tags[?Key=='Name'].Value|[0],PrivateIpAddress]" --output table --region ap-northeast-1
```

---

## Step 1: SSM vào bastion

Chạy trên **Windows PowerShell**:

```powershell
aws ssm start-session --target <INSTANCE_ID> --region ap-northeast-1
```

Sau khi connect, trên bastion kiểm tra bạn có sudo:

```bash
whoami          # => ssm-user
sudo whoami     # => root
```

> **Note**: `ssm-user` có passwordless sudo theo mặc định của SSM Agent.
> Nếu lệnh `sudo` yêu cầu password, nghĩa là cấu hình đã bị thay đổi.
> Liên hệ admin để kiểm tra `/etc/sudoers.d/ssm-agent-users`.

---

## Step 2: Tạo Linux user

Chạy trong **SSM session trên bastion (Linux shell)**:

```bash
# Thay NEW_USER bằng username thực tế (ví dụ: hoangtrung)
NEW_USER="hoangtrung"

# Tạo user với home directory và bash shell
sudo useradd -m -s /bin/bash "$NEW_USER"

# Verify
id "$NEW_USER"
# => uid=1001(hoangtrung) gid=1001(hoangtrung) groups=1001(hoangtrung)
```

### (Optional) Cấp sudo cho user mới

```bash
sudo usermod -aG wheel "$NEW_USER"   # Amazon Linux 2
# hoặc
sudo usermod -aG sudo "$NEW_USER"    # Ubuntu/Debian
```

---

## Step 3: Tạo SSH key pair

Có 2 cách: tạo key trên máy local hoặc tạo trên bastion.
Với local là Windows, **Cách A** vẫn là cách khuyến nghị.

### Cách A: Tạo key trên máy local Windows (Recommended)

Chạy trên **Windows PowerShell**:

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $HOME '.ssh') | Out-Null

# Tạo key pair
ssh-keygen -t ed25519 -f (Join-Path $HOME '.ssh\bastion_key') -C "$env:USERNAME@bastion"
# Enter passphrase (khuyến nghị đặt passphrase)

# Xem public key
Get-Content (Join-Path $HOME '.ssh\bastion_key.pub')
# => ssh-ed25519 AAAA...xxxx user@bastion
```

Quay lại **SSM session trên bastion**, thêm public key:

```bash
NEW_USER="hoangtrung"

# Tạo thư mục .ssh cho user
sudo mkdir -p /home/$NEW_USER/.ssh
sudo chmod 700 /home/$NEW_USER/.ssh

# Thêm public key (paste nội dung từ bastion_key.pub)
sudo tee /home/$NEW_USER/.ssh/authorized_keys << 'EOF'
ssh-ed25519 AAAA...paste-public-key-here... user@bastion
EOF

# Set permissions
sudo chmod 600 /home/$NEW_USER/.ssh/authorized_keys
sudo chown -R $NEW_USER:$NEW_USER /home/$NEW_USER/.ssh
```

### Cách B: Tạo key trên bastion

Chạy trong **SSM session trên bastion**:

```bash
NEW_USER="hoangtrung"

# Chuyển sang user mới
sudo su - "$NEW_USER"

# Tạo key pair
ssh-keygen -t ed25519 -C "$USER@bastion"
# Enter file: để default (~/.ssh/id_ed25519)
# Enter passphrase: khuyến nghị đặt

# Thêm public key vào authorized_keys
cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# QUAN TRỌNG: Copy private key về máy local
cat ~/.ssh/id_ed25519
# => Copy toàn bộ nội dung (từ -----BEGIN đến -----END)

# Thoát về ssm-user
exit
```

Trên **Windows PowerShell**, lưu private key:

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $HOME '.ssh') | Out-Null
notepad (Join-Path $HOME '.ssh\bastion_key')
```

Paste nội dung private key vào Notepad, save file, rồi test bằng `ssh`.

> **Cách A an toàn hơn** vì private key không bao giờ tồn tại trên server.

---

## Step 4: Verify sshd cho phép key auth

Chạy trong **SSM session trên bastion**:

```bash
# Kiểm tra sshd config
sudo grep -E "^(PubkeyAuthentication|AuthorizedKeysFile)" /etc/ssh/sshd_config
```

Expected output:

```
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
```

Nếu `PubkeyAuthentication` là `no`:

```bash
sudo sed -i 's/^PubkeyAuthentication no/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

---

## Step 5: Cấu hình SSH over SSM trên máy local Windows

Mở file SSH config trên **Windows PowerShell**:

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $HOME '.ssh') | Out-Null
notepad (Join-Path $HOME '.ssh\config')
```

Thêm cấu hình sau vào `%USERPROFILE%\.ssh\config`:

```ssh-config
# Bastion via SSM tunnel
Host bastion
  HostName <INSTANCE_ID>
  User hoangtrung
  IdentityFile ~/.ssh/bastion_key
  ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p --region ap-northeast-1
```

> Thay `<INSTANCE_ID>` bằng ID thực tế, ví dụ `i-0abc123def456`.
>
> `--parameters portNumber=%p` được viết không có single quote để tương thích
> với Windows OpenSSH. Nếu dùng path tường minh trong `IdentityFile`,
> ưu tiên format `C:/Users/<WindowsUser>/.ssh/bastion_key`, không dùng backslash.

---

## Step 6: Test kết nối

Chạy trên **Windows PowerShell**:

```powershell
ssh bastion
```

Nếu thành công:

```
Last login: Mon Mar 17 10:00:00 2026
[hoangtrung@ip-172-18-xx-xx ~]$
```

### Troubleshooting

| Lỗi | Nguyên nhân | Fix |
|-----|------------|-----|
| `ssh : The term 'ssh' is not recognized` | Windows chưa có OpenSSH Client | Cài `OpenSSH.Client` rồi mở lại PowerShell |
| `session-manager-plugin : The term 'session-manager-plugin' is not recognized` | Chưa cài Session Manager Plugin hoặc terminal chưa reload PATH | Cài plugin theo AWS guide rồi mở lại PowerShell |
| `TargetNotConnected` | SSM Agent không chạy hoặc instance stopped | Kiểm tra instance state + SSM Agent |
| `Permission denied (publickey)` | Key hoặc permission sai | Kiểm tra `authorized_keys`, `IdentityFile`, username, và `chmod 600` trên bastion |
| `WARNING: UNPROTECTED PRIVATE KEY FILE!` | File private key trên Windows có ACL quá rộng | Chạy lệnh `icacls` ở mục debug bên dưới rồi test lại |
| `Unable to start command` | Thiếu `AWS-StartSSHSession` document hoặc plugin lỗi | Kiểm tra SSM documents trong region và plugin cài đúng |
| `An error occurred (AccessDeniedException)` | IAM thiếu `ssm:StartSession` | Thêm policy cho IAM user/role |

### Debug chi tiết

```powershell
# SSH verbose mode
ssh -vvv bastion

# Kiểm tra SSM tunnel riêng
aws ssm start-session --target <INSTANCE_ID> --region ap-northeast-1

# Kiểm tra command nào đang available trong PATH
Get-Command ssh, ssh-keygen, aws, session-manager-plugin
```

Nếu Windows báo private key permission quá rộng:

```powershell
$KeyPath = Join-Path $HOME '.ssh\bastion_key'
icacls $KeyPath /inheritance:r
icacls $KeyPath /grant:r "$env:USERNAME:F"
```

---

## macOS/Linux Equivalent

Nếu local không phải Windows, các bước bastion vẫn giữ nguyên.
Chỉ thay các lệnh local bằng tương đương sau:

```bash
# Verify local tools
ssh -V
ssh-keygen -?
session-manager-plugin --version

# macOS example install
brew install --cask session-manager-plugin

# Generate key
mkdir -p ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/bastion_key -C "$USER@bastion"
cat ~/.ssh/bastion_key.pub

# Edit SSH config
vim ~/.ssh/config
```

Trong `~/.ssh/config`, có thể dùng cùng block:

```ssh-config
Host bastion
  HostName <INSTANCE_ID>
  User hoangtrung
  IdentityFile ~/.ssh/bastion_key
  ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p --region ap-northeast-1
```

---

## Security Notes

- Private key (`%USERPROFILE%\.ssh\bastion_key` trên Windows hoặc `~/.ssh/bastion_key` trên macOS/Linux) **không được commit vào git**
- Nếu tạo key trên bastion (Cách B), **xóa private key trên bastion** sau khi đã copy về local:
  ```bash
  sudo rm /home/$NEW_USER/.ssh/id_ed25519
  ```
- Mỗi người dùng nên có user + key riêng, không share
- Định kỳ review `/home/*/authorized_keys` để revoke key không dùng nữa
- Cân nhắc đặt passphrase cho SSH key và dùng `ssh-agent`
