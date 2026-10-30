import { Webhook } from "standardwebhooks";
import { type Message, render, templates } from "./templates.ts";

export type Config = {
  // The dashboard shows the secret as "v1,whsec_<base64>".
  hookSecret: string;
  apiKey: string;
  fromEmail: string;
  fromName: string;
  // The origin that verification links point at, such as https://<project-ref>.supabase.co.
  supabaseUrl: string;
  apiUrl?: string;
};

export const MAILCHANNELS_API_URL = "https://api.mailchannels.net/tx/v1/send";

// Supabase Auth Send Email hook payload:
// https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
type Payload = {
  user: { email?: string; new_email?: string; phone?: string };
  email_data: {
    email_action_type: string;
    token?: string;
    token_hash?: string;
    token_new?: string;
    token_hash_new?: string;
    redirect_to?: string;
    old_email?: string;
    old_phone?: string;
    provider?: string;
    factor_type?: string;
  };
};

class HookError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function error(status: number, message: string): Response {
  return Response.json({ error: { http_code: status, message } }, { status });
}

function required(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new HookError(400, `Missing ${name} in hook payload`);
  }
  return value;
}

export function verifyLink(
  supabaseUrl: string,
  tokenHash: string,
  type: string,
  redirectTo?: string,
): string {
  const url = new URL("/auth/v1/verify", supabaseUrl);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", type);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);
  return url.href;
}

export function buildMessages(payload: Payload, config: Config): Message[] {
  const { user, email_data: data } = payload ?? {};
  if (!user || !data) throw new HookError(400, "Invalid hook payload");
  const type = data.email_action_type;
  if (!Object.hasOwn(templates, type)) {
    throw new HookError(400, `Unsupported email_action_type ${type}`);
  }
  const appName = config.fromName;
  const link = (hash: string) => verifyLink(config.supabaseUrl, hash, type, data.redirect_to);

  switch (type) {
    case "signup":
    case "invite":
    case "magiclink":
    case "recovery":
      return [render(type, required(user.email, "user.email"), {
        appName,
        link: link(required(data.token_hash, "token_hash")),
        code: data.token,
      })];
    case "email":
    case "reauthentication":
      return [render(type, required(user.email, "user.email"), {
        appName,
        code: required(data.token, "token"),
      })];
    case "email_change": {
      const newEmail = required(user.new_email, "user.new_email");
      const tokenHash = required(data.token_hash, "token_hash");
      // With Secure email change on, Supabase sends two token pairs. The names are reversed for
      // backward compatibility: token_hash_new goes to the current address with token, and
      // token_hash goes to the new address with token_new.
      if (data.token_hash_new) {
        return [
          render(type, required(user.email, "user.email"), {
            appName,
            link: link(data.token_hash_new),
            code: data.token,
          }),
          render(type, newEmail, { appName, link: link(tokenHash), code: data.token_new }),
        ];
      }
      return [render(type, newEmail, {
        appName,
        link: link(tokenHash),
        code: data.token_new || data.token,
      })];
    }
    case "email_changed_notification":
      // Tell the old address, which the change could have been made without.
      return [render(type, required(data.old_email, "old_email"), {
        appName,
        detail: `The new address is ${required(user.email, "user.email")}.`,
      })];
    case "identity_linked_notification":
    case "identity_unlinked_notification":
      return [render(type, required(user.email, "user.email"), {
        appName,
        detail: data.provider ? `Provider: ${data.provider}.` : undefined,
      })];
    case "mfa_factor_enrolled_notification":
    case "mfa_factor_unenrolled_notification":
      return [render(type, required(user.email, "user.email"), {
        appName,
        detail: data.factor_type ? `Method: ${data.factor_type}.` : undefined,
      })];
    default:
      return [render(type, required(user.email, "user.email"), { appName })];
  }
}

async function send(message: Message, config: Config, fetchFn: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchFn(config.apiUrl ?? MAILCHANNELS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": config.apiKey },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: config.fromEmail, name: config.fromName },
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new HookError(503, "MailChannels could not be reached");
  }
  // Never log the response body: it can echo the recipient and the link.
  await response.body?.cancel();
  if (response.ok) return;
  if (response.status === 429) throw new HookError(429, "MailChannels rate limit reached");
  if (response.status >= 500) throw new HookError(503, "MailChannels is unavailable");
  console.error(`MailChannels rejected the message with HTTP ${response.status}`);
  throw new HookError(500, "MailChannels rejected the message");
}

export function createHandler(config: Config, fetchFn: typeof fetch = fetch) {
  for (const key of ["hookSecret", "apiKey", "fromEmail", "fromName", "supabaseUrl"] as const) {
    if (!config[key]) throw new Error(`Missing configuration: ${key}`);
  }
  const webhook = new Webhook(config.hookSecret.replace(/^v1,whsec_/, ""));

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return error(405, "Method not allowed");
    const body = await req.text();
    let payload: Payload;
    try {
      payload = webhook.verify(body, Object.fromEntries(req.headers)) as Payload;
    } catch {
      return error(401, "Invalid webhook signature");
    }
    try {
      for (const message of buildMessages(payload, config)) {
        await send(message, config, fetchFn);
      }
    } catch (e) {
      if (e instanceof HookError) return error(e.status, e.message);
      return error(500, "Failed to send the email");
    }
    return Response.json({});
  };
}
