import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { Alert, Avatar, Badge, Button, Card, CardHeader, Field, Input, Select, Spinner } from "../components/ui";
import { PageHeader } from "../layouts/AppLayout";
import { ApiError, api } from "../lib/api";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Invitation,
  type InvitableRole,
  type Role,
  type User,
} from "../lib/types";

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** Mirrors the API rules so the UI only offers actions the server will accept. */
function assignableRoles(actorRole: Role): InvitableRole[] {
  return actorRole === "OWNER" ? ["ADMIN", "RECRUITER", "REVIEWER"] : ["RECRUITER", "REVIEWER"];
}

function canEditMember(actor: User, member: User): boolean {
  if (member.id === actor.id || member.role === "OWNER") return false;
  if (member.role === "ADMIN" && actor.role !== "OWNER") return false;
  return true;
}

function InviteForm({ actorRole, onInvited }: { actorRole: Role; onInvited: () => void }) {
  const roles = assignableRoles(actorRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("RECRUITER");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setCopied(false);
    setSubmitting(true);
    try {
      const res = await api<{ invitation: Invitation; inviteUrl: string }>("/api/team/invitations", {
        method: "POST",
        body: { email, role },
      });
      setCreated({ email: res.invitation.email, url: res.inviteUrl });
      setEmail("");
      onInvited();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Invite a team member" description="Invitation links are single-use and expire after 7 days." />
      <form onSubmit={onSubmit} className="space-y-5 px-6 py-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Email" htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint={ROLE_DESCRIPTIONS[role]}>
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as InvitableRole)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={submitting} disabled={!email}>
            Create invitation
          </Button>
        </div>
        {created && (
          <div className="rounded-lg bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
            <p className="text-sm font-medium text-emerald-900">Invitation created for {created.email}</p>
            <p className="mt-1 text-xs text-emerald-800">
              Emails are not sent automatically yet. Copy this link and send it to them. It is shown only once.
            </p>
            <div className="mt-3 flex gap-2">
              <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" variant="secondary" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Card>
  );
}

function MemberRow({ actor, member, onChanged }: { actor: User; member: User; onChanged: (m: User) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = canEditMember(actor, member);

  const update = async (patch: { role?: InvitableRole; isActive?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ member: User }>(`/api/team/members/${member.id}`, { method: "PATCH", body: patch });
      onChanged(res.member);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={member.name} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-900">
            {member.name}
            {member.id === actor.id && <span className="text-xs font-normal text-slate-400">(you)</span>}
          </p>
          <p className="truncate text-xs text-slate-500">{member.email}</p>
        </div>
        {!member.isActive && <Badge tone="danger">Deactivated</Badge>}
        {editable ? (
          <div className="flex items-center gap-2">
            <Select
              aria-label={`Role for ${member.name}`}
              value={member.role}
              disabled={busy || !member.isActive}
              onChange={(e) => update({ role: e.target.value as InvitableRole })}
              className="w-36 py-1.5"
            >
              {assignableRoles(actor.role).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant={member.isActive ? "danger" : "secondary"}
              loading={busy}
              onClick={() => update({ isActive: !member.isActive })}
            >
              {member.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        ) : (
          <Badge tone={member.role === "OWNER" ? "brand" : "neutral"}>{ROLE_LABELS[member.role]}</Badge>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </li>
  );
}

export function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<User[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([
        api<{ members: User[] }>("/api/team/members"),
        api<{ invitations: Invitation[] }>("/api/team/invitations"),
      ]);
      setMembers(m.members);
      setInvitations(i.invitations);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setRevoking(id);
    setRevokeError(null);
    try {
      await api<void>(`/api/team/invitations/${id}`, { method: "DELETE" });
      setInvitations((list) => list?.filter((i) => i.id !== id) ?? null);
    } catch (err) {
      setRevokeError(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  };

  if (!user) return null;

  return (
    <>
      <PageHeader title="Team" description="Manage who can access your company workspace." />

      {loadError && (
        <div className="mb-6">
          <Alert>{loadError}</Alert>
        </div>
      )}

      <div className="space-y-6">
        <InviteForm actorRole={user.role} onInvited={() => void load()} />

        <Card>
          <CardHeader
            title="Members"
            description={members ? `${members.length} ${members.length === 1 ? "person" : "people"}` : undefined}
          />
          {!members ? (
            <div className="flex h-24 items-center justify-center text-brand-600">
              <Spinner className="h-6 w-6" />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  actor={user}
                  member={m}
                  onChanged={(updated) => setMembers((list) => list?.map((x) => (x.id === updated.id ? updated : x)) ?? null)}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Pending invitations" />
          {revokeError && (
            <div className="px-6 pt-4">
              <Alert>{revokeError}</Alert>
            </div>
          )}
          {!invitations ? (
            <div className="flex h-24 items-center justify-center text-brand-600">
              <Spinner className="h-6 w-6" />
            </div>
          ) : invitations.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{inv.email}</p>
                    <p className="text-xs text-slate-500">Expires {formatDate(inv.expiresAt)}</p>
                  </div>
                  <Badge>{ROLE_LABELS[inv.role]}</Badge>
                  {(inv.role !== "ADMIN" || user.role === "OWNER") && (
                    <Button size="sm" variant="ghost" loading={revoking === inv.id} onClick={() => revoke(inv.id)}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
