# Floor Coverings International Operations

Commercial flooring operations software for client intake, independent project delivery, crew scheduling, and Google Workspace organization.

## Prerequisites

- Node.js `>=22.13.0`

## Local prototype

```bash
npm install
npm run dev
npm run build
```

Copy `.env.example` to `.env.local` before connecting external services. The prototype supports separate **test** and **production** Google connection profiles: test with a dedicated personal Google account/folder first, then create a separate company-account connection for production. OAuth tokens and Drive-folder mappings are kept profile-specific, so a personal test folder is never opened from the production profile.

For local testing only, set `FCI_LOCAL_DEV_USER_EMAIL` in `.env.local` to your own email and add that same address to `FCI_ADMIN_EMAILS`. The fallback is available only to `npm run dev` on `localhost`; the hosted site still requires ChatGPT sign-in.

## Included capabilities

- Client Directory with repeat clients and multiple independent projects
- Email and file-filing rule configuration under Settings
- Protected Drive-only OAuth connection, root verification, and explicit project-folder provisioning
- Separate personal-test and company-production Google Drive profiles
- Google Drive / Shared Drive and Google Sheet organizational blueprint
- Gmail review queue, project scheduling, client/project activity, and AI assistant prototype (not connected to Gmail yet)
- D1-backed data-model and API foundation for clients, contacts, projects, rules, mail items, and workspace settings

## Google Workspace setup

See [`docs/google-workspace-organization.md`](docs/google-workspace-organization.md) for the shared-drive layout, email rules, client-sheet mirror, and administrator checklist.

For the prototype test sequence and the exact Google Cloud / Workspace handoff, see [`docs/testing-and-google-workspace-setup.md`](docs/testing-and-google-workspace-setup.md).

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the application and run source-level prototype checks
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
