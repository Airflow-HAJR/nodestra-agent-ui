# nodestra-agent-ui

Browser front end for the OAK airport assistant — the orb, the live transcript,
the indoor map, and the voice websocket to `nodestra-agent-v2`.

## Environment

Copy `.env.example` to `.env` and fill it in. Only two variables are required:
`VITE_WS_URL` and `VITE_GOOGLE_MAPS_API_KEY`.

## Accounts (optional)

Signing in is entirely optional and exists for exactly one reason: to make the
preferences the agent picks up outlive the conversation.

- **Guests** — anyone who never signs in — get the full experience. The agent
  still learns that they're vegetarian or use a wheelchair and acts on it for
  the rest of the conversation; that knowledge is simply never written to the
  database, and is gone when they leave. On a shared airport kiosk that's the
  behavior you want anyway.
- **Signed in** — one tap, Google, no forms. The same facts are saved to the
  account, so the next visit opens with "Welcome back, Sarah — I've still got
  your preferences" instead of the full welcome. The account sheet lists
  everything the agent remembers and lets any of it be deleted.

Sign-in happens in a popup rather than a full-page redirect, so the websocket,
the transcript, and whatever the agent was in the middle of saying all survive
it. Anything learned before signing in is carried into the account at that
moment, so nothing said as a guest is lost by signing in. If the popup is
blocked, it falls back to a redirect.

### Setup

Accounts are powered by Supabase Auth. Leave `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` unset and the account button simply doesn't render —
everyone is a guest and nothing else changes.

To turn them on:

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase dashboard →
   Project Settings → API). The anon key is public by design.
2. Enable the Google provider under Authentication → Providers.
3. Add this app's URL — including vite's `base`, e.g.
   `https://agent.nodestra.com/oakland/` and `http://localhost:5173/oakland/` —
   to Authentication → URL Configuration → Redirect URLs.

The server side needs no new configuration: it verifies the browser's access
token against the same Supabase project it already uses (`SUPABASE_URL` /
`SUPABASE_KEY`), and only a token that verifies makes memory durable. A client
can claim any guest id it likes; it can't claim an account.

## Scripts

```bash
npm run dev      # vite dev server
npm run build    # typecheck + production build
npm run preview  # serve the build
```
