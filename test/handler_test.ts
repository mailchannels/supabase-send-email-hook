import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createHandler, MAILCHANNELS_API_URL } from "../supabase/functions/send-email/handler.ts";
import {
  API_KEY,
  expectedLink,
  FROM_EMAIL,
  FROM_NAME,
  HOOK_SECRET,
  linkCases,
  payload,
  sign,
  SUPABASE_URL,
} from "./fixtures.ts";

type Sent = { url: string; headers: Headers; body: any };

function setup(
  respond: () => Response | Promise<Response> = () => new Response(null, { status: 202 }),
) {
  const sent: Sent[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return await respond();
  }) as typeof fetch;
  const handler = createHandler({
    hookSecret: HOOK_SECRET,
    apiKey: API_KEY,
    fromEmail: FROM_EMAIL,
    fromName: FROM_NAME,
    supabaseUrl: SUPABASE_URL,
  }, fetchStub);
  return { sent, handler };
}

function post(body: unknown, headers?: Record<string, string>): Request {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/send-email", {
    method: "POST",
    headers: headers ?? sign(raw),
    body: raw,
  });
}

function assertValidSend(s: Sent, to: string) {
  assertEquals(s.url, MAILCHANNELS_API_URL);
  assertEquals(s.headers.get("X-Api-Key"), API_KEY);
  assertEquals(s.headers.get("Content-Type"), "application/json");
  assertEquals(s.body.personalizations, [{ to: [{ email: to }] }]);
  assertEquals(s.body.from, { email: FROM_EMAIL, name: FROM_NAME });
  assert(typeof s.body.subject === "string" && s.body.subject.startsWith(`${FROM_NAME}: `));
  assertEquals(s.body.content.map((c: { type: string }) => c.type), ["text/plain", "text/html"]);
}

for (const c of linkCases) {
  Deno.test(`${c.type}: sends one Email API request with the verification link`, async () => {
    const { sent, handler } = setup();
    const res = await handler(post(c.body));
    assertEquals(res.status, 200);
    assertEquals(sent.length, 1);
    assertValidSend(sent[0], c.to);
    const link = expectedLink(c.type, c.hash);
    assertStringIncludes(sent[0].body.content[0].value, link);
    assertStringIncludes(sent[0].body.content[1].value, `href="${link.replaceAll("&", "&amp;")}"`);
  });
}

Deno.test("signup: includes the one-time code", async () => {
  const { sent, handler } = setup();
  await handler(post(payload("signup")));
  assertStringIncludes(sent[0].body.content[0].value, "123456");
});

Deno.test("invite: sends the invite link", async () => {
  const { sent, handler } = setup();
  assertEquals((await handler(post(payload("invite")))).status, 200);
  assertStringIncludes(sent[0].body.content[0].value, expectedLink("invite", "hash-invite"));
});

Deno.test("email_change with Secure email change: sends to both addresses with swapped hashes", async () => {
  const { sent, handler } = setup();
  const body = payload("email_change", {
    token: "111111",
    token_hash: "hash-for-new-address",
    token_new: "222222",
    token_hash_new: "hash-for-current-address",
  }, { new_email: "new@example.com" });
  assertEquals((await handler(post(body))).status, 200);
  assertEquals(sent.length, 2);
  assertValidSend(sent[0], "user@example.com");
  assertStringIncludes(
    sent[0].body.content[0].value,
    expectedLink("email_change", "hash-for-current-address"),
  );
  assertStringIncludes(sent[0].body.content[0].value, "111111");
  assertValidSend(sent[1], "new@example.com");
  assertStringIncludes(
    sent[1].body.content[0].value,
    expectedLink("email_change", "hash-for-new-address"),
  );
  assertStringIncludes(sent[1].body.content[0].value, "222222");
});

Deno.test("reauthentication: sends the code without a link", async () => {
  const { sent, handler } = setup();
  assertEquals((await handler(post(payload("reauthentication", { token_hash: "" })))).status, 200);
  assertStringIncludes(sent[0].body.content[0].value, "123456");
  assert(!sent[0].body.content[0].value.includes("/auth/v1/verify"));
});

Deno.test("email_changed_notification: notifies the old address", async () => {
  const { sent, handler } = setup();
  const body = payload("email_changed_notification", { old_email: "old@example.com" });
  assertEquals((await handler(post(body))).status, 200);
  assertValidSend(sent[0], "old@example.com");
  assertStringIncludes(sent[0].body.content[0].value, "user@example.com");
});

for (
  const type of [
    "password_changed_notification",
    "phone_changed_notification",
    "identity_linked_notification",
    "identity_unlinked_notification",
    "mfa_factor_enrolled_notification",
    "mfa_factor_unenrolled_notification",
  ]
) {
  Deno.test(`${type}: notifies the user`, async () => {
    const { sent, handler } = setup();
    assertEquals(
      (await handler(post(payload(type, { provider: "github", factor_type: "totp" })))).status,
      200,
    );
    assertEquals(sent.length, 1);
    assertValidSend(sent[0], "user@example.com");
  });
}

Deno.test("rejects a signature made with another secret", async () => {
  const { sent, handler } = setup();
  const raw = JSON.stringify(payload("signup"));
  const res = await handler(
    post(payload("signup"), sign(raw, "v1,whsec_" + btoa("a-different-secret-for-the-test"))),
  );
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error.http_code, 401);
  assertEquals(sent.length, 0);
});

Deno.test("rejects a body changed after signing", async () => {
  const { sent, handler } = setup();
  const headers = sign(JSON.stringify(payload("signup")));
  const res = await handler(
    post(payload("signup", { redirect_to: "https://evil.example" }), headers),
  );
  assertEquals(res.status, 401);
  assertEquals(sent.length, 0);
});

Deno.test("rejects missing signature headers", async () => {
  const { sent, handler } = setup();
  const res = await handler(post(payload("signup"), { "content-type": "application/json" }));
  assertEquals(res.status, 401);
  assertEquals(sent.length, 0);
});

Deno.test("rejects an expired timestamp", async () => {
  const { sent, handler } = setup();
  const raw = JSON.stringify(payload("signup"));
  const res = await handler(
    post(payload("signup"), sign(raw, HOOK_SECRET, new Date(Date.now() - 10 * 60_000))),
  );
  assertEquals(res.status, 401);
  assertEquals(sent.length, 0);
});

Deno.test("rejects methods other than POST", async () => {
  const { handler } = setup();
  assertEquals((await handler(new Request("http://localhost/", { method: "GET" }))).status, 405);
});

Deno.test("rejects an unsupported action type", async () => {
  const { sent, handler } = setup();
  assertEquals((await handler(post(payload("unknown_type")))).status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("rejects a payload missing the token hash", async () => {
  const { sent, handler } = setup();
  assertEquals((await handler(post(payload("signup", { token_hash: "" })))).status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("escapes HTML in the link", async () => {
  const { sent, handler } = setup();
  await handler(post(payload("signup", { redirect_to: 'https://app.example.com/"><script>' })));
  assert(!sent[0].body.content[1].value.includes("<script>"));
});

for (
  const [upstream, expected] of [[429, 429], [500, 503], [503, 503], [400, 500], [
    401,
    500,
  ]] as const
) {
  Deno.test(`maps Email API HTTP ${upstream} to ${expected}`, async () => {
    const { handler } = setup(() => new Response("{}", { status: upstream }));
    assertEquals((await handler(post(payload("signup")))).status, expected);
  });
}

Deno.test("returns 503 when the Email API cannot be reached", async () => {
  const { handler } = setup(() => Promise.reject(new TypeError("network down")));
  assertEquals((await handler(post(payload("signup")))).status, 503);
});

Deno.test("refuses to start without configuration", () => {
  let threw = false;
  try {
    createHandler({
      hookSecret: "",
      apiKey: API_KEY,
      fromEmail: FROM_EMAIL,
      fromName: FROM_NAME,
      supabaseUrl: SUPABASE_URL,
    });
  } catch {
    threw = true;
  }
  assert(threw);
});
