import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Boxes, Search, AlertCircle } from 'lucide-react';
import { api } from '../api/client.js';
import ProjectCard from '../components/ProjectCard.jsx';

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listProjects();
      setProjects(data.projects);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <div className="min-h-screen w-full bg-gray-50">
      {/* ============================================================= */}
      {/* Sticky Top Bar                                                */}
      {/* ============================================================= */}
      <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="flex h-16 w-full items-center justify-between gap-4 px-6 lg:px-10">
          {/* Title */}
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-gray-900">Projects</h1>
            <p className="hidden truncate text-xs text-gray-500 sm:block">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'} total
            </p>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            <div className="relative hidden w-64 sm:block">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects..."
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>

            <Link
              to="/projects/new"
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Create Project</span>
              <span className="sm:hidden">New</span>
            </Link>
          </div>
        </div>
      </header>

      {/* ============================================================= */}
      {/* Main Content — full width                                     */}
      {/* ============================================================= */}
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
            placeholder="Search projects..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
            <p className="text-sm text-red-700">
              Couldn&apos;t load projects: {error}. Is the backend running on port 5000?
            </p>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-2xl border border-gray-200 bg-white"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* ---- Create Project CTA card (always first) ---- */}
            <Link
              to="/projects/new"
              className="group flex min-h-[176px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-gray-300 bg-white p-6 text-center transition hover:border-gray-900 hover:bg-gray-50"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition group-hover:bg-gray-900 group-hover:text-white">
                <Plus size={22} />
              </span>
              <span className="text-sm font-semibold text-gray-900">Create Project</span>
              <span className="max-w-[220px] text-xs leading-relaxed text-gray-500">
                Set up a new Kubernetes cluster with KubeForge AI.
              </span>
            </Link>

            {/* ---- Project cards ---- */}
            {filtered.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}

            {/* ---- Empty state when no projects and no query ---- */}
            {projects.length === 0 && !query && (
              <div className="col-span-full mt-2 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
                <Boxes className="mx-auto text-gray-300" size={28} />
                <p className="mt-3 text-sm font-medium text-gray-700">No projects yet</p>
                <p className="mt-1 text-sm text-gray-400">
                  Create your first Kubernetes project to get started.
                </p>
              </div>
            )}

            {/* ---- Empty state when search has no results ---- */}
            {projects.length > 0 && filtered.length === 0 && (
              <div className="col-span-full mt-2 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
                <Search className="mx-auto text-gray-300" size={24} />
                <p className="mt-3 text-sm font-medium text-gray-700">
                  No projects match your search
                </p>
                <p className="mt-1 text-sm text-gray-400">Try a different search term.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}