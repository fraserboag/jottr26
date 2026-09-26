// Emails the owner when someone confirms a new Jottr account. Called only by
// the notify_signup trigger in schema.sql. It is deployed with JWT
// verification off, so the shared secret is the only thing that lets a request
// through. Without it, anyone could use this to send you email.
//
// Runs on Supabase's Deno runtime, not in the Next app. SMTP defaults to port
// 465 because Edge Functions can't open connections on 25 or 587.
import nodemailer from "npm:nodemailer@6";

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-signup-alert-secret") !== env("SIGNUP_ALERT_SECRET")) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: { email?: unknown; total?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const { email, total } = body ?? {};
  if (typeof email !== "string" || typeof total !== "number") {
    return new Response("Bad request", { status: 400 });
  }
  const to = env("SIGNUP_ALERT_TO");
  // Testing sign-up with your own address shouldn't send you an alert.
  if (email.toLowerCase() === to.toLowerCase()) {
    return new Response("Skipped");
  }

  const port = Number(Deno.env.get("SMTP_PORT") ?? 465);
  const transport = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  });

  await transport.sendMail({
    from: Deno.env.get("SMTP_FROM") ?? env("SMTP_USER"),
    to,
    subject: `New Jottr user: ${email}`,
    text: `${email} just signed up to Jottr.\n\nConfirmed users: ${total}\n`,
  });

  return new Response("Sent");
});
