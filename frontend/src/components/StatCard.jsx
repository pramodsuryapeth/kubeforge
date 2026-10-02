const TONES = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
};

export default function StatCard({ icon: Icon, label, value, tone = 'blue' }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5">
      <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${TONES[tone]}`}>
        <Icon size={20} />
      </span>
      <div>
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-2xl font-semibold text-gray-900">{value}</div>
      </div>
    </div>
  );
}
