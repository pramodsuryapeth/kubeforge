const sshClient = require('./sshClient');
const { getCredential } = require('./cryptoVault');

/** Opens (and immediately closes) a real SSH session to confirm reachability + auth. */
async function checkConnection(vm, onLog) {
  const checkedAt = new Date().toISOString();
  const host = `${vm.name} (${vm.ip})`;
  const credential = await getCredential(vm.credentialRef);

  if (!credential) {
    const entry = { vmName: vm.name, ip: vm.ip, result: 'Failed', reason: `No credential registered for "${vm.credentialRef}" — add it on the Vault page`, checkedAt };
    if (onLog) onLog({ time: checkedAt, host, command: 'SSH connection test', output: `[ERROR] ${entry.reason}`, stage: 'connection' });
    return entry;
  }

  try {
    const conn = await sshClient.connect(vm, credential);
    conn.end();
    if (onLog) onLog({ time: checkedAt, host, command: 'SSH connection test', output: '[OK] Connected', stage: 'connection' });
    return { vmName: vm.name, ip: vm.ip, result: 'Connected', authType: credential.authType, checkedAt };
  } catch (err) {
    if (onLog) onLog({ time: checkedAt, host, command: 'SSH connection test', output: `[ERROR] ${err.message}`, stage: 'connection' });
    return { vmName: vm.name, ip: vm.ip, result: 'Failed', reason: err.message, checkedAt };
  }
}

async function checkConnectionForProject(project, onLog) {
  const results = {};
  for (const vm of project.vms) {
    // eslint-disable-next-line no-await-in-loop
    results[vm.name] = await checkConnection(vm, onLog);
  }
  return results;
}

module.exports = { checkConnection, checkConnectionForProject };
