const { CHECKS } = require('./requirementEngine');

/**
 * CURRENT STATE vs DESIRED STATE -> DIFF.
 * Returns a flat list of issues; an empty list means READY, otherwise the
 * project should route through the Evidence -> AI -> Safety -> Remediation
 * loop before provisioning is allowed.
 */
function generateDiff(discoveryByVm, desiredState) {
  const issues = [];

  for (const [vmName, d] of Object.entries(discoveryByVm)) {
    if (d.connection === 'Failed') {
      // Unreachable VMs are excluded from the cluster upstream (see
      // setupOrchestrator's getUsableVMs) rather than being treated as a
      // fixable issue — skip it here defensively so isIssue() never runs
      // against a discovery record that's missing most of its fields.
      continue; // eslint-disable-line no-continue
    }

    for (const check of CHECKS) {
      if (check.isIssue(d, desiredState)) {
        issues.push({
          vmName,
          key: check.key,
          label: check.label,
          description: `${check.label} — check failed on ${vmName} (${d.ip})`,
          severity: check.severity,
        });
      }
    }

    if (d.cpuCores < desiredState.minCpuCores) {
      issues.push({
        vmName,
        key: 'insufficient-cpu',
        label: 'Minimum CPU met',
        description: `${vmName} has ${d.cpuCores} vCPU, but ${desiredState.minCpuCores}+ are required for a ${d.role} node`,
        severity: 'high',
      });
    }
    if (d.ramGb < desiredState.minRamGb) {
      issues.push({
        vmName,
        key: 'insufficient-memory',
        label: 'Minimum RAM met',
        description: `${vmName} has ${d.ramGb}GB RAM, but ${desiredState.minRamGb}GB+ is required`,
        severity: 'high',
      });
    }
  }

  return issues;
}

module.exports = { generateDiff };
