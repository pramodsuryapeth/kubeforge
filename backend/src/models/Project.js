const mongoose = require('mongoose');

const VMSchema = new mongoose.Schema({
  name: { type: String, required: true },
  ip: { type: String, required: true },
  credentialRef: { type: String, required: true },
  username: String,
  role: { type: String, enum: ['Control Plane', 'Worker'], required: true },
}, { _id: false });

const ExecutionStateSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: [
      'idle',
      'running',
      'diagnosing',
      'healing',
      'verifying',
      'failed',
      'completed',
    ],
    default: 'idle',
  },

  vm: {
    type: String,
    default: null,
  },

  phase: {
    type: String,
    default: null,
  },

  stepIndex: {
    type: Number,
    default: 0,
  },

  totalSteps: {
    type: Number,
    default: 0,
  },

  currentStep: {
    type: String,
    default: null,
  },

  lastCompletedStep: {
    type: Number,
    default: 0,
  },

  currentCommand: {
    type: String,
    default: null,
  },

  error: {
    code: {
      type: String,
      default: null,
    },
    message: {
      type: String,
      default: null,
    },
  },

  startedAt: {
    type: Date,
    default: null,
  },

  updatedAt: {
    type: Date,
    default: null,
  },
}, { _id: false });

const ProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    environment: { type: String, default: 'On-Premise' },
    tags: { type: [String], default: [] },
    kubernetesVersion: String,

    provisioningMethod: {
      type: String,
      enum: ['RKE2', 'kubeadm', 'Kubespray'],
      required: true,
    },

    cni: String,
    podCidr: String,
    serviceCidr: String,

    aiModel: {
      type: String,
      default: 'KubeForge AI (v1)',
    },

    vms: {
      type: [VMSchema],
      required: true,
    },

    // Opt-in: when true, even RISKY fixes apply automatically (still
    // through the same bounded-retry path, still fully logged) instead
    // of pausing for a human click. Off by default.
    autoApproveRisky: {
      type: Boolean,
      default: false,
    },

    // 'Draft' -> 'Connected' -> 'Discovered' -> 'Setting Up'
    // -> 'Awaiting Approval' -> 'Ready' | 'Failed'
    status: {
      type: String,
      default: 'Draft',
    },

    // Live/derived state
    connection: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    discovery: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    desiredState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    issues: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },

    // Every command actually executed against a VM.
    executionLog: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },

    // --------------------------------------------------
    // Persistent provisioning execution state
    // --------------------------------------------------
    // This is the source of truth for:
    // - current VM
    // - current phase
    // - current step
    // - completed steps
    // - resume after diagnosis/repair
    // - browser refresh
    // --------------------------------------------------
    executionState: {
      type: ExecutionStateSchema,
      default: () => ({}),
    },

    validation: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },

    pendingApproval: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    provisioned: {
      type: Boolean,
      default: false,
    },

    provisionedVMs: {
      type: [String],
      default: [],
    },

    createdBy: {
      type: String,
      default: 'Demo User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

module.exports = mongoose.model('Project', ProjectSchema);