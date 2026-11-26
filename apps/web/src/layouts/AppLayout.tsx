import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar, Logo, cx } from "../components/ui";
import { ROLE_LABELS, canManageTeam } from "../lib/types";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  visible: boolean;
}

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

export function AppLayout() {
  const { user, company, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Only sections that are implemented are listed. New sections are added as phases ship.
  const items: NavItem[] = [
    { to: "/", label: "Overview", icon: icon("M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10"), visible: true },
    {
      to: "/team",
      label: "Team",
      icon: icon("M17 20h5v-2a4 4 0 00-5-3.9M9 20H2v-2a4 4 0 015-3.9m10-4.1a3 3 0 11-6 0 3 3 0 016 0zM9 7a3 3 0 11-6 0 3 3 0 016 0z"),
      visible: canManageTeam(user?.role),
    },
  ];

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-6 py-6">
        <Logo />
        {company && <p className="mt-4 truncate text-xs font-medium uppercase tracking-wide text-slate-400">{company.name}</p>}
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {items
          .filter((i) => i.visible)
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
      </nav>
      {user && (
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            >
              {icon("M15 12H3m0 0l4-4m-4 4l4 4m6-12h5a2 2 0 012 2v12a2 2 0 01-2 2h-5")}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        >
          {icon(menuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16")}
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
