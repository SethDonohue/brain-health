# Brain Health: phone test checklist

Tick as you go. Items marked 📱 can only be checked on the real phone. Last updated for Build 16 (v0.13.0).

## 0. Install
- [ ] APK installs over the old app and your data is still there
- [ ] App opens on your first tab (set in Settings)
- [ ] 📱 New brain icon on the home screen and in the app drawer
- [ ] Settings → Import with Claude still shows your key (moved into the app's database, no need to paste it again)

## New in Build 16: booking import reads long screenshots
- [ ] Share the long "My bookings" screenshot (or Train → Import bookings → pick it). The preview shows each booking's real time: Happy Hour 3:00 PM and Primetime 5:00 PM, 2 h each, on every booked day
- [ ] Save it: on Tue 24 and Wed 25 the old wrong sessions (4:30–6:30 and 7:30–9:30) change to 3–5 PM and 5–7 PM instead of new ones being added next to them. If any day ends up with extra pickleball sessions, tap Undo in the toast and tell Claude
- [ ] Import the same screenshot again: it says the sessions are already in your plan
- [ ] A normal one-screen screenshot still imports as before
- [ ] 📱 If a time can't be read, the preview leaves it blank instead of showing a wrong time

## Build 15: voice logging understands start and end times
- [ ] Log activity → Say it instead → say "pickleball from 2:45 p.m. to 6:15 p.m. yesterday". The card shows Pickleball, yesterday, 3 h 30 min, starting 2:45 PM
- [ ] Try "between 2 and 4 pm", "2:45 until 6:15", "from noon to 2" and "11 pm to 1 am": each shows the right length and start time
- [ ] Say am/pm only once ("from 2:45 to 6:15 pm"): it still works out 3 h 30 min
- [ ] Saying a plain length ("two hours", "45 minutes") and "at 5 pm" still work as before
- [ ] Note any sentence with times that it gets wrong or doesn't understand

## Build 14: cardio 300 / 600, mountain bike up/down, log by voice, alcohol
- [ ] Home → Cardio this week now shows Floor 300 and Target 600 (Settings → cardio floor/target says 300 and 600; you can still change them)
- [ ] Home → Log activity → Mountain biking: climbing and descending each have minutes, intensity (both start vigorous) and an effort slider (8 and 6); "Ride total" adds them up
- [ ] Log a ride of 45 min up and 30 min down: Home and Train show "45 min up, 30 min down" (or "Mountain biking 1 h 15 min (45 min up, 30 min down)" on the Train chips); it counts as one ride, and cardio goes up by 150 (both parts count double)
- [ ] Switch the descent to Moderate, save, reopen with Edit: the split is kept and cardio counts that part once
- [ ] Turn off "Split into climbing and descending": the old single-length form comes back; an older ride you logged before opens unsplit
- [ ] Log activity → Say it instead: tap the microphone on your keyboard and say "pickleball two hours yesterday". A card shows what was understood (activity, day, length, intensity); Log it saves it, Change details opens the normal form filled in
- [ ] Try "mountain bike 45 minutes up and 30 down Saturday" and "pickleball 90 minutes moderate at 5 pm". Note any sentence it gets wrong or doesn't understand
- [ ] 📱 If it says it didn't catch something, the message tells you what to add; nothing is saved until you tap Log it
- [ ] Settings → export CSV has two new columns, climb_min and descent_min
- [ ] Sleep → a night's log has "Alcoholic drinks that evening" with 0 selected; pick 2 and save
- [ ] That night in Recent nights (and Last night, if it's last night) says "2 drinks"; nights with 0 say nothing
- [ ] Week → Sleep and caffeine shows "Nights with alcohol" with the count and total drinks
- [ ] Older nights open with 0 drinks and save fine

## Build 13: all exercise drawings
- [ ] Every exercise's ⓘ now shows a drawing for every step (no "no drawing" message on any of the 16)
- [ ] Workout A: Chin-up (band pulldown kneeling, negatives lower slowly, chin-up), Single-leg RDL (wall, free, dumbbell), Overhead press (pike, dumbbell), Hamstring curl (both legs, one leg up), Side plank (knees, full), Calf raise (on a step, hand on the wall)
- [ ] Workout B: Row (band seated, dumbbell with a hand on a chair), Push-up or floor press (counter, floor, lying press), Hip thrust (bridge, one leg, shoulders on the couch), Lateral raise (front view), Face pull (band, prone Y), Plank (plank, long plank), Pallof press
- [ ] Each drawing looks like the move to you; note any that look wrong or confusing
- [ ] 📱 Animations run smoothly and stop when the popup closes

## Build 12: Home tab and exercise demos
- [ ] The first tab is now called Home (same screen as before); Settings → Tab order says Home too
- [ ] Train → Strength list: each exercise has an ⓘ button on the left; tapping it opens the demo, tapping the row still opens history
- [ ] Split squat ⓘ: a looping figure; Split squat / Bulgarian / Bulgarian + DB buttons switch the drawing (couch, dumbbells)
- [ ] Decline push-up ⓘ: Push-up, Feet on couch and Loaded (backpack) all animate
- [ ] Workout B → Squat ⓘ: Bodyweight and Goblet animate
- [ ] Tap the drawing: it pauses; tap again: it plays
- [ ] 📱 "Watch video examples" opens YouTube (app or browser) with a search for that step; back returns to the app
- [ ] In the workout player: the ⓘ next to the step name opens the demo on top of the workout; Close or the back button returns to the workout without losing sets
- [ ] Exercise history popup: ⓘ next to each step name opens that step's demo; Close goes back to the history

## Build 11: home strength A/B and new targets
- [ ] Train → Strength shows Workout A / Workout B; A says "Up next" the first time
- [ ] Workout A lists 8 exercises (split squat, chin-up, decline push-up, single-leg RDL, overhead press, hamstring curl, side plank, calf raise); B lists a different 8
- [ ] Tap Workout B: the list changes; Start workout B opens the player with "Workout B, aim for 50–60 min" at the top
- [ ] The Variation buttons switch steps (e.g. Split squat / Bulgarian / Bulgarian + DB); weighted steps show a weight box
- [ ] Finish a workout A: next time the card says B is up next; Home's Start workout starts B
- [ ] After a bodyweight step where every set hit the top of the range, the next workout says "Ready for the next step?"
- [ ] Old gym sets are still in history (they just aren't in the new list)
- [ ] Settings → Weekly targets: Pickleball 3× a week, Strength 50 min–1 h, Mountain biking 1× a week with "Every 2 weeks" selected
- [ ] Next week's plan: pickleball Mon, Wed, Thu (unless you saved a usual week); MTB shows every other week, and the MTB tile is hidden on off weeks
- [ ] If you saved a usual week: re-save it after arranging a week the new way

## Build 10: weekly targets
- [ ] Settings → Weekly targets lists Pickleball, Strength and Mountain biking
- [ ] Change a target → Save targets: Train and Today tiles update straight away; Undo in the toast puts it back
- [ ] Change a session length: Today's hint for an untimed session shows the new range
- [ ] Set Mountain biking to 0: its tile disappears; set it back
- [ ] Reset to protocol targets brings back 3 / 2 / 1 (MTB every 2 weeks)
- [ ] Week tab: past weeks keep the target they had
- [ ] This week's planned sessions don't change when you save; next week starts with the new count (unless you saved a usual week)

## Build 9: session times
- [ ] Train: imported pickleball bookings show a range, e.g. "Pickleball 3–5 PM"
- [ ] Sessions on a day are in time order; untimed ones come after timed ones
- [ ] Tap a session → Set time → pick start and length → Save time: chip updates; Undo in the toast restores it
- [ ] Change time and Clear time work; a bike commute and the rest day have no Set time
- [ ] + on a day → "Add a time (optional)" → pick length → pick activity: it's added with that time
- [ ] Log as done on a timed session fills in its start time and length
- [ ] Today shows "3–5 PM" for today's booked session, and Tomorrow lists times
- [ ] Repeat last week copies times; a new week started from your usual week has no times
- [ ] 📱 Long chips (Mountain biking 5–6:30 PM) wrap neatly with Font size set to Large

## New in Build 8
- [ ] Settings → Backup: "Automatic daily backup" is on and shows a last backup time and where it was saved
- [ ] 📱 Say whether it says Documents/BrainHealth or app storage (tells us if Android allowed the Documents folder)
- [ ] 📱 Files app → Documents → BrainHealth has a brain-health-auto-… file
- [ ] Back up now adds a new entry to the list; Restore on an entry asks before replacing
- [ ] 📱 About a week later: a prompt offers to send a backup to Drive or Files
- [ ] Train → Strength → Import a workout → paste a workout → check sets, reps, holds → Add or Replace → Undo works
- [ ] Eat → Usual meals has "MIND smoothie, half": Add logs 1 greens, ½ berries, ½ nuts, ½ whole grains

## 1. Import bookings (new, test first)
- [ ] Settings → Import with Claude → paste key → Save key → "Key saved and working"
- [ ] A wrong key shows "key wasn't accepted"
- [ ] 📱 Court app: screenshot → Share → "Add to Brain Health" appears in the list
- [ ] Opens a preview with the right dates, times (3 PM), 2 h and booking name
- [ ] Untick one session, change a time, tap Add
- [ ] Train → next week: pickleball chips show the time and the weekly count did not grow
- [ ] Tap Undo: plan goes back to how it was
- [ ] Share the same screenshot again: "already in your plan", nothing doubled
- [ ] Train → Import bookings → choose the screenshot from the picker works too
- [ ] Airplane mode: import says you're offline; the rest of the app still works

## 2. Import a recipe and edit meals (new)
- [ ] Eat → Usual meals has "MIND smoothie (workout)"; tap Add: 2 leafy greens, 1 berries, 1 nuts, 1 whole grains log (Undo works)
- [ ] If you delete that meal in Edit meals, it stays deleted after restarting the app
- [ ] Eat → Import it → paste a recipe → Read it → servings look sensible
- [ ] Change a serving, remove a group, Add to usual meals, Undo works
- [ ] Eat → Edit meals: add, rename, change servings, reorder (↑ ↓), delete, Save
- [ ] Reset to protocol meals brings the original six back (including both smoothies) (then Save)

## 3. Train
- [ ] Repeat last week copies the plan; Undo restores it
- [ ] Save as usual week; next unplanned week starts from it
- [ ] Settings → Clear usual week goes back to the protocol default
- [ ] 📱 Press and hold a session, drag to another day (screen scrolls near the edges)
- [ ] Moving a session onto the rest day asks which day to free
- [ ] Add a session with the + on a day
- [ ] Strength: start workout, log sets (weights carry down), rest timer runs
- [ ] 📱 Rest timer buzzes at zero
- [ ] Finish workout shows the summary

## 4. Home
- [ ] Commute leg button logs a ride; Undo and "Hard ride" in the toast work
- [ ] Log activity: custom activity (e.g. hike) can be created and logged
- [ ] Weekly exercise and cardio tiles update
- [ ] Bottom buttons clear the phone's navigation bar

## 5. Sleep
- [ ] Bedtime changes the cutoffs (caffeine, exercise, shower)
- [ ] Log last night: times, quality, checklist
- [ ] Caffeine: tap a drink to log; edit drinks and amounts; Undo

## 6. Eat
- [ ] Date and Yesterday/Today toggle no longer collide
- [ ] Tap adds a serving; press and hold takes one back
- [ ] Edit my targets: change, Save, Undo, Reset
- [ ] Study bands show with ▼ you and a dashed line for your target
- [ ] About these bands opens the evidence note

## 7. Week
- [ ] Exercise, MIND score and sleep cards fill in after a few days of logging
- [ ] Trend bars: tap a bar, switch 4 / 12 weeks
- [ ] 📱 Export backup opens the Android share sheet
- [ ] 📱 Settings → Restore from a backup file works

## 8. Settings and general
- [ ] Units switch between imperial and metric everywhere
- [ ] Tab order can be changed and the first tab opens at launch
- [ ] Dark mode looks right (phone setting)
- [ ] 📱 Back button: closes sheets, then goes to the first tab, then leaves the app
- [ ] 📱 Phone Font size set to Large: no text overlaps or runs off the screen
- [ ] 📱 Switch away and back mid-entry: nothing is lost
