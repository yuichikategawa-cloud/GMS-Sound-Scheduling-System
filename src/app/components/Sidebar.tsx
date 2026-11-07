import "./Sidebar.css";
import {
  AudioLines,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Inbox as InboxIcon,
  LogOut,
  Users
} from "lucide-react";

export type SidebarTab =
  | "schedule"
  | "people"
  | "servantInfo"
  | "availability"
  | "statistics"
  | "audit"
  | "profile"
  | "inbox"
  | "requests";

type SidebarProps = {
  activeTab: SidebarTab;
  isAdmin: boolean;
  displayName: string;
  unreadServantRequestCount: number;
  adminRequestCount: number;
  onSelectTab: (tab: SidebarTab) => void;
  onCloseMobileNav: () => void;
  onSignOut: () => void;
};

export default function Sidebar({
  activeTab,
  isAdmin,
  displayName,
  unreadServantRequestCount,
  adminRequestCount,
  onSelectTab,
  onCloseMobileNav,
  onSignOut
}: SidebarProps) {
  const selectTab = (tab: SidebarTab) => {
    onSelectTab(tab);
    onCloseMobileNav();
  };

  return (
    <aside className="sidebar">
      <div className="brand brand-sound-identity">
        <div className="brand-sound-icon"><AudioLines size={25} /></div>
        <div className="brand-sound-copy">
          <b>GMS Sound Scheduling</b>
          <small>SERVE WITH EXCELLENCE</small>
        </div>
      </div>
      <div className="nav-label">WORKSPACE</div>
      <button className={"nav-item " + (activeTab === "schedule" ? "active" : "")} onClick={() => selectTab("schedule")}>
        <CalendarDays size={18} /> Schedule
      </button>
      <button className={"nav-item " + (activeTab === "availability" ? "active" : "")} onClick={() => selectTab("availability")}>
        <ClipboardCheck size={18} /> Availability
      </button>
      {!isAdmin && (
        <button className={"nav-item " + (activeTab === "inbox" ? "active" : "")} onClick={() => selectTab("inbox")}>
          <InboxIcon size={18} /> Inbox
          {unreadServantRequestCount > 0 && (
            <span className="inbox-count">{unreadServantRequestCount}</span>
          )}
        </button>
      )}
      {isAdmin && (
        <button className={"nav-item " + (activeTab === "requests" ? "active" : "")} onClick={() => selectTab("requests")}>
          <InboxIcon size={18} /> Servant Requests
          {adminRequestCount > 0 && (
            <span className="inbox-count">{adminRequestCount}</span>
          )}
        </button>
      )}
      {!isAdmin && (
        <button className={"nav-item " + (activeTab === "profile" ? "active" : "")} onClick={() => selectTab("profile")}>
          <Users size={18} /> My profile
        </button>
      )}
      {isAdmin && (
        <>
          <button className={"nav-item " + (activeTab === "servantInfo" ? "active" : "")} onClick={() => selectTab("servantInfo")}>
            <Users size={18} /> Servant Information
          </button>
          <button className={"nav-item " + (activeTab === "statistics" ? "active" : "")} onClick={() => selectTab("statistics")}>
            <BarChart3 size={18} /> Statistics
          </button>
          <button className={"nav-item " + (activeTab === "audit" ? "active" : "")} onClick={() => selectTab("audit")}>
            <ClipboardCheck size={18} /> Audit log
          </button>
        </>
      )}
      <div className="sidebar-bottom">
        <div className="user-chip">
          <div className="avatar">{(displayName || "G").slice(0, 1).toUpperCase()}</div>
          <div className="user-meta">
            <b>{displayName}</b>
            <small>{isAdmin ? "Administrator" : "Servant"}</small>
          </div>
          <button title="Sign out" className="icon-btn" onClick={onSignOut}>
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}
