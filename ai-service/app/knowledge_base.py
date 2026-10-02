"""
Local knowledge base of Kubernetes/Linux node-readiness and execution
issues. Each entry: symptoms (keywords), root cause, a remediation plan
(each step optionally carrying a `rollback` command the backend uses for
Rollback), and a baseline risk level.

Add new entries here to extend what KubeForge AI can diagnose — nothing
else in the service needs to change.
"""

KNOWLEDGE_BASE = [
    {
        "id": "swap-enabled",
        "title": "Swap is enabled",
        "keywords": ["swap", "swapon", "swapoff", "free -h", "Swap:", "kubelet fails swap"],
        "root_cause": "Kubernetes requires swap to be disabled on every node. With swap active the kubelet either refuses to start (on newer versions) or the scheduler's memory accounting becomes unreliable.",
        "remediation": [
            {"action": "disable_swap", "description": "Disable swap for the running session", "command": "swapoff -a", "rollback": "swapon -a"},
            {"action": "persist_swap_disable", "description": "Comment out swap entries in fstab so it stays disabled after reboot", "command": "sed -i '/ swap / s/^/#/' /etc/fstab", "rollback": "sed -i 's/^#\\\\(.*[[:space:]]swap[[:space:]].*\\\\)/\\\\1/' /etc/fstab"},
        ],
        "risk_level": "low",
    },
  {
    "id": "kubernetes-api-x509-unknown-authority",
    "title": "Kubernetes API certificate signed by unknown authority",
    "keywords": [
        "x509",
        "certificate signed by unknown authority",
        "failed to download openapi",
        "unknown authority",
        "crypto/rsa: verification error",
        "6443",
        "kubectl apply",
        "kubernetes"
    ],
    "root_cause": "kubectl cannot verify the Kubernetes API server certificate because the kubeconfig being used does not contain or trust the correct Kubernetes cluster CA certificate.",
    "remediation": [
        {
            "action": "refresh_kubeconfig",
            "description": "Replace the current user kubeconfig with the kubeadm admin kubeconfig",
            "command": "mkdir -p ~/.kube && sudo cp /etc/kubernetes/admin.conf ~/.kube/config && sudo chown $(id -u):$(id -g) ~/.kube/config && chmod 600 ~/.kube/config",
            "rollback": None
        },
        {
            "action": "set_kubeconfig",
            "description": "Use the refreshed kubeadm kubeconfig",
            "command": "export KUBECONFIG=$HOME/.kube/config",
            "rollback": None
        },
        {
            "action": "verify_kubernetes_api",
            "description": "Verify that kubectl can authenticate to the Kubernetes API server",
            "command": "kubectl get nodes",
            "rollback": None
        }
    ],
    "risk_level": "medium"
},
{
    "id": "apt-cdrom-repository-enabled",
    "title": "APT CD-ROM repository is enabled",
    "keywords": [
        "file:/cdrom",
        "file:///cdrom",
        "cdrom",
        "cdrom jammy Release",
        "The repository 'file:/cdrom",
        "no Release file",
        "apt-get update",
        "apt update",
        "E: The repository"
    ],
    "root_cause": "The Ubuntu VM has an installation CD-ROM repository enabled in its APT sources. During apt-get update, APT tries to access the CD-ROM repository and fails because the installation media is not mounted or the repository does not contain a valid Release file. This blocks package installation during Kubernetes provisioning.",
    "remediation": [
        {
            "action": "disable_cdrom_repository",
            "description": "Disable CD-ROM repository entries, including both deb cdrom: and deb file:///cdrom formats, then refresh the APT package lists.",
            "command": "sed -i -E '/^[[:space:]]*deb([[:space:]]+\\[[^]]*\\])?[[:space:]]*(cdrom:|file:\\/\\/\\/cdrom)/s/^/#/' /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null; apt-get update -qq",
            "rollback": "sed -i -E '/^[[:space:]]*#([[:space:]]*)deb([[:space:]]+\\[[^]]*\\])?[[:space:]]*(cdrom:|file:\\/\\/\\/cdrom)/s/^#//' /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null; apt-get update -qq"
        }
    ],
    "risk_level": "low"
},


    {
        "id": "missing-br-netfilter",
        "title": "br_netfilter kernel module not loaded",
        "keywords": ["br_netfilter", "lsmod", "bridge", "kernel module", "iptables see bridged traffic"],
        "root_cause": "The br_netfilter module lets iptables see bridged traffic, which CNI plugins depend on to enforce NetworkPolicies and route pod traffic correctly. Without it, pod-to-pod networking across the bridge is unreliable.",
        "remediation": [
            {"action": "load_kernel_module", "description": "Load the module immediately", "command": "modprobe br_netfilter", "rollback": None},
            {"action": "persist_kernel_module", "description": "Persist it across reboots", "command": "echo br_netfilter > /etc/modules-load.d/k8s-br-netfilter.conf", "rollback": "rm -f /etc/modules-load.d/k8s-br-netfilter.conf"},
        ],
        "risk_level": "low",
    },
    {
        "id": "missing-overlay-module",
        "title": "overlay kernel module not loaded",
        "keywords": ["overlay", "overlayfs", "lsmod", "containerd storage driver"],
        "root_cause": "containerd's default overlayfs storage driver requires the overlay kernel module. Without it, container image layers fail to mount and containers will not start.",
        "remediation": [
            {"action": "load_kernel_module", "description": "Load the module immediately", "command": "modprobe overlay", "rollback": None},
            {"action": "persist_kernel_module", "description": "Persist it across reboots", "command": "echo overlay > /etc/modules-load.d/k8s-overlay.conf", "rollback": "rm -f /etc/modules-load.d/k8s-overlay.conf"},
        ],
        "risk_level": "low",
    },
    {
        "id": "sysctl-bridge-nf-call-iptables",
        "title": "net.bridge.bridge-nf-call-iptables is not set to 1",
        "keywords": ["sysctl", "bridge-nf-call-iptables", "net.bridge", "iptables rules bridged packets"],
        "root_cause": "This sysctl must be 1 so iptables rules apply to traffic crossing a Linux bridge. Left at 0, Service ClusterIPs and NetworkPolicies silently stop working across nodes.",
        "remediation": [
            {"action": "set_sysctl", "description": "Set and persist the value", "command": "bash -c 'echo net.bridge.bridge-nf-call-iptables=1 > /etc/sysctl.d/99-kubeforge-bridge.conf && sysctl --system'", "rollback": "rm -f /etc/sysctl.d/99-kubeforge-bridge.conf && sysctl --system"},
        ],
        "risk_level": "low",
    },
    {
        "id": "sysctl-ip-forward",
        "title": "net.ipv4.ip_forward is not set to 1",
        "keywords": ["sysctl", "ip_forward", "net.ipv4", "packet forwarding disabled"],
        "root_cause": "IP forwarding must be enabled for a node to route pod traffic between interfaces. With it disabled, cross-node pod communication fails outright.",
        "remediation": [
            {"action": "set_sysctl", "description": "Set and persist the value", "command": "bash -c 'echo net.ipv4.ip_forward=1 > /etc/sysctl.d/99-kubeforge-ipfwd.conf && sysctl --system'", "rollback": "rm -f /etc/sysctl.d/99-kubeforge-ipfwd.conf && sysctl --system"},
        ],
        "risk_level": "low",
    },
    {
        "id": "container-runtime-not-running",
        "title": "Container runtime is not running",
        "keywords": ["containerd", "systemctl status containerd", "inactive", "dead", "container runtime", "unit file containerd.service does not exist", "failed to enable unit"],
        "root_cause": "kubelet talks to the container runtime over the CRI socket. If containerd (or CRI-O/Docker) isn't running, kubelet crash-loops with 'failed to get sandbox image' or similar CRI errors. If the systemd unit doesn't exist at all (not just inactive), the containerd package itself was never installed — starting/enabling it requires installing it first.",
        "remediation": [
            {"action": "install_and_restart_service", "description": "Install containerd if missing, then start and enable it", "command": "(systemctl list-unit-files containerd.service >/dev/null 2>&1 || apt-get update -qq && apt-get install -y -qq containerd) && systemctl enable --now containerd", "rollback": "systemctl disable --now containerd"},
        ],
        "risk_level": "low",
    },
    {
        "id": "dns-resolution-failure",
        "title": "DNS resolution is failing on the host",
        "keywords": ["dns", "could not resolve host", "curl -I", "resolve", "kubernetes.io unreachable"],
        "root_cause": "The node can't resolve external hostnames, which breaks pulling install scripts/binaries during provisioning and, later, any pod that depends on external DNS via the host's resolv.conf.",
        "remediation": [
            {"action": "fix_dns", "description": "Point resolv.conf at a known-good resolver", "command": "bash -c 'echo nameserver 8.8.8.8 > /etc/resolv.conf'", "rollback": None},
        ],
        "risk_level": "medium",
    },
    {
        "id": "existing-k8s-leftovers",
        "title": "Leftover Kubernetes components from a previous install",
        "keywords": ["/etc/kubernetes", "/var/lib/etcd", "leftover", "previous install", "admin.conf", "pki"],
        "root_cause": "Stale manifests, PKI material or etcd data from a prior cluster install conflict with a fresh init — kubeadm/RKE2 will refuse to proceed, or worse, silently join the wrong cluster identity.",
        "remediation": [
            {"action": "wipe_etcd", "description": "Reset any prior kubeadm state", "command": "kubeadm reset -f", "rollback": None},
            {"action": "delete_data", "description": "Remove leftover directories", "command": "rm -rf /etc/kubernetes /var/lib/etcd", "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "time-sync-drift",
        "title": "System clock is not synchronized",
        "keywords": ["timedatectl", "clock", "ntp", "chrony", "synchronized: no", "tls handshake"],
        "root_cause": "Clock drift beyond a few minutes causes TLS certificate validation between kubelets and the API server to fail intermittently, since certs are time-bound.",
        "remediation": [
            {"action": "restart_service", "description": "Enable and sync via chrony", "command": "systemctl enable --now chrony && chronyc makestep", "rollback": None},
        ],
        "risk_level": "low",
    },
    {
        "id": "insufficient-cpu",
        "title": "Node does not meet the minimum CPU requirement",
        "keywords": ["vcpu", "cpu cores", "insufficient cpu", "control plane requires"],
        "root_cause": "Control plane components (etcd, API server, scheduler, controller-manager) are CPU-sensitive; undersized nodes cause slow scheduling, API latency, and etcd timeouts under load.",
        "remediation": [
            {"action": "manual_review", "description": "Resize the VM to meet the minimum vCPU requirement before proceeding — this cannot be fixed by a script", "command": None, "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "insufficient-memory",
        "title": "Node does not meet the minimum memory requirement",
        "keywords": ["ram", "memory", "insufficient memory", "oom", "out of memory"],
        "root_cause": "Low memory nodes are prone to OOM-killed control-plane pods and kubelet itself, causing node NotReady flapping.",
        "remediation": [
            {"action": "manual_review", "description": "Resize the VM to meet the minimum RAM requirement before proceeding — this cannot be fixed by a script", "command": None, "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "disk-space-low",
        "title": "Root filesystem is low on free space",
        "keywords": ["df -h", "disk space", "no space left", "low disk"],
        "root_cause": "kubelet's disk-pressure eviction threshold defaults to 10% free; nodes below that start evicting pods to reclaim space, which looks like random pod churn.",
        "remediation": [
            {"action": "reclaim_disk_space", "description": "Vacuum old journal logs and unused container images", "command": "journalctl --vacuum-size=200M; crictl rmi --prune 2>/dev/null || true", "rollback": None},
        ],
        "risk_level": "low",
    },
    {
        "id": "cidr-conflict",
        "title": "Pod or Service CIDR overlaps the host network",
        "keywords": ["cidr", "overlap", "10.244.0.0/16", "10.96.0.0/12", "network conflict"],
        "root_cause": "If the chosen Pod/Service CIDR overlaps the VMs' existing LAN range, routing becomes ambiguous — traffic meant for a pod can be swallowed by the physical network and vice versa.",
        "remediation": [
            {"action": "manual_review", "description": "Choose a Pod/Service CIDR that does not overlap the host network, then recreate the project", "command": None, "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "ssh-auth-failed",
        "title": "SSH authentication failed",
        "keywords": ["authentication failed", "all configured authentication methods failed", "permission denied publickey", "wrong password"],
        "root_cause": "The username/password or private key registered for this VM's Vault credential was rejected by sshd — either the credential is wrong, the key isn't authorized on the target (not in ~/.ssh/authorized_keys), or the account is locked.",
        "remediation": [
            {"action": "manual_review", "description": "Verify the credential in Vault matches a working login for this VM, then re-check connection", "command": None, "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "ssh-connection-refused-or-timeout",
        "title": "SSH connection refused or timed out",
        "keywords": ["econnrefused", "connect etimedout", "connection timed out", "connection refused", "unreachable"],
        "root_cause": "Either sshd isn't running/listening on port 22, a firewall (host or network) is dropping the connection, the IP address is wrong, or the VM is powered off/unreachable from this backend.",
        "remediation": [
            {"action": "manual_review", "description": "Confirm the VM is powered on, the IP is correct, sshd is running, and nothing between this backend and the VM blocks port 22", "command": None, "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "sudo-permission-denied",
        "title": "sudo permission denied on the remote host",
        "keywords": ["sudo: incorrect password", "is not in the sudoers file", "sudo: a password is required", "permission denied sudo"],
        "root_cause": "The SSH user either isn't in the sudoers group, the password piped to `sudo -S` was wrong, or (for key-based auth) NOPASSWD isn't configured, so sudo is blocking on a password prompt that never arrives.",
        "remediation": [
            {"action": "manual_review", "description": "Grant sudo rights to this user on the VM (visudo / usermod -aG sudo), or configure NOPASSWD for key-based automation, then retry", "command": None, "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "host-key-verification-failed",
        "title": "SSH host key verification failed",
        "keywords": ["host key verification failed", "remote host identification has changed", "known_hosts"],
        "root_cause": "The SSH host key presented by the VM doesn't match what was previously seen — either the VM was rebuilt (benign) or this is a man-in-the-middle scenario (not benign). This should never be silently bypassed.",
        "remediation": [
            {"action": "manual_review", "description": "Manually verify the VM's host key out-of-band before trusting it — do not blindly accept a changed host key", "command": None, "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "kubeadm-join-parse-failure",
        "title": "Could not parse the kubeadm join command from kubeadm init output",
        "keywords": ["kubeadm join", "discovery-token-ca-cert-hash", "parse", "kubeadm init output"],
        "root_cause": "kubeadm init succeeded but its stdout didn't match the expected 'kubeadm join ... --discovery-token-ca-cert-hash sha256:...' pattern — likely a kubeadm version whose output format changed.",
        "remediation": [
            {"action": "manual_review", "description": "Run `kubeadm token create --print-join-command` on the control plane and join workers manually with that output", "command": None, "rollback": None},
        ],
        "risk_level": "high",
    },
    {
        "id": "install-script-download-transient-failure",
        "title": "Install script download failed (transient network blip)",
        "keywords": ["curl:", "failed to connect", "get.rke2.io", "install script", "curl -sfl", "could not resolve host", "operation timed out"],
        "root_cause": "The curl-based install script (RKE2's get.rke2.io, or a similar one-shot installer) failed to download — almost always a brief network blip or DNS hiccup rather than a real configuration problem. Distinct from an SSH-level connection refusal: this is curl failing to reach a package/script host, not sshd rejecting the connection.",
        "remediation": [
            {"action": "retry_after_delay", "description": "Wait a few seconds for the network hiccup to clear, then let the setup retry the same step", "command": "sleep 3", "rollback": None},
        ],
        "risk_level": "low",
    },
    {
        "id": "package-manager-transient-failure",
        "title": "Package manager install failed (transient)",
        "keywords": ["could not get lock", "temporary failure resolving", "failed to fetch", "apt-get", "exit status 100"],
        "root_cause": "apt-get failed — most commonly another process (unattended-upgrades, a concurrent apt run) is holding the dpkg lock, or a package mirror was briefly unreachable. This is usually transient.",
        "remediation": [
            {"action": "retry_package_install", "description": "Wait for any lock to clear and retry the update/install", "command": "while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 2; done; apt-get update -qq", "rollback": None},
        ],
        "risk_level": "low",
    },
]
