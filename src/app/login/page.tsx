import { LoginForm } from "@/components/login-form";
import { safeNextPath } from "@/lib/safe-next-path";

const ERRORS: Record<string, string> = {
  // /auth/callback sends people here when an email confirmation link is invalid or expired.
  confirmation_failed: "That confirmation link is invalid or has expired. Sign in, or sign up again for a new link.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(typeof next === "string" ? next : null);
  const initialMessage = typeof error === "string" ? ERRORS[error] : undefined;

  return <LoginForm next={nextPath} initialMessage={initialMessage} />;
}
