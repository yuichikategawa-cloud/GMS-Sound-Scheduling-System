type StatProps = { label: string; value: number | string };

export function Stat({ label, value }: StatProps) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
