# Point Bastion — SSH Access Guide (Session Manager Fallback)

## 1. Purpose

The point bastion hosts are normally accessed through **AWS Systems Manager Session Manager**. Session Manager depends on the SSM Agent running on the instance; when the agent breaks, operators can lose all access to the bastion — and with it, access to Aurora, Redshift, and ElastiCache.

This guide describes how to **prepare direct SSH access in advance** (while Session Manager is healthy), so that when SSM is down you can SSH straight to the bastion **over the private network, without SSM and without any public exposure**. It covers Windows, macOS, and Linux clients, using both OpenSSH and common GUI tools (PuTTY, WinSCP, Tera Term).

The direct-SSH path assumes your local machine is **on the same private network as the bastion** (VPN, Direct Connect, or VPC peering). Traffic goes to the bastion's private IP and never touches the internet — the bastion has no public IP at all. For machines that are **not** on the private network, section 8 (EC2 Instance Connect Endpoint) is the fallback.

**Do the preparation in section 5 today.** Once the agent is dead, the preparation steps become impossible.

> ⚠️ **Action required (admin):** three prerequisites must be confirmed/created today, and without them this guide cannot be executed during an incident:
> 1. **Confirm a private network path actually exists** (VPN / Direct Connect / peering that routes to the bastion subnet) and document which one, who operates it, and its client CIDR. If none exists, direct SSH is impossible and EICE (section 8) becomes the primary fallback.
> 2. The bastion security group has **no inbound rules** — direct SSH needs one inbound rule (TCP 22 from the verified private-network/VPN CIDR), see section 5.6.
> 3. **No EC2 Instance Connect Endpoint exists in either point VPC** — off-network access (section 8) needs the endpoint plus its own SG rule.

## 2. Architecture facts

These facts shape everything in this guide:

- The bastion sits in a **private subnet with no public IP**. There is no route from the internet — direct SSH is only reachable from inside the private network (VPN / peered networks).
- The bastion security group currently has **no inbound rules at all** — Session Manager needs none (the agent dials *out* through VPC interface endpoints). Direct SSH therefore requires an admin to add an inbound rule first (section 5.6).
- **No EC2 key pair is associated with the instance** (`key_name` is unset in the launch configuration). Every SSH identity must be provisioned manually into `~/.ssh/authorized_keys`, which is exactly what section 5 does.
- The bastions run **Ubuntu 20.04**. Where behavior differs on Amazon Linux 2023 (default user, package manager, sudo group, SSM Agent service name, ssh-rsa policy), this guide calls it out in AL2023 notes.
- The instances are **t2 (Xen) types**, so **EC2 Serial Console is not available** (it requires Nitro-based instance types).

Find the bastion's private IP and instance ID when you need them:

```bash
aws ec2 describe-instances --profile <your-profile> --region ap-northeast-1 --filters "Name=tag:Name,Values=point-bastion" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].[InstanceId,PrivateIpAddress]" --output table
```

(Console: **EC2 → Instances → point-bastion** → Details tab → Private IPv4 address.) DEV and STG are separate AWS accounts — run `aws sts get-caller-identity --profile <your-profile>` first to confirm you are reading the right one.

## 3. Access methods — which works when

The whole point of direct SSH is that it does **not** depend on the SSM Agent — only on sshd, the network path (VPN), and the security-group rule.

| # | Situation | Console Session Manager | Direct SSH over private network | EICE (section 8) |
|---|---|---|---|---|
| 1 | Everything healthy | ✅ | ✅ | ✅ (if endpoint exists) |
| 2 | SSM Agent dead / not registering (`TargetNotConnected`) | ❌ | ✅ — unaffected, needs sshd + key + SG rule only | ✅ |
| 3 | You are not on the private network (no VPN), agent alive | ✅ (browser) | ❌ — private IP unreachable | ✅ — works from anywhere with internet + IAM |
| 3b | You are not on the private network AND agent dead | ❌ | ❌ | ✅ — the only remaining path |
| 4 | sshd dead but agent alive | ✅ | ❌ | ❌ |
| 5 | Instance-level failure (kernel, full root disk, network stack) | ❌ | ❌ | ❌ → stop instance + user-data repair / EC2Rescue (section 8.5) |

To check whether the SSM side is alive (useful for deciding what broke):

```bash
aws ssm describe-instance-information --region ap-northeast-1 --query "InstanceInformationList[].[InstanceId,PingStatus,AgentVersion]" --output table
```

Or in the console: **EC2 → instance → Connect → Session Manager tab** (an explicit "SSM Agent is not online" message means the agent is dead), or **Systems Manager → Fleet Manager** ping status.

## 4. Client prerequisites

| Requirement | Notes |
|---|---|
| An SSH client | OpenSSH (built into Windows 10/11, macOS, Linux), PuTTY, Tera Term, and/or WinSCP |
| Private network access | VPN / Direct Connect / peering that routes to the bastion's subnet — required for direct SSH (sections 6–7) |
| AWS CLI v2 + credentials | Only needed for status checks (section 3) and the EICE fallback (section 8) |

### 4.1 Verify OpenSSH on Windows

Windows 10/11 ship an OpenSSH client, but confirm:

```powershell
ssh -V
ssh-keygen --help
```

If missing, install from an elevated PowerShell, then reopen the terminal:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

## 5. One-time preparation (do this while Session Manager is healthy)

Goal: a personal Linux user on the bastion with your public key in `authorized_keys`, plus the security-group rule that lets SSH in — so that direct SSH works later **without** SSM. Each operator gets their own user and key — never share either.

### 5.1 Open a browser shell via AWS Console → Session Manager

No CLI needed for this step; the browser shell is enough for all on-bastion commands in this section.

1. Sign in to the AWS Console for the target account and switch to region **ap-northeast-1**.
2. Open **EC2 → Instances**, select **point-bastion**, and choose **Connect**.
3. In the Connect dialog, choose the **Session Manager** tab, then **Connect**.

(Equivalent path: **Systems Manager console → Session Manager → Start session →** select the instance → **Start session**.)

A shell opens in the browser. You land as `ssm-user`, which has passwordless sudo by default:

```bash
whoami        # => ssm-user
sudo whoami   # => root
```

> If `sudo` prompts for a password, the default grant in `/etc/sudoers.d/ssm-agent-users` (`ssm-user ALL=(ALL) NOPASSWD:ALL`) has been altered — escalate to the infrastructure admin before continuing.

### 5.2 Create your Linux user

In the browser shell:

```bash
NEW_USER="<your-username>"        # e.g. tnguyen or firstname-lastname

sudo useradd -m -s /bin/bash "$NEW_USER"
id "$NEW_USER"
```

> ⚠️ **Never use a dot in the username** (`firstname.lastname`). `useradd` rejects it on Ubuntu — and even if such a user existed, sudo **silently ignores** any file in `/etc/sudoers.d/` whose name contains a dot, while `visudo -cf` still reports "parsed OK". You would only discover the broken sudo during the incident. Use a hyphen or a short handle instead.

Grant sudo **only if your role requires it**. The distro-agnostic way (recommended — works identically on Ubuntu and AL2023) is a sudoers drop-in. `NOPASSWD` is the only workable form here: these accounts are key-only with locked passwords, so a password-prompting sudo grant would be unusable (the same model `ssm-user` uses).

```bash
echo "$NEW_USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/$NEW_USER
sudo chmod 440 /etc/sudoers.d/$NEW_USER
sudo visudo -cf /etc/sudoers.d/$NEW_USER   # must print "parsed OK"
```

> **AL2023 note:** the group-based alternative is `sudo usermod -aG sudo "$NEW_USER"` on Ubuntu but `sudo usermod -aG wheel "$NEW_USER"` on AL2023. The sudoers drop-in above avoids remembering the difference.

**Governance:** notify the infrastructure admin whenever you create a user on the bastion, and record the username + key fingerprint on the team operations page. This list is what makes the offboarding step in section 10 possible.

### 5.3 Generate your SSH key pair (on your own machine)

Generate the key **locally** so the private key never exists on the server. Use Ed25519 — it is small, fast, and supported by every tool in this guide (OpenSSH, PuTTY 0.84, WinSCP 6.5.6, Tera Term 5.6.1).

> **AL2023 note:** AL2023 disables legacy `ssh-rsa` signatures by default. Ed25519 keys avoid the issue entirely.

#### Option A — `ssh-keygen` (Windows PowerShell, macOS, Linux)

```bash
# macOS / Linux
mkdir -p ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/point-bastion -C "<your-username>@point-bastion"
cat ~/.ssh/point-bastion.pub
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force -Path (Join-Path $HOME '.ssh') | Out-Null
ssh-keygen -t ed25519 -f (Join-Path $HOME '.ssh\point-bastion') -C "$env:USERNAME@point-bastion"
Get-Content (Join-Path $HOME '.ssh\point-bastion.pub')
```

Set a passphrase when prompted (recommended). The `.pub` output line (`ssh-ed25519 AAAA... comment`) is what goes to the server in step 5.4.

#### Option B — PuTTYgen (Windows GUI)

PuTTYgen ships with PuTTY (current stable 0.84) and is also bundled inside WinSCP.

1. Start **PuTTYgen**.
2. Under **Key → Type of key to generate**, select **EdDSA**, and leave the curve selector at its default (Ed25519).
3. Click **Generate** and move the mouse over the blank area until the progress bar completes.
4. Fill **Key passphrase** and **Confirm passphrase** (recommended).
5. Click **Save private key** → save as `point-bastion.ppk`. This PuTTY-native `.ppk` file is what PuTTY/WinSCP/Pageant use.
6. Copy the entire contents of the box labelled **"Public key for pasting into OpenSSH authorized_keys file"** — this single `ssh-ed25519 AAAA...` line is what goes to the server in step 5.4.

> **Do not** use the "Save public key" button for this purpose — it writes RFC 4716 format, which `authorized_keys` does not accept. Always copy from the paste box.

Two PuTTYgen conversions you may need later:

- **OpenSSH key → .ppk** (to reuse an Option-A key in PuTTY/WinSCP): **Conversions → Import key**, select `point-bastion` (the OpenSSH private key), enter its passphrase, then **Save private key**.
- **PPK version compatibility:** PuTTYgen saves PPK **version 3** by default. If a key must load in PuTTY 0.74 or older, or in old third-party tools, switch via **Key → Parameters for saving key files... → PPK version 2**. Prefer v3 (Argon2-protected) whenever possible; current WinSCP and Tera Term both accept it.

#### Option C — Tera Term key generator (Windows GUI)

Tera Term 5 can generate keys too: **Setup → SSH KeyGenerator**, select key type **ED25519**, click **Generate**, set **Key passphrase** / **Confirm passphrase**, then **Save public key** and **Save private key**. The saved public key is already in OpenSSH one-line format.

### 5.4 Install the public key on the bastion

Back in the browser Session Manager shell:

```bash
NEW_USER="<your-username>"
PUBKEY="ssh-ed25519 AAAA...paste-your-public-key-line-here... <your-username>@point-bastion"

sudo mkdir -p /home/$NEW_USER/.ssh
echo "$PUBKEY" | sudo tee -a /home/$NEW_USER/.ssh/authorized_keys
sudo chmod 700 /home/$NEW_USER/.ssh
sudo chmod 600 /home/$NEW_USER/.ssh/authorized_keys
sudo chown -R $NEW_USER:$NEW_USER /home/$NEW_USER/.ssh
```

Browser-shell paste can wrap or mangle long base64 lines, so **verify the key fingerprint** before trusting it. On the bastion:

```bash
sudo ssh-keygen -lf /home/$NEW_USER/.ssh/authorized_keys
```

The fingerprint must match what your own machine prints for `ssh-keygen -lf ~/.ssh/point-bastion.pub` (PowerShell: `ssh-keygen -lf $HOME\.ssh\point-bastion.pub`). Note that `tee -a` *appends* — if you re-run this step, remove the duplicate or stale lines from `authorized_keys` afterwards.

### 5.5 Verify sshd is running and allows key auth

```bash
sudo systemctl status ssh --no-pager     # Ubuntu (AL2023: sshd)
sudo sshd -T | grep -E "^(pubkeyauthentication|passwordauthentication|authorizedkeysfile)"
```

Expected:

```
pubkeyauthentication yes
passwordauthentication no
authorizedkeysfile .ssh/authorized_keys
```

`sshd -T` prints the *effective* configuration, so it also catches overrides living in `/etc/ssh/sshd_config.d/*.conf` (the include-style layout AL2023 and newer Ubuntu use), not just the legacy single file.

- If the `ssh` unit does not exist at all, install it **now**, while Session Manager is still healthy: `sudo apt install openssh-server` (AL2023: `sudo dnf install openssh-server`). Without sshd, every method in this guide is moot.
- If `passwordauthentication` prints `yes`, disable it before relying on SSH: add `PasswordAuthentication no` to a file in `/etc/ssh/sshd_config.d/`, validate with `sudo sshd -t`, then `sudo systemctl reload ssh` — or escalate to the infrastructure admin. (Always run `sshd -t` first; a config syntax error that blocks a reload would take down the very fallback you are building.)

While you are here, **record the bastion's host key fingerprints** so the first real SSH connection can be verified instead of blindly accepted:

```bash
for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done
```

Save the output on the team operations page; compare against it when your SSH client shows the host key prompt (and when investigating the "HOST IDENTIFICATION HAS CHANGED" warning in section 11).

### 5.6 Admin: allow SSH inbound on the bastion security group

The bastion security group currently has **no inbound rules**, so even with a valid key, direct SSH will time out until this rule exists:

- **Inbound rule: TCP 22, source = the private-network/VPN CIDR** that operator machines arrive from (least privilege — do not open to the whole VPC, and never to `0.0.0.0/0`).

**Verify the real source CIDR before writing the rule** — many VPNs NAT all clients behind one or a few egress IPs, so the address the bastion sees may differ from the client subnet. While connected to the VPN, attempt a test connection and check what the bastion sees (from a Session Manager shell: `sudo ss -tn | grep :22`, or check VPC Flow Logs / the VPN's documented NAT range). Record the confirmed CIDR on the team operations page so it is not re-derived during an incident.

Also confirm the network path end to end:

- The VPN / peering route tables actually route the bastion subnet to clients **and** the bastion subnet's route table can return traffic to the VPN CIDR (peering routes are not automatic).
- The subnet's **network ACL** allows TCP 22 inbound from the chosen CIDR and ephemeral-port return traffic outbound (only relevant if the NACL is non-default).

This should be codified in Terraform alongside the rest of the security-group rules; a console-added rule is acceptable only as an emergency measure.

### 5.7 Test the SSH path immediately

Do not wait for an incident to discover a typo or a missing rule. Complete section 6 (or 7) now, while connected to the VPN, and confirm you can log in. Re-test after any bastion rebuild and quarterly.

## 6. Connecting with OpenSSH (all platforms)

Direct SSH to the bastion's **private IP** over the private network. No SSM, no proxy, no tunnel — this path keeps working when the SSM Agent is dead. Requirements: VPN connected, SG rule from section 5.6 in place, key from section 5.

### 6.1 SSH config

**macOS / Linux** — add to `~/.ssh/config`:

```ssh-config
# point-bastion — direct over private network
Host point-bastion-dev
  HostName <DEV_BASTION_PRIVATE_IP>
  User <your-username>
  IdentityFile ~/.ssh/point-bastion

Host point-bastion-stg
  HostName <STG_BASTION_PRIVATE_IP>
  User <your-username>
  IdentityFile ~/.ssh/point-bastion
```

**Windows** — add the same block to `C:\Users\<you>\.ssh\config` (use forward slashes if you write an explicit `IdentityFile` path, e.g. `C:/Users/<you>/.ssh/point-bastion`).

Get the private IPs with the command in section 2. (Optional improvement: a Route 53 private hosted zone record — e.g. `bastion.dev.point.internal` — resolvable over the VPN makes a bastion rebuild a single DNS update instead of editing every client config; verify VPN DNS resolution first.)

### 6.2 Connect

```bash
ssh point-bastion-dev
scp ./file.sql point-bastion-dev:/tmp/        # file copy works the same way
```

Log in as **your** user — not `ssm-user` (that account is only the Session Manager console identity). After logging in, confirm the environment: the shell prompt hostname tells you which bastion you are on.

## 7. Connecting with GUI tools (Windows)

All three tools connect the same way: **Host = the bastion's private IP, Port = 22**, over the VPN. No tunnels or proxy commands needed.

### 7.1 PuTTY

The steps below match PuTTY 0.84:

1. PuTTY → **Session**: Host Name = `<BASTION_PRIVATE_IP>`, Port `22`, Connection type SSH.
2. **Connection → Data**: Auto-login username = `<your-username>`.
3. **Connection → SSH → Auth → Credentials**: set **Private key file for authentication** to your `point-bastion.ppk`. (The Credentials sub-panel exists since PuTTY 0.78; on older versions the field is directly on the Auth panel — but simply upgrade.)
4. **Session**: save the profile (e.g. `point-bastion-dev`), then **Open**.
5. Accept the host key on first connect.

**Pageant (optional, recommended for daily use):** run `pageant.exe`, right-click its system-tray icon → **View Keys** → **Add Key** → select `point-bastion.ppk` → enter the passphrase once. PuTTY and WinSCP then authenticate via the agent automatically, with no per-session passphrase prompts.

### 7.2 WinSCP (SFTP file transfer)

The steps below match WinSCP 6.5.6. WinSCP requires PuTTY-format keys: pointing it at an OpenSSH-format private key triggers an automatic offer to convert to `.ppk`. WinSCP also bundles PuTTYgen (**Advanced Site Settings → SSH → Authentication → Tools → Generate New Key Pair with PuTTYgen**) if you skipped section 5.3.

1. WinSCP Login dialog → **New Site**: File protocol **SFTP**, Host name = `<BASTION_PRIVATE_IP>`, Port number `22`, User name `<your-username>`.
2. **Advanced... → SSH → Authentication → Private key file**: select `point-bastion.ppk` (or your OpenSSH key and accept the conversion).
3. **Save** the site, then **Login**. Accept the host key on first connect.

Drag-and-drop upload/download then works normally.

### 7.3 Tera Term

The steps below match Tera Term 5.6.1:

1. **File → New connection**: Host = `<BASTION_PRIVATE_IP>`, Service **SSH**, TCP port# `22`, SSH version **SSH2** → **OK**.
2. Accept the host key in the Security Warning dialog on first connect.
3. In the **SSH Authentication** dialog: enter `<your-username>`, select the **"RSA/DSA/ECDSA/ED25519 key to log in"** option (wording may vary slightly between versions), click **Private key file:** and select your key, enter the passphrase → **OK**.

Tera Term 5 reads OpenSSH-format keys (including Ed25519) as well as PuTTY `.ppk` and ssh.com formats, so the key from any option in section 5.3 should work — if a key file is rejected, convert it with PuTTYgen (Conversions → Import key → Save private key) or use a key generated by Tera Term itself (section 5.3, Option C).

## 8. Off-network fallback: EC2 Instance Connect Endpoint (EICE)

Direct SSH (sections 6–7) requires being on the private network. When you are **not** — no VPN, working from an unmanaged network, or the VPN itself is down — the **EC2 Instance Connect Endpoint** is the way in. It is an identity-aware TCP proxy operated by AWS as a VPC endpoint: your machine talks to the AWS API over the internet using IAM credentials, and AWS relays the TCP connection to the bastion's private port 22. It does **not** depend on the SSM Agent — only on a reachable sshd and the key you provisioned in section 5. Connection attempts are logged to CloudTrail; there is no additional charge for the endpoint itself (standard data transfer charges, e.g. cross-AZ, may apply to traffic).

So the two fallbacks complement each other:

- **On the private network, SSM dead** → direct SSH (sections 6–7).
- **Off the private network** (any agent state) → EICE tunnel, then the same SSH clients connect via `localhost`.

> **Current state — read before an incident:** no EICE exists in the point VPCs today, so steps 8.1–8.2 are admin actions that must be performed (or pre-approved as an emergency change) before EICE can be used. Doing them in advance is strongly recommended. Serial console is **not** an alternative here — the bastions are t2 (Xen) types, which the Nitro-only EC2 Serial Console does not support.

### 8.1 Create the endpoint (admin, once per VPC)

The console steps below are for emergency creation; the permanent endpoint and security-group rule should be codified in Terraform alongside the rest of the network infrastructure.

Default quota: **1 EICE per VPC** (and per subnet; adjustable via Service Quotas); each endpoint supports up to 20 concurrent connections.

1. Create a dedicated security group for the endpoint (e.g. `eice-sg`) with one **outbound** rule: TCP 22, destination = the bastion security group (`bastion-sg`). Inbound rules on the endpoint SG are ignored by the service.
2. EC2 console → **Network & Security → Endpoints** (or VPC console → Endpoints) → **Create endpoint** → Type **EC2 Instance Connect Endpoint** → select the point VPC, a private subnet, and `eice-sg`.
3. Wait for the endpoint state to become **create-complete**.

The endpoint can reach instances in any subnet of the VPC, so one endpoint covers the bastion and any future private instances.

### 8.2 Allow EICE inbound on the bastion (admin, once)

Add one inbound rule to the bastion security group: **TCP 22, source = `eice-sg`** (the endpoint's security group). This is separate from the VPN-CIDR rule in section 5.6 — it admits traffic exclusively from the endpoint.

Operators additionally need the IAM permission `ec2-instance-connect:OpenTunnel` on the endpoint ARN (optionally restricted with the `ec2-instance-connect:remotePort = 22` condition key), plus `ec2:DescribeInstances` and `ec2:DescribeInstanceConnectEndpoints`.

### 8.3 Connect through the endpoint

Open a tunnel from your machine (internet + IAM credentials are enough — no VPN):

```bash
aws ec2-instance-connect open-tunnel --instance-id <INSTANCE_ID> --remote-port 22 --local-port 2222 --region ap-northeast-1 --profile <your-profile>
```

Then point any client from sections 6–7 at **Host `localhost`, Port `2222`** instead of the private IP (PuTTY/WinSCP/Tera Term work unchanged). Or use a one-shot OpenSSH ProxyCommand:

```bash
ssh -i ~/.ssh/point-bastion <your-username>@<INSTANCE_ID> -o ProxyCommand='aws ec2-instance-connect open-tunnel --instance-id %h --region ap-northeast-1 --profile <your-profile>'
```

Tunnel limits: maximum duration is **1 hour** per established connection (re-run the command to continue), and EICE is intended for management traffic — bulk data transfer is throttled.

### 8.4 Repair the SSM Agent once you are in

On the Ubuntu bastion the agent is the snap build:

```bash
sudo systemctl status snap.amazon-ssm-agent.amazon-ssm-agent.service --no-pager
sudo snap restart amazon-ssm-agent
sudo journalctl -u snap.amazon-ssm-agent.amazon-ssm-agent.service --since "1 hour ago" --no-pager | tail -50
```

> **AL2023 note:** the agent is an rpm there — `sudo systemctl status amazon-ssm-agent` / `sudo systemctl restart amazon-ssm-agent`.

Also verify the usual suspects: full root disk (`df -h /`), DNS to the VPC endpoints (`getent hosts ssm.ap-northeast-1.amazonaws.com` should resolve to private IPs), and instance-profile credentials (`curl` IMDSv2 token flow).

### 8.5 Last resort: instance-level recovery (no SSH, no SSM)

If even sshd is unreachable, the remaining options both involve **stopping the instance** — coordinate before using them, and note the private IP is static (`private_ip` is pinned in Terraform) so it survives stop/start:

- **Stop + edit user data:** Instance state → **Stop instance**, then Actions → **Instance settings → Edit user data** — inject a repair script (e.g. reinstall/restart the SSM agent), start the instance. Plain user-data scripts run only on first boot; wrap the script in a MIME multipart with `cloud_final_modules: [scripts-user, always]` to force execution on the next boot.
- **AWSSupport-ExecuteEC2Rescue** (Systems Manager Automation runbook): automates offline repair of connectivity/agent issues. It stops the instance and creates an AMI backup first, and **does not support instances with encrypted root volumes**. Both bastion root volumes are currently unencrypted, so this path applies — but re-check before use: if account-level EBS encryption-by-default is ever enabled, a rebuilt bastion would silently come up encrypted and invalidate it. In that case fall back to manual surgery: detach the root volume, attach it to a rescue instance, repair (fix sshd/agent/config), reattach, start.

## 9. Verification checklist

Run after completing section 5 and quarterly. Assign a named owner per environment, put the run in the team calendar, and record each result (date, environment, who, pass/fail) on the team operations page — an unowned "quarterly" check is a wish, not a control.

- The SG inbound rule (TCP 22 from the VPN/private CIDR) exists on the bastion security group
- While on the VPN: `ssh point-bastion-<env>` logs in directly (no SSM involved) without a password prompt
- Your GUI tool of choice (PuTTY / WinSCP / Tera Term) connects to the private IP on port 22
- `sudo sshd -T | grep pubkeyauthentication` still prints `pubkeyauthentication yes`
- Browser Session Manager shell still opens and `sudo whoami` returns `root` (the prep path must stay healthy too)
- (If EICE is deployed) from a machine **off** the VPN: `aws ec2-instance-connect open-tunnel` + SSH works end to end
- Stale entries removed from `/home/*/.ssh/authorized_keys` (leavers, rotated keys)

**After a bastion rebuild, re-testing is not enough — redo the setup.** Users, keys, and sudoers drop-ins live on the instance and are destroyed with it: every operator must redo section 5, the new private IP/instance ID must be updated in every SSH config and saved GUI profile, and cached host keys must be cleared (see the host-key row in section 11).

## 10. Security notes

- **Private keys never leave your machine.** Generate locally (section 5.3); never create them on the bastion, never paste a private key into a console session, chat, or ticket.
- **Passphrase-protect keys** and prefer an agent (Pageant / ssh-agent) over unprotected key files.
- **One user + one key per operator.** Shared accounts destroy the audit trail (sshd logs the key fingerprint per login; EICE additionally logs the IAM identity to CloudTrail).
- **Keep password authentication disabled** on sshd. Key-based auth only.
- **Keep the SG rule narrow:** TCP 22 from the VPN/private CIDR only — never the whole VPC, never `0.0.0.0/0` (the bastion has no public IP, but a broad rule still widens lateral movement inside the network).
- **Windows file permissions:** if OpenSSH refuses your key with `UNPROTECTED PRIVATE KEY FILE`, tighten the ACL:

  ```powershell
  icacls $HOME\.ssh\point-bastion /inheritance:r
  icacls $HOME\.ssh\point-bastion /grant:r "$($env:USERNAME):F"
  ```

- **Offboarding:** removing an operator means deleting their Linux user (`sudo userdel -r <user>`) **and their sudoers drop-in** (`sudo rm -f /etc/sudoers.d/<user>` — `userdel` does not remove it, and a reused username would silently inherit NOPASSWD root), or at minimum their `authorized_keys` entry — IAM offboarding alone does not revoke direct SSH once a key is installed.
- Direct SSH sessions are audited only by the bastion itself — `/var/log/auth.log` on Ubuntu is the audit source for SSH logins.

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ssh: connect to host ... port 22: Connection timed out` | Not on the VPN / no route to the subnet, SG inbound rule (section 5.6) missing, or a non-default NACL blocking | Check VPN connectivity (`nc -vz <ip> 22`; Windows: `Test-NetConnection <ip> -Port 22`), then verify the SG rule and subnet NACL |
| `Connection refused` on port 22 | sshd not running on the bastion | Console Session Manager shell → `sudo systemctl start ssh` (section 5.5). If Session Manager is also down, EICE will not help either (it needs sshd) → section 8.5 |
| `Permission denied (publickey)` | Wrong username, key not in `authorized_keys`, bad permissions | Verify you SSH as your own user, re-check section 5.4 permissions (`700`/`600`, ownership) |
| `UNPROTECTED PRIVATE KEY FILE` (Windows) | Key file ACL too permissive | `icacls` commands in section 10 |
| `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED` | Expected after a bastion rebuild | Compare against the fingerprints recorded in section 5.5. OpenSSH: `ssh-keygen -R <private-ip>` (or `ssh-keygen -R "[localhost]:2222"` for the EICE-tunnel path). PuTTY/WinSCP: accept the "update/replace key" prompt. Tera Term: edit its `ssh_known_hosts` file. If the bastion was NOT rebuilt, stop and investigate before accepting |
| WinSCP rejects the key file | Key is OpenSSH format | Accept WinSCP's auto-convert offer, or convert with PuTTYgen (Conversions → Import key → Save private key) |
| Tera Term: key file greyed out / not accepted | Wrong auth option selected | Select the "RSA/DSA/ECDSA/ED25519 key to log in" option before browsing for the key |
| `TargetNotConnected` when starting a console session | SSM Agent offline — direct SSH is unaffected | Use direct SSH (section 6) to get in and repair the agent (section 8.4) |
| `open-tunnel` fails with `AccessDeniedException` despite IAM allow | IAM `maxTunnelDuration` condition set, flag not passed | Add `--max-tunnel-duration <seconds>` matching the policy |
| SSH worked last quarter, fails now | Key rotated/removed, user deleted, SG rule removed, sshd config drift | Re-run section 9 checklist; re-provision via section 5 while Session Manager still works |

## 12. Method summary

| Method | Depends on SSM Agent | Needs VPN / private network | Inbound SG rule needed | Use when |
|---|---|---|---|---|
| Console Session Manager (browser) | Yes | No | No | Normal operations, and all section-5 prep |
| Direct SSH to private IP (OpenSSH / PuTTY / WinSCP / Tera Term) | **No** | Yes | Yes — TCP 22 from VPN/private CIDR | SSM down; daily SSH/SFTP work over the VPN |
| EC2 Instance Connect Endpoint | **No** | No — internet + IAM only | Yes — TCP 22 from endpoint SG | Off the VPN, or VPN down |
| Stop + user data / EC2Rescue | No | No | No | Instance-level failure; involves downtime |
