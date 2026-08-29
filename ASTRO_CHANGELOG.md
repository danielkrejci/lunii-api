# Astro changelog

Every deliberate change to the astrological knowledge base — `src/modules/dailyScore/rules.ts`
and the constants around it. Code changes belong in git; this file records **why** a
number is what it is, which git cannot tell you six months later.

## How to add an entry

One rule per entry, one entry per commit. Include:

- **What** — the pair, the group, the field, before → after
- **Reason** — the astrological argument, in words
- **Evidence** — what you ran to confirm it did what you meant

Any change to `baseImpact`, `importance` or `areas` invalidates
`src/modules/dailyScore/calibration.ts`. Re-run the calibration in the same commit:

```
pnpm tsx src/scripts/lintDailyScoreRules.ts
pnpm test
pnpm tsx src/scripts/calibrateDailyScore.ts --charts 300 --days 730 --write
pnpm tsx src/scripts/analyzeDailyScoreRules.ts --top 30
```

---

## 2026-08-30 — The planetary panel moved to its own on-demand route

**What** — the ten planet texts are no longer written by the daily horoscope generation.
They live in `planet_insights`, are written by `modules/insights/planets.ts` and are served
by `/daily-insight/planets`, which generates them on first read exactly as Moon Today does.

`/daily-insight/insight` no longer returns `content.data.planets`. Its deterministic half —
`data.planets` with each body's score and contacts — is unchanged, so the list still renders
from the horoscope response alone.

**Reason** — measured on a real generation: `planets[]` was 18 124 of 21 250 output
characters, **85 % of the output and therefore 85 % of the cost**, for text that is only
read when someone opens a planet. Most days nobody does, and the horoscope was waiting for
it.

Generating all ten in one request rather than one per tap: the output is the same text
either way, so per-planet only saves when few are opened, and it costs a second spinner on
every first tap, ten lifecycles instead of one, and ten chances to contradict each other.

The panel gets the finished horoscope as context so the two agree. Best-effort, not
awaited — the list renders instantly from the deterministic half, so a planet can be tapped
while the horoscope is still generating, and waiting would freeze the panel whenever the
horoscope failed.

**Evidence** — same chart, same day, both generations measured end to end:

```
                        latency   input    output    cost
before (one call)        63.6 s   11 678    6 324   $0.0193
after — horoscope         6.3 s    8 694    1 015   $0.0051
after — panel            22.6 s    5 396    4 443   $0.0127
```

Horoscope alone: **63.6 s to 6.3 s**, ten times faster. Opening the panel as well costs
$0.0179 against $0.0193 before, so the split is *cheaper even for a reader who opens it* —
the planet prompt drops every horoscope instruction, so the doubled context costs less than
the estimate that justified the change. Not opening it costs $0.0051, a 74 % saving.

Contact join verified: 29 contacts out of the engine, 29 carried into the text, none
dropped.

**Note** — `daily_insights` rows written before this still carry `planets` inside their
`content` JSON. Nothing reads it; it ages out with the row.

---

## 2026-08-30 — Thinking off, and the address rule moved to the top of every prompt

**What** — all four generations now pass `thinkingConfig: { thinkingBudget: 0 }`, and the
language-and-address rule from `buildPromptLanguageRule` is interpolated at the top of each
prompt as well as at the end. The cost calculation now counts `thoughtsTokenCount`.

**Reason** — `gemini-2.5-flash` thinks by default, and on the daily prompt it was spending
2 000–9 500 hidden tokens per call. Those are billed at the output rate, so every audit row
under-reported what was actually charged by 30–45 %.

Turning thinking off alone broke the informal address: the reply came back in the formal
form throughout. The rule had always been at the very end of a 45 000-character prompt, and
thinking was what made the model reach back for it. Repeating it at the top fixes that at
any budget, which means the thinking was buying nothing else.

**Evidence** — same prompt, same day, same reader; address form counted by regex over the
whole JSON reply:

```
budget      latency   thinking   output    cost      address form
default      47.8 s      2 003    7 773   $0.0279   informal 39 : formal   0
default      64.4 s      9 543    4 869   $0.0395   informal —  : formal   —
0            26.2 s          0    5 458   $0.0171   informal  1 : formal 108  ← broken
512          24.3 s        505    4 450   $0.0158   informal  4 : formal  99  ← broken
2048         47.3 s      2 047    8 088   $0.0288   informal 56 : formal   0
0   + rule on top   27.0 s   0    5 585   $0.0174   informal 80 : formal   0
512 + rule on top   28.5 s 455    5 034   $0.0172   informal 52 : formal   0
```

The two default runs differ by 35 % in latency and 42 % in cost because the default budget
is dynamic — capping it also removes that variance.

The duplication is not belt-and-braces. Removing the top copy and keeping only the one at
the end, thinking off:

```
prompt                     length      address form
horoscope, top + end       45 296 ch   informal 11 : formal  0
horoscope, end only        44 666 ch   informal  0 : formal 16
horoscope, end only        44 666 ch   informal  0 : formal 17
planets,   top + end       20 323 ch   informal 60 : formal  0
planets,   end only        19 693 ch   informal 61 : formal  1
planets,   end only        19 693 ch   informal  0 : formal 86
```

The horoscope fails every time without it. The planet panel, at half the length, fails
*intermittently* — which is worse, because one manual check passes and production does not.
The copy costs ~630 characters.

Net for the daily horoscope: **48–64 s to 27 s, and $0.028–0.040 to $0.019** at equal
quality.

**Note** — thinking is off for the compatibility and Moon prompts too, on the same
reasoning, but only the daily and onboarding prompts were measured directly. If a prompt
later grows a rule that the model has to hold across the whole context, this is the first
setting to suspect.

---

## 2026-08-29 — Personal data now changes the interpretation, not the salutation

**What** — three changes to how the four prompts see the reader.

The seven onboarding fields reach the prompts through one shared block,
`buildReaderBlock` in `src/modules/insights/reader.ts`, used by the daily horoscope, the
Moon screen and the compatibility overview. `goalsForTheYear` was loaded from the database
and dropped before the prompt for as long as the field has existed. `decisionStyle`,
`careerStage`, `beliefLevel`, `contentPreference` and the stored `personalityProfile`
reached no prompt but the onboarding one.

The daily prompt's priority list put the sky at 1–3 and did not rank the reader's own
transits at all; that is inverted. `EXAMPLE EVERYDAY SITUATIONS`, `REALISTIC EVERYDAY
MOMENTS`, two of the three dominant aspects and the duplicated `expression.*` lists are
gone, along with the instruction to "describe situations that many people genuinely
experience" — a direct order to be generic in a prompt whose stated thesis is the
opposite.

Form of address and grammatical gender moved into `buildPromptLanguageRule`, carried per
language by `Language.addressForm`.

**Reason** — the prompts were not under-written, they were under-fed. About 85% of the
daily prompt's astrological payload comes from `analyzeTransits`, which takes the sky and
never touches the natal chart, so it is identical for every reader in a timezone. The one
block that was the reader's arrived as bare aspect names because `buildImpacts` never
copied `rule.description` onto the `Impact`. Rich generic material next to skeletal
personal material produces a well-written horoscope about today's sky.

`addressForm` is per language rather than one global rule because the distinction is not
binary everywhere. `ja` and `ko` are marked `polite`, not `informal`: they have politeness
levels rather than a T/V pair, and the plain form from an app reads as rude rather than
friendly. `hi` and `id` are `polite` because आप and Anda are what a product uses with a
stranger. `en`, `sv`, `da`, `nb`, `fi` and `ar` are `informal` as a no-op — they have no
V-form, or lost it.

The non-binary branch does not say "write neutrally". Czech has no gender-neutral past
tense for the second person, so a model told to be neutral picks one anyway; it is told to
avoid participles instead.

Standing natal aspects are filtered to `PERSONAL_POINTS`. Sorting by tightness alone
returned Jupiter trine Pluto and Neptune sextile Pluto — true of the chart, and shared by
everyone born within years of it. This is the same argument `isExcludedPair` already makes
in `dailyScore/factors.ts`, one layer stronger: a personality reading needs one end of the
aspect to be Sun, Moon, Mercury, Venus, Mars or the Ascendant. The same filter applies to
the placements the reader block names, for the same reason — "their Uranus in Capricorn"
describes a birth cohort.

**Evidence** — two A/B pairs, each two readers with an identical chart and date and
opposite decision style, career stage, relationship status and goals.

Onboarding profile, same Sun/Moon/Rising:

```
A (researches, changing field)  core: "Než se pohneš, potřebuješ si shromáždit mnoho informací"
B (goes with gut, established)  core: "nakonec se vždy spolehneš na své vnitřní vedení"
```

Daily horoscope, same chart and same day:

```
A  "...můžeš narazit na tření při komunikaci svých nápadů nebo při nutnosti
    rychle se rozhodnout, což obvykle raději důkladně prozkoumáš"
B  "I když jsi zvyklá rozhodovat se rychle a podle pocitu, dnes se mohou vynořit
    hlubší vrstvy, které tvému rychlému úsudku dodají potřebnou hloubku"
```

The same Mercury tension, read two ways because the reader decides differently. Both texts
are informal and in feminine forms, which is the language rule landing.

Measured on a real prompt after the cuts: 44 899 characters, of which the generic sky is
16 381 and the personal transits plus the reader block are 3 152 — a ratio of 1 : 5.2. The
cuts are not what moved the needle; the priority order and the instruction on what to do
with the reader are.

Cost per daily generation, from `usage`: ~10 200 input and 6 500–7 600 output tokens,
$0.0195–$0.0221. Output is 78% of it, so trimming the prompt saves little — the ten-body
planet panel is the bill.

**Note** — the seven profile fields stay unconstrained `text` on the server. The client
sends English enum keys (`in_a_relationship`, `do_my_research`), and prompts humanize the
underscores rather than the server pinning an enum. Known risk, accepted deliberately: the
option lists live in the mobile app, and a server-side enum would need a client change and
a migration of existing values.

Two rule violations survive in the output and are worth watching. The model still names
astrology directly on occasion ("Dnešní úplněk v Rybách"), against a rule that predates
this change; and it paraphrases the stored profile back at the reader despite being told
not to. Neither is frequent enough to have a fix that is not more prompt text.

---

## 2026-08-17 — Full and New Moon are anchored to the instant, not to an angular window

**What** — the Moon Today screen shows a dedicated hero layout on the Full and New Moon.
Which day that is comes from the exact lunation instant, not from `getMoonPhase`.
`getMoonPhase` is unchanged and still buckets the cycle into eight 45° slices; it names
the phase, it does not decide the event.

**Reason** — `getMoonPhase`'s `fullMoon` bucket spans ±22.5°, about 3.7 days, so a hero
driven by it would run for four days in a row. The obvious fix — narrow the bucket to
roughly a day — does not work, and the reason is the sampling rather than the astrology.
Transits are stored once per date at local noon, and the Moon's elongation advances
10.76–14.37° per day. A window narrow enough to select one day (~12.2°) is sometimes
narrower than the gap between two consecutive samples, so the event falls between them
and **no day is flagged at all**.

The instant is unambiguous: it belongs to exactly one calendar day in any given zone.
That yields one hero day per lunation, with no gaps and no duplicates, and it is
timezone-correct — Honolulu and Auckland get their own right day rather than a shared
UTC one.

It also makes the displayed illumination honest. The worst case is local noon a full
twelve hours from the exact instant, which is an elongation of 173.9° and 99.7% lit —
still 100% after rounding. The old ±22.5° window would have shown a "Full Moon" at 96%.

**Evidence** — swept 50 lunations over four years against the real ephemeris, sampling
at local noon exactly as the transit table does:

```
elongation per day: min 10.76°  max 14.37°  mean 12.19°

half-width        window   lunations with no day   lunations with >1 day
±22.5° (current)   ~89h              0                     50/50
±12.19°            ~48h              0                     42/50
±9°                ~35h              0                     24/50
±6.1°              ~24h              3                      3/50
±3°                ~12h             24                      0/50
```

Then walked 70 consecutive days through `describeMoonDay` for Europe/Prague: exactly two
`fullMoon` days and two `newMoon` days, each reading 100% and 0% illuminated. The same
dates checked across Pacific/Honolulu, UTC and Pacific/Auckland resolve to different
local days, as they must.

`src/modules/moon/lunation.test.ts` locks the search itself: elongation within 0.002° of
the target, consecutive full moons 29.18–29.93 days apart across three years, and never
an instant before the one searched from.

**Note** — `getJulianDay` in `src/modules/astro/ephemeris.ts` passes the hour to
`swe_julday` as `getUTCHours() + getUTCMinutes() / 60` and drops seconds. Harmless where
it is used, since every caller samples on a whole minute, but it would cap the root
search at one-minute resolution. `src/modules/moon/lunation.ts` converts from the Unix
epoch instead. `getJulianDay` was deliberately left alone — every stored `birthChart` was
computed with it.

---

## 2026-08-05 — Reading split from generating on every AI endpoint

Revision of the entry below, which put generation behind a route the client wanted to
prefetch. That forced a choice between paying for accidental generations and turning
off the very React Query behaviour the prefetch was for: `retry: 3`,
`refetchOnMount`, `refetchOnWindowFocus` and `refetchOnReconnect` all assume the call
is a cheap idempotent read, and none of them care which HTTP method is underneath.

Three endpoints now come in pairs:

| reads | generates |
|---|---|
`GET /api/daily-insight/insight` | `POST /api/daily-insight/insight/generate` |
`GET /api/daily-insight/planets` | `POST /api/daily-insight/planets/generate` |
`GET /api/compatibility/people/detail` | `POST /api/compatibility/people/detail/generate` |

Every GET returns everything the engine can compute — scores, timeline, planetary
weights, compatibility — with the written fields **null** and a `generated: boolean`.
Retry, refetch and prefetch are all safe on them, and a refetch after focus now picks
up text that was generated elsewhere, which was impossible while the GET generated.

Both routes of a pair return the **same payload shape**, so a generate response goes
straight into the query cache via `setQueryData` without a follow-up refetch.

**Writes are conditional.** `WHERE … IS NULL` on the update, and `setWhere` on the
horoscope's upsert. Two concurrent generates both produce valid text; the one that
lands second must not replace what the user is already reading. Each generate route
also returns early when the text already exists, so a repeat costs nothing.

Endpoints that write but only ever compute deterministic values — `/score`,
`/score/explain`, `/list` — stayed `GET`. That is the line: writing on a read path is
fine while the write is idempotent and cheap. The problem was never the write, it was
the paid non-deterministic call.

Unrelated fix found on the way: `/list` inserted daily compatibility scores without
`onConflictDoNothing`, so two concurrent requests raced into a unique violation on
`compatibility_people_scores_person_date_idx` and the second returned 500.

`GET /detail` now returns **404** instead of throwing when no score row exists for
that person and date, since only `/list` creates those rows and a prefetched detail
can now legitimately arrive first.

---

## 2026-08-05 — Planet text moved to its own endpoint

Revision of the entry below, which folded ten planet interpretations into the daily
horoscope call. That made every daily insight pay for text most users would never
scroll to, and pushed the horoscope prompt to ~48,000 characters.

Split in two along the line the engine already draws:

- **Weights are free.** `GET /daily-insight/index` scores the day on every request
  (~110 aspect checks, deterministic) and returns the panel immediately with
  `description` and `reason` **null**.
- **Text costs a request.** `POST /daily-insight/planets { date }` generates it,
  stores it, and returns it. Idempotent: a day that already has text is returned as
  it stands rather than regenerated, so a double tap neither pays twice nor changes
  what the user just read. The response carries `generated: boolean` to say which
  happened.

The horoscope prompt is back to what it was. The planet interpretations get their own
compact prompt — **7,200 characters against the horoscope's 48,000** — carrying only
what they need: each body's weight, aspect count, contacts, meaning and keywords.

That prompt states explicitly that a high weight is not good news, since the score is
magnitude rather than valence, and that naming the planet is correct here — the rest
of the horoscope forbids mentioning astrology directly, and without the carve-out the
copy came out contorted.

**Storage stayed a single jsonb column** rather than becoming a `daily_insight_planets`
table. The panel is always read as a whole and always written as a whole, so per-planet
rows would buy nothing while multiplying the largest table in the database by ten —
3,650 rows per user per year instead of 365. A table becomes the right answer only if
generation ever goes per-planet, which would also mean ten AI calls instead of one and
lose the coherence of writing the set together.

`getDailyScore()` is called before the update to guarantee the row exists: a day may
never have been opened, and `daily_insights` cannot hold a planets-only row because
the area scores are NOT NULL.

---

## 2026-08-05 — Planet interpretations come from the model, and are stored

Follow-up to the entry below. The per-body `description` and `reason` were being
lifted from the static `PLANET_PROFILES` text, so every user read the same sentence
about Mars regardless of what Mars was doing to their chart. They now go through the
LLM like every other piece of copy.

**Flow.** `summarizePlanetInfluence()` is an input to `generateDailyInsight()`, not a
route-level decoration. The prompt gains a `PLANETARY WEIGHT TODAY` section carrying,
per body, the engine's 0–100 weight, the aspect count and the concrete transit list,
plus the body's meaning and keywords as reference material. The model returns one
`{ name, description, reason }` per body.

**The model never touches the numbers.** `score`, `weight` and `aspects` are merged
back from the engine **by name, not by position**, so a body the model skips or
renames still comes back with its numbers, falling back to the profile text and the
deterministic transit list. Same rule as the area scores: the engine computes, the
model writes.

The prompt tells it in this one section that naming the planet is expected — the rest
of the horoscope forbids mentioning astrology directly, and without the carve-out the
copy came out contorted.

**Now stored** in a new `daily_insights.planets jsonb` column (migration 0023). The
previous entry recomputed the list per request, which was right while it was pure
engine output; now that it carries generated text, regenerating it would mean another
AI call per request. A row with insight text but no `planets` — anything written
before this change — fails the completeness check and falls through to regeneration,
the same path a row with scores but no text already took.

No engine or calibration version change: no number moved.

---

## 2026-08-05 — Per-planet influence on the daily insight endpoint

`GET /api/daily-insight/index` now returns a `planets` array: all ten transiting
bodies with today's weight, a description and the transits behind it. Magnitude, not
valence — "how much is Mars in play" rather than "is Mars helping".

**Why it needed its own calibration.** Raw weight is not comparable across bodies:
the Sun's typical daily weight is 19.6 and Saturn's 7.5, so a shared scale would
report the Moon near 90 every day and Neptune near 5 forever, saying nothing about
today. `PLANET_CALIBRATION` fits each body against its own norm, over only the days
it actually aspects the chart — including idle days would drag every scale toward
zero. A loud Saturn day now scores 87 on a weight of 7.5, which is the point.

The resulting behaviour tracks orbital speed exactly, which is the check that it
works:

```
  moon     24  73  30  80  29  95  38  58  50  63     13.2 deg/day
  venus    33  28  25  24  31  40  55  70  78  82     1.2
  saturn   87  87  87  87  87  88  88  88  88  88     0.034
  pluto    39  39  39  38  38  38  38  38  38  38     0.004
```

**Nothing is stored.** The list is recomputed per request from the transit chart the
route already loads — ~110 aspect checks, deterministic, so there is nothing to keep
in sync and no migration. One consequence worth knowing: on a cached row the area
scores may come from an older engine while the planet weights are always current.

`CALIBRATION_VERSION` deliberately did **not** change. Its fingerprint hashes the
area constants only, because those are what stored rows depend on; `PLANET_CALIBRATION`
is computed fresh and persisted nowhere, so changing it must not mark existing rows
stale. `ENGINE_VERSION` is unchanged for the same reason — no stored score moved.

`description` comes from the existing `PLANET_PROFILES` text in `modules/insights`,
mapped in by the route. The scoring module stays free of prose, and no extra AI call
was added: the numbers are deterministic and the copy already existed.

Five tests added, covering sort order, the 0–100 integer range, a zero score for a
body aspecting nothing, that each body uses its own scale (a loud Saturn must be able
to clear 60), and that the Moon moves at least three times as much per day as Pluto.

---

## 2026-08-05 — Made the score behave like a forecast (engine 2026-08-05.2)

Product decision: daily dynamics now outrank astrological fidelity. Scores should
read like weather — 20–40 point swings between days, most of the 0–100 range in use,
genuinely bad and genuinely good days both possible.

### The finding that made it tractable

**Daily liveliness is exactly an area's Moon share.** Measured, not assumed:

```
  love     Moon 12% of its influence  ->  4.9 points a day
  career   Moon  4%                   ->  3.4
  health   Moon 13%                   ->  5.8
  mood     Moon 24%                   ->  9.9
```

The Moon is the only body fast enough to change a score overnight: 13.2°/day, so an
aspect lasts about a day. Mercury at 1.4°/day lasts ten days; the Sun fourteen;
Saturn fourteen months. The 2026-08-05 concentration had wired the Moon almost
entirely into `mood`, which is why career and love read as trends.

### What did NOT work, measured before being discarded

**A sharper orb taper.** `(1-orb/max)³` raised love's daily movement 23% but left
lag-1 autocorrelation at 0.83 (from 0.88) and *reduced* direction changes from 13.0
to 11.7 per 30 days. Worse, it cut the Moon's share of daily change from 60% to 44%:
a sharper taper punishes the one fast body hardest, because a single midnight sample
rarely catches the Moon near exact. Rejected.

**Boosting Mercury's importance** for career. No effect (career's quiet-fortnight
share went 22% → 25%), which exposed the general rule: **anything that merely scales
an area's raw values is absorbed when sigma is refitted.** Only changes to the
*ratio* of fast variation to slow level survive recalibration. That is why the taper
failed and why `LAYER_GAIN` works.

### What was changed

**`LAYER_GAIN.slow` 0.6 → 0.35.** Moves the score's level from slow bodies to fast
ones. Proposed and rejected on 2026-08-04 as "treating the symptom" — correct under
the old objective, and the right tool under this one. Cost, accepted knowingly: a
hard Saturn period no longer shows up as a sustained stretch of low scores.

**Calibration target 38/74 → 25/85.** Sigma is not only range, it is gain: a narrower
sigma amplifies day-to-day differences and widens the distribution in one move, so
this single pair of numbers drives both amplitude and contrast.

**The 11 Moon pairs re-authored**, mood capped around 0.30–0.40 and the rest spread
across the other areas, so every area receives a fast input. This deliberately walks
back part of the morning's concentration — for the Moon pairs only. The other 48
pairs keep theirs, and same-day area contrast still improved.

Three pairs kept `mood` dominant at 0.40 because the astrology is not negotiable
there: `moon-moon` (the lunar return), `moon-sun` (the core self axis) and
`moon-saturn` (emotional weight). A blanket 0.30 cap had made `health` the dominant
area of a lunar return, and the domain test caught it.

### Result

| | before | after |
|---|---|---|
| love, points/day | 4.9 | **8.7** |
| career | 3.4 | **7.4** |
| health | 5.8 | **10.7** |
| mood | 9.9 | **13.3** |
| overall | 5.8 | **10.3** |
| days moving 20+ points (overall) | 1% | **14%** |
| own p1–p99 range | 24–86 | **9–96** |
| days below 20 | 0% | **6%** |
| days above 80 | 3% | **16%** |
| career's quiet fortnights | 40% | **13%** |
| same-day area spread, median | 21 | **31** |

A sample fortnight, one chart:

```
  love     35 47 50 54 60 57 51 24 43 42 33 55 65 51 61
  career   37 35 31 25 23 44 65 40 43 40 42 37 21 25 26
  health   49 55 54 44 37 54 67 25 21 29 29 38 20 15 18
  mood     21 31 34 25 23 45 60 12 21 26 19 29 17 13 16
```

Day 7 → 8 drops health 67 → 25 and mood 60 → 12.

### Tests

Five bands were rewritten to encode the new intent rather than to pass: overall
tails now 18–32 / 78–92, day-to-day median 6–16, per-area pace 4–20, area means
within 4 points, "reaches 70+" within 7. Two tests were **added** so the new goal is
guarded rather than merely permitted: *reaches both ends of the scale* (2–15% of days
below 20, 6–30% above 80) and *produces jumps a user would notice* (more than 4% of
days moving 20+ points). 60 tests, all passing.

### Known consequence

Per-user baselines are now more visible, because the range is wider. Some charts sit
low for stretches — the sample fortnight above is one of them. Worth watching in real
use; if it becomes a problem the fix is centring each user on their own median rather
than on the population's, which is deterministic but needs a reference window.

---

## 2026-08-05 — Concentrated every pair's areas (engine 2026-08-05.1)

Scores were homogeneous in use: all four areas typically inside 50–60, and a day
like "love 90, career 25" never occurred. Measured cause, not a guess:

```
areas touched per rule:  4.00 of 4          every aspect nudged every area
dominant area share:     mean 0.34, max 0.50
cross-area correlation:  health/mood 0.98, love/health 0.93, love/career 0.84
same-day spread:         median 7, p90 14, max 33 over 14,600 user-days
```

Summing 20–40 aspects that each spread evenly over four areas makes the four sums
near-identical by construction. "love 90 / career 25" needs a spread of 65; the
largest ever observed was 33. It was not a calibration problem — it was arithmetic.

**All 59 pairs rewritten by hand.** Areas are authored per pair, not per pair+group:
which part of life an aspect touches is a property of the two points, while whether
it helps or hurts is what `baseImpact` is for. Areas that do not apply are omitted
rather than written as `0` — equivalent for `buildImpacts`, and it keeps the
"every declared share is > 0" invariant.

The organising idea: each pair has one clearly dominant area.

| pair | areas | reason |
|---|---|---|
| `venus-venus` | love .85 / mood .15 | as close to pure love as the table gets |
| `moon-moon` | mood .70 / health .30 | inner weather, plus bodily rhythm |
| `mercury-mercury` | career .75 / mood .25 | |
| `mars-mars` | health .55 / career .35 / mood .10 | |
| `jupiter-mercury` | career .75 / mood .25 | |
| `moon-pluto` | mood .70 / love .20 / health .10 | |
| `ascendant-mars` | health .65 / career .25 / mood .10 | |
| `mars-saturn` | career .50 / health .40 / mood .10 | effort meeting a wall |
| `mercury-neptune` | career .45 / mood .40 / health .15 | fog where clarity is needed |
| `mars-neptune` | health .50 / mood .30 / career .20 | energy draining away |

The Ascendant pairs carry health's distinctive sources. That is the fix for the
problem the 2026-08-04 health rebalance created and could not solve: spreading more
health across every point made health the statistical average of the other three,
so it stopped ever being the highest area. Health needed *specific* sources, and
those can only be authored per pair.

**Result** — 60 charts × 365 days, calibration target unchanged at p10 38 / p90 74:

| | before | after |
|---|---|---|
| dominant area share | 0.34 | **0.57** |
| areas per rule | 4.00 | **2.85** |
| love / career correlation | 0.84 | **0.13** |
| love / health | 0.93 | **0.12** |
| health / mood | 0.98 | **0.59** |
| same-day spread, median | 7 | **20** |
| same-day spread, p90 | 14 | **34** |
| same-day spread, max | 33 | **66** |

Population distribution held exactly (p10 38, p50 57, p90 74), and within-user
variance stayed at 90% of the total — the character came from the table, not from
the normalisation, which is what the calibration is supposed to guarantee.

**What this deliberately did not fix:** the 7-day window still spans ~17 points
overall, essentially unchanged. Area contrast and temporal range are independent
levers, and only the first was pulled. Widening the second means moving the
calibration target (measured: p10 32 / p90 78 gives a 22-point week at the cost of
7.6% of days below 30) and was left alone on purpose.

**Three tests changed, none loosened to go green:**

- *Mars does not dominate health on its own* — compared Venus-Venus against
  Mars-Mars, which stopped meaning anything once Venus-Venus became pure love. The
  intent was always "health must not be one flavour", so it now asserts that over
  the table: at least 6 distinct points feed health, and Mars plus Saturn hold under
  60% of the health-heavy rules.
- *gives every area a comparable raw dynamic range* — replaced by *moves every area
  at a usable pace*. Raw range was a proxy for "is this area amplified noise", and it
  stopped tracking that intent, because calibration refits sigma per area. Now the
  score movement itself is measured directly.
- *centres all four areas together* — bound raised from 2 to 3 points. Health sits
  ~2 points below the others because its strong sources lean difficult. Genuinely a
  loosened threshold; kept because 2 points out of 100 is imperceptible and the cause
  is astrological rather than a miscalibration.

`CALIBRATION_VERSION` gained a fingerprint of the fitted values
(`2026-08-05-30c3fc87`). It had the same collision flaw `ENGINE_VERSION` solved with
a revision counter: today's refit still reported yesterday's date, so two refits on
one day were indistinguishable. A hash needs no manual bump.

**Next tuning target, from the same measurement:** day-to-day movement is uneven
across areas — mood moves 9.6 points a day, career only 3.2. Career's sources
(Mercury, Sun, Jupiter, Saturn) are slower than mood's, so career reads as sluggish.
Fixable by giving career more fast-planet weight, and worth doing before touching
the calibration target.

---

## 2026-08-04 — Fixed the ephemeris path (engine 2026-08-04.2)

`lib/swisseph.ts` called `swe_set_ephe_path("../assets/ephe")`, a path resolved
against the working directory rather than the module. From the project root it
pointed at `../assets/ephe`, one level above the repo, which does not exist — so the
committed `semo_18.se1` / `sepl_18.se1` were never loaded and swisseph fell back to
its built-in Moshier ephemeris. A missing path is not an error, so nothing said so.

Now `join(import.meta.dirname, "../assets/ephe")`.

**Evidence that it took effect** — positions moved, all by under an arcsecond:

| body | before | after | delta |
|---|---|---|---|
| moon | 15.047912819 | 15.047674533 | 0.86″ |
| neptune | 4.218756510 | 4.218857298 | 0.36″ |
| pluto | 304.105424350 | 304.105544476 | 0.43″ |

**Nothing downstream changed.** Recalibrating over 300 charts × 730 days produced
byte-identical constants, all 58 tests still pass, and the five reference charts
score exactly as before (D stayed `49 / 60 / 50 / 47 / 52`). Expected: an arcsecond
is four orders of magnitude below the 4–8° orbs the engine works in.

The version was bumped anyway, and `ENGINE_VERSION` gained a revision counter —
a bare date cannot distinguish two changes landing on the same day.

**Why this was worth doing despite changing nothing:** the fallback was silent, the
committed ephemeris files were dead weight, and Moshier's accuracy guarantees do not
extend as far in time as the `.se1` files do. Better to depend on the source we
actually ship.

---

## 2026-08-04 — Retired the bootstrap generator

`src/scripts/generateDailyScoreRules.ts` produced the first complete draft of all 177
rules and is now spent. From this point `rules.ts` is the source of truth and is edited
by hand; the generator's guard flag was renamed to
`--i-know-this-destroys-hand-authored-rules` so nobody re-runs it by reflex.

**Reason:** the generator is a factorised model — the approach deliberately rejected for
the runtime, because a global per-planet constant cannot express what a specific pair of
points means. That is acceptable in a bootstrap, where being approximate is the point,
and unacceptable in a source of truth.

---

## 2026-08-04 — Hand-authored 23 conjunctions

Every conjunction whose generated `baseImpact` fell below 2.0 was rewritten by hand. A
conjunction of two significant points should never contribute less than a weak sextile,
and eleven of them were scoring effectively zero on ~10% of user-days each.

**Three sign flips.** The generator derived a conjunction's polarity from the average of
the two bodies' "harmony" priors, which fails exactly where a malefic meets a benefic:

| pair | before | after | reason |
|---|---|---|---|
| `saturn-venus` | +1.0 | **−2.8** | duty over pleasure; affection cooled, not warmed |
| `neptune-sun` | +1.3 | **−2.6** | vitality diffused, inspiration without traction |
| `pluto-venus` | +1.7 | **−2.4** | obsessive attraction, possessiveness |

**Two judgement calls worth revisiting.** `sun-mars` kept a positive sign (+3.4) —
courage and initiative, with friction as the price rather than the meaning.
`mercury-neptune` was made negative (−2.4): imagination and fog in equal measure, but
fog costs more than inspiration gains on a score that asks "how is your day".

The rest, by family: Mars conjunctions are friction (`mars-moon` −3.4, `mars-mercury`
−2.6, `ascendant-mars` −3.0); Saturn is weight (`saturn-sun` −4.5); Uranus is disruption
except through Mercury, where it reads as insight (`mercury-uranus` +2.6, `sun-uranus`
+2.8, `moon-uranus` −3.2, `ascendant-uranus` −2.8); Neptune dissolves (`moon-neptune`
−2.2, `ascendant-neptune` −2.6); Pluto compels (`pluto-sun` −4.2, `moon-pluto` −3.6,
`mercury-pluto` −2.8, `ascendant-pluto` −3.2, `jupiter-pluto` +2.6). Remaining:
`jupiter-saturn` +2.8 (structured growth), `ascendant-mercury` +2.6,
`ascendant-moon` +3.0.

Priorities were raised to 4–5 for the personal points, so the AI prompt surfaces them.

**Evidence:** rule lint went from 11 "effectively inert" warnings to 0. All eight failing
domain tests passed. Distribution held at mean 56.3 / p10 38 / p90 74 after recalibration.

**Note:** a per-pair `minimumMagnitude` field was considered and rejected — a
hand-authored `baseImpact` already *is* the per-pair minimum.

---

## 2026-08-04 — Rebalanced which bodies feed `health`

`health` was drawing 18.3% of its total energy from transiting Mars, more than from any
other body, and negatively. Venus, Mercury and Jupiter barely touched it. Net effect:
`health` had a raw mean of +0.17 against `love`'s +2.05, and a raw dynamic range a third
narrower than `mood`'s — so calibration compensated with a smaller sigma, which amplified
every single aspect. `health` was the noisiest of the four areas.

| point | love | career | health | mood | reason |
|---|---|---|---|---|---|
| venus | .60 → **.50** | .10 | .10 → **.20** | .20 | rest and indulgence are Venusian |
| moon | .25 | .05 | .20 → **.28** | .50 → **.42** | sleep, digestion, bodily rhythm |
| jupiter | .20 | .40 → **.35** | .10 → **.20** | .30 → **.25** | vitality, excess |
| mercury | .20 | .40 → **.36** | .10 → **.16** | .30 → **.28** | nerves, restlessness |
| mars | .20 → **.22** | .30 → **.34** | .35 → **.26** | .15 → **.18** | still the largest single source, no longer nearly the only one |
| sun | .15 | .35 | .20 → **.22** | .30 → **.28** | vitality |

Saturn, Uranus, Neptune, Pluto and the Ascendant unchanged.

**Evidence:** `health` raw range 10.28 → 11.75 (81% of the widest, above the 75% floor
the statistics test now enforces); raw mean 0.17 → 0.55.

**Side effect, accepted.** `health` fell from 21.6% to 10.5% in how often it is the
single highest area, while `career` rose to 37.8%. Mechanism: drawing from many sources
made `health` statistically close to the mean of the other three, and the mean of a set is
rarely its maximum. It is not a regression in the area's own terms — "reaches 70+" is
17.4 / 17.6 / 17.5 / 17.9 across love / career / health / mood, i.e. perfectly level.

This matters only if the UI ever highlights a single "best area today". If it does,
`health` needs *distinctive* sources rather than more of them, authored per pair
(`mars-ascendant`, `mars-mars`, `saturn-mars` → health-dominant) rather than per point.
The statistics test keeps a loose 50% canary on the old metric as a reminder.

---

## 2026-08-04 — `saturn` trine `sun` no longer required to leave love at zero

The domain test originally asserted that Saturn trine Sun must not increase love at all.
Revised to assert that **career must outweigh love** instead.

**Reason:** Saturn trine Sun can genuinely mean stability, reliability and commitment,
all of which belong to love. What the aspect is *about* is earned structure, so career
should dominate — but zero was too strong a claim.

---

## 2026-08-04 — Initial engine

Replaced a scoring path that returned the same five numbers
(`love 80, career 85, health 69, mood 100, overall 83`) for every user on every date
between 1999 and 2030, because the only inputs reaching the score were constant planet
weights.

The new engine: transit-to-natal aspects → `AspectRule` on an unordered pair →
`Impact[]` → per-area sums → calibrated logistic. Rules are keyed on unordered pairs
because direction changes an aspect's duration and daily loudness, not its theme; the
`DirectionOverride` table exists for the cases where it changes the meaning.

Calibration is fitted, never guessed: 300 charts × 730 days against a mildly optimistic
target (score p10 38, p90 74). Volatility of 5.0 median points day to day was hit without
tuning `LAYER_GAIN`.

**Known and deliberately deferred:** Uranus, Neptune and Pluto produce a near-constant
per-user offset rather than daily variation (within/between ratios 0.6 / 0.3 / 0.2), and
so does Saturn (0.8, the largest negative offset of any body at −1.43). This was
diagnosed as a **timescale** problem, not a rule problem: a long transit currently has the
same daily strength for its entire duration. Excluding planets or lowering `LAYER_GAIN`
would treat the symptom. The fix belongs in the temporal profile — per-planet orbs
(the strongest lever), applying/separating asymmetry, and a non-linear orb taper — all of
which are single multipliers inside `buildImpacts` and change no rules.
