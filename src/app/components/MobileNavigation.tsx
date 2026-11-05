import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Inbox as InboxIcon,
  LogOut,
  MoreHorizontal,
  Moon,
  Smartphone,
  Sun,
  UserRound,
  Users
} from "lucide-react";
import type { SidebarTab } from "./Sidebar";

type MobileNavigationProps = {
  activeTab: SidebarTab;
  isAdmin: boolean;
  open: boolean;
  pwaInstalled: boolean;
  theme: "light" | "dark";
  showInboxBadge: boolean;
  onSelectTab: (tab: SidebarTab) => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleTheme: () => void;
  onInstallApp: () => void;
  onSignOut: () => void;
};

export default function MobileNavigation({
  activeTab,
  isAdmin,
  open,
  pwaInstalled,
  theme,
  showInboxBadge,
  onSelectTab,
  onToggleMenu,
  onCloseMenu,
  onToggleTheme,
  onInstallApp,
  onSignOut
}: MobileNavigationProps) {
  const selectTab = (tab: SidebarTab) => {
    onSelectTab(tab);
    onCloseMenu();
  };

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Primary navigation">
        <button
          className={"mobile-nav-item " + (activeTab === "schedule" ? "active" : "")}
          onClick={() => selectTab("schedule")}
        >
          <CalendarDays size={20} /><span>Schedule</span>
        </button>
        <button
          className={"mobile-nav-item " + (activeTab === "availability" ? "active" : "")}
          onClick={() => selectTab("availability")}
        >
          <ClipboardCheck size={20} /><span>Availability</span>
        </button>
        <button
          className={"mobile-nav-item " + ((!isAdmin && activeTab === "inbox") || (isAdmin && activeTab === "requests") ? "active" : "")}
          onClick={() => selectTab(isAdmin ? "requests" : "inbox")}
        >
          <InboxIcon size={20} /><span>{isAdmin ? "Requests" : "Inbox"}</span>
          {showInboxBadge && <i className="mobile-nav-badge" />}
        </button>
        <button
          className={"mobile-nav-item " + (open ? "active" : "")}
          aria-expanded={open}
          onClick={onToggleMenu}
        >
          <MoreHorizontal size={20} /><span>More</span>
        </button>
      </nav>

      {open && (
        <div className="mobile-more-backdrop" onClick={onCloseMenu}>
          <div className="mobile-more-menu" onClick={event => event.stopPropagation()}>
            <div className="mobile-more-heading">More options</div>
            <button onClick={onToggleTheme} aria-pressed={theme === "dark"}>
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            {!pwaInstalled && (
              <button onClick={() => { onCloseMenu(); onInstallApp(); }}>
                <Smartphone size={18} /> Install app
              </button>
            )}
            {!isAdmin && (
              <button onClick={() => selectTab("profile")}>
                <UserRound size={18} /> My profile
              </button>
            )}
            {isAdmin && (
              <>
                <button onClick={() => selectTab("servantInfo")}>
                  <Users size={18} /> Servant Information
                </button>
                <button onClick={() => selectTab("statistics")}>
                  <BarChart3 size={18} /> Statistics
                </button>
                <button onClick={() => selectTab("audit")}>
                  <ClipboardCheck size={18} /> Audit log
                </button>
              </>
            )}
            <button className="mobile-more-signout" onClick={onSignOut}>
              <LogOut size={18} /> Sign out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
