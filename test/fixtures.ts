import { Webhook } from "standardwebhooks";

// Synthetic values only. Never put a real secret or API key in tests.
export const HOOK_SECRET = "v1,whsec_" + btoa("synthetic-hook-secret-for-tests!");
export const API_KEY = "synthetic-api-key";
export const SUPABASE_URL = "https://project-ref.supabase.co";
export const FROM_EMAIL = "auth@example.com";
export const FROM_NAME = "Example App";

export function sign(
  body: string,
  secret = HOOK_SECRET,
  timestamp = new Date(),
): Record<string, string> {
  const id = `msg_${crypto.randomUUID()}`;
  const signature = new Webhook(secret.replace(/^v1,whsec_/, "")).sign(id, timestamp, body);
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
  };
}

const user = {
  id: "8b0f2d8e-5d1c-4f0a-9a57-2f3c1f1e0a11",
  aud: "authenticated",
  role: "authenticated",
  email: "user@example.com",
  phone: "",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-10-29T00:00:00Z",
  updated_at: "2026-10-29T00:00:00Z",
  is_anonymous: false,
};

export function payload(
  type: string,
  data: Record<string, string> = {},
  userOverrides: Record<string, unknown> = {},
) {
  return {
    user: { ...user, ...userOverrides },
    email_data: {
      token: "123456",
      token_hash: `hash-${type}`,
      redirect_to: "https://app.example.com/welcome",
      email_action_type: type,
      site_url: "https://app.example.com",
      token_new: "",
      token_hash_new: "",
      ...data,
    },
  };
}

// The four link-confirmed actions the goal covers, with the recipient and token hash each must use.
export const linkCases = [
  { type: "signup", body: payload("signup"), to: "user@example.com", hash: "hash-signup" },
  { type: "magiclink", body: payload("magiclink"), to: "user@example.com", hash: "hash-magiclink" },
  { type: "recovery", body: payload("recovery"), to: "user@example.com", hash: "hash-recovery" },
  {
    type: "email_change",
    body: payload("email_change", { token_new: "654321" }, { new_email: "new@example.com" }),
    to: "new@example.com",
    hash: "hash-email_change",
  },
];

export function expectedLink(type: string, hash: string): string {
  const url = new URL("/auth/v1/verify", SUPABASE_URL);
  url.searchParams.set("token", hash);
  url.searchParams.set("type", type);
  url.searchParams.set("redirect_to", "https://app.example.com/welcome");
  return url.href;
}
