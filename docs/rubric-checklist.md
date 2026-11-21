# Relief Claim Assist Rubric Checklist

This checklist maps the feature brief and the hackathon's six evaluation categories to observable behavior. Use the [manual workflow guide](manual-workflow-test.md) for click-by-click instructions.

## Run the checks

1. Run `npm run typecheck`, `npm run test:unit`, and `npm run build`.
2. Run `npm run test:e2e` with the configured demo credentials. The suite starts the production build, exercises Supabase and configured providers, and opens Chrome at desktop and phone widths.
3. Run [`supabase/tests/staff_approval.sql`](../supabase/tests/staff_approval.sql) in an authorized SQL console to verify the database approval boundary. The script rolls back its synthetic test records.

If Turbopack's CSS worker fails to start on Windows, build with `npm run build -- --webpack` before running the same end-to-end suite.

The live browser suite creates synthetic claims and audit events. It restores the original system rule configuration and the original consent grant. Use a dedicated demo dataset.

## Evaluation evidence

| Rubric area | What to demonstrate | Pass condition |
| --- | --- | --- |
| AI implementation and intelligence · 30 | Ask a policy question, analyze a synthetic document, and classify a suspicious text. Ask an ambiguous command. | Policy cites the registry, evidence shows extracted fields, Scam Shield compares the verdict with the rail, and the assistant asks for clarification before opening tools on low-confidence input. |
| SaaS and architecture · 20 | Switch roles, create and submit a claim, inspect the scoped partner API in Swagger, and compare staff overview counts. | Roles enter the correct workspace, API scopes are enforced, counts reflect Supabase, and the build and automated checks pass. The health endpoint is available at /api/health. |
| Real-world problem solving · 15 | Submit on a weak connection, ask for clearer evidence, simulate a failed payment, retry, and check the final receipt. | A single claim survives sync, an officer records the decision, and the simulated receipt matches in citizen and shopkeeper views. |
| Accessibility and inclusion · 10 | Run at phone width, use the keyboard, switch English and Urdu, record a short clip in 2G Lite mode, and open the offline screen. | The claim steps can be read or played aloud, typing is available, and queued changes sync after reconnect. The offline screen loads without exposing a cached private workspace. |
| Safety, privacy, and reliability · 15 | Revoke helper access, test ambiguous assistant commands and a duplicate-identity fixture, and review the audit trail. | Revocation blocks the next call and replay, low confidence triggers clarification or officer review, and an auditor cannot change audit rows. |
| Innovation and creativity · 10 | Show the voice launcher, shared-device family switching, rule simulation, and two safety thresholds. | The same change is traceable through the workspace, simulator, and audit trail. Judges evaluate originality and design quality. |

## Verification on November 21, 2026

- **Passed against the demo project.** One-click sign-in and role restrictions, concurrent claim submission, evidence replacement, officer approval, failed mock payment and retry, matching receipt, consent revocation, staff approval, scoped partner API, rule history, and immutable audit logs.
- **Passed with live AI services.** Pi and MiMo ran the cited policy tool and analyzed a private synthetic image. Policy retrieval returned the widow section for an Urdu query. Deepgram transcribed English in the live browser relay and the 2G recording flow.
- **Passed in Chrome.** The suite checked phone and desktop layouts, keyboard navigation, the account menu, persona switching, offline claim and evidence sync, and a cold start without private content.
- **Passed with fallbacks.** Simulated Jev clarified low-confidence commands before calling tools. The Jev adapter passed unit tests with a simulated live response and a provider failure. The unconfigured Cartesia endpoint returned the browser speech fallback.
- **Pending provider or device verification.** Live Jev, live Cartesia, and an Urdu microphone and playback check on a device with an Urdu voice.

## Provider modes

- Jev can run in deterministic simulation mode without a key. Unit tests exercise the live request and response contract with a mock provider. Live Jev requires OpenRouter credentials.
- Deepgram live audio uses a server-side relay with short-lived recording sessions. Short recordings use the authenticated transcription endpoint when live audio is unavailable or 2G Lite mode is active. Host the live relay on a long-running Node.js instance.
- Cartesia requires its API key and language voice IDs. Use browser speech when Cartesia is unavailable. The voices installed on the device determine which languages can be spoken.
- The offline screen protects the private workspace on a cold start. Reconnect to authenticate and reopen a saved draft.
- The current preview runs locally and uses the connected demo Supabase project. The CI workflow runs after a push or pull request.

## Public submission

For a hosted demo, use a long-running Node.js 24 process with HTTPS. Run `npm ci` and `npm run build`, then start the process with `npm run start`. Configure the server environment from `.env.example`, connect a synthetic Supabase dataset with the migrations applied, and keep `RELIEF_DEMO_REGISTRATION=false`. Add the HTTPS `/auth/callback` URL to Supabase Auth if you enable email confirmation. Check `/api/health`, one-click sign-in, and both microphone paths on the hosted URL before sharing it.

The submission also needs the GitHub repository link and a public Google Drive demo video link. The [five-minute walkthrough](../README.md#five-minute-judge-demo) covers the actions to record.
