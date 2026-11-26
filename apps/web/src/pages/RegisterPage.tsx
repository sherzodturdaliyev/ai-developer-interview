import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input } from "../components/ui";
import { AuthLayout } from "../layouts/AuthLayout";
import { ApiError } from "../lib/api";

const EMPTY = { companyName: "", name: "", email: "", password: "" };

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register(form);
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

  return (
    <AuthLayout
      title="Create your company account"
      subtitle={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Company name" htmlFor="companyName" error={fieldErrors.companyName}>
          <Input
            id="companyName"
            autoComplete="organization"
            value={form.companyName}
            onChange={set("companyName")}
            invalid={!!fieldErrors.companyName}
          />
        </Field>
        <Field label="Your name" htmlFor="name" error={fieldErrors.name}>
          <Input id="name" autoComplete="name" value={form.name} onChange={set("name")} invalid={!!fieldErrors.name} />
        </Field>
        <Field label="Work email" htmlFor="email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set("email")}
            invalid={!!fieldErrors.email}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={fieldErrors.password} hint="At least 10 characters">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
            invalid={!!fieldErrors.password}
          />
        </Field>
        <Button type="submit" loading={submitting} className="w-full">
          Create account
        </Button>
        <p className="text-center text-xs text-slate-500">You will be the owner of this company workspace.</p>
      </form>
    </AuthLayout>
  );
}
