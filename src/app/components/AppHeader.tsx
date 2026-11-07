import "./AppHeader.css";
import {
  Menu,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun
} from "lucide-react";
import type { SidebarTab } from "./Sidebar";

type AppHeaderProps = {
  activeTab: SidebarTab;
  isAdmin: boolean;
  pwaInstalled: boolean;
  theme: "light" | "dark";
  onToggleMobileMenu: () => void;
  onInstallApp: () => void;
  onToggleTheme: () => void;
  onRefresh: () => void;
};

const PAGE_TITLES: Record<SidebarTab, string> = {
  schedule: "Serving schedule",
  people: "Serving statistics",
  servantInfo: "Servant Information",
  availability: "Availability management",
  statistics: "Serving statistics",
  audit: "Audit log",
  profile: "My profile",
  inbox: "Inbox",
  requests: "Servant Requests"
};

export default function AppHeader({
  activeTab,
  isAdmin,
  pwaInstalled,
  theme,
  onToggleMobileMenu,
  onInstallApp,
  onToggleTheme,
  onRefresh
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <button className="mobile-menu icon-btn" onClick={onToggleMobileMenu}>
        <Menu />
      </button>
      <div>
        <div className="eyebrow">GMS • CHURCH SERVING</div>
        <h1>{PAGE_TITLES[activeTab]}</h1>
      </div>
      <div className="top-actions">
        <span className="role-tag">
          <ShieldCheck size={14} />{isAdmin ? "Admin access" : "View access"}
        </span>
        {!pwaInstalled && (
          <button className="btn secondary pwa-install-button" onClick={onInstallApp}>
            <Smartphone size={15} /> Install app
          </button>
        )}
        <button
          className="icon-btn theme-toggle"
          onClick={onToggleTheme}
          aria-pressed={theme === "dark"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="icon-btn" onClick={onRefresh} title="Refresh">
          <RefreshCw size={17} />
        </button>
      </div>
    </header>
  );
}
