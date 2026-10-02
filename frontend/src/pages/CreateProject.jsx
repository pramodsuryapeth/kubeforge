import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Server,
  Sparkles,
  FileText,
} from 'lucide-react';
import { api } from '../api/client.js';
import VMTable from '../components/VMTable.jsx';

const PROVISIONING_METHODS = ['kubeadm', 'RKE2', 'Kubespray'];
const CNI_OPTIONS = ['Calico', 'Cilium', 'Flannel', 'Weave'];
const AI_MODELS = ['KubeForge AI (v1)'];
const ENVIRONMENTS = ['On-Premise', 'AWS', 'Azure', 'GCP', 'VMware'];

const initialForm = {
  name: '',
  description: '',
  kubernetesVersion: 'v1.30.1',
  provisioningMethod: 'Kubeadm',
  cni: 'Calico',
  podCidr: '10.244.0.0/16',
  serviceCidr: '10.96.0.0/12',
  aiModel: AI_MODELS[0],
  environment: ENVIRONMENTS[0],
  tags: '',
  autoApproveRisky: false,
};

export default function CreateProject() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [credentialOptions, setCredentialOptions] = useState([]);
  const [vms, setVms] = useState([
    { name: 'master-01', ip: '', credentialRef: '', username: '', role: 'Control Plane' },
    { name: 'worker-01', ip: '', credentialRef: '', username: '', role: 'Worker' },
  ]);
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .listCredentials()
      .then((data) => {
        setCredentialOptions(data.credentials);
        if (data.credentials.length > 0) {
          const first = data.credentials[0];
          setVms((prev) =>
            prev.map((vm) => ({ ...vm, credentialRef: first.ref, username: first.username }))
          );
        }
      })
      .catch(() => {});
  }, []);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);
    try {
      const payload = {
        ...form,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        vms,
      };
      const project = await api.createProject(payload);
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setErrors(err.details && err.details.length ? err.details : [err.message]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-gray-50">
      {/* ============================================================= */}
      {/* Sticky Top Bar                                                */}
      {/* ============================================================= */}
      <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="flex h-16 w-full items-center justify-between gap-4 px-6 lg:px-10">
          {/* Breadcrumb */}
          <nav className="flex min-w-0 items-center gap-2 text-sm">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Projects</span>
              <span className="sm:hidden">Back</span>
            </Link>
            <span className="text-gray-300">/</span>
            <span className="truncate font-medium text-gray-900">Create Project</span>
          </nav>

          {/* Header actions */}
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="hidden rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:inline-flex"
            >
              Cancel
            </Link>
            <button
              type="submit"
              form="create-project-form"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              )}
              {submitting ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </div>
      </header>

      {/* ============================================================= */}
      {/* Main Content — full width                                     */}
      {/* ============================================================= */}
      <main className="w-full px-6 py-8 lg:px-10 lg:py-10">

        {/* Errors */}
        {errors.length > 0 && (
          <div
            role="alert"
            className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-800">
                Please fix the following before continuing
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-red-700">
                {errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <form id="create-project-form" onSubmit={handleSubmit} className="space-y-6">
          {/* ============ SECTION 1 ============ */}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <SectionHeader
              step={1}
              icon={FileText}
              title="Project Information"
              description="Name your project and define the cluster parameters."
            />

            <div className="p-6 lg:p-8">
              {/* Form grid — 3 columns on large screens */}
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
                <Field label="Project Name" required>
                  <input
                    required
                    value={form.name}
                    onChange={set('name')}
                    placeholder="Production-K8s"
                    className={inputClass}
                  />
                </Field>

                <Field label="Cloud / Environment">
                  <select
                    value={form.environment}
                    onChange={set('environment')}
                    className={inputClass}
                  >
                    {ENVIRONMENTS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Kubernetes Version" required>
                  <input
                    required
                    value={form.kubernetesVersion}
                    onChange={set('kubernetesVersion')}
                    className={inputClass}
                  />
                </Field>

                <Field label="Provisioning Method" required>
                  <select
                    value={form.provisioningMethod}
                    onChange={set('provisioningMethod')}
                    className={inputClass}
                  >
                    {PROVISIONING_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="CNI Plugin" required>
                  <select value={form.cni} onChange={set('cni')} className={inputClass}>
                    {CNI_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="AI Model">
                  <select value={form.aiModel} onChange={set('aiModel')} className={inputClass}>
                    {AI_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Pod CIDR" required>
                  <input
                    required
                    value={form.podCidr}
                    onChange={set('podCidr')}
                    className={`${inputClass} font-mono`}
                  />
                </Field>

                <Field label="Service CIDR" required>
                  <input
                    required
                    value={form.serviceCidr}
                    onChange={set('serviceCidr')}
                    className={`${inputClass} font-mono`}
                  />
                </Field>

                <Field label="Tags" hint="Comma separated">
                  <input
                    value={form.tags}
                    onChange={set('tags')}
                    placeholder="production, dev, test"
                    className={inputClass}
                  />
                </Field>

                <Field label="Description" full>
                  <input
                    value={form.description}
                    onChange={set('description')}
                    placeholder="Production Kubernetes cluster using RKE2"
                    className={inputClass}
                  />
                </Field>
              </div>

              {/* Automation row */}
              <div className="mt-8 border-t border-gray-100 pt-6">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Automation
                </p>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {/* AI notice */}
                  <div className="flex gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <Sparkles size={16} className="mt-0.5 shrink-0 text-gray-900" />
                    <p className="text-xs leading-relaxed text-gray-600">
                      <span className="font-semibold text-gray-900">KubeForge AI</span> analyzes
                      infrastructure state, identifies issues, and suggests safe remediation for
                      Kubernetes setup.
                    </p>
                  </div>

                  {/* Auto-approve toggle */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:bg-gray-50">
                    <span className="relative mt-0.5 flex h-5 w-9 shrink-0 items-center">
                      <input
                        type="checkbox"
                        checked={form.autoApproveRisky}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, autoApproveRisky: e.target.checked }))
                        }
                        className="peer sr-only"
                      />
                      <span className="absolute inset-0 rounded-full bg-gray-200 transition peer-checked:bg-gray-900" />
                      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                    </span>
                    <span className="text-xs leading-relaxed text-gray-600">
                      <span className="block text-sm font-medium text-gray-900">
                        Fully automatic — apply higher-risk fixes without asking
                      </span>
                      <span className="mt-1 block">
                        Off by default. Higher-risk fixes pause for your approval. Only enable for
                        VMs you're sure don't hold anything you need to keep.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* ============ SECTION 2 ============ */}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <SectionHeader
              step={2}
              icon={Server}
              title="Cluster VMs / Hosts"
              description="Add the machines that will form your Kubernetes cluster."
            />
            <div className="p-6 lg:p-8">
              <VMTable vms={vms} onChange={setVms} credentialOptions={credentialOptions} />
            </div>
          </section>

          {/* ============ FOOTER ACTIONS ============ */}
          <div className="flex flex-col-reverse items-stretch gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">
              Fields marked <span className="text-red-500">*</span> are required.
            </p>
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 sm:flex-none"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                {submitting && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
                {submitting ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reusable pieces                                                     */
/* ------------------------------------------------------------------ */

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

function SectionHeader({ step, title, description, icon: Icon }) {
  return (
    <div className="flex items-start gap-4 border-b border-gray-100 bg-gray-50/60 px-6 py-5 lg:px-8">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
        {step}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          {title}
          {Icon && <Icon size={14} className="text-gray-400" />}
        </h2>
        {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
      </div>
    </div>
  );
}

function Field({ label, required, full, hint, children }) {
  return (
    <label className={`block text-sm ${full ? 'md:col-span-2 lg:col-span-3' : ''}`}>
      <span className="mb-1.5 flex items-baseline gap-1.5">
        <span className="font-medium text-gray-700">{label}</span>
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="text-xs font-normal text-gray-400">({hint})</span>}
      </span>
      {children}
    </label>
  );
}