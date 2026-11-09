# Brain Health Tracker: instructions for Claude

Personal, single-user Android app that tracks a brain-health protocol: exercise, sleep hygiene and the MIND diet. A PWA wrapped in Capacitor, Android only. The owner has no computer: everything is built in the cloud and installed on their phone from a GitHub Release. They read on a phone screen, so explain things simply and briefly.

This file is the source of truth for how to work on this repo. Project notes (todo plan, test checklist, release process) live in the "Brain Health" Claude Project docs; this repo's `README.md` and `TEST-CHECKLIST.md` mirror what matters.

## Stack
- React 19 + TypeScript + Vite, Tailwind CSS 4
- Dexie (IndexedDB) for all app data; Zod for validation; Zustand for UI state
- Capacitor 8 (Android, minSdk 29)
- Milestone M1 in progress. Location, ride detection and reminders are later milestones; don't build them unless asked.

## How we work
- One tab or feature at a time. After each one, publish a build so it can be tested on the phone before moving on.
- Before multi-file changes, give a short plain-language plan and wait for an OK.
- Make minimal, focused changes. Don't refactor or restyle code unrelated to the task.
- Follow existing patterns, file structure and naming in the repo.
- Ask before adding any new dependency.
- Never claim something works until it type-checks and builds. Tell the owner exactly what to test on the phone.
- If unsure an API or plugin method exists, say so and check instead of guessing.

## Build and release
- Every build is published as a **GitHub Release built by GitHub Actions** (`.github/workflows/release.yml`). Don't send hand-built APKs unless asked or GitHub is unavailable (say so if it is).
- Before releasing: `npx tsc -b`, `npm test`, `npm run build` and `node e2e/layout.cjs` all pass. Keep type checking free of errors.
- Steps: bump `versionCode` and `versionName` in `android/app/build.gradle` (release tag is `v<versionName>`) → update README status/features, `TEST-CHECKLIST.md` and the Project docs → commit and push to `main` → start the "Release APK" workflow → watch it → confirm the release and APK exist.
- Start the workflow with `gh api -X POST repos/SethDonohue/brain-health/actions/workflows/release.yml/dispatches -f ref=main` (tag pushes and direct release creation are blocked in Claude sessions), or the owner taps Actions → Release APK → Run workflow.
- **Always send the owner the link to the release page**, e.g. https://github.com/SethDonohue/brain-health/releases/tag/v0.6.0, say to tap the APK under Assets, and list what to test on the phone.
- Never hand-edit `android/app/src/main/assets/public`; `cap sync` generates it.
- Don't change `applicationId`, signing config or keystore without asking. The signing key is not in the repo (it's in GitHub secrets `BRAINHEALTH_KEYSTORE_BASE64` and `BRAINHEALTH_KEYSTORE_PASSWORD`); never commit `*.keystore`, `*.jks` or `keystore.properties`. The workflow checks the APK's certificate matches the installed app.
- The repo is public: never put secrets, keys or personal data in it.

## Data
- All data lives in Dexie. Never use localStorage for anything important.
- Any schema change needs a new Dexie version with a migration; never drop or reset existing data.
- Request persistent storage (`navigator.storage.persist()`) so Android is less likely to clear it.
- Keep the export/import (JSON) path and automatic backups working.
- Fully offline: no accounts, no analytics. The only network call is the optional Claude API import, with the owner's own key (stored in a device-only table, never in backups).

## App rules
- Units are switchable imperial/metric. Store in one canonical unit and convert only for display.
- Caffeine is logged per drink.
- Each logged activity has a user-chosen intensity. Defaults: pickleball = moderate, mountain biking = vigorous, bike commuting = moderate (sometimes vigorous). No road cycling.
- Cycling (commuting and MTB) counts toward the cardio goal.
- Activities aren't tied to fixed days; they can move around the week.
- No sleep-tracker integration; sleep is logged manually.
- Home screen shows weekly total exercise and weekly cardio.
- The app suggests plan changes based on logged data.
- Plan times are for planning only; logs record start and length, and only length counts toward goals.

## Mobile UI
- Phone first: touch targets at least 48dp (the layout checker enforces 44 px), one-handed reach for main actions.
- Respect safe areas (status bar, gesture nav) and support dark mode.
- Handle the Android back button sensibly on every screen.
- Handle app pause/resume without losing unsaved input.
- Run `node e2e/layout.cjs` after UI changes; fix overflow, wrapped labels, overlaps and small tap targets it reports.

## Native features (later milestones)
- Use Capacitor plugins rather than browser APIs for location, motion and notifications.
- Declare permissions in `AndroidManifest.xml`, request them at runtime with a clear reason, and keep the app fully usable if denied.
- Background location or ride detection needs a foreground service; keep battery use low (no tight polling, throttle GPS).

## Commits
End commit messages with the attribution lines the session provides.
