import { Link, useLocation } from 'react-router-dom';
import { Boxes, Bell, ChevronDown } from 'lucide-react';

const NAV_LINKS = [
  { label: 'Projects', to: '/' },
  { label: 'Vault', to: '/vault' },
];

export default function Navbar() {
  const location = useLocation();

  const isActive = (link) =>
    location.pathname === link.to ||
    (link.to === '/' && location.pathname.startsWith('/projects'));

  return (
    <header className="sticky top-0 z-30 w-full border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="flex h-16 w-full items-center justify-between gap-6 px-6 lg:px-10">
        {/* ---------- Left: Brand + Nav ---------- */}
        <div className="flex min-w-0 items-center gap-8">
          {/* Brand */}
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white">
              <Boxes size={18} />
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-semibold text-gray-900">KubeForge</span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-400">
                Automate · Heal · Deploy
              </span>
            </span>
          </Link>

          {/* Divider */}
          <span className="hidden h-6 w-px bg-gray-200 sm:block" />

          {/* Nav links */}
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV_LINKS.map((link) => {
              const active = isActive(link);
              return (
                <Link
                  key={link.label}
                  to={link.to}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* ---------- Right: Actions ---------- */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label="Notifications"
            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
          >
            <Bell size={18} />
          </button>

          <span className="mx-1 hidden h-6 w-px bg-gray-200 sm:block" />

          <button
            type="button"
            className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition hover:bg-gray-100"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
              D
            </span>
            <span className="hidden text-sm font-medium text-gray-700 sm:block">Demo User</span>
            <ChevronDown size={14} className="text-gray-400" />
          </button>
        </div>
      </div>
    </header>
  );
}