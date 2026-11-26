import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, FullPageSpinner, Input } from "../components/ui";
import { AuthLayout } from "../layouts/AuthLayout";
import { ApiError, api } from "../lib/api";
import { ROLE_LABELS, type InvitationPreview } from "../lib/types";

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { acceptInvitation, status } = useAuth();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("This invitation link is incomplete. Ask your administrator for a new one.");
      return;
    }
    let cancelled = false;
    api<{ invitation: InvitationPreview }>(`/api/invitations/${encodeURIComponent(token)}`, { auth: false })
      .then((res) => !cancelled && setPreview(res.invitation))
      .catch((err) => !cancelled && setLoadError(err instanceof ApiError ? err.message : "Could not load the invitation."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await acceptInvitation({ token, name, password });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        setFieldErrors(fields);
        if (Object.keys(fields).length === 0) setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!preview && !loadError) return <FullPageSpinner />;

  if (loadError || !preview) {
    return (
      <AuthLayout title="Invitation unavailable">
        <Alert>{loadError}</Alert>
        <p className="mt-6 text-sm text-slate-500">
          <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Go to sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={`Join ${preview.companyName}`}
      subtitle={
        <>
          You were invited as <span className="font-medium text-slate-700">{ROLE_LABELS[preview.role]}</span>.
        </>
      }
    >
      {status === "authenticated" && (
        <div className="mb-5">
          <Alert tone="warning">You are already signed in. Accepting will switch you to the new account.</Alert>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email" htmlFor="email">
          <Input id="email" value={preview.email} disabled readOnly />
        </Field>
        <Field label="Your name" htmlFor="name" error={fieldErrors.name}>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!fieldErrors.name} />
        </Field>
        <Field label="Choose a password" htmlFor="password" error={fieldErrors.password} hint="At least 10 characters">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={!!fieldErrors.password}
          />
        </Field>
        <Button type="submit" loading={submitting} className="w-full">
          Accept invitation
        </Button>
      </form>
    </AuthLayout>
  );
}
