import { Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const ROLE_OPTIONS = ['Control Plane', 'Worker'];

function emptyVM(defaultCredentialRef) {
  return { name: '', ip: '', credentialRef: defaultCredentialRef || '', username: '', role: 'Worker' };
}

export default function VMTable({ vms, onChange, credentialOptions }) {
  const updateRow = (index, field, value) => {
    const next = vms.slice();
    next[index] = { ...next[index], [field]: value };
    if (field === 'credentialRef') {
      const cred = credentialOptions.find((c) => c.ref === value);
      if (cred) next[index].username = cred.username;
    }
    onChange(next);
  };

  const addRow = () => onChange([...vms, emptyVM(credentialOptions[0]?.ref)]);
  const removeRow = (index) => onChange(vms.filter((_, i) => i !== index));

  if (credentialOptions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-800">
        No Vault credentials registered yet. <Link to="/vault" className="font-medium underline">Add one on the Vault page</Link> before adding VMs.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500">VM Name</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">IP Address</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Vault Credential</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Username</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Role</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {vms.map((vm, index) => (
              <tr key={index}>
                <td className="px-3 py-2">
                  <input
                    value={vm.name}
                    onChange={(e) => updateRow(index, 'name', e.target.value)}
                    placeholder="master-01"
                    className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={vm.ip}
                    onChange={(e) => updateRow(index, 'ip', e.target.value)}
                    placeholder="Enter IP address"
                    className="w-36 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={vm.credentialRef}
                    onChange={(e) => updateRow(index, 'credentialRef', e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    {credentialOptions.map((c) => (
                      <option key={c.ref} value={c.ref}>{c.ref}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-gray-500">{vm.username}</td>
                <td className="px-3 py-2">
                  <select
                    value={vm.role}
                    onChange={(e) => updateRow(index, 'role', e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    disabled={vms.length <= 1}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="Remove VM"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <Plus size={15} /> Add VM
      </button>

      <p className="mt-3 flex items-start gap-1.5 rounded-md bg-gray-50 p-2.5 text-xs text-gray-500">
        Credentials are encrypted in Vault (AES-256-GCM). Secrets are never saved in the project database.
      </p>
    </div>
  );
}
