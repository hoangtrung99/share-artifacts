# Point Bastion — Git over SSH through the Squid Proxy

## 1. Purpose

The point bastion's outbound network is locked down behind a Squid forward proxy. After that lockdown, **`git fetch` / `git pull` / `git clone` over SSH stopped working** (`git@github.com:...` remotes hang or fail), while HTTPS access keeps working. This guide explains why, and gives the one-time per-user configuration that makes git-over-SSH work again **without weakening the egress posture** — by routing SSH through GitHub's port-443 endpoint via the proxy.

This is a companion to the bastion SSH access guide (`point-bastion-ssh-access-guide.md`); that one covers operator login *to* the bastion, this one covers the bastion reaching *GitHub*.

## 2. Why git-over-SSH breaks behind the proxy

The bastion has no direct route to the internet. All outbound internet traffic must go through the Squid proxy host (`bastion-proxy`) on TCP 3128, and Squid only permits a narrow set of destinations:

- **Bastion security group egress** allows only internal data ports (Aurora, Redis, Redshift) plus TCP 3128 to the proxy security group. The previous broad `0.0.0.0/0` egress rule was removed. → The bastion cannot open a direct TCP connection to `github.com:22`.
- **Squid egress / CONNECT policy** allows only ports **80, 443 and 53**. A `CONNECT github.com:22` is rejected with `HTTP/1.1 403 Forbidden`.

Plain SSH uses `github.com:22`. Both layers block it, so git-over-SSH fails. Note that the `http_proxy` / `https_proxy` environment variables (set in `/etc/profile.d/squid-proxy.sh`) do **not** help SSH — SSH ignores those variables; only HTTP/HTTPS clients honour them. That is why HTTPS git still works while SSH git does not.

The fix uses the fact that **GitHub also serves SSH on port 443** at `ssh.github.com`, and Squid *does* allow `CONNECT` to 443. So we tunnel SSH to `ssh.github.com:443` through the proxy.

## 3. Architecture facts (verified)

| Fact | Value |
|---|---|
| Bastion internet path | only via Squid proxy on TCP 3128 |
| Squid proxy endpoint (DEV) | `172.18.21.146:3128` (instance `bastion-proxy`) |
| Squid allowed CONNECT ports | 80, 443, 53 — **not 22** (`CONNECT :22` → `403 Forbidden`) |
| Direct `github.com:22` from bastion | blocked (no egress rule) |
| `CONNECT ssh.github.com:443` through Squid | works (returns GitHub SSH banner) |
| Proxy helper available | `nc` is **OpenBSD netcat** (supports `-X connect -x`) — no extra install needed |

> The proxy IP above is the DEV value. Confirm the proxy host for the environment you are on before configuring:
>
> ```bash
> # find the proxy instance and its private IP
> aws ec2 describe-instances --region ap-northeast-1 \
>   --filters "Name=tag:Name,Values=bastion-proxy" "Name=instance-state-name,Values=running" \
>   --query "Reservations[].Instances[].[InstanceId,PrivateIpAddress]" --output table
> ```
>
> The proxy URL is also recorded on the bastion in `/etc/profile.d/squid-proxy.sh` (`http_proxy` / `https_proxy`).

## 4. One-time setup (per user on the bastion)

Do this as the user that runs git (the examples use `ssm-user`, where repos are cloned). It only adds a client-side SSH config block — it changes **no system config and restarts no service**.

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh

# back up any existing config first
[ -f ~/.ssh/config ] && cp -p ~/.ssh/config ~/.ssh/config.bak.$(date +%Y%m%d-%H%M%S)

cat >> ~/.ssh/config <<'EOF'

# git over GitHub's 443 endpoint, tunneled through the Squid proxy
# (direct :22 is blocked by the egress lockdown; Squid allows CONNECT 443)
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    ProxyCommand nc -X connect -x 172.18.21.146:3128 %h %p
EOF

chmod 600 ~/.ssh/config
```

What each line does:

- `HostName ssh.github.com` + `Port 443` — talk to GitHub's SSH-over-HTTPS endpoint instead of `github.com:22`.
- `ProxyCommand nc -X connect -x 172.18.21.146:3128 %h %p` — open the TCP connection through Squid using an HTTP `CONNECT` tunnel. `%h`/`%p` expand to `ssh.github.com`/`443`.
- Because the block matches `Host github.com`, **existing `git@github.com:...` remotes keep working unchanged** — no need to edit any remote URL.

Replace `172.18.21.146` with the proxy IP for your environment (see §3).

## 5. Verify

```bash
# 1) Authentication + transport end to end
ssh -T git@github.com
# Expected: "Hi <account>! You've successfully authenticated, but GitHub does not provide shell access."
# (ssh -T always exits 1 against GitHub even on success — judge by the message, not the exit code.)

# 2) A real fetch
git -C ~/bs-point-infra fetch -v
# Expected: branches listed as "[up to date]" / updated, exit code 0.
```

If both pass, git pull/fetch/clone over SSH now work through the proxy.

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Permission denied (publickey)` on `ssh -T` | The SSH key in `~/.ssh` is not registered with a GitHub identity that can read the repo | Register the public key (`~/.ssh/id_ed25519.pub`) on a GitHub account with repo access, or add it as a **Deploy key** on the repository |
| `ssh: connect to host ssh.github.com port 443: ...` / hangs | Proxy IP wrong, or proxy unreachable | Re-check the proxy IP (§3); test `nc -z 172.18.21.146 3128` |
| `nc: Proxy error: "HTTP/1.1 403 Forbidden"` | You pointed SSH at port 22 instead of 443 | Ensure `HostName ssh.github.com` and `Port 443` are set — Squid only allows CONNECT to 443 |
| `nc: invalid option -- 'X'` | `nc` is netcat-traditional, not OpenBSD | Install OpenBSD netcat, or use `corkscrew`/`ncat` in the `ProxyCommand` instead |
| Host key prompt on first connect | First time reaching `ssh.github.com` | Accept it once (or pre-seed with `-o StrictHostKeyChecking=accept-new`) — it is GitHub's normal host key |

## 7. Notes

- **No security posture change.** This rides the path the proxy already permits (CONNECT 443). It needs **no security-group edit** and opens no new port — unlike re-allowing direct `:22` egress, which should be avoided.
- **HTTPS alternative.** Because `https_proxy` is already configured, switching a remote to HTTPS (`https://github.com/<org>/<repo>.git`) also works through the proxy. The trade-off is that a **private** repo then needs an HTTPS credential (personal access token / deploy token) instead of the existing SSH key, so for key-based workflows the SSH-over-443 method above is less disruptive.
- **Per user, not system-wide.** The block lives in each user's `~/.ssh/config`. Repeat it for any other user that needs git on the bastion. To make it system-wide instead, an admin can place the same `Host github.com` block in `/etc/ssh/ssh_config.d/`.
