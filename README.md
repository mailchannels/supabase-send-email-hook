# supabase-send-email-hook

A [Supabase Auth Send Email hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
implemented as a Supabase Edge Function that sends auth emails through the
[MailChannels Email API](https://docs.mailchannels.com/email-api/integrations/supabase).

The function:

- Verifies the hook's [Standard Webhooks](https://www.standardwebhooks.com/) signature and returns
  `401` for a missing, invalid or expired signature, before it reads the payload.
- Sends signup confirmation, invite, magic link, password recovery and email change messages with
  the Supabase verification link (`/auth/v1/verify?token=<token_hash>&type=<type>&redirect_to=...`)
  and one-time code, and sends one-time-code (`email`, `reauthentication`) and security notification
  messages.
- Sends one message to the current address and one to the new address for an email change when
  **Secure email change** is on. Supabase reverses the field names for backward compatibility:
  `token_hash_new` goes to `user.email`, and `token_hash` goes to `user.new_email`.
- Returns `429` when MailChannels rate-limits and `503` when MailChannels fails or can't be reached,
  so Supabase Auth retries. Other Email API rejections return `500`.

The full setup guide, including the custom SMTP alternative, is at
[docs.mailchannels.com](https://docs.mailchannels.com/email-api/integrations/supabase).

## Use it in your project

1. Create an API key at [Account > API Keys](https://dash.mailchannels.com/account/api-keys), and
   set up [Domain Lockdown](https://docs.mailchannels.com/email-api/domain-lockdown) for your sender
   domain.
2. Copy `supabase/functions/send-email` into your project's `supabase/functions` directory. Edit
   `templates.ts` to change the subjects and wording.
3. Deploy it without JWT verification, since Supabase Auth authenticates with the hook signature:

   ```bash
   supabase functions deploy send-email --no-verify-jwt
   ```

4. In the Supabase dashboard, open **Authentication > Hooks**, add a **Send Email** hook of type
   **HTTPS** with the URL `https://<project-ref>.supabase.co/functions/v1/send-email`, and generate
   a secret (`v1,whsec_...`).
5. Copy `.env.example` to `.env`, fill it in, and upload it:

   ```bash
   supabase secrets set --env-file .env
   ```

| Variable                  | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `SEND_EMAIL_HOOK_SECRET`  | The hook secret from the dashboard, `v1,whsec_<base64>`.                     |
| `MAILCHANNELS_API_KEY`    | Your MailChannels API key.                                                   |
| `MAILCHANNELS_FROM_EMAIL` | The sender address, on a domain your Domain Lockdown record authorizes.      |
| `MAILCHANNELS_FROM_NAME`  | The sender name, also used as the subject prefix.                            |
| `SUPABASE_PUBLIC_URL`     | Optional. The origin for links; local development only (see below).          |
| `MAILCHANNELS_API_URL`    | Optional. Overrides the Email API endpoint; used by the tests to hit a stub. |

## Develop locally

`supabase/config.toml` registers the hook with the local Auth server. Run:

```bash
supabase start
supabase functions serve --env-file .env
```

Inside a locally served function, `SUPABASE_URL` points at Supabase's internal gateway. Add
`SUPABASE_PUBLIC_URL=http://127.0.0.1:54321` to `.env` so links in local emails open in your
browser.

## Tests

All tests use synthetic secrets and a stub in place of the Email API; none send real email.

```bash
deno task test   # unit tests: signatures, every action type, links, error mapping
deno task e2e    # behaviour script: serves the function with Deno and posts signed hook requests
```

To run the behaviour script against the Supabase Edge Runtime, start the runtime as in
[`ci/ci.yml`](ci/ci.yml) (the GitHub Actions workflow, to be moved to `.github/workflows/ci.yml`) and run
`FUNCTION_URL=http://127.0.0.1:9000/send-email deno task e2e`. CI runs both.

## License

[MIT](LICENSE)
