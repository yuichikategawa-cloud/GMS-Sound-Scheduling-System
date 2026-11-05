import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";

export default function AuditPanel({
  logs,
  onDownload,
}: {
  logs: any[];
  onDownload: () => void;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(logs.length / pageSize));
  const visible = logs.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [logs.length]);

  return <>
    <div className="toolbar audit-toolbar">
      <div>
        <h2>System audit trail</h2>
        <p className="subtle">Showing up to 50 events from the last 14 days. Records older than 14 days can be downloaded; all audit data is automatically deleted after 30 days.</p>
      </div>
      <button className="btn secondary" onClick={onDownload}>
        <ClipboardCheck size={16} /> Download older records (15+ days)
      </button>
    </div>
    {logs.length === 0
      ? <div className="empty-state">
          <ClipboardCheck size={28} />
          <b>No audit activity in the last 14 days</b>
          <p>Older records, if available, can be downloaded using the button above.</p>
        </div>
      : <>
          <div className="people-list">
            {visible.map(log => <div className="audit-row" key={log.id}>
              <div>
                <b>{log.action} · {log.table_name}</b>
                <small>Record: {log.record_id}</small>
                <small>{new Date(log.created_at).toLocaleString()}</small>
              </div>
              <span>{log.actor_id ? "User " + String(log.actor_id).slice(0, 8) : "System"}</span>
            </div>)}
          </div>
          <div className="audit-pagination">
            <span>Page {page} of {pageCount} · {logs.length} events from the last 14 days</span>
            <div>
              <button className="btn secondary tiny" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
              <button className="btn secondary tiny" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>Next</button>
            </div>
          </div>
        </>
    }
  </>;
}
