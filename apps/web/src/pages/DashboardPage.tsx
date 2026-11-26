import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Alert, Badge, Card, CardHeader, Spinner } from "../components/ui";
import { PageHeader } from "../layouts/AppLayout";
import { ApiError, api } from "../lib/api";
import { ROLE_LABELS, canManageTeam, type Invitation, type User } from "../lib/types";

interface TeamSummary {
  active: number;
  inactive: number;
  pendingInvites: number;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="px-6 py-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
    </Card>
  );
}

export function DashboardPage() {
  const { user, company } = useAuth();
  const isManager = canManageTeam(user?.role);
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    Promise.all([
      api<{ members: User[] }>("/api/team/members"),
      api<{ invitations: Invitation[] }>("/api/team/invitations"),
    ])
      .then(([m, i]) => {
        if (cancelled) return;
        setSummary({
          active: m.members.filter((u) => u.isActive).length,
          inactive: m.members.filter((u) => !u.isActive).length,
          pendingInvites: i.invitations.length,
        });
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load team data."));
    return () => {
      cancelled = true;
    };
  }, [isManager]);

  if (!user || !company) return null;
  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} description={`${company.name} workspace`} />

      {isManager && (
        <section className="mb-8">
          {error ? (
            <Alert>{error}</Alert>
          ) : !summary ? (
            <div className="flex h-28 items-center justify-center text-brand-600">
              <Spinner className="h-6 w-6" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Active team members" value={summary.active} />
              <Stat label="Pending invitations" value={summary.pendingInvites} />
              <Stat label="Deactivated members" value={summary.inactive} />
            </div>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your account" />
          <dl className="divide-y divide-slate-100 px-6">
            {[
              ["Name", user.name],
              ["Email", user.email],
              ["Role", <Badge key="role" tone="brand">{ROLE_LABELS[user.role]}</Badge>],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between gap-4 py-3.5 text-sm">
                <dt className="text-slate-500">{label}</dt>
                <dd className="truncate font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Company" />
          <dl className="divide-y divide-slate-100 px-6">
            <div className="flex items-center justify-between gap-4 py-3.5 text-sm">
              <dt className="text-slate-500">Name</dt>
              <dd className="truncate font-medium text-slate-900">{company.name}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3.5 text-sm">
              <dt className="text-slate-500">Workspace ID</dt>
              <dd className="truncate font-mono text-xs text-slate-700">{company.slug}</dd>
            </div>
          </dl>
          {isManager && (
            <div className="border-t border-slate-100 px-6 py-4">
              <Link to="/team" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                Manage team →
              </Link>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
