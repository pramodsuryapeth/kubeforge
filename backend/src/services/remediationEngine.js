const sshClient = require('./sshClient');
const { getCredential } = require('./cryptoVault');

/**
 * Executes every command in diagnosis.remediation_plan, in order, over a
 * real SSH session to the affected VM. Steps with no `command` (e.g.
 * "manual_review" — resize the VM, choose a different CIDR) are recorded
 * but not executed, since there's nothing to run.
 *
 * Returns one executionLog-shaped entry per command actually run, each
 * carrying its own rollback command (from the knowledge base) so Rollback
 * can later undo exactly what happened here, in reverse order.
 */
async function applyRemediation(issue, diagnosis, project) {
  const vm = project.vms.find((v) => v.name === issue.vmName);
  if (!vm) throw new Error(`VM "${issue.vmName}" not found on this project`);

  const credential = await getCredential(vm.credentialRef);
  if (!credential) throw new Error(`No credential registered for "${vm.credentialRef}"`);

  const entries = [];
  const steps = (diagnosis.remediation_plan || []).filter((s) => s.command);

  if (steps.length === 0) {
    // Nothing executable (e.g. "resize this VM" / "pick a different CIDR") —
    // surface it as a no-op entry so it's still visible in the activity log.
    return [{
      vmName: vm.name,
      issueKey: issue.key,
      description: issue.description,
      command: null,
      rollbackCommand: null,
      stdout: '',
      stderr: '',
      exitCode: null,
      success: false,
      requiresManualAction: true,
      note: (diagnosis.remediation_plan || []).map((s) => s.description).join('; ') || 'No automated fix available',
      stage: 'remediation',
      appliedAt: new Date().toISOString(),
    }];
  }

  await sshClient.withConnection(vm, credential, async (conn) => {
    for (const step of steps) {
      // eslint-disable-next-line no-await-in-loop
      const result = await sshClient.exec(conn, step.command, {
        sudo: true,
        password: credential.authType === 'password' ? credential.secret : null,
      });
      entries.push({
        vmName: vm.name,
        issueKey: issue.key,
        description: step.description,
        command: step.command,
        rollbackCommand: step.rollback || null,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        success: result.code === 0,
        stage: 'remediation',
        appliedAt: new Date().toISOString(),
      });
    }
  });

  return entries;
}

module.exports = { applyRemediation };
