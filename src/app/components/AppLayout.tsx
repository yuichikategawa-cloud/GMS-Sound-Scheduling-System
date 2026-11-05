import type { ReactNode } from "react";

type AppLayoutProps = {
  theme: "light" | "dark";
  sidebar: ReactNode;
  header: ReactNode;
  mobileNavigation: ReactNode;
  overlays: ReactNode;
  children: ReactNode;
};

export default function AppLayout({
  theme,
  sidebar,
  header,
  mobileNavigation,
  overlays,
  children
}: AppLayoutProps) {
  return (
    <div className="app-shell" data-theme={theme}>
      {sidebar}
      <div className="main-area">
        {header}
        <main className="content">{children}</main>
      </div>
      {mobileNavigation}
      {overlays}
    </div>
  );
}
