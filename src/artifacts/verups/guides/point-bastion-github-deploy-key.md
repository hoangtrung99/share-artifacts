# Point Bastion — GitHub Deploy Key Setup (over the Squid Proxy)

## 1. Purpose

This guide sets up a **per-repository deploy key** so the point bastion can `fetch` / `pull` (and optionally `push`) a GitHub repository over SSH, **without** relying on any individual's personal SSH key.

It is self-contained — it walks from generating a brand-new key pair through to a verified `git fetch`. The bastion's outbound network is locked down behind a Squid forward proxy, so the SSH transport is routed through GitHub's port-443 endpoint; that mechanism is explained in depth in the companion guide `point-bastion-git-ssh-via-proxy.md` and is included here as a ready-to-use config line.

Running example throughout: repository `backseat-inc/bs-point-infra`. Substitute your own org/repo where shown.

## 2. Why a deploy key (instead of a personal key)

| | Personal SSH key | Deploy key |
|---|---|---|
| Tied to | an individual GitHub account | a single repository |
| Access scope | every repo that account can see | exactly one repo |
| Default permission | the account's full permissions | **read-only** (write is an opt-in toggle) |
| Survives offboarding | no — breaks when the person leaves / rotates keys | yes — independent of any person |
| Audit | mixed with the person's activity | attributable to the repo's deploy key |

On a shared host like the bastion, a **read-only deploy key** is the least-privilege choice: if it leaks, the blast radius is read access to one repository — no push, no other repos, no personal account.

> **Constraint:** a given public key can be attached as a deploy key to **only one repository** across GitHub. Each repo that needs SSH access from the bastion therefore gets **its own** key pair (see §8).

## 3. Prerequisites

- You can reach the bastion via **AWS Systems Manager → Session Manager** (you land as `ssm-user`, which is where repos live under `/home/ssm-user`).
- The Squid proxy endpoint for your environment. DEV value: **`172.18.21.146:3128`**. Confirm for other environments:

  ```bash
  aws ec2 describe-instances --region ap-northeast-1 \
    --filters "Name=tag:Name,Values=bastion-proxy" "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].[InstanceId,PrivateIpAddress]" --output table
  ```

  The proxy URL is also recorded on the bastion in `/etc/profile.d/squid-proxy.sh`.
- `nc` on the bastion is **OpenBSD netcat** (supports `-X connect -x`), so no extra package is needed for the proxy tunnel.

All on-bastion commands below are run **as `ssm-user`** (the default Session Manager identity). No `sudo` is required.

## 4. Step 1 — Generate the key pair (from scratch, on the bastion)

Name the key after the repo so multiple keys stay distinguishable. Generate it as a passphrase-less Ed25519 key — unattended `git fetch` cannot answer a passphrase prompt, and the private key is protected by file permissions and never leaves the host.

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh

ssh-keygen -t ed25519 -N '' \
  -C 'deploy-bs-point-infra@point-bastion-dev' \
  -f ~/.ssh/deploy_bs-point-infra

chmod 600 ~/.ssh/deploy_bs-point-infra        # private key
chmod 644 ~/.ssh/deploy_bs-point-infra.pub    # public key
```

- `-t ed25519` — modern, small, fast key type.
- `-N ''` — no passphrase (required for unattended git).
- `-C '...'` — a comment identifying the host/purpose; pick something recognisable.
- `-f ~/.ssh/deploy_<repo>` — dedicated filename per repo.

Display the **public** key (this is what you register on GitHub — it is not secret) and record its fingerprint:

```bash
cat ~/.ssh/deploy_bs-point-infra.pub
ssh-keygen -lf ~/.ssh/deploy_bs-point-infra.pub
```

> Never copy or display the private key (`deploy_bs-point-infra` with no `.pub`). It must stay on the bastion, mode `600`, owned by `ssm-user`.

## 5. Step 2 — Register the public key as a Deploy key on GitHub

In the repository on GitHub: **Settings → Deploy keys → Add deploy key**.

- **Title:** something identifying the host, e.g. `point-bastion-dev`.
- **Key:** paste the entire single line from `deploy_bs-point-infra.pub`.
- **Allow write access:** leave **unchecked** for read-only (`fetch` / `pull` / `clone`). Check it **only** if the bastion must `git push` / push tags.

Click **Add key**.

> If you paste the key and GitHub reports it is already in use, that public key is attached to another repo or account — deploy keys are one-repo-only. Generate a fresh key (§4) for this repo.

## 6. Step 3 — Configure SSH to use the key through the proxy

Add a **host alias** dedicated to this repo. The alias pins the exact key (`IdentityFile` + `IdentitiesOnly yes`) and routes SSH to GitHub's port-443 endpoint through the Squid proxy.

```bash
cat >> ~/.ssh/config <<'EOF'

# Deploy-key access to backseat-inc/bs-point-infra over GitHub's 443 endpoint via the Squid proxy
Host bs-point-infra.github.com
    HostName ssh.github.com
    Port 443
    User git
    IdentityFile ~/.ssh/deploy_bs-point-infra
    IdentitiesOnly yes
    ProxyCommand nc -X connect -x 172.18.21.146:3128 %h %p
EOF

chmod 600 ~/.ssh/config
```

Line by line:

- `Host bs-point-infra.github.com` — an **alias** (not a real DNS name). Remotes that target this alias use this block.
- `HostName ssh.github.com` + `Port 443` — connect to GitHub's SSH-over-HTTPS endpoint (direct `:22` is blocked by the egress lockdown).
- `IdentityFile ~/.ssh/deploy_bs-point-infra` + `IdentitiesOnly yes` — use **only** this deploy key, do not offer any other key in `~/.ssh`. Essential when more than one key exists.
- `ProxyCommand nc -X connect -x 172.18.21.146:3128 %h %p` — tunnel the TCP connection through Squid via HTTP `CONNECT`. Replace the IP with your environment's proxy (§3).

## 7. Step 4 — Point the repository at the alias, then verify

For an existing clone, repoint its remote at the alias:

```bash
git -C ~/bs-point-infra remote set-url origin git@bs-point-infra.github.com:backseat-inc/bs-point-infra.git
```

For a fresh clone, use the alias in the URL:

```bash
git clone git@bs-point-infra.github.com:backseat-inc/bs-point-infra.git
```

Verify:

```bash
# Authentication. A DEPLOY KEY prints the repo slug (not a username):
ssh -T -o StrictHostKeyChecking=accept-new git@bs-point-infra.github.com
#   Expected: "Hi backseat-inc/bs-point-infra! You've successfully authenticated, but GitHub does not provide shell access."
#   (ssh -T exits 1 against GitHub even on success — judge by the message.)

# A real fetch:
git -C ~/bs-point-infra fetch -v
```

> The "Hi `<org>/<repo>`!" message (rather than "Hi `<username>`!") confirms the connection authenticated as the **deploy key**, not a personal key.

## 8. Multiple repositories

Repeat the whole flow per repo — each gets its **own** key pair and its **own** host alias:

```bash
# generate
ssh-keygen -t ed25519 -N '' -C 'deploy-<repo>@point-bastion-dev' -f ~/.ssh/deploy_<repo>
# register deploy_<repo>.pub on that repo (Step 2)
# add a host alias block (Step 3) with Host <repo>.github.com + IdentityFile ~/.ssh/deploy_<repo>
# clone/repoint with git@<repo>.github.com:<org>/<repo>.git
```

Because each alias sets `IdentitiesOnly yes`, the keys never collide — every repo authenticates with exactly its own deploy key.

## 9. Rotation & offboarding

- **Rotate a deploy key:** generate a new pair (§4), add the new public key on the repo (§5), update `IdentityFile` in the alias block, verify, then delete the old deploy key on GitHub and `rm ~/.ssh/deploy_<repo>_old*` on the bastion.
- **Retire the personal key:** once deploy-key access is proven, you can make the bastion use deploy keys only — remove the generic `Host github.com` block from `~/.ssh/config` and `rm ~/.ssh/id_ed25519*`. Keep the personal key until the deploy key has worked reliably.
- **Decommission a repo's access:** delete the deploy key on GitHub **and** remove the alias block + `rm ~/.ssh/deploy_<repo>*` on the bastion. Deleting only one side leaves a dangling half.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Permission denied (publickey)` | Public key not registered (or registered on a different repo), or wrong `IdentityFile` | Confirm the deploy key is on the correct repo (§5); confirm the alias points `IdentityFile` at the matching private key |
| `ssh -T` prints "Hi `<username>`!" instead of the repo slug | The connection used a personal key, not the deploy key | Ensure the remote targets the **alias** (`git@<repo>.github.com:...`) and the alias has `IdentitiesOnly yes` |
| `nc: Proxy error: "HTTP/1.1 403 Forbidden"` | SSH pointed at port 22 | The alias must use `HostName ssh.github.com` + `Port 443` — Squid only allows CONNECT to 443 |
| Connection hangs / `connect to host ... port 443` | Wrong proxy IP or proxy unreachable | Re-check the proxy IP (§3); test `nc -z <proxy-ip> 3128` |
| `nc: invalid option -- 'X'` | `nc` is netcat-traditional, not OpenBSD | Install OpenBSD netcat, or use `corkscrew` / `ncat` in the `ProxyCommand` |
| GitHub rejects the key at registration ("key already in use") | Deploy keys are one-repo-only | Generate a fresh key (§4) for this repo |

## 11. Notes

- **No security posture change.** This rides the path the proxy already permits (CONNECT 443); it needs no security-group edit and opens no new port. Do not re-allow direct `:22` egress.
- **Per user.** Keys and `~/.ssh/config` live in the user's home (here `ssm-user`). Repeat for any other user that runs git on the bastion, or place the alias block in `/etc/ssh/ssh_config.d/` for all users (the key files still need to be readable by each user that uses them).
- **Read-only by default.** Only enable write access on the deploy key if the bastion genuinely needs to push.
