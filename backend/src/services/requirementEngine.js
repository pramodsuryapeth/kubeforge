/**
 * Single source of truth for what a node must look like before it can join
 * the cluster. `isIssue` reads the real discovery object for that VM;
 * `evidenceCommand` is the real command evidenceEngine re-runs live over
 * SSH to get fresh evidence when a check fails.
 */
const CHECKS = [
  {
    key: 'swap-enabled',
    label: 'Swap disabled',
    severity: 'medium',
    isIssue: (d) => d.swapEnabled === true,
    evidenceCommand: 'free -h',
  },
  {
    key: 'missing-br-netfilter',
    label: 'br_netfilter kernel module loaded',
    severity: 'high',
    isIssue: (d) => !d.kernelModules.br_netfilter,
    evidenceCommand: 'lsmod | grep br_netfilter',
  },
  {
    key: 'missing-overlay-module',
    label: 'overlay kernel module loaded',
    severity: 'high',
    isIssue: (d) => !d.kernelModules.overlay,
    evidenceCommand: 'lsmod | grep overlay',
  },
  {
    key: 'sysctl-bridge-nf-call-iptables',
    label: 'net.bridge.bridge-nf-call-iptables = 1',
    severity: 'high',
    isIssue: (d) => d.sysctl['net.bridge.bridge-nf-call-iptables'] !== 1,
    evidenceCommand: 'sysctl net.bridge.bridge-nf-call-iptables',
  },
  {
    key: 'sysctl-ip-forward',
    label: 'net.ipv4.ip_forward = 1',
    severity: 'high',
    isIssue: (d) => d.sysctl['net.ipv4.ip_forward'] !== 1,
    evidenceCommand: 'sysctl net.ipv4.ip_forward',
  },
  {
    key: 'dns-resolution-failure',
    label: 'DNS resolution working',
    severity: 'medium',
    isIssue: (d) => !d.dnsResolves,
    evidenceCommand: 'curl -I https://kubernetes.io',
  },
  {
    key: 'existing-k8s-leftovers',
    label: 'No leftover Kubernetes components',
    severity: 'high',
    isIssue: (d) => d.existingK8sLeftovers === true,
    evidenceCommand: 'ls -la /etc/kubernetes/ /var/lib/etcd 2>&1',
  },
  {
    key: 'time-sync-drift',
    label: 'System clock synced (NTP)',
    severity: 'medium',
    isIssue: (d) => !d.timeSynced,
    evidenceCommand: 'timedatectl status',
  },
];

function buildDesiredState(project) {
  const hasControlPlane = project.vms.some((v) => v.role === 'Control Plane');
  return {
    checks: CHECKS.map((c) => c.key),
    minCpuCores: hasControlPlane ? 2 : 1,
    minRamGb: 2,
    kubernetesVersion: project.kubernetesVersion,
    provisioningMethod: project.provisioningMethod,
    cni: project.cni,
  };
}

module.exports = { CHECKS, buildDesiredState };
