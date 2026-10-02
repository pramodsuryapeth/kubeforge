import { useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Plus,
  ShieldCheck,
  Lock,
  Fingerprint,
  ArrowLeft,
  Search,
  X,
  Copy,
  Check,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

const AUTH_TYPES = [
  { value: 'password', label: 'Password' },
  { value: 'ssh-key', label: 'SSH Key' },
];

const emptyForm = {
  ref: '',
  username: '',
  authType: 'password',
  secret: '',
  passphrase: '',
};

export default function Vault() {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [copiedRef, setCopiedRef] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api.listCredentials();
      setCredentials(data.credentials);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const set = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.createCredential(form);
      setForm(emptyForm);
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function copyRef(ref) {
    navigator.clipboard?.writeText(ref);
    setCopiedRef(ref);
    setTimeout(() => setCopiedRef(''), 1500);
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return credentials;
    const q = query.toLowerCase();
    return credentials.filter(
      (c) =>
        c.ref.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q)
    );
  }, [credentials, query]);

  return (
    <div className="min-h-screen w-full bg-gray-50">
      {/* Top bar */}
      <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="flex h-16 w-full items-center justify-between gap-4 px-6 lg:px-10">
          <nav className="flex min-w-0 items-center gap-2 text-sm">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Projects</span>
            </Link>
            <span className="text-gray-300">/</span>
            <span className="font-medium text-gray-900">Vault</span>
          </nav>

          <div className="relative hidden w-64 sm:block">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search credentials…"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
        </div>
      </header>

      <main className="w-full px-6 py-8 lg:px-10 lg:py-10">
        {/* Mobile search */}
        <div className="relative mb-5 sm:hidden">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search credentials…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
              !
            </span>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Create button — left aligned, directly above list */}
        <div className="mb-4 flex justify-start">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black"
          >
            <Plus size={16} />
            Create Vault
          </button>
        </div>

        {/* Credential list */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-[76px] animate-pulse rounded-2xl border border-gray-200 bg-white"
              />
            ))}
          </div>
        ) : credentials.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white px-6 py-20 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-900 text-white">
              <KeyRound size={22} />
            </span>
            <p className="mt-4 text-base font-semibold text-gray-900">
              Your vault is empty
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-500">
              Add your first credential to enable SSH access to your cluster
              hosts.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white px-6 py-14 text-center">
            <Search className="mx-auto text-gray-300" size={22} />
            <p className="mt-3 text-sm font-medium text-gray-700">
              No matching credentials
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Try a different search term.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((c) => {
              const isKey = c.authType === 'ssh-key';
              const copied = copiedRef === c.ref;
              return (
                <li
                  key={c.ref}
                  className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 hover:shadow"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700">
                    {isKey ? <Fingerprint size={20} /> : <Lock size={20} />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {c.ref}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {c.username}
                    </p>
                  </div>

                  <span className="hidden shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 sm:inline-block">
                    {isKey ? 'SSH Key' : 'Password'}
                  </span>

                  <button
                    type="button"
                    onClick={() => copyRef(c.ref)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-900 hover:bg-gray-900 hover:text-white"
                    aria-label="Copy reference name"
                  >
                    {copied ? (
                      <>
                        <Check size={12} />
                        <span className="hidden sm:inline">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span className="hidden sm:inline">Copy</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          form={form}
          set={set}
          setForm={setForm}
          saving={saving}
          onSubmit={handleSubmit}
          onClose={() => {
            setShowCreate(false);
            setForm(emptyForm);
          }}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/* Create modal                                                        */
/* ================================================================== */

function CreateModal({ form, set, setForm, saving, onSubmit, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 text-white">
              <KeyRound size={18} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Create Vault
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Stored securely — never shown again.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form
          id="vault-create-form"
          onSubmit={onSubmit}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          <div className="space-y-5">
            <Field label="Reference name" required>
              <input
                required
                value={form.ref}
                onChange={set('ref')}
                placeholder="Ubuntu-Cluster-Cred"
                className={inputClass}
                autoFocus
              />
            </Field>

            <Field label="SSH username" required>
              <input
                required
                value={form.username}
                onChange={set('username')}
                placeholder="username"
                className={inputClass}
              />
            </Field>

            <Field label="Authentication method">
              <div className="flex rounded-lg border border-gray-300 bg-gray-50 p-1">
                {AUTH_TYPES.map((t) => {
                  const active = form.authType === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, authType: t.value }))
                      }
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? 'bg-gray-900 text-white shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {t.value === 'password' ? (
                        <Lock size={12} />
                      ) : (
                        <Fingerprint size={12} />
                      )}
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field
              label={
                form.authType === 'password' ? 'Password' : 'Private key (PEM)'
              }
              required
            >
              {form.authType === 'password' ? (
                <input
                  required
                  type="password"
                  value={form.secret}
                  onChange={set('secret')}
                  placeholder="••••••••••••"
                  className={inputClass}
                />
              ) : (
                <textarea
                  required
                  value={form.secret}
                  onChange={set('secret')}
                  rows={6}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  className={`${inputClass} font-mono text-xs leading-relaxed`}
                />
              )}
            </Field>

            {form.authType === 'ssh-key' && (
              <Field label="Key passphrase" hint="Optional">
                <input
                  type="password"
                  value={form.passphrase}
                  onChange={set('passphrase')}
                  placeholder="Leave blank if none"
                  className={inputClass}
                />
              </Field>
            )}

            <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
              <ShieldCheck
                size={14}
                className="mt-0.5 shrink-0 text-green-600"
              />
              <span>
                Secrets are encrypted with AES-256-GCM at rest and decrypted in
                memory only when an SSH connection needs them.
              </span>
            </div>
          </div>
        </form>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 bg-gray-50/60 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="vault-create-form"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            <Plus size={15} />
            {saving ? 'Saving…' : 'Save Credential'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reusable pieces                                                     */
/* ------------------------------------------------------------------ */

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

function Field({ label, required, hint, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 flex items-baseline gap-1.5">
        <span className="font-medium text-gray-700">{label}</span>
        {required && <span className="text-red-500">*</span>}
        {hint && (
          <span className="text-xs font-normal text-gray-400">({hint})</span>
        )}
      </span>
      {children}
    </label>
  );
}