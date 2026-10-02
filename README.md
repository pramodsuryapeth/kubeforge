# KubeForge

## Recent changes

- **Real outcome feedback, so the AI actually gets more accurate from
  experience.** This is not a trained model — it's honest about that —
  but every applied fix now reports back to the AI service whether it
  actually worked (`POST /feedback`), and that history biases future
  retrieval: an entry with a proven-poor track record ranks lower than an
  equally-text-matching entry that's actually worked before, and can even
  cause a *different* knowledge base entry to be chosen for the same
  error text once the first guess has failed enough times for real. See
  `ai-service/app/outcomes.py`; view the learned stats at `GET /stats` on
  the AI service.
- **Smarter retry: stops wasting attempts on a fix that's provably
  stuck.** If a retry fails with the *exact same* command and error as
  the previous attempt, that's strong evidence it's not a transient
  problem — so it now escalates for approval right away instead of
  blindly trying the identical thing a 3rd time. A fix whose error
  *changes* between attempts (genuinely transient) still gets its full
  3 tries.
- **Fixed the actual root cause of the containerd loop, not just the
  symptom:** kubeadm provisioning ran `systemctl enable --now containerd`
  *before* the apt-get install step, and that install step never
  actually included `containerd` in its package list — so the unit file
  could never exist yet. Both are fixed (install now includes containerd
  and runs first), and the container-runtime check was removed from
  preflight entirely, for every method, not just RKE2 — it doesn't belong
  as a pre-provisioning gate when provisioning itself is what installs
  the runtime.
- **Fixed a real SSH command-construction bug**, found from a pasted
  error log: sudo-wrapped commands used `JSON.stringify()` to quote
  arguments, which turns real newlines into a literal `\n` two-character
  sequence — valid JSON, but bash's double-quote parsing never converts
  that back into a newline. Any multi-line command (like the cluster
  validation step) came out as one unparseable line and failed with a
  syntax error. Replaced with proper POSIX single-quote shell escaping
  (`shellQuote.js`), reproduced the original failure through a real shell
  first to confirm the diagnosis, then confirmed the fix against every
  command shape actually used in the codebase.
- **The test harness itself was upgraded to close the gap that let that
  bug ship**: the mock SSH layer previously reimplemented command
  handling and never exercised the real sudo-wrapping/escaping logic at
  all. It now applies the *actual* shell-escaping code and runs every
  constructed command through a real `bash -n` syntax check before
  simulating a response — so a future escaping bug would fail the test
  suite immediately instead of only surfacing against a real VM.
- **New opt-in: fully automatic, including higher-risk fixes.** A
  checkbox on Create Project ("Fully automatic — apply higher-risk fixes
  too, without asking") lets a project skip approval even for things
  like wiping leftover Kubernetes data from a prior install. It's off by
  default and scoped per-project — not a global change — because that
  specific action is destructive. Every auto-approved fix is still
  logged and clearly tagged. Note this can't do anything about issues
  that have no command to run in the first place (wrong credentials, a
  VM that's genuinely too small) — those still need you regardless of
  the setting, since there's nothing to automate.
- **`kubectl` now works from your own home directory, not just root's.**
  Every remediation/provisioning command runs wrapped in `sudo`, which
  means `~`/`$HOME` inside those commands was always root's home — so
  kubeconfig only ever landed at `/root/.kube/config`. If you then SSH in
  as yourself and run `kubectl get nodes` from your own home directory,
  it used to fail. Setup now also writes kubeconfig to the actual SSH
  user's home with correct ownership, so it works immediately, no sudo
  or manual `KUBECONFIG` export needed.
- **Re-verified the firewall removal is complete** — grepped the whole
  codebase; nothing adds, checks, or modifies firewall rules anywhere.
- **Provisioning now follows the reference setup guide exactly**, command
  for command: RKE2's `config.yaml` sets `cni:`/`cluster-cidr:`/
  `service-cidr:`/`cluster-dns:` from your actual project config (CNI
  mapped to RKE2's built-in canal/calico/cilium, cluster-dns derived as
  the 10th address in your Service CIDR); kubeadm now generates the join
  command via `kubeadm token create --print-join-command` instead of
  parsing it out of `kubeadm init`'s output — more robust, and it removes
  a limitation called out in this README before; kubeadm's CNI step now
  properly supports all four options (Calico via the Tigera operator,
  Cilium via its CLI, Flannel, and a clearly-marked-legacy Weave path);
  Kubespray now generates the `group_vars/k8s_cluster/k8s-cluster.yml`
  file (network plugin + both CIDRs) alongside the inventory, and runs
  with `-b -v` as specified. Every provisioning run's first log line now
  states the exact method and CNI being used, so it's never ambiguous
  from the activity log which path actually ran.
- **On "my project was set to kubeadm but it provisioned with RKE2":** I
  re-tested the backend's method-selection branch directly and it
  correctly ran kubeadm-specific commands when `provisioningMethod` was
  `"kubeadm"` — and re-read the Create Project form's state handling,
  which also looks correct. I couldn't reproduce a bug in either place
  from here. If it happens again, the project page's subtitle always
  shows the stored method, and now the very first provisioning log line
  states it too — comparing those two tells you immediately whether the
  form failed to capture the selection or something else is going on;
  let me know what they show and I'll dig further from there.
- **Bounded auto-retry before ever asking for approval.** A SAFE fix
  whose command fails is no longer immediately escalated to a human — it
  gets re-diagnosed against the fresh error (which is new information)
  and retried automatically, up to 3 attempts, before pausing. Only a
  genuinely RISKY diagnosis, or a fix that fails 3 times in a row, asks
  for approval (unless the opt-in above is on).
- **Firewall configuration removed from setup.** Nothing in KubeForge
  touches host firewall rules anymore — that check, its knowledge base
  entry, and its discovery command are gone. Setup completes without
  needing any firewall changes.
- **A node that fails Check Connection/Discover no longer blocks the
  whole cluster.** It's excluded from provisioning entirely (visible in
  the Nodes table and logged), as long as at least one Control Plane node
  is still reachable. Cluster validation now checks against the nodes
  that were actually provisioned, not the full VM list.
- **Live streaming logs.** Check Connection, Discover, Start Setup,
  Approve, and Rollback all stream over Server-Sent Events now — you see
  each command as it actually runs, not a static result after a long
  wait.
- **Fixed a real bug:** Check Connection and Discover used to return a
  partial response that replaced the whole project state in the
  frontend, crashing the page (white screen) right after the first
  click. Every action now always resolves to the full project object.

## On "self-modifying code"

You asked for the AI to change its own code when it hits an error. I'm
not building that, and it's worth explaining why plainly rather than
just quietly not doing it: this system already runs real commands with
sudo on real infrastructure. Every one of those commands goes through a
safety gate (SAFE auto-applies, RISKY asks you) precisely because a bad
command failing is loud and contained to one VM. A bad *code* change has
no equivalent review step, it affects every future run for every
project, and if it's subtly wrong it can compound in ways that are much
harder to detect than a shell command exiting non-zero. The outcome
feedback loop above is the responsible version of "gets better from
experience" — it learns from real results without ever touching its own
source. A genuine bug in the code itself should fail loudly with a full
stack trace and get fixed by a human (or by asking me), not get silently
patched by the same system that's already running with elevated access.

A real, self-healing Kubernetes provisioning platform. Give it VMs and
credentials; it checks connectivity, inspects each host over real SSH,
diagnoses anything not cluster-ready with a retrieval-augmented AI model,
fixes what's safe to fix automatically, installs Kubernetes, and validates
the result — pausing to ask you only when a fix is genuinely risky and
you haven't opted out of that, or when an automatic fix has failed
several times in a row with no sign it's transient.

## What this is, plainly

Every SSH connection, every discovery command, every remediation command,
and every `kubeadm`/RKE2 install step in this codebase is **real** — there
is no simulated success/failure anywhere. The backend actually opens SSH
sessions (via `ssh2`) and runs actual commands on your VMs; the AI service
actually retrieves from its knowledge base and returns a real diagnosis;
credentials are actually encrypted (AES-256-GCM) before they touch MongoDB.

The one honest caveat: this was built in a sandboxed environment with no
outbound network access, so none of the SSH/Mongo/Kubernetes code has been
run against a live target. Every piece was written against the standard,
well-documented APIs (`ssh2`, Mongoose, `kubeadm`/RKE2's own documented
output formats) and syntax-checked, but "correct by construction" isn't
the same as "verified against your infrastructure." Test it against a
disposable VM or two before pointing it at anything you care about.

## Architecture

```
frontend/    React + Vite + Tailwind — Dashboard, Create Project, Vault,
             and the simplified 3-step Project page
backend/     Node.js + Express — real SSH engines (connection, discovery,
             evidence, remediation, provisioning, validation), MongoDB
             persistence, AES-256-GCM credential vault, the setup
             orchestrator that ties it all into one automated flow
ai-service/  Python + FastAPI — KubeForge AI: TF-IDF retrieval over a
             20-entry knowledge base + structured synthesis, no external
             AI API required
```

```
frontend (5173) --/api proxy--> backend (5000) --/diagnose--> ai-service (8000)
                                      |
                                 real SSH (ssh2) ---> your VMs
                                      |
                                   MongoDB
```

## Prerequisites

- Node.js 18+, Python 3.10+, a running MongoDB (local `mongod` or Atlas)
- One or more VMs you actually control, reachable over SSH from wherever
  you run the backend
- **Passwordless sudo for the SSH user** (or root login). Remediation and
  provisioning commands run as `sudo -S` with the credential's password
  piped to stdin; if you're using SSH-key auth instead of a password,
  there's nothing to pipe, so that user **must** have `NOPASSWD` sudo
  configured (`visudo` → `youruser ALL=(ALL) NOPASSWD: ALL`, or scope it
  to the specific commands in `backend/src/services/*.js` if you'd rather
  not grant blanket NOPASSWD).
- For **Kubespray** specifically: it's an Ansible project meant to run
  *from a deploy host against an inventory*, not something installed on
  the target VMs. Clone it and install its requirements on the machine
  running this backend:
  ```bash
  git clone https://github.com/kubernetes-sigs/kubespray.git
  cd kubespray && pip install -r requirements.txt
  ```
  Then set `KUBESPRAY_PATH` in `backend/.env` to that checkout's path.

## Running it

### 1. AI service

```bash
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm run generate-key        # paste the output into CREDENTIAL_ENCRYPTION_KEY in .env
# also set MONGODB_URI in .env if it's not a local default mongod
npm install
npm start
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

## Using it

1. **Vault page** — register a real SSH credential for your VMs (a
   username + password, or a username + private key). This is encrypted
   before it's stored; you'll select it by name, not by pasting secrets
   again.
2. **Create Project** — fill in the cluster config and add your VMs by
   name/IP/role, picking the credential you just registered.
3. On the project page, three steps, left to right:
   - **Check Connection** — opens a real SSH session to every VM and
     closes it; confirms reachability and auth before anything else runs.
   - **Discover** — read-only. Runs ~16 real diagnostic commands per VM
     (swap, kernel modules, sysctl, firewall, container runtime, DNS,
     leftovers, clock sync) and records the actual output.
   - **Start Kubernetes Setup** — fully automated from here. It re-checks
     desired state against real state, and for anything wrong: gathers
     fresh evidence live, sends it to KubeForge AI, and either applies
     the fix immediately (low risk) or pauses with an **Approve &
     Continue** card (higher risk — things like firewall changes or
     wiping leftover cluster data always require your click). Once
     clean, it installs Kubernetes for real, and if any install command
     fails, the exact same AI-repair loop kicks in automatically before
     retrying. It finishes by running real `kubectl` checks against the
     new cluster.
4. **Activity Log**, visible on every project, is the literal list of
   commands executed on your VMs — this is also the record **Rollback**
   uses to undo things (each fix carries its own inverse command; a
   provisioned cluster is undone via the real uninstall procedure for
   whichever method you used — `rke2-uninstall.sh`, `kubeadm reset`, or
   Kubespray's `reset.yml`).

## Provisioning methods — how "real" each one is

- **RKE2**: fully scripted per-VM over SSH — install script, token
  retrieval from the primary control plane, join config written to every
  other node. This is the most straightforward of the three (single
  install script, built-in CNI) and the path I'd trust most without
  testing it yourself first.
- **kubeadm**: fully scripted — package install, `kubeadm init` on the
  primary control plane, the join command is parsed out of its output
  with a regex matching the standard `kubeadm join ... --discovery-token-
  ca-cert-hash sha256:...` format, then run on every other node. The CNI
  step applies a pinned Calico/Flannel/Weave manifest; **Cilium has no
  single-manifest install**, so picking kubeadm + Cilium will provision
  the cluster but skip CNI installation — install Cilium yourself
  afterward (`cilium install` via its CLI) or pick a different CNI.
  Multiple control planes are supported for RKE2; kubeadm's HA control-
  plane certificate-sharing flow is not implemented — stick to one
  control-plane node with kubeadm for now.
- **Kubespray**: shells out locally to `ansible-playbook` against a
  generated inventory. Correct in shape, but it's the path most sensitive
  to your specific Kubespray version's expectations — read its docs for
  your target OS before relying on it.

## Known limitations, stated plainly

- **WinRM isn't implemented.** Every VM in this system is assumed to be
  Linux over SSH — matching everything in the original spec. Adding real
  WinRM (NTLM negotiation, SOAP envelopes) is a substantial separate
  effort; the `role`/`credentialRef` fields are there if you want to
  extend `connectionEngine.js` yourself.
- **Cluster-validation failures don't loop back into auto-repair.** If
  the post-install `kubectl` checks fail, the project is marked `Failed`
  with the check details shown — you fix it and re-run Start Setup,
  rather than the AI attempting a cluster-level fix on its own. Pre-
  install issues *do* get the full auto-repair treatment; this is a
  deliberate scope line, not an oversight — a wrong guess about *why* a
  live cluster is unhealthy is a worse failure mode than asking a human.
- **The regex that parses `kubeadm init`'s join command** matches the
  standard, current output format. If your kubeadm version changed that
  format, the AI's knowledge base has an entry for exactly this failure
  and will tell you to run `kubeadm token create --print-join-command`
  yourself.
- Rollback reverses remediations command-by-command and, if a cluster was
  provisioned, runs a full uninstall — it does not surgically undo
  individual provisioning steps (that's not really how real teardown
  works anyway; a clean uninstall is the standard practice).

## Extending the knowledge base

Everything the AI can diagnose lives in `ai-service/app/knowledge_base.py`
as a list of `{ id, title, keywords, root_cause, remediation, risk_level }`
entries, each remediation step optionally carrying a `rollback` command.
Add an entry and the retriever picks it up automatically.
