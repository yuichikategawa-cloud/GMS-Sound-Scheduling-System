import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./ServantInformationPanel.css";
import type { ReactNode } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import type { Location, Role, ScheduleView, Servant } from "../../../types";
import { displayList, errorText, fmtDate } from "../../../shared/formatters";

type ServantInformationPanelProps = {
  isAdmin: boolean;
  servants: Servant[];
  memberDirectory: any[];
  accountCandidates: any[];
  locations: Location[];
  schedules: ScheduleView[];
  requests: any[];
  onAdd: () => void;
  onToggle: (servant: Servant) => void;
  onSaveLocationRoles: (servant: Servant, rolesByLocation: Record<string, Role[]>) => Promise<boolean>;
  onLink: (servant: Servant, userId: string, verifiedNij: string) => Promise<boolean>;
};

export default function ServantInformationPanel({
  isAdmin,
  servants,
  memberDirectory,
  accountCandidates,
  locations,
  schedules,
  requests,
  onAdd,
  onToggle,
  onSaveLocationRoles,
  onLink,
}: ServantInformationPanelProps) {
  const [query, setQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [cgFilter, setCgFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openSummary, setOpenSummary] = useState({
    overview: true,
    church: true,
    cg: true,
    leadership: false,
    health: false,
  });
  const [expanded, setExpanded] = useState<string[]>([]);
  const [linkChoices, setLinkChoices] = useState<Record<string, string>>({});
  const [linkNijs, setLinkNijs] = useState<Record<string, string>>({});
  const [linkBusy, setLinkBusy] = useState<Record<string, boolean>>({});
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  const [linkingServant, setLinkingServant] = useState<Servant | null>(null);
  const [roleMatrixDrafts, setRoleMatrixDrafts] = useState<Record<string, Record<string, Role[]>>>({});
  const [roleBusy, setRoleBusy] = useState<Record<string, boolean>>({});
  const soundRoles: Role[] = ["FOH", "Monitor", "Assistant"];


  useEffect(() => {
    if (!linkingServant) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLinkingServant(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [linkingServant?.id]);

  const profiles = new Map(memberDirectory.map((member: any) => [member.user_id, member]));
  const rows = servants.map(servant => ({
    servant,
    profile: profiles.get(servant.auth_user_id) as any,
  }));
  const value = (row: any, key: string) => row.profile?.[key] ?? row.servant?.[key] ?? "";
  const linked = rows.filter(row => !!row.servant.auth_user_id).length;
  const verified = rows.filter(row =>
    row.profile?.last_verified_at && Date.now() - new Date(row.profile.last_verified_at).getTime() <= 90 * 86400000
  ).length;
  const overdue = rows.filter(row =>
    !row.profile?.last_verified_at || Date.now() - new Date(row.profile.last_verified_at).getTime() > 90 * 86400000
  ).length;
  const missingPhone = rows.filter(row => !value(row, "phone_number")).length;
  const missingCg = rows.filter(row =>
    !value(row, "cg_category") || !value(row, "cg_number") || !value(row, "cg_status")
  ).length;

  const countBy = (getValue: (row: any) => string) => {
    const counts = new Map<string, number>();
    rows.forEach(row => {
      const key = getValue(row) || "Not recorded";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  const servantLocationNames = (servantId: string) => [
    ...new Set(
      schedules
        .filter(schedule => schedule.assignments.some(assignment => assignment.servant_id === servantId))
        .map(schedule => schedule.location_name)
        .filter(Boolean),
    ),
  ];
  const churchCounts = locations
    .map(location => [
      location.name,
      rows.filter(row => servantLocationNames(row.servant.id).includes(location.name)).length,
    ] as [string, number])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const unassignedLocationCount = rows.filter(row => servantLocationNames(row.servant.id).length === 0).length;
  if (unassignedLocationCount) churchCounts.push(["No serving assignment", unassignedLocationCount]);

  const cgCounts = countBy(row => value(row, "cg_category"));
  const roleCounts = countBy(row => value(row, "cg_status"));
  const domicileCounts = countBy(row => value(row, "domicile_area"));
  const filtered = rows.filter(row => {
    const haystack = [
      row.servant.full_name,
      row.profile?.email,
      row.profile?.username,
      value(row, "cg_number"),
      value(row, "cg_category"),
      value(row, "phone_number"),
    ].join(" ").toLowerCase();
    const selectedLocation = locations.find(location => location.id === locationFilter)?.name;
    return (!query || haystack.includes(query.toLowerCase()))
      && (!locationFilter || servantLocationNames(row.servant.id).some(name => selectedLocation === name))
      && (!cgFilter || value(row, "cg_category") === cgFilter)
      && (!statusFilter || (
        statusFilter === "linked" ? !!row.servant.auth_user_id
          : statusFilter === "unlinked" ? !row.servant.auth_user_id
            : row.servant.active
      ));
  });

  const toggle = (id: string) => setExpanded(current =>
    current.includes(id) ? current.filter(value => value !== id) : [...current, id]
  );

  const roleMatrixFor = (servant: Servant): Record<string, Role[]> => {
    const saved = servant.qualified_roles_by_location;
    const fallbackRoles = servant.qualified_roles ?? soundRoles;
    const matrix = roleMatrixDrafts[servant.id] ?? saved ??
      Object.fromEntries(locations.map((location) => [location.id, fallbackRoles.slice()]));
    return Object.fromEntries(locations.map((location) => [
      location.id,
      (matrix[location.id] ?? []).slice(),
    ]));
  };

  const saveLocationRoles = async (servant: Servant) => {
    const rolesByLocation = roleMatrixFor(servant);
    setRoleBusy((current) => ({ ...current, [servant.id]: true }));
    try {
      const saved = await onSaveLocationRoles(servant, rolesByLocation);
      if (saved) {
        setRoleMatrixDrafts((current) => {
          const next = { ...current };
          delete next[servant.id];
          return next;
        });
      }
    } finally {
      setRoleBusy((current) => ({ ...current, [servant.id]: false }));
    }
  };

  const toggleLocationRole = (
    servant: Servant,
    locationId: string,
    role: Role,
    checked: boolean,
  ) => {
    const current = roleMatrixFor(servant);
    const selected = current[locationId] ?? [];
    const next = checked
      ? [...new Set([...selected, role])]
      : selected.filter((item) => item !== role);
    setRoleMatrixDrafts((drafts) => ({
      ...drafts,
      [servant.id]: { ...current, [locationId]: next },
    }));
  };

  const matrixHasChanges = (servant: Servant): boolean => {
    const current = roleMatrixFor(servant);
    const saved = servant.qualified_roles_by_location ??
      Object.fromEntries(locations.map((location) => [
        location.id,
        (servant.qualified_roles ?? soundRoles).slice(),
      ]));
    return locations.some((location) =>
      JSON.stringify([...(current[location.id] ?? [])].sort()) !==
      JSON.stringify([...(saved[location.id] ?? [])].sort())
    );
  };

  const submitLink = async (servant: Servant) => {
    const userId = linkChoices[servant.id] ?? "";
    const nij = linkNijs[servant.id] ?? "";
    if (!userId || !nij.trim()) {
      setLinkErrors(current => ({ ...current, [servant.id]: "Select an account and enter the verified NIJ." }));
      return;
    }
    setLinkBusy(current => ({ ...current, [servant.id]: true }));
    setLinkErrors(current => ({ ...current, [servant.id]: "" }));
    try {
      const success = await onLink(servant, userId, nij);
      if (success) {
        setLinkChoices(current => ({ ...current, [servant.id]: "" }));
        setLinkNijs(current => ({ ...current, [servant.id]: "" }));
        setLinkingServant(current => current?.id === servant.id ? null : current);
      } else {
        setLinkErrors(current => ({
          ...current,
          [servant.id]: "Linking was not completed. Review the error message above and resolve the issue before retrying.",
        }));
      }
    } catch (error) {
      setLinkErrors(current => ({ ...current, [servant.id]: errorText(error) }));
    } finally {
      setLinkBusy(current => ({ ...current, [servant.id]: false }));
    }
  };

  const section = (
    key: keyof typeof openSummary,
    title: string,
    subtitle: string,
    body: ReactNode,
  ) => (
    <details
      className="servant-summary-section"
      open={openSummary[key]}
      onToggle={event => {
        const isOpen = (event.currentTarget as HTMLDetailsElement).open;
        setOpenSummary(current => ({ ...current, [key]: isOpen }));
      }}
    >
      <summary>
        <span><b>{title}</b><small>{subtitle}</small></span>
        <ChevronDown size={18} />
      </summary>
      <div className="servant-summary-body">{body}</div>
    </details>
  );

  const bars = (items: [string, number][]) => (
    <div className="servant-bars">
      {items.map(([name, count]) => (
        <div className="servant-bar-row" key={name}>
          <div>
            <span>{name}</span>
            <b>{count} <small>({rows.length ? Math.round(count / rows.length * 100) : 0}%)</small></b>
          </div>
          <div className="servant-bar-track">
            <i style={{ width: `${rows.length ? count / rows.length * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="servant-info-page">
      <div className="toolbar">
        <div>
          <h2>Servant Information</h2>
          <p className="subtle">A complete overview of the serving community, CG structure and profile readiness.</p>
        </div>
        <button className="btn primary" onClick={onAdd}><Plus size={16} /> Add servant</button>
      </div>

      <div className="servant-kpi-grid">
        <div className="servant-kpi"><span>TOTAL SERVANTS</span><b>{rows.length}</b><small>All registered servant records</small></div>
        <div className="servant-kpi"><span>ACTIVE SERVANTS</span><b>{rows.filter(row => row.servant.active).length}</b><small>Currently eligible for scheduling</small></div>
        <div className="servant-kpi"><span>LINKED ACCOUNTS</span><b>{linked} <small>/ {rows.length}</small></b><small>{rows.length ? Math.round(linked / rows.length * 100) : 0}% connected to login</small></div>
        <div className="servant-kpi"><span>PROFILE FOLLOW-UP</span><b>{overdue}</b><small>{verified} verified within 90 days</small></div>
      </div>

      {section("overview", "1. Servant overview", "Account access, active status and profile verification", (
        <div className="servant-mini-grid">
          <div><b>{rows.length - linked}</b><span>Not linked to login</span></div>
          <div><b>{rows.filter(row => !row.servant.active).length}</b><span>Inactive servants</span></div>
          <div><b>{missingPhone}</b><span>Missing phone number</span></div>
          <div><b>{missingCg}</b><span>Incomplete CG information</span></div>
          <div><b>{requests.filter((request: any) => request.status === "pending").length}</b><span>Pending serving requests</span></div>
          <div><b>{schedules.filter(schedule => schedule.status === "published").length}</b><span>Published services</span></div>
        </div>
      ))}
      {section("church", "2. Church distribution", "Servants by assigned serving location", bars(churchCounts))}
      {section("cg", "3. CG distribution", "Servants by community group and domicile", (
        <div className="servant-two-col">
          <div><h4>CG category</h4>{bars(cgCounts)}</div>
          <div><h4>Domicile area</h4>{bars(domicileCounts)}</div>
        </div>
      ))}
      {section("leadership", "4. CG leadership structure", "Team Leader, Coach, CG Leader, Sponsor and Member roles", bars(roleCounts))}
      {section("health", "5. Profile health", "Records requiring follow-up or verification", (
        <div className="servant-health-list">
          <div><span>Verified within 90 days</span><b>{verified}</b></div>
          <div><span>Verification overdue / not recorded</span><b>{overdue}</b></div>
          <div><span>Missing phone number</span><b>{missingPhone}</b></div>
          <div><span>Missing CG information</span><b>{missingCg}</b></div>
        </div>
      ))}

      <div className="servant-directory-block">
        <div className="servant-directory-heading">
          <div>
            <h3>Detailed servant information</h3>
            <p className="subtle">Expand an individual record to view personal, CG, leadership and account details.</p>
          </div>
          <b>{filtered.length} records</b>
        </div>
        <div className="servant-filters">
          <input aria-label="Search servant" placeholder="Search name, username, email, phone or CG" value={query} onChange={event => setQuery(event.target.value)} />
          <select value={locationFilter} onChange={event => setLocationFilter(event.target.value)}>
            <option value="">All locations</option>
            {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <select value={cgFilter} onChange={event => setCgFilter(event.target.value)}>
            <option value="">All CG categories</option>
            {["AOG Teen", "AOG Youth", "Young Adult", "Family", "Senior"].map(category => <option key={category}>{category}</option>)}
          </select>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="">All accounts/status</option>
            <option value="linked">Linked account</option>
            <option value="unlinked">Not linked</option>
            <option value="active">Active only</option>
          </select>
        </div>

        <div className="servant-record-list">
          {filtered.length === 0 ? (
            <div className="servant-empty-state">
              <b>No servant records to display</b>
              <p>{servants.length === 0 ? "No servant rows were returned. Check the Supabase servants table and its SELECT policy for the admin role." : "No servants match the current search or filters."}</p>
              <button className="btn secondary" onClick={() => {
                setQuery("");
                setLocationFilter("");
                setCgFilter("");
                setStatusFilter("");
              }}>Clear filters</button>
            </div>
          ) : filtered.map(({ servant, profile }) => (
            <article className="servant-record" key={servant.id}>
              <div className="servant-record-heading">
                <button className="servant-record-summary" onClick={() => toggle(servant.id)}>
                  <span className="servant-avatar">{servant.full_name.slice(0, 1).toUpperCase()}</span>
                  <span className="servant-record-name">
                    <b>{servant.full_name}</b>
                    <small>{value({ servant, profile }, "cg_category") || "CG not recorded"} · {servantLocationNames(servant.id).join(", ") || "No serving assignment"}</small>
                  </span>
                  <span className={`servant-account-chip ${servant.auth_user_id ? "linked" : "unlinked"}`}>{servant.auth_user_id ? "Linked" : "Not linked"}</span>
                  <ChevronDown size={18} />
                </button>
                {isAdmin && !servant.auth_user_id && servant.active && (
                  <button
                    type="button"
                    className="btn tiny secondary servant-link-trigger"
                    aria-haspopup="dialog"
                    aria-expanded={linkingServant?.id === servant.id}
                    onClick={() => setLinkingServant(servant)}
                  >Link account</button>
                )}
              </div>

              {expanded.includes(servant.id) && (
                <div className="servant-record-detail">
                  <div>
                    <h4>Personal information</h4>
                    <p><b>Email:</b> {profile?.email || "—"}</p>
                    <p><b>Gender:</b> {value({ servant, profile }, "gender") || "—"}</p>
                    <p><b>Date of birth:</b> {value({ servant, profile }, "date_of_birth") || "—"}</p>
                    <p><b>NIJ:</b> {value({ servant, profile }, "nij") || "—"}</p>
                    <p><b>Phone:</b> {value({ servant, profile }, "phone_number") || "—"}</p>
                    <p><b>Domicile:</b> {[value({ servant, profile }, "domicile_area"), value({ servant, profile }, "domicile_other")].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  <div>
                    <h4>CG information</h4>
                    <p><b>Category:</b> {value({ servant, profile }, "cg_category") || "—"}</p>
                    <p><b>Status:</b> {value({ servant, profile }, "cg_status") || "—"}</p>
                    <p><b>CG number:</b> {value({ servant, profile }, "cg_number") || "—"}</p>
                    <p><b>Days:</b> {displayList(value({ servant, profile }, "cg_days")) || "—"}</p>
                    <p><b>Time:</b> {value({ servant, profile }, "cg_time") || "—"}</p>
                  </div>
                  <div>
                    <h4>Leadership &amp; account</h4>
                    <p><b>Team Leader:</b> {value({ servant, profile }, "team_leader_name") || "—"}</p>
                    <p><b>Coach:</b> {value({ servant, profile }, "coach_name") || "—"}</p>
                    <p><b>CG Leader:</b> {value({ servant, profile }, "cg_leader_name") || "—"}</p>
                    <p><b>Leader phone(s):</b> {displayList(value({ servant, profile }, "leader_phone_numbers")) || "—"}</p>
                    <p><b>Account:</b> {profile?.username || "No username linked"}</p>
                    <p><b>Profile verified:</b> {profile?.last_verified_at ? fmtDate(new Date(profile.last_verified_at).toLocaleDateString("en-CA")) : "Not yet verified"}</p>
                    <p><b>Serving status:</b> {servant.active ? "Active" : "Inactive"}</p>

                    <button className={`btn tiny servant-status-toggle ${servant.active ? "danger" : "primary"}`} onClick={() => onToggle(servant)}>
                      {servant.active ? "Deactivate servant" : "Activate servant"}
                    </button>
                  </div>
                  <div className="servant-role-qualification">
                    <div className="servant-role-qualification-heading">
                      <div>
                        <span className="servant-role-qualification-eyebrow">SMART SCHEDULING</span>
                        <h4>Church-specific sound role qualifications</h4>
                        <p>Approve each position separately for every church. An unchecked church has no eligible roles for this servant.</p>
                      </div>
                      <span className="servant-role-qualification-count">
                        {locations.reduce((count, location) => count + roleMatrixFor(servant)[location.id].length, 0)} role permissions
                      </span>
                    </div>
                    <div className="servant-location-role-grid">
                      {locations.map((location) => {
                        const selected = roleMatrixFor(servant)[location.id] ?? [];
                        return (
                          <section className="servant-location-role-card" key={location.id} aria-label={location.name + " qualifications"}>
                            <div className="servant-location-role-heading">
                              <b>{location.name}</b>
                              <span>{selected.length ? selected.length + " of 3 roles" : "Not eligible"}</span>
                            </div>
                            {isAdmin ? (
                              <div className="servant-role-qualification-options">
                                {soundRoles.map((role) => {
                                  const checked = selected.includes(role);
                                  return (
                                    <label key={role} className={checked ? "is-selected" : ""}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(event) => toggleLocationRole(servant, location.id, role, event.target.checked)}
                                      />
                                      <span>{role}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="servant-role-readonly-list">
                                {selected.length
                                  ? selected.map((role) => <span key={role}>{role}</span>)
                                  : <small>Not qualified for this church.</small>}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                    {isAdmin && (
                      <div className="servant-location-role-actions">
                        <small>These permissions are enforced by Smart Scheduling and the database when assignments are saved.</small>
                        <button
                          type="button"
                          className="btn tiny primary"
                          disabled={roleBusy[servant.id] || !matrixHasChanges(servant)}
                          onClick={() => void saveLocationRoles(servant)}
                        >{roleBusy[servant.id] ? "Saving…" : "Save church qualifications"}</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      {linkingServant && typeof document !== "undefined" && createPortal(
        <div
          className="servant-link-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setLinkingServant(null);
          }}
        >
          <section
            className="servant-link-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="servant-link-dialog-title"
          >
            <div className="servant-link-dialog-heading">
              <div>
                <h3 id="servant-link-dialog-title">Link existing account</h3>
                <p>Link an existing login to <b>{linkingServant.full_name}</b>.</p>
              </div>
              <button
                type="button"
                className="icon-btn servant-link-dialog-close"
                aria-label="Close account linking dialog"
                onClick={() => setLinkingServant(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="servant-link-dialog-description">
              Select the member's existing login and verify the NIJ against their identity record before linking.
            </p>
            <div className="servant-link-dialog-fields">
              <label>
                Member account
                <select
                  value={linkChoices[linkingServant.id] ?? ""}
                  onChange={event => setLinkChoices(current => ({ ...current, [linkingServant.id]: event.target.value }))}
                >
                  <option value="">Choose a member account</option>
                  {accountCandidates.map((account: any) => (
                    <option key={account.user_id} value={account.user_id}>
                      {account.full_name} · {account.username || account.email || "No username"}{account.linked_servant ? ` (currently linked to ${account.linked_servant.full_name})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Verify NIJ
                <input
                  type="password"
                  autoComplete="off"
                  value={linkNijs[linkingServant.id] ?? ""}
                  onChange={event => setLinkNijs(current => ({ ...current, [linkingServant.id]: event.target.value }))}
                  placeholder="Enter NIJ for identity verification"
                />
              </label>
            </div>
            {accountCandidates.length === 0 && (
              <p className="servant-link-dialog-note">
                No completed servant member profiles are available for linking. Ask the member to complete their profile first.
              </p>
            )}
            {linkErrors[linkingServant.id] && (
              <p className="servant-link-dialog-error" role="alert">{linkErrors[linkingServant.id]}</p>
            )}
            <button
              type="button"
              className="btn primary servant-link-dialog-submit"
              disabled={!!linkBusy[linkingServant.id] || !linkChoices[linkingServant.id] || !(linkNijs[linkingServant.id] ?? "").trim()}
              onClick={() => void submitLink(linkingServant)}
            >
              {linkBusy[linkingServant.id] ? "Linking account…" : "Link verified account"}
            </button>
            <p className="servant-link-dialog-footnote">
              Linking may consolidate an automatically created duplicate servant row. Historical assignment or request conflicts are blocked for manual review.
            </p>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}