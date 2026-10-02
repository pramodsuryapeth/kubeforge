import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';

export default function ProjectCard({ project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-brand-200 hover:shadow-sm"
    >
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Boxes size={18} />
        </span>
        <StatusBadge status={project.status} />
      </div>

      <h3 className="mt-3 text-sm font-semibold text-gray-900">{project.name}</h3>
      <p className="mt-1 text-xs text-gray-500">
        {project.kubernetesVersion} &middot; {project.provisioningMethod} &middot; {project.cni}
      </p>
      <p className="mt-2 text-xs text-gray-500">{project.nodeSummary}</p>

      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-[11px] text-gray-400">
        <span>Updated: {new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        {project.openIssues > 0 && <span className="font-medium text-amber-600">{project.openIssues} issue{project.openIssues > 1 ? 's' : ''}</span>}
      </div>
    </Link>
  );
}
