import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Bell, LifeBuoy } from "lucide-react";
import "./RequestsInbox.css";
import { fmtDate, fmtDateTime } from "../../../shared/formatters";
import type { ScheduleView, Servant, ServingNotificationRecord } from "../../../types";
import type { ServingRequestRecord } from "../services/requestData";

type RequestsSection = "coverage" | "swaps" | "notifications";

export default function RequestsPanel({
  requests,
  schedules,
  servants,
  focusedRequestId,
  coverageContent,
  onReview,
  notifications,
  onNotificationRead,
  notificationSettings,
}: {
  requests: ServingRequestRecord[];
  schedules: ScheduleView[];
  servants: Servant[];
  focusedRequestId: string | null;
  coverageContent: ReactNode;
  onReview: (request: ServingRequestRecord, approve: boolean) => void;
  notifications: ServingNotificationRecord[];
  onNotificationRead: (id: string) => void;
  notificationSettings:ReactNode;
}) {
  const [section, setSection] = useState<RequestsSection>("coverage");
  const pendingCoverage = requests.filter(request => request.request_type === "replacement" && request.status === "pending").length;
  const pendingSwaps = requests.filter(request => request.request_type === "swap" && request.status === "pending").length;
  const unreadNotifications = notifications.filter(notification => !notification.is_read).length;
  const swaps = requests.filter(request => request.request_type === "swap");

  useEffect(() => {
    if (focusedRequestId) setSection("coverage");
  }, [focusedRequestId]);

  return (
    <section className="requests-panel">
      <header className="requests-center-heading">
        <div>
          <h2>Requests & notifications</h2>
          <p className="subtle">Review cover needs, approve swaps and manage servant notifications in one place.</p>
        </div>
      </header>

      <div className="requests-center-tabs" role="tablist" aria-label="Requests and notifications">
        <button type="button" role="tab" aria-selected={section === "coverage"} className={section === "coverage" ? "selected" : ""} onClick={() => setSection("coverage")}>
          <LifeBuoy size={16} /> Needs cover <span>{pendingCoverage}</span>
        </button>
        <button type="button" role="tab" aria-selected={section === "swaps"} className={section === "swaps" ? "selected" : ""} onClick={() => setSection("swaps")}>
          <AlertTriangle size={16} /> Swap requests <span>{pendingSwaps}</span>
        </button>
        <button type="button" role="tab" aria-selected={section === "notifications"} className={section === "notifications" ? "selected" : ""} onClick={() => setSection("notifications")}>
          <Bell size={16} /> Notifications <span>{unreadNotifications}</span>
        </button>
      </div>

      {section === "coverage" && coverageContent}

      {section === "swaps" && (
        <section className="requests-content-card servant-requests-section">
          <div className="list-heading requests-content-heading">
            <h2>Swap requests</h2>
            <span>{pendingSwaps} pending</span>
          </div>
          {swaps.length === 0 ? (
            <div className="requests-empty-note">No swap requests yet.</div>
          ) : (
            <div className="people-list">
              {swaps.map(request => {
                const sourceSchedule = schedules.find(schedule => schedule.id === request.schedule_id);
                const sourceAssignment = sourceSchedule?.assignments.find(assignment => assignment.id === request.assignment_id);
                const requester = servants.find(servant => servant.id === request.requester_servant_id);
                const targetSchedule = request.target_schedule_id ? schedules.find(schedule => schedule.id === request.target_schedule_id) : undefined;
                const targetAssignment = targetSchedule?.assignments.find(assignment => assignment.id === request.target_assignment_id);
                const targetIsReviewable = Boolean(
                  sourceSchedule?.status === "published" && targetSchedule?.status === "published" && targetAssignment &&
                  targetAssignment.servant_id === request.target_servant_id && targetAssignment.servant_id !== request.requester_servant_id,
                );

                return (
                  <div className="request-row" key={request.id}>
                    <div className="request-main">
                      <b>{requester?.full_name ?? "Servant"} · swap</b>
                      <small>{sourceSchedule ? `${fmtDate(sourceSchedule.service_date)} · ${sourceSchedule.location_name} · ${sourceSchedule.service_name}${sourceAssignment ? ` · ${sourceAssignment.role}` : ""}` : "Original schedule unavailable"}</small>
                      <div className="request-target">
                        <b>Proposed swap target</b>
                        {targetSchedule && targetAssignment && targetIsReviewable ? <>
                          <small>{fmtDate(targetSchedule.service_date)} · {targetSchedule.location_name} · {targetSchedule.service_name}</small>
                          <small>{targetAssignment.servant_name} · {targetAssignment.role}</small>
                        </> : <small role="status">Target service or assignment is no longer available. Refresh the schedule before approving.</small>}
                      </div>
                      <small>{request.details || "No details provided"}</small>
                      <span className={`status-chip ${request.status}`}>{request.status}</span>
                    </div>
                    {request.status === "pending" && <div className="request-actions">
                      <button type="button" className="btn tiny primary" disabled={!targetIsReviewable} onClick={() => onReview(request, true)}>Approve swap</button>
                      <button type="button" className="btn tiny secondary" onClick={() => onReview(request, false)}>Decline request</button>
                    </div>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {section === "notifications" && <>
        {notificationSettings}
        <section className="requests-content-card notification-history-section">
          <div className="list-heading requests-content-heading">
            <h2>Notification history</h2>
            <span>{notifications.length} in the last 30 days</span>
          </div>
          {notifications.length === 0 ? <div className="requests-empty-note">No notifications in the last 30 days.</div> : (
            <div className="notification-history-list">
              {notifications.map(notification => <article
                className={`inbox-item ${notification.is_read ? "read" : "unread"}`}
                key={notification.id}
                role="button"
                tabIndex={0}
                onClick={() => onNotificationRead(notification.id)}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onNotificationRead(notification.id);
                  }
                }}
              >
                <div className="inbox-item-body">
                  <b>{notification.title}</b>
                  <p>{notification.body}</p>
                  <small>{fmtDateTime(notification.created_at)}</small>
                </div>
                <span className="inbox-status approved">{notification.is_read ? "Read" : "New"}</span>
              </article>)}
            </div>
          )}
        </section>
      </>}
    </section>
  );
}
