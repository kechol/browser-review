// SPDX-License-Identifier: Apache-2.0
export interface StatCardProps {
  label: string;
  value: string;
  trend: string;
}

export function StatCard({ label, value, trend }: StatCardProps) {
  return (
    <article className="stat-card" data-testid={`stat-${label}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-trend">{trend}</p>
    </article>
  );
}
