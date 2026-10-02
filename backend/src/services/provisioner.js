/**
 * kubeadm-only provisioning with CNI plugins.
 *
 * Health check returns:
 *   {
 *     status: 'READY' | 'FAILED',
 *     healthy: boolean,
 *     successMessage: string | null,
 *     checks: [ { check, status, detail }, ... ],
 *     failedChecks: [...],
 *     evidence: { ... }
 *   }
 *
 * On success:
 *   - provisionKubeadm() returns the validation object
 *   - provisionCluster() persists it on project.validation
 *     via project.set(..., { strict: false }) + markModified so
 *     Mongoose never coerces the object into an array
 *   - provisionCluster() emits a special onLog event with
 *     status: 'success' and successMessage, so the UI can show it
 *     live during the SSE stream.
 */

const sshClient = require('./sshClient');
const { getCredential } = require('./cryptoVault');
const { validateClusterHealth } = require('./validationEngine');

/* ------------------------------------------------------------------ */
/* DEBUG HELPERS                                                       */
/* ------------------------------------------------------------------ */

function dbg(...args) {
  // eslint-disable-next-line no-console
  console.log('[PROVISION DEBUG]', ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const KUBECONFIG_PREAMBLE =
  'export KUBECONFIG=/etc/kubernetes/admin.conf';

/* ------------------------------------------------------------------ */
/* PROVISION ERROR                                                     */
/* ------------------------------------------------------------------ */

class ProvisionError extends Error {
  constructor(vm, command, result, executionState = null) {
    super(`Command failed on ${vm.name}: ${command}`);
    this.name = 'ProvisionError';
    this.vm = vm;
    this.command = command;
    this.result = result;
    this.executionState = executionState;

    dbg(
      `ProvisionError constructed: vm=${vm?.name} command=${command} ` +
        `code=${result?.code} stderr=${String(result?.stderr || '').slice(0, 200)}`,
    );
  }
}

/* ================================================================== */
/* COMMON PREP                                                         */
/* ================================================================== */

const COMMON_PREP = [
  {
    command: [
      'if swapon --show --noheadings 2>/dev/null | grep -q . ; then',
      '  echo "[CHECK] swap is enabled — disabling";',
      '  swapoff -a;',
      '  echo "[INSTALL] swap disabled";',
      'else',
      '  echo "[SKIP] swap already disabled";',
      'fi',
    ].join('\n'),
    rollback: 'swapon -a',
    description: 'Disable swap (skip if already disabled)',
  },
  {
    command: [
      'if grep -qE "^[^#]*\\sswap\\s" /etc/fstab 2>/dev/null ; then',
      '  echo "[CHECK] uncommented swap line found in /etc/fstab — commenting";',
      '  sed -i "/ swap / s/^/#/" /etc/fstab;',
      '  echo "[INSTALL] fstab swap entry commented";',
      'else',
      '  echo "[SKIP] fstab already has no active swap entry";',
      'fi',
    ].join('\n'),
    rollback: null,
    description: 'Persist swap-disabled across reboots (skip if already done)',
  },
  {
    command: [
      'if lsmod | grep -q "^overlay" ; then',
      '  echo "[SKIP] overlay module already loaded";',
      '  echo "[INFO] overlay $(modinfo -F version overlay 2>/dev/null || echo builtin)";',
      'else',
      '  echo "[CHECK] overlay not loaded — loading";',
      '  modprobe overlay;',
      '  echo "[INSTALL] overlay module loaded";',
      'fi',
      'mkdir -p /etc/modules-load.d',
      'if grep -qxF "overlay" /etc/modules-load.d/99-k8s.conf 2>/dev/null ; then',
      '  echo "[SKIP] overlay already persisted in modules-load.d";',
      'else',
      '  printf "overlay\\n" >> /etc/modules-load.d/99-k8s.conf;',
      '  echo "[INSTALL] overlay persisted in modules-load.d";',
      'fi',
    ].join('\n'),
    rollback: null,
    description: 'Load overlay kernel module (skip if already loaded)',
  },
  {
    command: [
      'if lsmod | grep -q "^br_netfilter" ; then',
      '  echo "[SKIP] br_netfilter module already loaded";',
      'else',
      '  echo "[CHECK] br_netfilter not loaded — loading";',
      '  modprobe br_netfilter;',
      '  echo "[INSTALL] br_netfilter module loaded";',
      'fi',
      'mkdir -p /etc/modules-load.d',
      'if grep -qxF "br_netfilter" /etc/modules-load.d/99-k8s.conf 2>/dev/null ; then',
      '  echo "[SKIP] br_netfilter already persisted in modules-load.d";',
      'else',
      '  printf "br_netfilter\\n" >> /etc/modules-load.d/99-k8s.conf;',
      '  echo "[INSTALL] br_netfilter persisted in modules-load.d";',
      'fi',
    ].join('\n'),
    rollback: null,
    description: 'Load br_netfilter kernel module (skip if already loaded)',
  },
  {
    command: [
      'CURRENT="$(sysctl -n net.ipv4.ip_forward 2>/dev/null || echo 0)"',
      'if [ "$CURRENT" = "1" ] ; then',
      '  echo "[SKIP] net.ipv4.ip_forward already = 1";',
      'else',
      '  echo "[CHECK] net.ipv4.ip_forward=$CURRENT — setting to 1";',
      '  sysctl -w net.ipv4.ip_forward=1;',
      '  echo "[INSTALL] net.ipv4.ip_forward=1 applied";',
      'fi',
      'mkdir -p /etc/sysctl.d',
      'if grep -qE "^net\\.ipv4\\.ip_forward\\s*=\\s*1" /etc/sysctl.d/99-k8s.conf 2>/dev/null ; then',
      '  echo "[SKIP] net.ipv4.ip_forward already persisted";',
      'else',
      '  echo "net.ipv4.ip_forward=1" >> /etc/sysctl.d/99-k8s.conf;',
      '  echo "[INSTALL] net.ipv4.ip_forward persisted in /etc/sysctl.d/99-k8s.conf";',
      'fi',
    ].join('\n'),
    rollback: null,
    description: 'Ensure IPv4 forwarding is enabled (skip if already enabled)',
  },
  {
    command: [
      'CURRENT="$(sysctl -n net.bridge.bridge-nf-call-iptables 2>/dev/null || echo 0)"',
      'if [ "$CURRENT" = "1" ] ; then',
      '  echo "[SKIP] net.bridge.bridge-nf-call-iptables already = 1";',
      'else',
      '  echo "[CHECK] bridge-nf-call-iptables=$CURRENT — setting to 1";',
      '  sysctl -w net.bridge.bridge-nf-call-iptables=1;',
      '  echo "[INSTALL] bridge-nf-call-iptables=1 applied";',
      'fi',
      'mkdir -p /etc/sysctl.d',
      'if grep -qE "^net\\.bridge\\.bridge-nf-call-iptables\\s*=\\s*1" /etc/sysctl.d/99-k8s.conf 2>/dev/null ; then',
      '  echo "[SKIP] bridge-nf-call-iptables already persisted";',
      'else',
      '  echo "net.bridge.bridge-nf-call-iptables=1" >> /etc/sysctl.d/99-k8s.conf;',
      '  echo "[INSTALL] bridge-nf-call-iptables persisted";',
      'fi',
    ].join('\n'),
    rollback: null,
    description:
      'Ensure bridged-traffic iptables visibility (skip if already set)',
  },
];

dbg(`COMMON_PREP loaded — ${COMMON_PREP.length} steps`);

/* ================================================================== */
/* kubeadm SHELL COMMAND CONSTANTS                                     */
/* ================================================================== */

const K8S_REPO_COMMAND = [
  'set -e',
  'wait_for_apt() {',
  '  while fuser /var/lib/apt/lists/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend >/dev/null 2>&1 ; do',
  '    echo "[WAIT] Another APT/DPKG process is running...";',
  '    sleep 3;',
  '  done',
  '}',
  'wait_for_apt',
  'KEYRING=/etc/apt/keyrings/kubernetes-apt-keyring.gpg',
  'LISTFILE=/etc/apt/sources.list.d/kubernetes.list',
  'if [ -f "$KEYRING" ] && [ -f "$LISTFILE" ] ; then',
  '  echo "[SKIP] Kubernetes APT repository already configured";',
  '  echo "[INFO] keyring: $KEYRING";',
  '  echo "[INFO] list file contents:";',
  '  cat "$LISTFILE";',
  'else',
  '  echo "[CHECK] Kubernetes APT repository missing — configuring";',
  '  apt-get update -y',
  '  apt-get install -y apt-transport-https ca-certificates curl gpg',
  '  mkdir -p /etc/apt/keyrings',
  '  if [ ! -f "$KEYRING" ] ; then',
  '    echo "[INSTALL] downloading Kubernetes Release.key"',
  '    curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.30/deb/Release.key \\',
  '      | gpg --batch --yes --dearmor -o "$KEYRING"',
  '    echo "[INSTALL] keyring written to $KEYRING"',
  '  else',
  '    echo "[SKIP] keyring already present"',
  '  fi',
  '  if [ ! -f "$LISTFILE" ] ; then',
  '    echo "[INSTALL] writing $LISTFILE"',
  '    echo "deb [signed-by=$KEYRING] https://pkgs.k8s.io/core:/stable:/v1.30/deb/ /" > "$LISTFILE"',
  '  else',
  '    echo "[SKIP] apt list file already present"',
  '  fi',
  'fi',
  'wait_for_apt',
  'apt-get update -y',
].join('\n');

const K8S_PACKAGE_INSTALL_COMMAND = [
  'set -e',
  'wait_for_apt() {',
  '  while fuser /var/lib/apt/lists/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend >/dev/null 2>&1 ; do',
  '    echo "[WAIT] Another APT/DPKG process is running...";',
  '    sleep 3;',
  '  done',
  '}',
  'PKGS="containerd kubelet kubeadm kubectl"',
  'MISSING=""',
  'for p in $PKGS ; do',
  '  if dpkg -s "$p" >/dev/null 2>&1 ; then',
  '    V="$(dpkg-query -W -f=\'${Version}\' "$p" 2>/dev/null || echo unknown)"',
  '    echo "[INFO] $p already installed (version=$V)"',
  '  else',
  '    echo "[CHECK] $p NOT installed"',
  '    MISSING="$MISSING $p"',
  '  fi',
  'done',
  'if [ -n "$MISSING" ] ; then',
  '  echo "[INSTALL] installing missing packages:$MISSING"',
  '  wait_for_apt',
  '  DEBIAN_FRONTEND=noninteractive apt-get install -y $MISSING',
  'else',
  '  echo "[SKIP] all kubeadm packages already installed"',
  'fi',
  'echo "[CHECK] applying apt-mark hold"',
  'apt-mark hold containerd kubelet kubeadm kubectl >/dev/null',
  'echo "[INFO] final versions:"',
  'for p in $PKGS ; do',
  '  V="$(dpkg-query -W -f=\'${Version}\' "$p" 2>/dev/null || echo not-installed)"',
  '  echo "  $p = $V"',
  'done',
].join('\n');

const CONTAINERD_CONFIG_COMMAND = [
  'set -e',
  'mkdir -p /etc/containerd',
  'NEED_REGEN=0',
  'if [ ! -f /etc/containerd/config.toml ] ; then',
  '  echo "[CHECK] /etc/containerd/config.toml missing — generating";',
  '  NEED_REGEN=1',
  'elif ! grep -qE "^\\s*SystemdCgroup\\s*=\\s*true" /etc/containerd/config.toml ; then',
  '  echo "[CHECK] SystemdCgroup != true — regenerating config.toml";',
  '  NEED_REGEN=1',
  'else',
  '  echo "[SKIP] containerd config.toml already has SystemdCgroup = true";',
  'fi',
  'if [ "$NEED_REGEN" = "1" ] ; then',
  '  containerd config default > /etc/containerd/config.toml',
  '  sed -i "s/SystemdCgroup = false/SystemdCgroup = true/" /etc/containerd/config.toml',
  '  echo "[INSTALL] containerd config.toml written with SystemdCgroup = true"',
  'fi',
  'if systemctl is-enabled --quiet containerd 2>/dev/null ; then',
  '  echo "[SKIP] containerd already enabled"',
  'else',
  '  systemctl enable containerd',
  '  echo "[INSTALL] containerd enabled"',
  'fi',
  'if systemctl is-active --quiet containerd 2>/dev/null && [ "$NEED_REGEN" = "0" ] ; then',
  '  echo "[SKIP] containerd already active"',
  'else',
  '  systemctl restart containerd',
  '  echo "[INSTALL] containerd restarted"',
  'fi',
  'systemctl is-active --quiet containerd && echo "[OK] containerd is active"',
  'if systemctl is-enabled --quiet kubelet 2>/dev/null ; then',
  '  echo "[SKIP] kubelet already enabled"',
  'else',
  '  systemctl enable kubelet',
  '  echo "[INSTALL] kubelet enabled"',
  'fi',
].join('\n');

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

function deriveClusterDNS(serviceCidr) {
  dbg(`deriveClusterDNS ENTER serviceCidr=${serviceCidr}`);
  const base = serviceCidr.split('/')[0];
  const octets = base.split('.').map(Number);
  let n =
    ((octets[0] << 24) |
      (octets[1] << 16) |
      (octets[2] << 8) |
      octets[3]) >>>
    0;
  n = (n + 10) >>> 0;
  const result = [24, 16, 8, 0]
    .map((shift) => (n >>> shift) & 255)
    .join('.');
  dbg(`deriveClusterDNS EXIT result=${result}`);
  return result;
}

function homeDirFor(vm) {
  const home = vm.username === 'root' ? '/root' : `/home/${vm.username}`;
  dbg(`homeDirFor vm=${vm.name} username=${vm.username} home=${home}`);
  return home;
}

async function writeKubeconfigForUser(vm, sourcePath, runOn, stepContext) {
  const home = homeDirFor(vm);
  const stepInfo = stepContext ? stepContext.next() : {};

  dbg(
    `writeKubeconfigForUser ENTER vm=${vm.name} home=${home} step=${
      stepInfo.stepIndex || 'n/a'
    }`,
  );

  if (home === '/root') {
    dbg(`writeKubeconfigForUser: root user — checking /root/.kube/config`);
    await runOn(
      vm,
      [
        'if [ -f /root/.kube/config ] ; then',
        '  echo "[SKIP] root kubeconfig already present";',
        '  echo "[INFO] /root/.kube/config exists ($(wc -l < /root/.kube/config) lines)";',
        'else',
        '  echo "[CHECK] root kubeconfig missing — creating from ' + sourcePath + '";',
        '  mkdir -p /root/.kube',
        '  cp ' + sourcePath + ' /root/.kube/config',
        '  echo "[INSTALL] root kubeconfig created";',
        'fi',
      ].join('\n'),
      {
        description: 'User kubeconfig (root user, no copy needed)',
        phase: 'kubeconfig',
        ...stepInfo,
      },
    );
    dbg(`writeKubeconfigForUser EXIT (root path) vm=${vm.name}`);
    return;
  }

  dbg(
    `writeKubeconfigForUser: non-root user — installing ${home}/.kube/config`,
  );

  await runOn(
    vm,
    [
      'TARGET="' + home + '/.kube/config"',
      'if [ -f "$TARGET" ] && cmp -s "' + sourcePath + '" "$TARGET" ; then',
      '  echo "[SKIP] kubeconfig already present and identical for ' + vm.username + '"',
      'else',
      '  echo "[CHECK] installing kubeconfig for ' + vm.username + '"',
      '  mkdir -p ' + home + '/.kube',
      '  cp ' + sourcePath + ' ' + home + '/.kube/config',
      '  chown -R ' + vm.username + ':' + vm.username + ' ' + home + '/.kube',
      '  echo "[INSTALL] kubeconfig installed for ' + vm.username + '"',
      'fi',
    ].join('\n'),
    {
      description: `Make kubectl work for ${vm.username} from their own home directory`,
      phase: 'kubeconfig',
      ...stepInfo,
    },
  );

  dbg(`writeKubeconfigForUser EXIT vm=${vm.name}`);
}

function getKubeadmCniStepCount(cni) {
  if (cni === 'Calico') return 5;
  if (cni === 'Cilium') return 3;
  if (cni === 'Flannel') return 3;
  return 1;
}

function getProvisionTotalSteps(project, vms) {
  dbg(
    `getProvisionTotalSteps ENTER cni=${project.cni} vms=${vms.length}`,
  );

  const commonSteps = COMMON_PREP.length * vms.length;
  const controlPlanes = vms.filter((v) => v.role === 'Control Plane');
  const workers = vms.filter((v) => v.role === 'Worker');
  const [, ...restCP] = controlPlanes;

  const packageSteps = vms.length * 3;
  const primaryControlPlaneSteps = 4;
  const cniSteps = getKubeadmCniStepCount(project.cni);
  const uploadCertsStep = restCP.length > 0 ? 1 : 0;
  const joinSteps = restCP.length + workers.length;

  const total =
    commonSteps +
    packageSteps +
    primaryControlPlaneSteps +
    cniSteps +
    uploadCertsStep +
    joinSteps;

  dbg(
    `getProvisionTotalSteps result commonSteps=${commonSteps} ` +
      `packageSteps=${packageSteps} primaryCP=${primaryControlPlaneSteps} ` +
      `cniSteps=${cniSteps} uploadCerts=${uploadCertsStep} ` +
      `joinSteps=${joinSteps} total=${total}`,
  );

  return total;
}

async function persistExecutionState(project, state) {
  if (!project) {
    dbg('persistExecutionState: no project — skipping');
    return;
  }
  project.executionState = {
    ...(project.executionState || {}),
    ...state,
    updatedAt: new Date(),
  };
  if (typeof project.save === 'function') {
    dbg(
      `persistExecutionState: saving status=${state.status} stepIndex=${state.stepIndex}/${state.totalSteps} lastCompleted=${state.lastCompletedStep}`,
    );
    await project.save();
  } else {
    dbg('persistExecutionState: project.save() unavailable — state kept in memory');
  }
}

function runOnFactory(
  onLog,
  { project = null, resumeFromStep = 0, totalSteps = 0 } = {},
) {
  dbg(
    `runOnFactory created resumeFromStep=${resumeFromStep} totalSteps=${totalSteps}`,
  );

  return async (
    vm,
    command,
    {
      sudo = true,
      description,
      phase = 'provisioning',
      stepIndex = null,
      totalSteps: commandTotalSteps = null,
    } = {},
  ) => {
    dbg(
      `runOn ENTER vm=${vm.name} phase=${phase} desc=${description || command}`,
    );

    const credential = await getCredential(vm.credentialRef);
    if (!credential) {
      dbg(
        `runOn: no credential for "${vm.credentialRef}" on vm=${vm.name}`,
      );
      throw new ProvisionError(vm, command, {
        stdout: '',
        stderr: `No credential for "${vm.credentialRef}"`,
        code: 1,
      });
    }

    dbg(`runOn: credential acquired for vm=${vm.name}`);

    const commandName = description || command;
    const resolvedStep =
      typeof stepIndex === 'number' ? stepIndex : null;
    const resolvedTotal =
      typeof commandTotalSteps === 'number'
        ? commandTotalSteps
        : totalSteps;

    dbg(`runOn resolvedStep=${resolvedStep}/${resolvedTotal}`);

    if (resolvedStep !== null && resolvedStep <= resumeFromStep) {
      dbg(
        `runOn RESUME-SKIP step ${resolvedStep} <= resumeFromStep ${resumeFromStep} vm=${vm.name}`,
      );

      onLog({
        time: new Date().toISOString(),
        host: vm.name,
        command: commandName,
        output: `[SKIP] Already completed during previous attempt (${resolvedStep}/${resolvedTotal})`,
        status: 'skipped',
        stage: 'provisioning',
        phase,
        stepIndex: resolvedStep,
        totalSteps: resolvedTotal,
      });

      return { stdout: '', stderr: '', code: 0, skipped: true };
    }

    if (project && resolvedStep !== null) {
      dbg(`runOn persist current step ${resolvedStep} on ${vm.name}`);
      await persistExecutionState(project, {
        status: 'running',
        vm: vm.name,
        phase,
        stepIndex: resolvedStep,
        totalSteps: resolvedTotal,
        currentStep: commandName,
        currentCommand: command,
        lastCompletedStep: resumeFromStep,
        error: { code: null, message: null },
        startedAt: project.executionState?.startedAt || new Date(),
      });
    }

    dbg(`runOn emitting [RUNNING] log for vm=${vm.name} step=${resolvedStep}`);

    onLog({
      time: new Date().toISOString(),
      host: vm.name,
      command: commandName,
      output:
        resolvedStep !== null
          ? `[RUNNING] Step ${resolvedStep}/${resolvedTotal} is currently executing...`
          : '[RUNNING] Command is currently executing...',
      status: 'running',
      stage: 'provisioning',
      phase,
      stepIndex: resolvedStep,
      totalSteps: resolvedTotal,
    });

    let result;

    try {
      dbg(`runOn SSH START vm=${vm.name} step=${resolvedStep}`);
      result = await sshClient.withConnection(
        vm,
        credential,
        async (conn) => {
          dbg(`runOn SSH CONNECTED vm=${vm.name}`);
          const execResult = await sshClient.exec(conn, command, {
            sudo,
            password:
              credential.authType === 'password'
                ? credential.secret
                : null,
          });
          dbg(
            `runOn SSH exec DONE vm=${vm.name} code=${execResult?.code}`,
          );
          return execResult;
        },
      );
      dbg(
        `runOn SSH RETURN vm=${vm.name} step=${resolvedStep} code=${result?.code}`,
      );
    } catch (err) {
      dbg(`runOn SSH THREW vm=${vm.name}: ${err.message}`);
      result = { stdout: '', stderr: err.message, code: 1 };
    }

    onLog({
      time: new Date().toISOString(),
      host: vm.name,
      command: commandName,
      output:
        result.code === 0
          ? result.stdout || '[OK]'
          : `[ERROR] ${
              result.stderr || result.stdout || 'command failed'
            }`,
      status: result.code === 0 ? 'completed' : 'failed',
      stage: 'provisioning',
      phase,
      stepIndex: resolvedStep,
      totalSteps: resolvedTotal,
    });

    if (result.code !== 0) {
      dbg(
        `runOn FAILURE vm=${vm.name} step=${resolvedStep} code=${result.code}`,
      );

      if (project && resolvedStep !== null) {
        await persistExecutionState(project, {
          status: 'failed',
          vm: vm.name,
          phase,
          stepIndex: resolvedStep,
          totalSteps: resolvedTotal,
          currentStep: commandName,
          currentCommand: command,
          lastCompletedStep: Math.max(0, resolvedStep - 1),
          error: {
            code: String(result.code),
            message:
              result.stderr ||
              result.stdout ||
              'command failed',
          },
        });
      }

      throw new ProvisionError(
        vm,
        command,
        result,
        project?.executionState || null,
      );
    }

    if (project && resolvedStep !== null) {
      dbg(
        `runOn SUCCESS checkpoint vm=${vm.name} step=${resolvedStep} lastCompletedStep=${resolvedStep}`,
      );
      await persistExecutionState(project, {
        status: 'running',
        vm: vm.name,
        phase,
        stepIndex: resolvedStep,
        totalSteps: resolvedTotal,
        currentStep: commandName,
        currentCommand: command,
        lastCompletedStep: resolvedStep,
        error: { code: null, message: null },
      });
    }

    dbg(`runOn EXIT vm=${vm.name} step=${resolvedStep}`);
    return result;
  };
}

/* ================================================================== */
/* kubeadm CNI INSTALL                                                 */
/* ================================================================== */

function getKubeadmCniDetectionCommand(cni) {
  dbg(`getKubeadmCniDetectionCommand ENTER cni=${cni}`);

  const common = `
    export KUBECONFIG=/etc/kubernetes/admin.conf
    echo "[CNI-CHECK] Checking ${cni}"
    NODE_READY="$(
      kubectl get node \\
        --selector='node-role.kubernetes.io/control-plane' \\
        -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' \\
        2>/dev/null || true
    )"
    CNI_CONFIG_COUNT="$(
      find /etc/cni/net.d \\
        -maxdepth 1 \\
        -type f \\
        2>/dev/null |
      wc -l |
      tr -d ' '
    )"
  `;

  if (cni === 'Calico') {
    return `
      ${common}
      DS_STATUS="$(
        if kubectl -n calico-system get ds calico-node >/dev/null 2>&1 ; then
          kubectl -n calico-system get ds calico-node -o jsonpath='{.status.desiredNumberScheduled} {.status.currentNumberScheduled} {.status.numberReady}'
        elif kubectl -n kube-system get ds calico-node >/dev/null 2>&1 ; then
          kubectl -n kube-system get ds calico-node -o jsonpath='{.status.desiredNumberScheduled} {.status.currentNumberScheduled} {.status.numberReady}'
        else
          echo "0 0 0"
        fi
      )"
    `;
  }

  if (cni === 'Cilium') {
    return `
      ${common}
      DS_STATUS="$(
        kubectl -n kube-system get ds cilium \\
          -o jsonpath='{.status.desiredNumberScheduled} {.status.currentNumberScheduled} {.status.numberReady}' \\
          2>/dev/null || echo "0 0 0"
      )"
    `;
  }

  if (cni === 'Flannel') {
    return `
      ${common}
      DS_STATUS="$(
        kubectl -n kube-flannel get ds kube-flannel-ds \\
          -o jsonpath='{.status.desiredNumberScheduled} {.status.currentNumberScheduled} {.status.numberReady}' \\
          2>/dev/null || echo "0 0 0"
      )"
    `;
  }

  if (cni === 'Weave') {
    return `
      ${common}
      DS_STATUS="$(
        kubectl -n kube-system get ds weave-net \\
          -o jsonpath='{.status.desiredNumberScheduled} {.status.currentNumberScheduled} {.status.numberReady}' \\
          2>/dev/null || echo "0 0 0"
      )"
    `;
  }

  throw new Error(`Unsupported kubeadm CNI: ${cni}`);
}

async function checkExistingKubeadmCNI(project, primaryCP, runOn, stepContext) {
  const { cni } = project;

  dbg(
    `checkExistingKubeadmCNI ENTER primaryCP=${primaryCP.name} cni=${cni}`,
  );

  const detectionCommand = getKubeadmCniDetectionCommand(cni);

  const command = `
    set -u
    ${detectionCommand}
    DESIRED="$(printf '%s\\n' "$DS_STATUS" | awk '{print $1+0}')"
    CURRENT="$(printf '%s\\n' "$DS_STATUS" | awk '{print $2+0}')"
    READY="$(printf '%s\\n' "$DS_STATUS" | awk '{print $3+0}')"
    echo "[CNI-CHECK] CNI=${cni}"
    echo "[CNI-CHECK] desired=$DESIRED current=$CURRENT ready=$READY"
    echo "[CNI-CHECK] configFiles=$CNI_CONFIG_COUNT nodeReady=$NODE_READY"
    if [ "$DESIRED" -gt 0 ] &&
       [ "$DESIRED" = "$CURRENT" ] &&
       [ "$DESIRED" = "$READY" ] &&
       [ "$CNI_CONFIG_COUNT" -gt 0 ] &&
       [ "$NODE_READY" = "True" ]
    then
      echo "[CNI-HEALTHY] ${cni}"
      exit 0
    fi
    echo "[CNI-NOT-READY] ${cni}"
    exit 0
  `;

  dbg(`checkExistingKubeadmCNI: running detection command on ${primaryCP.name}`);

  const result = await runOn(primaryCP, command, {
    description: `Pre-check existing ${cni} CNI`,
    phase: 'kubeadm-cni',
    ...stepContext.next(),
  });

  const output = String(result.stdout || '');
  const healthy = output.includes(`[CNI-HEALTHY] ${cni}`);

  dbg(
    `checkExistingKubeadmCNI EXIT healthy=${healthy} outputPreview=${output.slice(0, 300)}`,
  );

  return healthy;
}

async function installKubeadmCNI(project, primaryCP, runOn, stepContext) {
  const { cni, podCidr } = project;
  const nextStep = () => stepContext.next();

  dbg(`installKubeadmCNI ENTER cni=${cni} podCidr=${podCidr}`);

  if (cni === 'Calico') {
    dbg('installKubeadmCNI: applying Calico operator CRDs');
    await runOn(
      primaryCP,
      'kubectl apply --server-side -f https://raw.githubusercontent.com/projectcalico/calico/v3.31.0/manifests/operator-crds.yaml',
      { description: 'Install/validate Calico operator CRDs', phase: 'kubeadm-cni', ...nextStep() },
    );

    dbg('installKubeadmCNI: applying Calico Tigera operator');
    await runOn(
      primaryCP,
      'kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.31.0/manifests/tigera-operator.yaml',
      { description: 'Install/validate Calico Tigera operator', phase: 'kubeadm-cni', ...nextStep() },
    );

    dbg('installKubeadmCNI: downloading custom-resources.yaml');
    await runOn(
      primaryCP,
      [
        'if [ -f custom-resources.yaml ] ; then',
        '  echo "[SKIP] custom-resources.yaml already present";',
        'else',
        '  curl -fsSLO https://raw.githubusercontent.com/projectcalico/calico/v3.31.0/manifests/custom-resources.yaml',
        'fi',
      ].join('\n'),
      { description: 'Download Calico custom-resources.yaml', phase: 'kubeadm-cni', ...nextStep() },
    );

    dbg(`installKubeadmCNI: setting pod CIDR to ${podCidr}`);
    await runOn(
      primaryCP,
      [
        'if grep -q "' + podCidr + '" custom-resources.yaml ; then',
        '  echo "[SKIP] pod CIDR already set";',
        'else',
        '  sed -i "s#192.168.0.0/16#' + podCidr + '#" custom-resources.yaml',
        'fi',
      ].join('\n'),
      { description: 'Set Calico pod CIDR', phase: 'kubeadm-cni', ...nextStep() },
    );

    dbg('installKubeadmCNI: applying custom-resources.yaml');
    await runOn(
      primaryCP,
      'kubectl apply -f custom-resources.yaml',
      { description: 'Apply/validate Calico custom resources', phase: 'kubeadm-cni', ...nextStep() },
    );
  } else if (cni === 'Cilium') {
    dbg('installKubeadmCNI: downloading Cilium CLI');
    await runOn(
      primaryCP,
      [
        'if command -v cilium >/dev/null 2>&1 ; then',
        '  echo "[SKIP] cilium CLI already installed"',
        'else',
        '  curl -L --fail --remote-name-all https://github.com/cilium/cilium-cli/releases/latest/download/cilium-linux-amd64.tar.gz',
        'fi',
      ].join('\n'),
      { description: 'Download Cilium CLI', phase: 'kubeadm-cni', ...nextStep() },
    );

    dbg('installKubeadmCNI: extracting Cilium CLI');
    await runOn(
      primaryCP,
      [
        'if command -v cilium >/dev/null 2>&1 ; then',
        '  echo "[SKIP] cilium CLI already in PATH"',
        'else',
        '  tar xzvf cilium-linux-amd64.tar.gz -C /usr/local/bin',
        'fi',
      ].join('\n'),
      { description: 'Install Cilium CLI', phase: 'kubeadm-cni', ...nextStep() },
    );

    dbg(`installKubeadmCNI: running cilium install with podCidr=${podCidr}`);
    await runOn(
      primaryCP,
      `cilium install --set ipam.mode=cluster-pool --set ipam.operator.clusterPoolIPv4PodCIDRList="${podCidr}"`,
      { description: 'Install Cilium CNI', phase: 'kubeadm-cni', ...nextStep() },
    );
  } else if (cni === 'Flannel') {
    dbg('installKubeadmCNI: downloading Flannel manifest');
    await runOn(
      primaryCP,
      [
        'if [ -f kube-flannel.yml ] ; then',
        '  echo "[SKIP] kube-flannel.yml already present";',
        'else',
        '  curl -fsSLO https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml',
        'fi',
      ].join('\n'),
      { description: 'Download Flannel manifest', phase: 'kubeadm-cni', ...nextStep() },
    );

    dbg(`installKubeadmCNI: setting Flannel pod CIDR to ${podCidr}`);
    await runOn(
      primaryCP,
      [
        'if grep -q "Network.*' + podCidr + '" kube-flannel.yml ; then',
        '  echo "[SKIP] Flannel pod CIDR already set"',
        'else',
        '  sed -i "s#\\"Network\\": \\"10.244.0.0/16\\"#\\"Network\\": \\"' + podCidr + '\\"#" kube-flannel.yml',
        'fi',
      ].join('\n'),
      { description: 'Set Flannel pod CIDR', phase: 'kubeadm-cni', ...nextStep() },
    );

    dbg('installKubeadmCNI: applying kube-flannel.yml');
    await runOn(
      primaryCP,
      'kubectl apply -f kube-flannel.yml',
      { description: 'Apply Flannel CNI', phase: 'kubeadm-cni', ...nextStep() },
    );
  } else {
    dbg(`installKubeadmCNI: applying Weave CNI (legacy) podCidr=${podCidr}`);
    await runOn(
      primaryCP,
      `kubectl apply -f "https://reweave.azurewebsites.net/k8s/v1.30/net.yaml?env.IPALLOC_RANGE=${podCidr}"`,
      { description: 'Apply Weave CNI', phase: 'kubeadm-cni', ...nextStep() },
    );
  }

  dbg(`installKubeadmCNI EXIT cni=${cni}`);
}

async function validateKubeadmCNIAfterInstall(project, primaryCP, runOn, stepContext) {
  const { cni } = project;

  dbg(
    `validateKubeadmCNIAfterInstall ENTER primaryCP=${primaryCP.name} cni=${cni}`,
  );

  const detectionCommand = getKubeadmCniDetectionCommand(cni);

  const command = `
    set -u
    export KUBECONFIG=/etc/kubernetes/admin.conf
    echo "[CNI-POSTCHECK] Waiting for ${cni}"
    for attempt in $(seq 1 36); do
      ${detectionCommand}
      DESIRED="$(printf '%s\\n' "$DS_STATUS" | awk '{print $1+0}')"
      CURRENT="$(printf '%s\\n' "$DS_STATUS" | awk '{print $2+0}')"
      READY="$(printf '%s\\n' "$DS_STATUS" | awk '{print $3+0}')"
      echo "[CNI-POSTCHECK] attempt=$attempt desired=$DESIRED current=$CURRENT ready=$READY"
      if [ "$DESIRED" -gt 0 ] &&
         [ "$DESIRED" = "$CURRENT" ] &&
         [ "$DESIRED" = "$READY" ] &&
         [ "$CNI_CONFIG_COUNT" -gt 0 ] &&
         [ "$NODE_READY" = "True" ]
      then
        echo "[CNI-HEALTHY] ${cni} is healthy"
        exit 0
      fi
      sleep 5
    done
    echo "[CNI-FAILED] ${cni} did not become healthy"
    exit 1
  `;

  const result = await runOn(primaryCP, command, {
    description: `Post-install validation for ${cni} CNI`,
    phase: 'kubeadm-cni',
    ...stepContext.next(),
  });

  dbg(
    `validateKubeadmCNIAfterInstall EXIT cni=${cni} code=${result?.code}`,
  );

  return result;
}

/* ================================================================== */
/* kubeadm MAIN FLOW                                                   */
/* ================================================================== */

async function provisionKubeadm(project, vms, runOn, stepContext) {
  dbg('provisionKubeadm() ENTER');

  const controlPlanes = vms.filter((v) => v.role === 'Control Plane');
  const workers = vms.filter((v) => v.role === 'Worker');
  const [primaryCP, ...restCP] = controlPlanes;

  if (!primaryCP) {
    dbg('provisionKubeadm: no Control Plane VM found — throwing');
    throw new Error(
      'kubeadm provisioning requires at least one node with role "Control Plane"',
    );
  }

  dbg(
    `provisionKubeadm roles: primary=${primaryCP.name} ` +
      `additionalCP=${restCP.length} workers=${workers.length} totalVMs=${vms.length}`,
  );

  /* ---------- PHASE 1: PACKAGES ON EVERY VM ---------- */
  dbg('provisionKubeadm PHASE 1 (packages) START');
  for (const vm of vms) {
    dbg(`provisionKubeadm PHASE 1 — VM ${vm.name} (${vm.role}) START`);

    dbg(`provisionKubeadm PHASE 1 — configure APT repo on ${vm.name}`);
    await runOn(vm, K8S_REPO_COMMAND, {
      description: 'Configure Kubernetes APT repository (skip if present)',
      phase: 'kubeadm-packages',
      ...stepContext.next(),
    });
    dbg(`provisionKubeadm PHASE 1 — APT repo done on ${vm.name}`);

    dbg(`provisionKubeadm PHASE 1 — install packages on ${vm.name}`);
    await runOn(vm, K8S_PACKAGE_INSTALL_COMMAND, {
      description: 'Install containerd, kubelet, kubeadm, kubectl (skip if present)',
      phase: 'kubeadm-packages',
      ...stepContext.next(),
    });
    dbg(`provisionKubeadm PHASE 1 — packages installed on ${vm.name}`);

    dbg(`provisionKubeadm PHASE 1 — configure containerd on ${vm.name}`);
    await runOn(vm, CONTAINERD_CONFIG_COMMAND, {
      description: 'Configure containerd (skip if already configured)',
      phase: 'kubeadm-packages',
      ...stepContext.next(),
    });
    dbg(`provisionKubeadm PHASE 1 — containerd configured on ${vm.name}`);

    dbg(`provisionKubeadm PHASE 1 — VM ${vm.name} DONE`);
  }
  dbg('provisionKubeadm PHASE 1 (packages) COMPLETE');

  /* ---------- PHASE 2: kubeadm init ---------- */
  dbg(`provisionKubeadm PHASE 2 (kubeadm init) START on ${primaryCP.name}`);

  const initCommand = [
    'if [ -f /etc/kubernetes/admin.conf ] ; then',
    '  echo "[SKIP] kubeadm already initialized"',
    'else',
    `  kubeadm init --pod-network-cidr=${project.podCidr} --service-cidr=${project.serviceCidr}`,
    'fi',
  ].join('\n');

  await runOn(primaryCP, initCommand, {
    description: 'kubeadm init (skip if already initialized)',
    phase: 'kubeadm-init',
    ...stepContext.next(),
  });

  dbg(`provisionKubeadm PHASE 2 DONE on ${primaryCP.name}`);

  /* ---------- PHASE 3: root kubeconfig ---------- */
  dbg(`provisionKubeadm PHASE 3 (root kubeconfig) START`);

  await runOn(
    primaryCP,
    [
      'if [ -f /root/.kube/config ] ; then',
      '  echo "[SKIP] /root/.kube/config already exists"',
      'else',
      '  mkdir -p /root/.kube',
      '  cp /etc/kubernetes/admin.conf /root/.kube/config',
      'fi',
    ].join('\n'),
    {
      description: 'Set up root kubeconfig (skip if present)',
      phase: 'kubeadm-init',
      ...stepContext.next(),
    },
  );

  dbg(`provisionKubeadm PHASE 3 DONE`);

  /* ---------- PHASE 4: user kubeconfig ---------- */
  dbg('provisionKubeadm PHASE 4 (user kubeconfig) START');
  await writeKubeconfigForUser(
    primaryCP,
    '/etc/kubernetes/admin.conf',
    runOn,
    stepContext,
  );
  dbg('provisionKubeadm PHASE 4 DONE');

  /* ---------- PHASE 5: CNI ---------- */
  dbg('provisionKubeadm PHASE 5 (CNI) START');

  dbg('provisionKubeadm PHASE 5 — pre-check existing CNI');
  const existingCni = await checkExistingKubeadmCNI(
    project,
    primaryCP,
    runOn,
    stepContext,
  );
  dbg(`provisionKubeadm PHASE 5 — existingCni=${existingCni}`);

  if (existingCni) {
    dbg(
      `[CNI] ${project.cni} already exists and is healthy — reusing existing CNI`,
    );
    console.log(
      `[CNI] ${project.cni} already exists and is healthy. Reusing existing CNI.`,
    );
  } else {
    dbg(`[CNI] ${project.cni} missing or unhealthy — installing CNI`);
    console.log(
      `[CNI] ${project.cni} missing or unhealthy. Installing CNI.`,
    );
    await installKubeadmCNI(project, primaryCP, runOn, stepContext);
    dbg('provisionKubeadm PHASE 5 — installKubeadmCNI DONE');
  }

  dbg('provisionKubeadm PHASE 5 — post-install validation');
  await validateKubeadmCNIAfterInstall(
    project,
    primaryCP,
    runOn,
    stepContext,
  );
  dbg('provisionKubeadm PHASE 5 (CNI) DONE');

  /* ---------- PHASE 6: join command ---------- */
  dbg('provisionKubeadm PHASE 6 (generate join command) START');

  const joinResult = await runOn(
    primaryCP,
    'kubeadm token create --print-join-command',
    {
      description: 'Generate kubeadm join command',
      phase: 'kubeadm-join',
      ...stepContext.next(),
    },
  );
  const joinCommand = String(joinResult.stdout || '').trim();

  dbg(
    `provisionKubeadm PHASE 6 — joinCommand (first 120 chars)="${joinCommand.slice(0, 120)}"`,
  );

  if (!joinCommand.startsWith('kubeadm join')) {
    dbg('provisionKubeadm PHASE 6 — invalid join command, throwing');
    throw new ProvisionError(
      primaryCP,
      'kubeadm token create --print-join-command',
      {
        stdout: joinResult.stdout,
        stderr: `Unexpected join command output: ${joinCommand.slice(0, 200)}`,
        code: 1,
      },
    );
  }

  dbg('provisionKubeadm PHASE 6 DONE');

  /* ---------- PHASE 7: additional control planes ---------- */
  if (restCP.length > 0) {
    dbg(
      `provisionKubeadm PHASE 7 (additional control planes) START — count=${restCP.length}`,
    );

    dbg('provisionKubeadm PHASE 7 — uploading control-plane certs');
    const certResult = await runOn(
      primaryCP,
      'kubeadm init phase upload-certs --upload-certs',
      {
        description: 'Upload certificates for additional control planes',
        phase: 'kubeadm-join',
        ...stepContext.next(),
      },
    );

    const match = String(certResult.stdout || '').match(/[a-f0-9]{64}/i);
    if (!match) {
      dbg('provisionKubeadm PHASE 7 — certificate key extraction failed');
      throw new ProvisionError(
        primaryCP,
        'kubeadm init phase upload-certs --upload-certs',
        {
          stdout: certResult.stdout,
          stderr: 'Could not extract certificate key',
          code: 1,
        },
      );
    }
    const certificateKey = match[0];

    dbg(
      `provisionKubeadm PHASE 7 — certificateKey acquired (len=${certificateKey.length})`,
    );

    for (const cp of restCP) {
      dbg(`provisionKubeadm PHASE 7 — joining additional CP ${cp.name}`);

      await runOn(
        cp,
        [
          'if [ -f /etc/kubernetes/kubelet.conf ] ; then',
          '  echo "[SKIP] already joined as control plane"',
          'else',
          '  ' + joinCommand + ' --control-plane --certificate-key ' + certificateKey,
          'fi',
        ].join('\n'),
        {
          description: `Join ${cp.name} as additional control plane`,
          phase: 'kubeadm-join',
          ...stepContext.next(),
        },
      );

      dbg(`provisionKubeadm PHASE 7 — ${cp.name} joined`);
    }

    dbg('provisionKubeadm PHASE 7 DONE');
  } else {
    dbg('provisionKubeadm PHASE 7 SKIPPED (no additional control planes)');
  }

  /* ---------- PHASE 8: workers ---------- */
  dbg(
    `provisionKubeadm PHASE 8 (worker joins) START — count=${workers.length}`,
  );

  for (const w of workers) {
    dbg(`provisionKubeadm PHASE 8 — joining worker ${w.name}`);

    await runOn(
      w,
      [
        'if [ -f /etc/kubernetes/kubelet.conf ] ; then',
        '  echo "[SKIP] already joined as worker"',
        'else',
        '  command -v kubeadm >/dev/null 2>&1 || { echo "[FAIL] kubeadm missing"; exit 1; }',
        '  systemctl is-active --quiet containerd || { echo "[FAIL] containerd not active"; exit 1; }',
        '  ' + joinCommand,
        'fi',
      ].join('\n'),
      {
        description: `Join ${w.name} as worker (skip if already joined)`,
        phase: 'kubeadm-join',
        ...stepContext.next(),
      },
    );

    dbg(`provisionKubeadm PHASE 8 — ${w.name} joined`);
  }

  dbg('provisionKubeadm PHASE 8 DONE');

  /* ---------- PHASE 9: validation ---------- */
  dbg('provisionKubeadm PHASE 9 (validation) START');

  const validation = await validateClusterHealth(project, [
    primaryCP,
    ...restCP,
    ...workers,
  ]);

  dbg(
    `provisionKubeadm PHASE 9 — validation result ` +
      `status=${validation?.status} ` +
      `healthy=${validation?.healthy} ` +
      `successMessage="${String(
        validation?.successMessage || '',
      ).slice(0, 200)}"`,
  );

  if (!validation || !validation.healthy) {
    const failed = validation?.failedChecks || [];

    dbg(
      `provisionKubeadm PHASE 9 — validation FAILED — ` +
        `failedChecks=${
          failed.map((f) => f.check).join(', ') || '(none)'
        }`,
    );

    throw new ProvisionError(
      primaryCP,
      'cluster health validation',
      {
        stdout: JSON.stringify(
          failed.length ? failed : validation,
          null,
          2,
        ),
        stderr: `Cluster validation failed: ${
          failed.map((f) => f.check).join(', ') || 'see evidence'
        }`,
        code: 1,
      },
      project.executionState,
    );
  }

  dbg(
    'provisionKubeadm PHASE 9 — CLUSTER HEALTHY — returning validation to caller',
  );

  return validation;
}

/* ------------------------------------------------------------------ */
/* STEP CONTEXT                                                        */
/* ------------------------------------------------------------------ */

function createStepContext(project, vms, resumeFromStep = 0) {
  let currentStep = 0;
  const total = getProvisionTotalSteps(project, vms) + 2;

  dbg(
    `createStepContext totalSteps=${total} resumeFromStep=${resumeFromStep}`,
  );

  return {
    totalSteps: total,
    resumeFromStep,
    next() {
      currentStep += 1;
      const info = { stepIndex: currentStep, totalSteps: total };
      dbg(`stepContext.next stepIndex=${info.stepIndex}/${info.totalSteps}`);
      return info;
    },
    consumeExternalStep() {
      currentStep += 1;
      dbg(
        `stepContext.consumeExternalStep currentStep=${currentStep}/${total}`,
      );
    },
    getCurrentStep() {
      return currentStep;
    },
  };
}

/* ------------------------------------------------------------------ */
/* ENTRY POINT                                                         */
/* ------------------------------------------------------------------ */

async function provisionCluster(
  project,
  { onLog = () => {}, vms = project.vms, resumeFromStep = null } = {},
) {
  dbg('provisionCluster ENTER');

  dbg(
    `provisionCluster provisioningMethod=${project.provisioningMethod} cni=${project.cni}`,
  );

  if (project.provisioningMethod !== 'kubeadm') {
    dbg(
      `provisionCluster: unsupported provisioning method "${project.provisioningMethod}"`,
    );
    throw new Error(
      `Unsupported provisioning method "${project.provisioningMethod}". ` +
        'This provisioning service supports kubeadm only.',
    );
  }

  const savedLastCompleted = Number(
    project.executionState?.lastCompletedStep || 0,
  );

  dbg(
    `provisionCluster savedLastCompleted=${savedLastCompleted} resumeFromStep=${resumeFromStep}`,
  );

  const resolvedResumeFrom =
    typeof resumeFromStep === 'number'
      ? resumeFromStep
      : savedLastCompleted;

  const totalSteps = getProvisionTotalSteps(project, vms);
  dbg(`provisionCluster totalSteps=${totalSteps}`);

  const stepContext = createStepContext(project, vms, resolvedResumeFrom);

  dbg('provisionCluster: stepContext created');

  const runOn = runOnFactory(onLog, {
    project,
    resumeFromStep: resolvedResumeFrom,
    totalSteps,
  });

  dbg('provisionCluster: runOn runner created');

  onLog({
    time: new Date().toISOString(),
    host: 'cluster',
    command: '[PROVISION]',
    output: `Using kubeadm provisioning with CNI: ${project.cni}`,
    status: 'running',
    stage: 'provisioning',
    phase: 'provisioning',
    stepIndex: resolvedResumeFrom,
    totalSteps,
  });

  dbg('provisionCluster: initial onLog emitted');

  await persistExecutionState(project, {
    status: 'running',
    vm: project.executionState?.vm || null,
    phase: project.executionState?.phase || 'provisioning',
    stepIndex: resolvedResumeFrom,
    totalSteps,
    currentStep: project.executionState?.currentStep || null,
    currentCommand: project.executionState?.currentCommand || null,
    lastCompletedStep: resolvedResumeFrom,
    error: { code: null, message: null },
    startedAt: project.executionState?.startedAt || new Date(),
  });

  dbg('provisionCluster: execution state persisted (running)');

  /* COMMON PREP */
  dbg(
    `provisionCluster: COMMON_PREP START — vms=${vms.length} stepsPerVm=${COMMON_PREP.length}`,
  );

  for (const vm of vms) {
    dbg(`provisionCluster: COMMON_PREP — VM ${vm.name} START`);

    for (const step of COMMON_PREP) {
      const stepInfo = stepContext.next();

      dbg(
        `provisionCluster: COMMON_PREP — running "${step.description}" on ${vm.name} ` +
          `(step ${stepInfo.stepIndex}/${stepInfo.totalSteps})`,
      );

      await runOn(vm, step.command, {
        description: step.description,
        phase: 'common-prep',
        ...stepInfo,
      });

      dbg(
        `provisionCluster: COMMON_PREP — "${step.description}" done on ${vm.name} ` +
          `(step ${stepInfo.stepIndex}/${stepInfo.totalSteps})`,
      );
    }

    dbg(`provisionCluster: COMMON_PREP — VM ${vm.name} DONE`);
  }

  dbg('provisionCluster: COMMON_PREP COMPLETE');

  /* KUBEADM — returns validation object */
  dbg('provisionCluster: delegating to provisionKubeadm()');

  const validation = await provisionKubeadm(
    project,
    vms,
    runOn,
    stepContext,
  );

  dbg(
    `provisionCluster: provisionKubeadm returned — ` +
      `status=${validation?.status} healthy=${validation?.healthy}`,
  );

  /* -------------------------------------------------------------- */
  /* PERSIST the validation result on the project                    */
  /* -------------------------------------------------------------- */
  if (project) {
    dbg('provisionCluster: persisting project.validation');

    /*
     * Assign via .set() with strict:false so Mongoose never coerces the
     * object into an array (which happens when the schema declares
     * `validation` as [SomethingSchema]).
     *
     * Also mark the path modified so .save() definitely flushes it.
     */
    if (typeof project.set === 'function') {
      project.set('validation', validation, { strict: false });
      if (typeof project.markModified === 'function') {
        project.markModified('validation');
      }
    } else {
      project.validation = validation;
    }

    dbg(
      `provisionCluster: validation assigned — isArray=${Array.isArray(
        validation,
      )} status=${validation?.status}`,
    );

    if (typeof project.save === 'function') {
      await project.save();
      dbg('provisionCluster: project.validation saved to MongoDB');
    } else {
      dbg(
        'provisionCluster: project.save() unavailable — validation only in memory',
      );
    }
  }

  /* -------------------------------------------------------------- */
  /* EMIT SUCCESS LOG — this is what the UI receives live via SSE    */
  /* -------------------------------------------------------------- */
 if (validation?.healthy) {
  dbg(
    `provisionCluster: emitting [SUCCESS] event with message="${String(
      validation.successMessage || '',
    ).slice(0, 200)}"`,
  );

  // Mark project as successfully provisioned
  project.status = 'Ready';
  project.provisioned = true;

  if (typeof project.save === 'function') {
    await project.save();
  }

  onLog({
    time: new Date().toISOString(),
    host: 'cluster',
    command: '[SUCCESS]',
    output:
      validation.successMessage ||
      'Kubernetes cluster provisioning completed successfully.',
    status: 'success',
    stage: 'success',
    phase: 'completed',
    stepIndex: totalSteps,
    totalSteps,
    successMessage: validation.successMessage,
    validation,
  });

  dbg('provisionCluster: [SUCCESS] event emitted');
}

  dbg('provisionCluster: persisting final execution state (completed)');

  await persistExecutionState(project, {
    status: 'completed',
    vm: null,
    phase: 'completed',
    stepIndex: totalSteps,
    totalSteps,
    currentStep: 'Kubernetes cluster provisioning completed successfully',
    currentCommand: null,
    lastCompletedStep: totalSteps,
    error: { code: null, message: null },
  });

  dbg('provisionCluster: final execution state persisted');

  onLog({
    time: new Date().toISOString(),
    host: 'cluster',
    command: '[PROVISION]',
    output:
      validation?.successMessage ||
      'Kubernetes cluster provisioning completed successfully — all nodes Ready, all pods healthy.',
    status: 'completed',
    stage: 'provisioning',
    phase: 'completed',
    stepIndex: totalSteps,
    totalSteps,
  });

  dbg('provisionCluster: final [PROVISION] onLog emitted');
  dbg('provisionCluster EXIT');

  // Return the validation object too, in case caller wants it
  return validation;
}

/* ------------------------------------------------------------------ */
/* UNINSTALL                                                           */
/* ------------------------------------------------------------------ */

async function uninstallCluster(
  project,
  { onLog = () => {}, vms = project.vms } = {},
) {
  dbg(
    `uninstallCluster ENTER provisioningMethod=${project.provisioningMethod}`,
  );

  if (project.provisioningMethod !== 'kubeadm') {
    dbg(
      `uninstallCluster: unsupported provisioning method "${project.provisioningMethod}"`,
    );
    throw new Error(
      `Unsupported provisioning method "${project.provisioningMethod}". ` +
        'Only kubeadm is supported.',
    );
  }

  const runOn = runOnFactory(onLog);
  const controlPlanes = vms.filter((v) => v.role === 'Control Plane');
  const workers = vms.filter((v) => v.role === 'Worker');

  dbg(
    `uninstallCluster: controlPlanes=${controlPlanes.length} workers=${workers.length}`,
  );

  for (const vm of workers) {
    dbg(`uninstallCluster: resetting worker ${vm.name}`);
    await runOn(
      vm,
      'if [ -f /etc/kubernetes/kubelet.conf ] ; then kubeadm reset -f || true; else echo "[SKIP] already reset"; fi',
      { description: 'Reset kubeadm worker', phase: 'rollback' },
    );
    dbg(`uninstallCluster: worker ${vm.name} reset done`);
  }

  for (const vm of controlPlanes) {
    dbg(`uninstallCluster: resetting control plane ${vm.name}`);
    await runOn(
      vm,
      'if [ -f /etc/kubernetes/admin.conf ] ; then kubeadm reset -f || true; else echo "[SKIP] already reset"; fi',
      { description: 'Reset kubeadm control plane', phase: 'rollback' },
    );

    dbg(`uninstallCluster: removing kubeadm/CNI config on ${vm.name}`);
    await runOn(
      vm,
      'rm -rf /etc/cni/net.d /etc/kubernetes ~/.kube && echo "[OK]"',
      { description: 'Remove kubeadm and CNI configuration', phase: 'rollback' },
    );
    dbg(`uninstallCluster: ${vm.name} cleanup done`);
  }

  onLog({
    time: new Date().toISOString(),
    host: 'cluster',
    command: 'kubeadm reset',
    output: '[OK] kubeadm cluster reset completed',
    status: 'completed',
    stage: 'rollback',
    phase: 'rollback',
  });

  dbg('uninstallCluster EXIT');
}

/* ------------------------------------------------------------------ */
/* CLEANUP BEFORE RETRY                                                */
/* ------------------------------------------------------------------ */

async function cleanupBeforeRetry(
  project,
  onLog,
  vms = project.vms,
  { fullReset = false } = {},
) {
  dbg(`cleanupBeforeRetry ENTER fullReset=${fullReset}`);

  if (!fullReset) {
    dbg('cleanupBeforeRetry: skipping full reset');
    onLog({
      time: new Date().toISOString(),
      host: 'cluster',
      command: '[RETRY] Resume existing provisioning checkpoint',
      output:
        '[SKIP] Full cleanup disabled — provisioning will resume from the saved step.',
      status: 'skipped',
      stage: 'provisioning',
      phase: 'resume',
    });
    dbg('cleanupBeforeRetry EXIT (skip)');
    return;
  }

  if (project.provisioningMethod !== 'kubeadm') {
    dbg('cleanupBeforeRetry: non-kubeadm method — nothing to do');
    return;
  }

  const runOn = runOnFactory(() => {});
  const controlPlanes = vms.filter((v) => v.role === 'Control Plane');

  dbg(
    `cleanupBeforeRetry: resetting ${controlPlanes.length} control plane(s)`,
  );

  for (const vm of controlPlanes) {
    dbg(`cleanupBeforeRetry: kubeadm reset on ${vm.name}`);
    try {
      await runOn(vm, 'kubeadm reset -f || true', {
        description: 'Reset partial kubeadm state before full retry',
        phase: 'full-reset',
      });
      dbg(`cleanupBeforeRetry: ${vm.name} reset OK`);
    } catch (err) {
      dbg(`cleanupBeforeRetry: ${vm.name} reset FAILED — ${err.message}`);
      onLog({
        time: new Date().toISOString(),
        host: vm.name,
        command: 'kubeadm reset -f',
        output: `[WARN] cleanup itself failed: ${err.message}`,
        stage: 'provisioning',
        phase: 'full-reset',
      });
    }
  }

  dbg('cleanupBeforeRetry EXIT');
}

module.exports = {
  provisionCluster,
  uninstallCluster,
  cleanupBeforeRetry,
  provisionKubeadm,
  ProvisionError,
  COMMON_PREP,
  deriveClusterDNS,
  getProvisionTotalSteps,
  writeKubeconfigForUser,
};