// Runs the goal's behaviour script against the served function and a stub Email API.
//
// By default it starts the function with `deno run`. Set FUNCTION_URL to test a function served
// some other way, such as by the Supabase Edge Runtime; that function must be started with
// MAILCHANNELS_API_URL=http://127.0.0.1:$STUB_PORT/tx/v1/send and the synthetic values in
// fixtures.ts.
import { assertEquals, assertStringIncludes } from "@std/assert";
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

const STUB_PORT = Number(Deno.env.get("STUB_PORT") ?? "54329");
const FUNCTION_PORT = 8000;

type Received = { path: string; apiKey: string | null; body: any };
const received: Received[] = [];

async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      await (await fetch(url)).body?.cancel();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`${url} did not start`);
}

Deno.test("behaviour script", async (t) => {
  const stub = Deno.serve({ hostname: "0.0.0.0", port: STUB_PORT, onListen() {} }, async (req) => {
    received.push({
      path: new URL(req.url).pathname,
      apiKey: req.headers.get("X-Api-Key"),
      body: await req.json(),
    });
    return new Response(null, { status: 202 });
  });

  let child: Deno.ChildProcess | undefined;
  let functionUrl = Deno.env.get("FUNCTION_URL");
  if (!functionUrl) {
    // 1. Start the Edge Function with a synthetic hook secret and API key.
    child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-net",
        "--allow-env",
        "--config",
        "supabase/functions/send-email/deno.json",
        "supabase/functions/send-email/index.ts",
      ],
      env: {
        SEND_EMAIL_HOOK_SECRET: HOOK_SECRET,
        MAILCHANNELS_API_KEY: API_KEY,
        MAILCHANNELS_FROM_EMAIL: FROM_EMAIL,
        MAILCHANNELS_FROM_NAME: FROM_NAME,
        SUPABASE_URL,
        MAILCHANNELS_API_URL: `http://127.0.0.1:${STUB_PORT}/tx/v1/send`,
      },
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    functionUrl = `http://127.0.0.1:${FUNCTION_PORT}/send-email`;
  }
  await waitFor(functionUrl);

  try {
    // 2-3. Signup, magic link, recovery and email change: 200 and one valid send each.
    for (const c of linkCases) {
      await t.step(`${c.type}: 200 and one send with the link`, async () => {
        received.length = 0;
        const raw = JSON.stringify(c.body);
        const res = await fetch(functionUrl, { method: "POST", headers: sign(raw), body: raw });
        await res.body?.cancel();
        assertEquals(res.status, 200);
        assertEquals(received.length, 1);
        const [send] = received;
        assertEquals(send.path, "/tx/v1/send");
        assertEquals(send.apiKey, API_KEY);
        assertEquals(send.body.personalizations, [{ to: [{ email: c.to }] }]);
        assertEquals(send.body.from, { email: FROM_EMAIL, name: FROM_NAME });
        assertStringIncludes(send.body.content[0].value, expectedLink(c.type, c.hash));
        console.log(`${c.type}: HTTP ${res.status}, 1 send to ${c.to}`);
      });
    }

    // 4. A bad signature: 401 and no send.
    await t.step("bad signature: 401 and no send", async () => {
      received.length = 0;
      const raw = JSON.stringify(payload("signup"));
      const headers = sign(raw, "v1,whsec_" + btoa("not-the-hook-secret-configured!!"));
      const res = await fetch(functionUrl, { method: "POST", headers, body: raw });
      await res.body?.cancel();
      assertEquals(res.status, 401);
      assertEquals(received.length, 0);
      console.log(`bad signature: HTTP ${res.status}, 0 sends`);
    });
  } finally {
    child?.kill();
    await child?.status;
    await stub.shutdown();
  }
});
