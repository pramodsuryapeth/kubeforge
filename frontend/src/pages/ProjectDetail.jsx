import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  X,
  Loader2,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Sparkles,
  Radio,
  Terminal,
} from 'lucide-react';

import { api, streamAction } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

const th = 'px-3 py-2 text-left font-medium text-gray-500';
const td = 'px-3 py-2 text-gray-600';

export default function ProjectDetail() {
  const { id } = useParams();

  const [project, setProject] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [liveLog, setLiveLog] = useState([]);
  const [executionState, setExecutionState] = useState(null);
  const [selectedVm, setSelectedVm] = useState('ALL');
  const [logOpen, setLogOpen] = useState(false);

  const esRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const loadedProject = await api.getProject(id);
      setProject(loadedProject);
      setExecutionState(loadedProject.executionState || null);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  function runStream(action, path) {
    esRef.current?.close();

    setBusy(action);
    setError('');
    setLiveLog([]);
    setLogOpen(true); // auto-open the footer log when an action starts

    esRef.current = streamAction(id, path, {
      onLog: (entry) => {
        setLiveLog((prev) => [...prev, entry]);
      },
      onExecutionState: (state) => {
        setExecutionState(state);
        setProject((prev) =>
          prev ? { ...prev, executionState: state } : prev
        );
      },
      onStatus: (status) => {
        setProject((prev) => (prev ? { ...prev, status } : prev));
      },
      onDone: (updatedProject) => {
        setProject(updatedProject);
        setExecutionState(updatedProject.executionState || null);
        setLiveLog([]);
        setBusy('');
      },
      onError: (message) => {
        setError(message);
        setBusy('');
      },
    });
  }

  if (!project) {
    return (
      <div className="min-h-screen w-full bg-gray-50 px-6 py-8 lg:px-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        >
          <ArrowLeft size={14} />
          Projects
        </Link>

        {error ? (
          <div className="mt-4 max-w-2xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="mt-4 text-sm text-gray-400">Loading project…</div>
        )}
      </div>
    );
  }

  const hasConnection = Object.keys(project.connection || {}).length > 0;
  const hasDiscovery = Object.keys(project.discovery || {}).length > 0;
  const awaitingApproval = project.status === 'Awaiting Approval';

  const controlPlanes = project.vms.filter((v) => v.role === 'Control Plane').length;
  const workers = project.vms.filter((v) => v.role === 'Worker').length;

  const anyChanges =
    (project.executionLog || []).some(
      (e) => e.stage === 'remediation' && e.success
    ) || project.provisioned;

  const displayLog = [...(project.executionLog || []), ...liveLog];

  const currentExecutionState =
    executionState || project.executionState || null;

  const executionRunning = [
    'running',
    'diagnosing',
    'healing',
    'verifying',
  ].includes(currentExecutionState?.status);

  const executionFailed = currentExecutionState?.status === 'failed';
  const executionCompleted = currentExecutionState?.status === 'completed';

  const setupInProgress = busy === 'setup' || executionRunning;

  const canResumeSetup =
    executionFailed && hasDiscovery && busy === '' && !awaitingApproval;

  const setupButtonLabel = canResumeSetup
    ? 'Resume Kubernetes Setup'
    : 'Start Kubernetes Setup';

  const setupButtonDescription = canResumeSetup
    ? 'Continue from the saved failed step'
    : 'Fix issues, install, validate — automatically';

  const filteredLog =
    selectedVm === 'ALL'
      ? displayLog
      : displayLog.filter(
          (entry) => (entry.host || entry.vmName) === selectedVm
        );

  const isLive = busy !== '' || executionRunning;

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-50">
      {/* ============================================================= */}
      {/* Sticky Top Bar                                                */}
      {/* ============================================================= */}
      <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="flex h-16 w-full items-center justify-between gap-4 px-6 lg:px-10">
          {/* Breadcrumb + name */}
          <nav className="flex min-w-0 items-center gap-2 text-sm">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Projects</span>
            </Link>
            <span className="text-gray-300">/</span>
            <span className="truncate font-medium text-gray-900">
              {project.name}
            </span>
            <StatusBadge status={project.status} />
          </nav>

          {/* Right: rollback */}
          {anyChanges && busy === '' && (
            <RollbackButton
              busy={busy}
              provisioned={project.provisioned}
              onRollback={() => runStream('rollback', 'rollback')}
            />
          )}
        </div>
      </header>

      {/* ============================================================= */}
      {/* Main content — full width, padding-bottom leaves room for     */}
      {/* the fixed footer log drawer.                                  */}
      {/* ============================================================= */}
      <main
        className="w-full flex-1 px-6 py-8 lg:px-10 lg:py-10"
        style={{ paddingBottom: logOpen ? '30rem' : '5.5rem' }}
      >
        {/* Project meta */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 lg:text-3xl">
            {project.name}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {project.kubernetesVersion} · {project.provisioningMethod} ·{' '}
            {project.cni} · {project.vms.length} Nodes ({controlPlanes} CP +{' '}
            {workers} Workers)
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <XCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* ============================================================ */}
        {/* 3 STEP BUTTONS                                               */}
        {/* ============================================================ */}
        <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-stretch lg:gap-3">
          <StepButton
            number={1}
            label="Check Connection"
            description="Verify SSH access to every host"
            state={
              busy === 'connection'
                ? 'active'
                : hasConnection
                  ? project.status === 'Failed' && !hasDiscovery
                    ? 'failed'
                    : 'done'
                  : 'pending'
            }
            disabled={busy !== ''}
            onClick={() => runStream('connection', 'connection/check')}
          />

          <ChevronRight
            className="hidden shrink-0 self-center text-gray-300 lg:block"
            size={18}
          />

          <StepButton
            number={2}
            label="Discover"
            description="Read-only inspection of each host"
            state={
              busy === 'discovery'
                ? 'active'
                : hasDiscovery
                  ? 'done'
                  : 'pending'
            }
            disabled={!hasConnection || busy !== ''}
            onClick={() => runStream('discovery', 'discovery/run')}
          />

          <ChevronRight
            className="hidden shrink-0 self-center text-gray-300 lg:block"
            size={18}
          />

          <StepButton
            number={3}
            label={setupButtonLabel}
            description={setupButtonDescription}
            state={
              setupInProgress
                ? 'active'
                : executionCompleted || project.status === 'Ready'
                  ? 'done'
                  : executionFailed ||
                      (project.status === 'Failed' && hasDiscovery)
                    ? 'failed'
                    : 'pending'
            }
            disabled={!hasDiscovery || busy !== '' || awaitingApproval}
            onClick={() => runStream('setup', 'setup/start')}
          />
        </div>

        {/* ============================================================ */}
        {/* LIVE OPERATION MESSAGE                                       */}
        {/* ============================================================ */}
        {(busy === 'connection' ||
          busy === 'discovery' ||
          busy === 'setup' ||
          busy === 'approve') && (
          <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
            <Sparkles size={16} className="animate-pulse text-gray-900" />
            {busy === 'setup' || busy === 'approve' ? (
              <>
                Setting up your cluster — checking readiness, applying fixes,
                installing Kubernetes, and validating automatically.
              </>
            ) : busy === 'discovery' ? (
              <>Running discovery — live output in the log below.</>
            ) : (
              <>Checking connectivity — live results in the log below.</>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* EXECUTION PROGRESS                                           */}
        {/* ============================================================ */}
        {currentExecutionState &&
          Number(currentExecutionState.totalSteps || 0) > 0 && (
            <div className="mt-6">
              <ExecutionProgress state={currentExecutionState} />
            </div>
          )}

        {/* ============================================================ */}
        {/* APPROVAL                                                     */}
        {/* ============================================================ */}
        {awaitingApproval && project.pendingApproval && (
          <div className="mt-6">
            <ApprovalCard
              pending={project.pendingApproval}
              busy={busy === 'approve'}
              onApprove={() => runStream('approve', 'setup/approve')}
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* READY                                                        */}
        {/* ============================================================ */}
        {project.status === 'Ready' && !awaitingApproval && (
          <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
            <CheckCircle2 size={16} className="text-green-600" />
            Kubernetes cluster is up and validated — KubeForge complete.
          </div>
        )}

        {/* ============================================================ */}
        {/* FAILED                                                       */}
        {/* ============================================================ */}
        {project.status === 'Failed' &&
          !executionCompleted &&
          !awaitingApproval &&
          hasDiscovery &&
          busy === '' && (
            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <XCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p>Setup didn't complete — see the activity log below for what failed.</p>
                {executionFailed && currentExecutionState?.currentStep && (
                  <p className="mt-1 font-medium">
                    Saved checkpoint: {currentExecutionState.currentStep}
                  </p>
                )}
                {executionFailed && (
                  <p className="mt-1 text-xs text-red-600">
                    Fix the issue on the VM and click "Resume Kubernetes Setup".
                    Previous successful steps will be skipped by the backend
                    checkpoint logic.
                  </p>
                )}
              </div>
            </div>
          )}

        {/* ============================================================ */}
        {/* NODES                                                        */}
        {/* ============================================================ */}
        <div className="mt-6">
          <NodesPanel project={project} />
        </div>

        {/* ============================================================ */}
        {/* VALIDATION                                                   */}
        {/* ============================================================ */}
        {project.validation?.checks?.length > 0 && (
          <div className="mt-6">
            <ValidationPanel checks={project.validation.checks} />
          </div>
        )}
      </main>

      {/* ============================================================= */}
      {/* Footer Activity Log — fixed drawer anchored to bottom         */}
      {/* ============================================================= */}
      <FooterActivityLog
        open={logOpen}
        onToggle={() => setLogOpen((o) => !o)}
        entries={filteredLog}
        live={isLive}
        selectedVm={selectedVm}
        onVmChange={setSelectedVm}
        vms={project.vms}
      />
    </div>
  );
}

/* ========================================================================== */
/* Footer Activity Log (fixed bottom drawer)                                  */
/* ========================================================================== */

function FooterActivityLog({
  open,
  onToggle,
  entries,
  live,
  selectedVm,
  onVmChange,
  vms = [],
}) {
  const list = entries || [];
  const bottomRef = useRef(null);

  useEffect(() => {
    if (live && open) {
      bottomRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [entries.length, live, open]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.15)]">
      {/* ---------- Header (clickable to toggle) ---------- */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-gray-50 lg:px-10"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
            <Terminal size={15} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">
                Activity Log
              </h3>
              {live && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white">
                  <Radio size={10} className="animate-pulse" />
                  Live
                </span>
              )}
              {!live && list.length > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                  {list.length} {list.length === 1 ? 'entry' : 'entries'}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              Every command actually run on your VMs — this backs Rollback.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* VM filter — stop propagation so it doesn't toggle the panel */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <select
              value={selectedVm}
              onChange={(e) => onVmChange(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            >
              <option value="ALL">All VMs</option>
              {vms.map((vm) => (
                <option key={vm.name} value={vm.name}>
                  {vm.name}
                </option>
              ))}
            </select>
          </div>

          <ChevronDown
            size={18}
            className={`text-gray-400 transition-transform duration-200 ${
              open ? 'rotate-180' : 'rotate-0'
            }`}
          />
        </div>
      </button>

      {/* ---------- Body ---------- */}
      {open && (
        <div className="border-t border-gray-200">
          <div className="max-h-96 overflow-y-auto bg-gray-950 p-4 font-mono text-xs">
            {list.length === 0 ? (
              <div className="p-2 text-gray-500">Nothing has run yet.</div>
            ) : (
              list.map((e, i) => {
                const time = e.time || e.appliedAt;
                const host = e.host || e.vmName;
                const output = e.output || e.stdout || e.stderr || '';

                return (
                  <div
                    key={i}
                    className="border-b border-gray-800 py-2 last:border-0"
                  >
                    <div className="flex flex-wrap items-baseline gap-1.5 text-gray-300">
                      <span className="text-gray-500">
                        {time ? new Date(time).toLocaleTimeString() : ''}
                      </span>

                      <StageTag stage={e.stage} />

                      <span className="text-blue-400">{host}</span>

                      <span className="whitespace-pre-wrap break-all">
                        {e.command}
                      </span>
                    </div>

                    {output && (
                      <div className="whitespace-pre-wrap break-all pl-1 text-green-400">
                        → {String(output).slice(0, 400)}
                      </div>
                    )}

                    {e.rollbackCommand && (
                      <div className="pl-1 text-gray-500">
                        rollback ready: {e.rollbackCommand}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Execution Progress                                                         */
/* ========================================================================== */

function ExecutionProgress({ state }) {
  const total = Number(state.totalSteps || 0);
  const current = Number(state.stepIndex || 0);
  const completed = Number(state.lastCompletedStep || 0);

  const percent =
    total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  const statusLabel =
    {
      idle: 'Idle',
      running: 'Running',
      diagnosing: 'Diagnosing',
      healing: 'Repairing',
      verifying: 'Verifying',
      failed: 'Failed',
      completed: 'Completed',
    }[state.status] ||
    state.status ||
    'Idle';

  const statusClass =
    {
      idle: 'bg-gray-100 text-gray-700',
      running: 'bg-blue-100 text-blue-700',
      diagnosing: 'bg-yellow-100 text-yellow-700',
      healing: 'bg-orange-100 text-orange-700',
      verifying: 'bg-purple-100 text-purple-700',
      failed: 'bg-red-100 text-red-700',
      completed: 'bg-green-100 text-green-700',
    }[state.status] || 'bg-gray-100 text-gray-700';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              Provisioning Progress
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
            >
              {statusLabel}
            </span>
          </div>

          <p className="mt-1 text-xs text-gray-400">
            Step {current} of {total} · {completed} completed
          </p>
        </div>

        <span className="text-sm font-semibold text-gray-700">{percent}%</span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-gray-900 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ExecutionInfo label="VM" value={state.vm || '—'} />
        <ExecutionInfo label="Phase" value={state.phase || '—'} />
        <ExecutionInfo label="Current Step" value={state.currentStep || '—'} />
        <ExecutionInfo
          label="Last Completed Step"
          value={completed > 0 ? String(completed) : 'None'}
        />
      </div>

      {state.currentCommand && (
        <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Current Command
          </p>
          <code className="mt-1 block break-all font-mono text-xs text-gray-700">
            {state.currentCommand}
          </code>
        </div>
      )}

      {state.error?.message && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-red-600" />
            <div>
              <p className="text-xs font-semibold text-red-800">
                Failed Step Error
              </p>
              <p className="mt-1 text-xs text-red-700">{state.error.message}</p>
              {state.error.code && (
                <p className="mt-1 text-[10px] text-red-500">
                  Error code: {state.error.code}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {state.status === 'failed' && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="mt-0.5 shrink-0" />
            <span>
              This execution state is saved. After the failed issue is repaired,
              use <strong>Resume Kubernetes Setup</strong> to continue from the
              checkpoint.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ExecutionInfo({ label, value }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-1 break-words text-xs font-medium text-gray-800">
        {value}
      </p>
    </div>
  );
}

/* ========================================================================== */
/* Step Button                                                                */
/* ========================================================================== */

function StepButton({ number, label, description, state, disabled, onClick }) {
  const circle = {
    pending: 'border-2 border-gray-300 text-gray-400',
    active: 'border-2 border-gray-900 text-gray-900',
    done: 'bg-gray-900 text-white',
    failed: 'bg-red-600 text-white',
  }[state];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === 'active'}
      className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-6 text-center transition hover:border-gray-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:shadow-none"
    >
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${circle}`}
      >
        {state === 'done' ? (
          <Check size={18} />
        ) : state === 'active' ? (
          <Loader2 size={18} className="animate-spin" />
        ) : state === 'failed' ? (
          <X size={18} />
        ) : (
          number
        )}
      </span>

      <span className="text-sm font-semibold text-gray-900">{label}</span>
      <span className="text-xs text-gray-400">{description}</span>
    </button>
  );
}

/* ========================================================================== */
/* Approval Card                                                              */
/* ========================================================================== */

function ApprovalCard({ pending, busy, onApprove }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 shrink-0 text-amber-600" size={20} />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-900">
            Action needed — a risky fix is waiting for your approval
          </h3>
          <p className="mt-1 text-sm text-amber-800">
            {pending.issue?.description || pending.root_cause}
          </p>
          {pending.explanation && (
            <p className="mt-1 text-sm text-amber-700">{pending.explanation}</p>
          )}

          {pending.remediation_plan?.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {pending.remediation_plan.map((step, i) => (
                <li key={i} className="text-xs text-amber-800">
                  <span className="text-amber-400">›</span> {step.description}
                  {step.command && (
                    <code className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-900">
                      {step.command}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          )}

          {pending.safetyReason && (
            <p className="mt-2 text-xs text-amber-600">
              Why this needs approval: {pending.safetyReason}
            </p>
          )}

          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
          >
            <Check size={14} />
            {busy ? 'Applying…' : 'Approve & Continue Setup'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Nodes Panel                                                                */
/* ========================================================================== */

function NodesPanel({ project }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <h3 className="text-sm font-semibold text-gray-900">Nodes</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className={th}>VM</th>
              <th className={th}>IP</th>
              <th className={th}>Role</th>
              <th className={th}>Connection</th>
              <th className={th}>Discovery</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {project.vms.map((vm) => {
              const conn = (project.connection || {})[vm.name];
              const disc = (project.discovery || {})[vm.name];
              const excluded =
                project.provisioned &&
                project.provisionedVMs &&
                !project.provisionedVMs.includes(vm.name);

              return (
                <tr key={vm.name}>
                  <td className={`${td} font-medium text-gray-900`}>
                    {vm.name}
                  </td>
                  <td className={td}>{vm.ip}</td>
                  <td className={td}>{vm.role}</td>
                  <td className={td}>
                    {!conn ? (
                      <span className="text-gray-400">—</span>
                    ) : conn.result === 'Connected' ? (
                      <span className="inline-flex items-center gap-1 text-green-600">
                        <CheckCircle2 size={13} />
                        Connected
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-red-600"
                        title={conn.reason}
                      >
                        <XCircle size={13} />
                        Failed
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    {!disc ? (
                      <span className="text-gray-400">—</span>
                    ) : disc.connection === 'Connected' ? (
                      <>
                        {disc.os}
                        {excluded && (
                          <span className="ml-1.5 text-xs text-amber-600">
                            (excluded from cluster)
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-red-600">{disc.error}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Validation Panel                                                           */
/* ========================================================================== */

function ValidationPanel({ checks }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <h3 className="text-sm font-semibold text-gray-900">
          Cluster Validation
        </h3>
      </div>

      <div className="divide-y divide-gray-100">
        {checks.map((c, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-6 py-3 text-sm"
          >
            <span className="text-gray-700">{c.check}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{c.detail}</span>
              {c.status === 'pass' ? (
                <CheckCircle2 size={16} className="text-green-500" />
              ) : (
                <XCircle size={16} className="text-red-500" />
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Stage Tag                                                                  */
/* ========================================================================== */

function StageTag({ stage }) {
  const colors = {
    connection: 'text-cyan-400',
    discovery: 'text-purple-400',
    remediation: 'text-amber-400',
    provisioning: 'text-blue-400',
    rollback: 'text-red-400',
    setup: 'text-gray-300',
  };

  return (
    <span
      className={`text-[10px] uppercase tracking-wide ${
        colors[stage] || 'text-gray-500'
      }`}
    >
      [{stage || 'log'}]
    </span>
  );
}

/* ========================================================================== */
/* Rollback Button                                                            */
/* ========================================================================== */

function RollbackButton({ busy, provisioned, onRollback }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
      >
        <RotateCcw size={14} />
        Rollback
      </button>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm">
      <span className="text-red-700">
        Undo every applied fix{provisioned ? ' and uninstall the cluster' : ''}?
      </span>
      <button
        type="button"
        onClick={onRollback}
        disabled={busy === 'rollback'}
        className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {busy === 'rollback' ? 'Rolling back…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs text-gray-500 hover:text-gray-700"
      >
        Cancel
      </button>
    </div>
  );
}