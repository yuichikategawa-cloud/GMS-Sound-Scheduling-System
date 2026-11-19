import { useMemo } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Users } from "lucide-react";
import type { ScheduleView, Servant } from "../../../types";
import { fmtDate, isScheduleUpcoming } from "../../../shared/formatters";
import type { AvailabilityRecord, ServingPreferenceRecord, ServingRequestRecord } from "../../../shared/contracts/scheduling.ts";
import { findCoverCandidates } from "../services/coverCandidates";
import "./CoverageWorkspace.css";

type CoverageWorkspaceProps = {
  requests: ServingRequestRecord[];
  schedules: ScheduleView[];
  servants: Servant[];
  availability: AvailabilityRecord[];
  preferences: ServingPreferenceRecord[];
  loading: boolean;
  focusedRequestId: string | null;
  onAssignCover: (request: ServingRequestRecord, servantId: string) => void;
};

export default function CoverageWorkspace({
  requests, schedules, servants, availability, preferences, loading, focusedRequestId, onAssignCover,
}: CoverageWorkspaceProps) {
  const openRequests = useMemo(() => requests
    .filter(request => request.request_type === "replacement" && request.status === "pending")
    .sort((left, right) => Number(right.id === focusedRequestId) - Number(left.id === focusedRequestId) || left.created_at.localeCompare(right.created_at)), [requests, focusedRequestId]);

  return (
    <main className="coverage-workspace">
      <header className="coverage-heading">
        <div>
          <h2>Coverage</h2>
          <p className="subtle">Review replacement requests and find an eligible servant for each service.</p>
        </div>
        <span className="coverage-open-count"><AlertTriangle size={15} /> {openRequests.length} open</span>
      </header>

      {openRequests.length === 0 ? (
        <section className="coverage-empty-card">
          <span className="coverage-empty-icon"><CheckCircle2 size={21} /></span>
          <div><b>All covered</b><p>There are no pending replacement requests.</p></div>
        </section>
      ) : (
        <div className="coverage-case-list">
          {openRequests.map(request => {
            const schedule = schedules.find(item => item.id === request.schedule_id);
            const assignment = schedule?.assignments.find(item => item.id === request.assignment_id);
            const originalServant = servants.find(person => person.id === request.requester_servant_id);
            const candidates = findCoverCandidates(request, schedule, schedules, servants, availability, preferences);
            const current = Boolean(
              schedule && assignment && assignment.servant_id === request.requester_servant_id &&
              schedule.status === "published" && isScheduleUpcoming(schedule.service_date, schedule.start_time),
            );

            return (
              <article className={`coverage-case-card ${request.id === focusedRequestId ? "focused" : ""}`} key={request.id}>
                <div className="coverage-case-heading">
                  <div className="coverage-case-icon"><Users size={18} /></div>
                  <div className="coverage-case-title">
                    <div><h3>{schedule?.service_name ?? "Service unavailable"}</h3><span className="coverage-role-chip">{assignment?.role ?? "Role unavailable"}</span></div>
                    <p>{schedule ? `${fmtDate(schedule.service_date)} · ${schedule.start_time.slice(0, 5)} · ${schedule.location_name}` : "The original schedule could not be found."}</p>
                  </div>
                  <span className="coverage-status"><Clock3 size={13} /> Needs cover</span>
                </div>

                <div className="coverage-case-context">
                  <span>Replacing <b>{originalServant?.full_name ?? "Unknown servant"}</b></span>
                  <span>{request.details?.trim() || "No reason provided"}</span>
                </div>

                {!current ? (
                  <div className="coverage-case-warning" role="status">
                    <AlertTriangle size={15} /> This request no longer matches an upcoming published assignment. Review it in Servant Requests.
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="coverage-case-warning" role="status">
                    <AlertTriangle size={15} /> No eligible cover candidates match the role, availability, preferences and schedule checks.
                  </div>
                ) : (
                  <div className="coverage-candidates">
                    <div className="coverage-candidates-heading"><b>Suggested cover</b><span>{candidates.length} eligible</span></div>
                    {candidates.map((candidate, index) => (
                      <div className="coverage-candidate" key={candidate.servant.id}>
                        <div className="coverage-candidate-rank">{index + 1}</div>
                        <div className="coverage-candidate-info">
                          <b>{candidate.servant.full_name}</b>
                          <span>{candidate.notes.join(" · ")}</span>
                        </div>
                        {candidate.availability === "available" && <span className="coverage-available-pill">Available</span>}
                        {candidate.availability === "prefer_not" && <span className="coverage-prefer-pill">Prefer not</span>}
                        <button
                          type="button"
                          className="btn tiny primary coverage-assign-button"
                          disabled={loading}
                          onClick={() => onAssignCover(request, candidate.servant.id)}
                        >
                          Assign cover <ArrowRight size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
