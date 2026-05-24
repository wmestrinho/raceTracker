# UI Review (raceTracker)

Date: 2026-05-24

## What is strong now
- Clear light-themed visual identity
- Good section segmentation for race-day workflows
- Improved accessibility baseline (skip link, focus-visible, landmarks)
- Better metadata and social preview support

## High-impact next improvements
1. Replace footer placeholder links
   - Current: social links point to `#`
   - Action: wire real URLs or hide links until ready

2. Contact section CTA upgrade
   - Current: static email text
   - Action: add clear CTA button (`mailto:`) and optional short form endpoint placeholder

3. Dashboard chart semantics
   - Current: visual placeholder bars/segments
   - Action: add concise inline labels/value badges for readability without hover

4. Mobile nav ergonomics
   - Current: dense top nav on small screens
   - Action: convert to compact menu button under 768px

5. Visual hierarchy polish
   - Action: tighten vertical rhythm between section heading, lead text, and content cards

## Technical follow-ups
- Add simple performance budget check (asset size warning) in CI
- Add HTML validation step in CI when introducing a validator dependency
- Optionally split JS into modules (`charts.js`, `telemetry.js`, `workshop.js`) once scope grows

## Suggested execution order
1) Footer/contact CTA cleanup
2) Dashboard readability labels
3) Mobile nav compact mode
4) CI enhancements
