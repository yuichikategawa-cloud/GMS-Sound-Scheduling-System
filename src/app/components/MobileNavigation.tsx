import "./MobileNavigation.css";
import { useEffect, useRef } from "react";
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeMenuRef = useRef(onCloseMenu);
  closeMenuRef.current = onCloseMenu;

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    const focusable = () => menu?.querySelectorAll<HTMLElement>("button:not(:disabled)");
    focusable()?.[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenuRef.current();
        trigger?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(focusable() ?? []);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

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
          ref={triggerRef}
          aria-expanded={open}
          aria-controls="mobile-more-menu"
          onClick={onToggleMenu}
        >
          <MoreHorizontal size={20} /><span>More</span>
        </button>
      </nav>

      {open && (
        <div className="mobile-more-backdrop" onClick={onCloseMenu}>
          <div
            className="mobile-more-menu"
            id="mobile-more-menu"
            ref={menuRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-heading"
            onClick={event => event.stopPropagation()}
          >
            <div className="mobile-more-heading" id="mobile-more-heading">More options</div>
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
