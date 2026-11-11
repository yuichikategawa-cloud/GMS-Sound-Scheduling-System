import { useState } from "react";
import type { ReactNode } from "react";
import "./RequestsInbox.css";
import { fmtDate, fmtDateTime } from "../../../shared/formatters";
import type { ScheduleView, Servant, ServingNotificationRecord } from "../../../types";
import type { ServingRequestRecord } from "../services/requestData";

export default function RequestsPanel({
  requests,
  schedules,
  servants,
  onReview,
  onResolve,
  notifications,
  onNotificationRead,
  notificationSettings,
}: {
  requests: ServingRequestRecord[];
  schedules: ScheduleView[];
  servants: Servant[];
  onReview: (request: ServingRequestRecord, approve: boolean) => void;
  onResolve: (request: ServingRequestRecord, replacementServantId: string) => void;
  notifications: ServingNotificationRecord[];
  onNotificationRead: (id: string) => void;
  notificationSettings:ReactNode;
}) {
  const pending = requests.filter(request => request.status === "pending");
  const [replacementChoice, setReplacementChoice] = useState<Record<string, string>>({});

  return (
    <section className="requests-panel">
      {notificationSettings}
      <section className="requests-content-card notification-history-section">
        <div className="list-heading requests-content-heading">
          <h2>Notification history</h2>
          <span>{notifications.length} in the last 30 days</span>
        </div>
        {notifications.length === 0 ? (
          <div className="requests-empty-note">No notifications in the last 30 days.</div>
        ) : (
          <div className="notification-history-list">
            {notifications.map(notification => (
              <article
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
                <span className="inbox-status approved">
                  {notification.is_read ? "Read" : "New"}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="requests-content-card servant-requests-section">
        <div className="list-heading requests-content-heading">
          <h2>Servant requests</h2>
          <span>{pending.length} pending</span>
        </div>
        {requests.length === 0 ? (
          <div className="requests-empty-note">No replacement or swap requests yet.</div>
        ) : (
          <div className="people-list">
            {requests.map(request => {
              const sourceSchedule = schedules.find(schedule => schedule.id === request.schedule_id);
              const sourceAssignment = sourceSchedule?.assignments.find(
                assignment => assignment.id === request.assignment_id,
              );
              const requester = servants.find(servant => servant.id === request.requester_servant_id);
              const replacementCandidates = servants.filter(
                servant => servant.active && servant.id !== request.requester_servant_id,
              );

              const targetSchedule = request.target_schedule_id
                ? schedules.find(schedule => schedule.id === request.target_schedule_id)
                : undefined;
              const targetAssignment = targetSchedule?.assignments.find(
                assignment => assignment.id === request.target_assignment_id,
              );
              const targetIsReviewable = Boolean(
                sourceSchedule?.status === "published" &&
                targetSchedule?.status === "published" &&
                targetAssignment &&
                targetAssignment.servant_id === request.target_servant_id &&
                targetAssignment.servant_id !== request.requester_servant_id,
              );

              return (
                <div className="request-row" key={request.id}>
                  <div className="request-main">
                    <b>{requester?.full_name ?? "Servant"} · {request.request_type}</b>
                    <small>
                      {sourceSchedule
                        ? `${fmtDate(sourceSchedule.service_date)} · ${sourceSchedule.location_name} · ${sourceSchedule.service_name}`
                        : "Original schedule unavailable"}
                      {sourceAssignment ? ` · ${sourceAssignment.role}` : ""}
                    </small>
                    {request.request_type === "swap" && (
                      <div className="request-target">
                        <b>Proposed swap target</b>
                        {targetSchedule && targetAssignment && targetIsReviewable ? (
                          <>
                            <small>
                              {fmtDate(targetSchedule.service_date)} · {targetSchedule.location_name} · {targetSchedule.service_name}
                            </small>
                            <small>{targetAssignment.servant_name} · {targetAssignment.role}</small>
                          </>
                        ) : (
                          <small role="status">
                            Target service or assignment is no longer available. Refresh the schedule before approving.
                          </small>
                        )}
                      </div>
                    )}
                    <small>{request.details || "No details provided"}</small>
                    <span className={`status-chip ${request.status}`}>{request.status}</span>
                  </div>

                  {request.status === "pending" && (
                    <div className="request-actions">
                      {request.request_type === "replacement" ? (
                        <>
                          <select
                            aria-label={`Replacement servant for ${requester?.full_name ?? "request"}`}
                            value={replacementChoice[request.id] ?? ""}
                            onChange={event => setReplacementChoice(current => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))}
                          >
                            <option value="">Choose replacement servant</option>
                            {replacementCandidates.map(servant => (
                              <option key={servant.id} value={servant.id}>{servant.full_name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn tiny primary"
                            disabled={!replacementChoice[request.id]}
                            onClick={() => onResolve(request, replacementChoice[request.id])}
                          >
                            Assign replacement
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn tiny primary"
                          disabled={!targetIsReviewable}
                          onClick={() => onReview(request, true)}
                        >
                          Approve swap
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn tiny secondary"
                        onClick={() => onReview(request, false)}
                      >
                        Decline request
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
