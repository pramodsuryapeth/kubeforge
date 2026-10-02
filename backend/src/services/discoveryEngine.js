/**
 * READ ONLY. Opens a real SSH session to the VM and runs a fixed battery
 * of inspection commands — no command here writes to the filesystem or
 * changes any state.
 *
 * No firewall command is run or checked here on purpose: KubeForge no
 * longer requires touching host firewall rules to complete a setup.
 */
const sshClient = require('./sshClient');
const { getCredential } = require('./cryptoVault');

const COMMANDS = {
  os: "cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2",
  kernel: 'uname -r',
  arch: 'uname -m',
  cpuCores: 'nproc',
  ramMb: "free -m | awk '/Mem:/ {print $2}'",
  swapMb: "free -m | awk '/Swap:/ {print $2}'",
  diskFreeGb: "df -BG --output=avail / | tail -1 | tr -dc '0-9'",
  brNetfilter: 'lsmod | grep -c br_netfilter',
  overlay: 'lsmod | grep -c overlay',
  sysctlBridge: 'sysctl -n net.bridge.bridge-nf-call-iptables 2>/dev/null',
  sysctlIpForward: 'sysctl -n net.ipv4.ip_forward 2>/dev/null',
  containerRuntime: 'systemctl is-active containerd 2>/dev/null || systemctl is-active docker 2>/dev/null || echo inactive',
  dns: 'curl -sI --max-time 5 https://kubernetes.io >/dev/null 2>&1 && echo ok || echo fail',
  k8sLeftovers: 'test -d /etc/kubernetes && echo yes || echo no',
  timeSynced: 'timedatectl show --property=NTPSynchronized --value 2>/dev/null',
};

/** Runs every discovery command over one SSH session. `onLog`, if given, fires immediately after each command for live streaming — the return value is still the authoritative record. */
async function runDiscovery(vm, onLog) {
  const credential = await getCredential(vm.credentialRef);
  if (!credential) {
    const err = new Error(`No credential registered for "${vm.credentialRef}"`);
    err.code = 'NO_CREDENTIAL';
    throw err;
  }

  const log = [];
  const host = `${vm.name} (${vm.ip})`;

  const data = await sshClient.withConnection(vm, credential, async (conn) => {
    const run = async (cmd) => {
      const result = await sshClient.exec(conn, cmd);
      const entry = { time: new Date().toISOString(), host, command: cmd, output: result.stdout || result.stderr || '(no output)', stage: 'discovery' };
      log.push(entry);
      if (onLog) onLog(entry);
      return result;
    };

    const os = await run(COMMANDS.os);
    const kernel = await run(COMMANDS.kernel);
    const arch = await run(COMMANDS.arch);
    const cpu = await run(COMMANDS.cpuCores);
    const ram = await run(COMMANDS.ramMb);
    const swap = await run(COMMANDS.swapMb);
    const disk = await run(COMMANDS.diskFreeGb);
    const brnf = await run(COMMANDS.brNetfilter);
    const ovl = await run(COMMANDS.overlay);
    const bridge = await run(COMMANDS.sysctlBridge);
    const ipfwd = await run(COMMANDS.sysctlIpForward);
    const runtime = await run(COMMANDS.containerRuntime);
    const dns = await run(COMMANDS.dns);
    const leftovers = await run(COMMANDS.k8sLeftovers);
    const time = await run(COMMANDS.timeSynced);

    return {
      vmName: vm.name,
      ip: vm.ip,
      role: vm.role,
      os: os.stdout || 'Unknown',
      kernel: kernel.stdout,
      arch: arch.stdout,
      cpuCores: parseInt(cpu.stdout, 10) || 0,
      ramGb: Math.round((parseInt(ram.stdout, 10) || 0) / 1024),
      diskFreeGb: parseInt(disk.stdout, 10) || 0,
      swapEnabled: (parseInt(swap.stdout, 10) || 0) > 0,
      kernelModules: {
        br_netfilter: (parseInt(brnf.stdout, 10) || 0) > 0,
        overlay: (parseInt(ovl.stdout, 10) || 0) > 0,
      },
      sysctl: {
        'net.bridge.bridge-nf-call-iptables': parseInt(bridge.stdout, 10) || 0,
        'net.ipv4.ip_forward': parseInt(ipfwd.stdout, 10) || 0,
      },
      containerRuntimeActive: runtime.stdout.trim() === 'active',
      dnsResolves: dns.stdout.trim() === 'ok',
      existingK8sLeftovers: leftovers.stdout.trim() === 'yes',
      timeSynced: time.stdout.trim().toLowerCase() === 'yes',
      connection: 'Connected',
      checkedAt: new Date().toISOString(),
    };
  });

  return { data, log };
}

async function runDiscoveryForProject(project, onLog) {
  const results = {};
  const combinedLog = [];

  for (const vm of project.vms) {
    const host = `${vm.name} (${vm.ip})`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data, log } = await runDiscovery(vm, onLog);
      results[vm.name] = data;
      const doneEntry = { time: new Date().toISOString(), host, command: '[DISCOVERY]', output: 'Host discovery completed successfully', stage: 'discovery' };
      combinedLog.push(...log, doneEntry);
      if (onLog) onLog(doneEntry);
    } catch (err) {
      results[vm.name] = {
        vmName: vm.name, ip: vm.ip, role: vm.role, connection: 'Failed', error: err.message, checkedAt: new Date().toISOString(),
      };
      const failEntry = { time: new Date().toISOString(), host, command: '[DISCOVERY]', output: `Failed: ${err.message}`, stage: 'discovery' };
      combinedLog.push(failEntry);
      if (onLog) onLog(failEntry);
    }
  }

  return { results, log: combinedLog };
}

module.exports = { runDiscovery, runDiscoveryForProject };
