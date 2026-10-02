const STYLES = {
  Ready: 'bg-green-50 text-green-700 ring-green-200',
  Connected: 'bg-blue-50 text-blue-700 ring-blue-200',
  Discovered: 'bg-blue-50 text-blue-700 ring-blue-200',
  'Setting Up': 'bg-blue-50 text-blue-700 ring-blue-200',
  'Awaiting Approval': 'bg-amber-50 text-amber-700 ring-amber-200',
  Failed: 'bg-red-50 text-red-700 ring-red-200',
  Draft: 'bg-gray-100 text-gray-600 ring-gray-200',
};

const DOT = {
  Ready: 'bg-green-500',
  Connected: 'bg-blue-500',
  Discovered: 'bg-blue-500',
  'Setting Up': 'bg-blue-500 animate-pulse',
  'Awaiting Approval': 'bg-amber-500',
  Failed: 'bg-red-500',
  Draft: 'bg-gray-400',
};

export default function StatusBadge({ status }) {
  const style = STYLES[status] || STYLES.Draft;
  const dot = DOT[status] || DOT.Draft;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}
