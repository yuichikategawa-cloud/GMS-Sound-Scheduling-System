import { BarChart3, ShieldCheck } from "lucide-react";
import "./StatisticsPanel.css";
import type { ScheduleView, Servant } from "../../../types";
import { calculateServingStatistics } from "../services/servingStatistics";

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="stat-card"><span>{label}</span><b>{value}</b></div>;
}

export default function StatisticsPanel({
  schedules,
  servants,
}: {
  schedules: ScheduleView[];
  servants: Servant[];
}) {
  const stats = calculateServingStatistics(schedules, servants);
  const { rows } = stats;

  return <>
    <div className="toolbar"><div><h2>Serving statistics</h2><p className="subtle">Based on all upcoming published schedules across every church location. Schedule-page filters do not affect these figures.</p></div></div>
    <section className="stats-grid stats-grid-wide">
      <Stat label="TOTAL ASSIGNMENTS" value={stats.totalAssignments}/>
      <Stat label="REQUIRED ROLES FILLED" value={stats.filledRequired}/>
      <Stat label="REQUIRED ROLE GAPS" value={stats.requiredRoleGaps}/>
      <Stat label="SERVANTS ASSIGNED" value={rows.length}/>
      <Stat label="CONFIRMATION RATE" value={`${stats.confirmationRate}%`}/>
      <Stat label="DECLINED ASSIGNMENTS" value={stats.declined}/>
      <Stat label="ACTIVE SERVANTS NOT SCHEDULED" value={stats.notScheduled}/>
    </section>
    <section className="filter-panel">
      <div className="filter-title"><BarChart3 size={17}/><b>Assignments by church location</b></div>
      <div className="location-stat-list">{stats.locationCounts.length?stats.locationCounts.map(location=><div className="location-stat" key={location.name}><span>{location.name}</span><b>{location.count}</b></div>):<p className="subtle stats-empty-state">No assignments are present in upcoming published schedules.</p>}</div>
    </section>
    <section className="filter-panel fairness-panel">
      <div className="filter-title"><ShieldCheck size={17}/><b>Fairness checker</b></div>
      <p className="subtle">Workload comparison across upcoming published schedules. Use this as a review aid, not a performance ranking.</p>
      <div className="fairness-metrics">
        <div><small>Average assignments</small><b>{rows.length ? stats.averageAssignments.toFixed(1) : "0"}</b></div>
        <div><small>Highest workload</small><b>{stats.highestWorkload}</b></div>
        <div><small>Lowest workload</small><b>{stats.lowestWorkload}</b></div>
      </div>
      {stats.showFairnessAlert && <div className="fairness-alert">Workload difference is 3 or more assignments. Consider reviewing upcoming assignments and availability.</div>}
    </section>
    <div className="list-heading"><h2>Assignments by servant</h2><span>{rows.length} servants</span></div>
    <div className="stats-table-wrap stats-desktop-table">
      <table className="stats-table">
        <thead><tr><th>Servant</th><th>Total</th><th>FOH</th><th>Monitor</th><th>Assistant</th></tr></thead>
        <tbody>{rows.length?rows.map(row=><tr key={row.id}><td><b>{row.name}</b></td><td>{row.total}</td><td>{row.FOH}</td><td>{row.Monitor}</td><td>{row.Assistant}</td></tr>):<tr><td colSpan={5}>No servants are assigned to upcoming published schedules.</td></tr>}</tbody>
      </table>
    </div>
    <div className="stats-servant-cards">{rows.length?rows.map(row=><article className="stats-servant-card" key={row.id}>
      <b className="stats-servant-name">{row.name}</b>
      <div className="stats-servant-metrics">
        <div><small>Total</small><strong>{row.total}</strong></div>
        <div><small>FOH</small><strong>{row.FOH}</strong></div>
        <div><small>Monitor</small><strong>{row.Monitor}</strong></div>
        <div><small>Assistant</small><strong>{row.Assistant}</strong></div>
      </div>
    </article>):<p className="subtle stats-empty-state">No servants are assigned to upcoming published schedules.</p>}</div>
  </>;
}
