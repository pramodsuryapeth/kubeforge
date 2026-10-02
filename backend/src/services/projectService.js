const { randomUUID } = require('crypto');

const VALID_PROVISIONING_METHODS = ['RKE2', 'kubeadm', 'Kubespray'];
const VALID_CNI = ['Calico', 'Cilium', 'Flannel', 'Weave'];
const VALID_ROLES = ['Control Plane', 'Worker'];
const CIDR_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function validateCIDR(cidr) {
  if (typeof cidr !== 'string' || !CIDR_REGEX.test(cidr)) return false;
  const [, a, b, c, d, prefix] = cidr.match(CIDR_REGEX);
  const octets = [a, b, c, d].map(Number);
  if (octets.some((o) => o > 255)) return false;
  const p = Number(prefix);
  return p >= 0 && p <= 32;
}

function validateProvisioningMethod(method) {
  return VALID_PROVISIONING_METHODS.includes(method);
}

function validateCNI(cni) {
  return VALID_CNI.includes(cni);
}

function validateVMConfig(vms) {
  const errors = [];
  if (!Array.isArray(vms) || vms.length === 0) {
    return ['At least one VM/host is required'];
  }
  vms.forEach((vm, i) => {
    if (!vm.name) errors.push(`VM #${i + 1}: name is required`);
    if (!vm.ip || !IP_REGEX.test(vm.ip)) errors.push(`VM #${i + 1}: a valid IP address is required`);
    if (!vm.credentialRef) errors.push(`VM #${i + 1}: a Vault credential reference is required`);
    if (!vm.role || !VALID_ROLES.includes(vm.role)) errors.push(`VM #${i + 1}: role must be one of ${VALID_ROLES.join(', ')}`);
  });
  return errors;
}

function validateRoles(vms) {
  const errors = [];
  const controlPlaneCount = (vms || []).filter((v) => v.role === 'Control Plane').length;
  if (controlPlaneCount === 0) errors.push('At least one VM must have the Control Plane role');
  return errors;
}

function validateProjectConfig(payload) {
  const errors = [];
  if (!payload.name || !payload.name.trim()) errors.push('Project name is required');
  if (!payload.kubernetesVersion) errors.push('Kubernetes version is required');
  if (!validateProvisioningMethod(payload.provisioningMethod)) {
    errors.push(`Provisioning method must be one of ${VALID_PROVISIONING_METHODS.join(', ')}`);
  }
  if (!validateCNI(payload.cni)) {
    errors.push(`CNI must be one of ${VALID_CNI.join(', ')}`);
  }
  if (!validateCIDR(payload.podCidr)) errors.push('Pod CIDR must be a valid CIDR block (e.g. 10.244.0.0/16)');
  if (!validateCIDR(payload.serviceCidr)) errors.push('Service CIDR must be a valid CIDR block (e.g. 10.96.0.0/12)');
  if (payload.podCidr && payload.serviceCidr && payload.podCidr === payload.serviceCidr) {
    errors.push('Pod CIDR and Service CIDR must not be identical');
  }
  return errors;
}

/**
 * Runs every validation stage from the "PROJECT SERVICE" block of the
 * architecture doc and, if everything passes, builds the stored project.
 * Throws a { status, message, errors } object on failure.
 */
function buildProject(payload) {
  const errors = [
    ...validateProjectConfig(payload),
    ...validateVMConfig(payload.vms),
    ...validateRoles(payload.vms),
  ];

  if (errors.length > 0) {
    const err = new Error('Project configuration failed validation');
    err.status = 400;
    err.errors = errors;
    throw err;
  }

  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    name: payload.name.trim(),
    description: payload.description || '',
    environment: payload.environment || 'On-Premise',
    tags: payload.tags || [],
    kubernetesVersion: payload.kubernetesVersion,
    provisioningMethod: payload.provisioningMethod,
    cni: payload.cni,
    podCidr: payload.podCidr,
    serviceCidr: payload.serviceCidr,
    aiModel: payload.aiModel || 'KubeForge AI (v1)',
    vms: payload.vms.map((vm) => ({
      name: vm.name,
      ip: vm.ip,
      credentialRef: vm.credentialRef,
      username: vm.username || 'cloudhedge',
      role: vm.role,
    })),
    status: 'Draft',
    discovery: {},
    issues: [],
    diagnoses: [],
    remediations: [],
    provisioningLog: [],
    validation: [],
    createdAt: now,
    updatedAt: now,
    createdBy: 'Demo User',
  };
}

module.exports = {
  VALID_PROVISIONING_METHODS,
  VALID_CNI,
  VALID_ROLES,
  validateCIDR,
  validateProvisioningMethod,
  validateCNI,
  validateVMConfig,
  validateRoles,
  validateProjectConfig,
  buildProject,
};
