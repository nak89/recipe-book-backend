# Security remediation — 6 October 2026

These changes are local and in the development Supabase project only. Nothing was committed, pushed or deployed to production. **Email confirmation stays disabled as requested while testing.** This report updates the initial snapshot in SECURITY_AUDIT.md.

## Completed

- Backend dependency audit: **0 reported vulnerabilities**, down from 13 initially. Prisma is now 7.10.0, its client was regenerated, and the database integration tests pass. Scoped overrides pin patched deepmerge-ts and mysql2 dependencies; revisit those overrides when Prisma incorporates them upstream.
- Development recipe photos are private. Authenticated requests obtain one-hour viewing links only for objects in the caller's directory. Anonymous access and another user's access are rejected. Recipe writes also reject another user's uploaded photo reference.
- The app resolves stable stored references to temporary viewing links, batches requests, refreshes expiring links and separates caches by session. Uploaded photos use memory-only image caching. Public library images remain public. Existing recipe rows need no URL migration.
- Web exports now include a restrictive Content Security Policy, anti-framing, MIME-sniffing, referrer and permissions headers. Service-worker registration moved out of inline JavaScript. The app remains a single-page Expo web export.
- Mobile dependency updates remove the known URL-decoder issue and several XML/YAML and other dependency advisories without changing Expo SDK 57. The remaining npm audit result is **21 high entries**, propagated from two unpatched roots: braces 3.0.3 and node-forge 1.4.0 in development/build tooling. No patched release was available at this check. This is not a clean mobile audit, nor 21 demonstrated app exploits.
- Earlier fixes remain: bounded multipart fields, signup throttling, environment-file ignore rules, and database grants/RLS captured in a migration applied to development.

## Validation

- Backend type check, 161/161 API integration checks and 2/2 security unit tests passed.
- Mobile lint, type check and 190/190 unit tests passed.
- Final web export passed. Chrome login, recipe navigation and a private uploaded photo worked with the restrictive policy enforced; the image loaded through a signed link and the checked browser logs contained no warnings/errors.
- Added coverage for photo ownership, anonymous denial, public-URL denial, batching, session isolation, concurrent expiry refresh, and the navigation parser's compatibility.
- Evidence lives in `testing/security/remediation-*` and `testing/security/private-photo-browser.jpg`.
- Disposable browser/integration accounts, records and uploaded fixtures were removed. Cleanup verification found one original development account, its 30 recipes, and zero remaining QA accounts.
- Native iPhone/Expo Go verification remains required; browser and unit checks do not establish native upload/navigation behaviour.

## Maintenance and release order

1. On the phone, test login, existing images, new photo upload, editing, logout/login and navigation. Run the development backend and Expo against the development project. The private development bucket requires the updated backend and client together.
2. Review and release the backend changes through the existing branch workflow. Render watches `meal-planner`; do not push it merely to save local work. Explicitly apply `20261006090000_lock_down_api_tables` to production as a release step: the current Render build does not apply migrations.
3. Build the web client with **`npm run export:web`**, using deliberate production environment values. Bare `expo export` on SDK 57 with `web.output=single` omits the security-header manifest. The wrapper emits `_expo/.routes.json`; verify the actual hosting response headers after release. Local testing does not prove EAS has deployed them.
4. Deploy the updated client and verify its authenticated photo signing against the updated API before changing production storage visibility. Older clients cannot display private objects. Account for stale installed/cached clients before the switch.
5. Only then make the production photo bucket private and apply its 5 MB JPEG/PNG/WebP/HEIC restrictions. Check anonymous denial and two-account isolation again. Production bucket visibility has **not** changed yet.

Mobile installs must run the `postinstall` script. `patches/query-string+9.5.1.patch` adds named exports expected by Expo Router 57 to the patched query-string version; removing the patch without updating Router can break navigation. The navigation regression test exercises this compatibility. The xcode-scoped uuid override is tooling-only. Review/remove overrides and the patch when upstream updates make them unnecessary; avoid forced SDK downgrades from npm audit.

## Still open

- Email ownership verification is deliberately deferred. Keep the requested testing exception until the user asks to enable it.
- Native encrypted session storage and migration of existing saved sessions; password recovery and full account deletion.
- Orphaned-photo cleanup, per-account storage/recipe budgets, list pagination and shared rate-limit storage for multiple server processes.
- Provider abuse controls, administrator MFA, email delivery and production redirect configuration still need a separate verified review.
- Production deployment/configuration and native-device acceptance checks are pending. Previously timed-out live API checks do not establish its deployed security behaviour.

Private storage cannot retract photos someone already downloaded. Signed links remain usable until expiry (one hour), including after logout. Deleted/replaced recipes do not yet remove their old stored photos. These limits are not resolved by making the bucket private.
