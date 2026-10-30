import { createHandler } from "./handler.ts";

const env = (name: string) => Deno.env.get(name) ?? "";

const handler = createHandler({
  hookSecret: env("SEND_EMAIL_HOOK_SECRET"),
  apiKey: env("MAILCHANNELS_API_KEY"),
  fromEmail: env("MAILCHANNELS_FROM_EMAIL"),
  fromName: env("MAILCHANNELS_FROM_NAME"),
  // Inside `supabase functions serve`, SUPABASE_URL is the internal gateway; set
  // SUPABASE_PUBLIC_URL so links in local emails open in a browser.
  supabaseUrl: env("SUPABASE_PUBLIC_URL") || env("SUPABASE_URL"),
  // Only for tests against a stub. Leave unset to use the Email API.
  apiUrl: Deno.env.get("MAILCHANNELS_API_URL") || undefined,
});

Deno.serve(handler);
