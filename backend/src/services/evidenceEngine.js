const sshClient = require('./sshClient');
const { getCredential } = require('./cryptoVault');
const { CHECKS } = require('./requirementEngine');

/**
 * Gathers real evidence for one issue by re-running its diagnostic command
 * live over SSH — the same command/stdout/stderr/exit_code shape a human
 * would collect by hand, fed to the AI model as-is.
 */
async function collectEvidence(issue, project) {
  const vm = project.vms.find((v) => v.name === issue.vmName);
  const check = CHECKS.find((c) => c.key === issue.key);
  const command = check ? check.evidenceCommand : 'echo "no diagnostic command registered for this check"';

  if (!vm) {
    return { command, stdout: '', stderr: `VM "${issue.vmName}" not found on this project`, exit_code: 1 };
  }

  try {
    const credential = await getCredential(vm.credentialRef);
    if (!credential) {
      return { command, stdout: '', stderr: `No credential registered for "${vm.credentialRef}"`, exit_code: 1 };
    }
    const result = await sshClient.withConnection(vm, credential, (conn) => sshClient.exec(conn, command));
    return { command, stdout: result.stdout, stderr: result.stderr, exit_code: result.code };
  } catch (err) {
    return { command, stdout: '', stderr: err.message, exit_code: 1 };
  }
}

module.exports = { collectEvidence };
