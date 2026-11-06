# Brain Health

A personal Android app for following a brain-health protocol: exercise, sleep habits and the MIND diet. It plans your week, logs what you actually did, and suggests changes based on your own data.

Single user, offline-first, no account. Everything is stored on the phone.

> **Status:** Milestone 1 (M1) in progress. Current build: v0.5.0 (versionCode 8).
> This is a personal project, not a medical device or medical advice.

## Features

**Today**
- Weekly total exercise and weekly cardio at a glance (cardio counts vigorous minutes double; floor 150, target 300 moderate-equivalent minutes)
- Today's planned sessions, with booked times
- One-tap bike commute logging and a full "Log activity" form with intensity
- Custom activities (for example, hiking)
- Cutoff times from your bedtime: caffeine, exercise and hot shower

**Sleep**
- Bedtime setting and a nightly sleep log (times, quality, checklist)
- Caffeine logged per drink, with editable drinks and amounts

**Eat**
- MIND diet food groups with tap to add a serving and press-and-hold to take one back
- Editable personal targets, shown against the MIND study's scoring bands
- Usual meals (including a MIND workout smoothie and a half-smoothie for before and after a session), editable and reorderable
- Import a recipe from a photo, file or pasted text (see AI import)

**Train**
- Weekly targets with a movable plan: press and hold to drag a session to another day, with a rest-day check
- Repeat last week, and save a usual week that new weeks start from
- Strength player with per-set logging, weight carry-down and a rest timer
- Import bookings (for example, a court-booking screenshot) or a strength workout (see AI import)

**Week**
- Exercise totals, MIND score, sleep summary and trend charts (4 or 12 weeks)
- Suggestions from your logs (late sessions, late caffeine, missed targets and more)
- Export a full backup or a sessions CSV

**Settings**
- Imperial or metric units (stored metric, converted for display)
- Tab order, rest day, cardio goals, bedtime
- Automatic daily backups (keeps the last 7), back up now, restore from a file or a saved backup
- Claude API key for imports

## AI import (optional)

Bookings, recipes and workouts can be imported from a screenshot, photo, PDF, text file or pasted text, or shared straight to the app from another app with Android's **Share** menu.

- Uses Anthropic's Claude API (model `claude-haiku-5-5`) with **your own API key**, entered in Settings.
- The key is stored on the phone in a device-only database table. It is never included in backups.
- Only the content you choose to import is sent. Every import shows an editable preview, and nothing is saved until you tap Save. Undo is available afterwards.
- Imported booked sessions reuse planned sessions of the same activity, so weekly counts don't double.
- This is the only network feature. Everything else works offline.

## Tech stack

| Area | Choice |
| --- | --- |
| UI | React 19, TypeScript, Vite |
| Styling | Tailwind CSS 4 |
| Data | Dexie (IndexedDB), versioned schema with migrations |
| State | Zustand (UI), `dexie-react-hooks` (live queries) |
| Validation | Zod (protocol config, backups, AI responses) |
| Native | Capacitor 8 (Android only, minSdk 29): App, Filesystem, Share, plus a small custom share-target plugin |
| Tests | Vitest with fake-indexeddb, Playwright layout checks |

## Project structure

```
src/
  domain/      Pure logic: protocol seed (protocol.v1.ts), dates, cardio, MIND scoring, plans, strength, units
  db/          Dexie schema (db.ts), data operations (repo.ts), backups and automatic backups
  ai/          Claude import: request, parsing and validation, share-sheet bridge
  screens/     Today, Sleep, Eat, Train, Week, Settings, strength player, onboarding
  sheets/      Bottom sheets: logging, moving sessions, sleep, eat, train, import
  ui/          Shared components (Sheet, Button, Stepper, Segmented, Toggle, toasts)
android/       Capacitor Android project (ShareInPlugin.java receives shared items)
e2e/layout.cjs Layout checks across phone sizes, text sizes and themes
design/        Icon source (SVG)
TEST-CHECKLIST.md  What to test on the phone after each build
```

The protocol (targets, diet groups, workout, sleep rules, meals, drinks) is versioned data, not code. Edits in the app save a new protocol version, so past weeks keep the rules they were logged under.

## Getting started

Requirements: Node 22+, and for APKs, JDK 21 and the Android SDK (platform 36).

```bash
npm install
npm run dev        # web preview at http://localhost:5173
npm test           # unit and data tests
npm run lint
npx tsc -b         # type check
```

The app runs in a desktop browser for development. Native-only features (share target, file backups, vibration) need the Android build.

## Building the Android APK

```bash
npm run build              # type check and web build
npx cap sync android       # copy the web build into the Android project
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Or `npm run apk` for all three steps.

- Bump `versionCode` and `versionName` in `android/app/build.gradle` for each build.
- **Signing key:** the key that signs the APKs isn't in this repository. Put `brainhealth.keystore` and `keystore.properties` (with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`) in `android/`; both are ignored by git. Signed builds install over the existing app and keep its data. Without the key, Gradle signs with the default debug key: the build works but can't update an installed copy.
- Don't edit `android/app/src/main/assets/public`; `cap sync` generates it.

APKs for each build are attached to this repository's GitHub Releases.

## Testing

- `npm test`: domain logic, database operations, backups, imports with mocked Claude responses.
- Layout checks: build, serve the build, then run the checker:

  ```bash
  npm run build && npx vite preview --port 4173 &
  node e2e/layout.cjs                        # 5 widths x 3 text sizes x light/dark
  node e2e/layout.cjs --quick                # fewer combinations
  SCALES=200 node e2e/layout.cjs             # largest Android text size, report only
  ```

  It fails on horizontal overflow, clipped or wrapped tab labels, overlapping text, tap targets under 44 px, and content hidden behind the footer.
- On the phone: follow [TEST-CHECKLIST.md](TEST-CHECKLIST.md).

## Data and backups

- All data lives in IndexedDB through Dexie. Schema changes add a new Dexie version with a migration; existing data is never dropped.
- The app asks Android for persistent storage.
- Automatic backup: once a day when the app opens, a full JSON backup is saved to `Documents/BrainHealth` (or the app's own storage if Android doesn't allow that). The last 7 are kept. Once a week the app offers to send one to Drive or Files.
- Manual: Settings or Week → Export full backup. Restore replaces all data on the phone with the backup.

## Roadmap

- **M1 (in progress):** protocol, planning, logging, strength, MIND diet, sleep, caffeine, units, offline storage, imports, backups.
- **M2:** reminders and notifications from your bedtime, weekly reports.
- **M3:** smarter suggestions, location prompts and ride detection, protocol editor, Learn tab.
- **M4:** GPS for rides.

## Evidence notes

The MIND diet bands follow Morris et al. (2015), an observational study. A 2023 randomized trial (Barnes et al., NEJM) found no significant cognitive difference between the MIND diet and a control diet with mild calorie restriction. The app shows the bands as a reference for what the study counted, not as proven thresholds.

## License

Private, personal project. All rights reserved.
