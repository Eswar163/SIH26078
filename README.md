# Trikaal

**Weather event intelligence on numerical weather prediction output, for the Indian region.**

Trikaal (त्रिकाल, "the three times") follows every weather system through its past, present and future. It detects cyclones, depressions, western disturbances, heat and cold waves, heavy-rain spells and thunderstorm clusters in gridded model output. It tracks them through time, fingerprints them, remembers them, forecasts them probabilistically and explains what to do about them.

Everything runs in the browser, offline, on a deterministic synthetic NWP model. The same world seed always gives the same weather, so a run can be shared by its seed.

> Synthetic model output for training and demonstration. Trikaal is not an official forecast, and its bulletins are clearly marked as synthetic.

---

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The first run takes about a second. The 21-member ensemble, the four earlier model cycles and Event Memory then fill in over the next few seconds, in parallel Web Workers.

```bash
npm test          # 36 tests: geometry, detection, tracking, DNA, ensemble, scenarios, intelligence
npm run build     # type-check and production bundle in dist/
npm run geo       # rebuild the bundled coastline from Natural Earth (only needed if you change it)
```

Requirements: Node 20 or newer. No API keys, no network at runtime.

---

## What it does

The build follows the twelve-stage plan:

| # | Stage | Where |
|---|-------|-------|
| 1 | Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 2 | Design system and shell | `src/styles`, `src/shell`, `src/ui` |
| 3 | Map and synthetic NWP engine | `src/map`, `src/engine/world.ts`, `synth.ts`, `climate.ts` |
| 4 | Event detection | `src/engine/detect.ts` |
| 5 | Event tracking | `src/engine/track.ts`, `hungarian.ts` |
| 6 | Event DNA and lifecycle | `src/engine/dna.ts`, `lifecycle.ts` |
| 7 | Event Memory and genealogy | `src/engine/archive.ts`, `analogs.ts`, the Memory view |
| 8 | Future probability cone | `src/engine/ensemble.ts`, `cone.ts` |
| 9 | Scenario Lab | `src/engine/scenario.ts`, the Scenario Lab view |
| 10 | AI Event Intelligence | `src/engine/intel/*`, `ri.ts`, `decision.ts`, the Briefing view |
| 11 | Integration | `src/state`, `src/worker`, `src/App.tsx` |
| 12 | Testing and optimisation | `tests/`, worker pool, caches |

### Features we have not seen together in other tools

- **An elliptical cone, not a fixed circle.** The cone is built from the 21 ensemble members' position covariance at each lead time. It stretches along the track when timing is uncertain and across it when direction is.
- **A landfall ribbon.** The coastline is unrolled from Yemen to Myanmar, showing landfall probability per stretch of coast, every member's crossing point and the shortest stretch that holds half of the landfalls.
- **A decision clock.** For each city and protective action (recall boats, evacuate, pre-position NDRF teams, close schools, open cooling centres), Trikaal applies the cost-loss rule ("act when the probability exceeds the action's cost/loss ratio") and the lead time the action needs. It then reports the last responsible moment to act, or how far behind you already are.
- **Run-to-run trend.** The same system is compared across the last four model cycles. Trikaal flags a steady drift ("landfall has moved 200 km west over four cycles") or a back-and-forth "windshield wiper".
- **Reveal the outcome.** The atmosphere is synthetic, so the truth is known. One switch overlays what actually happened. The Verification view scores the detector (probability of detection, false-alarm ratio), track and intensity error against persistence, cone calibration and the rapid-intensification model.
- **Event DNA.** Each event gets a per-step strip of traits (a genome-browser row per trait), a fixed-length genome and a readable genotype such as `B1 ESCS S r4`. DNA powers age-aligned analog search ("the first 48 hours of this storm look like the first 48 hours of these"), a novelty score and a DNA map of 35 seasons.
- **Lineage.** The tracker infers families: a remnant that regenerates over the other sea, a low born inside another's circulation (split), absorption (merge), a low induced by a western disturbance, a cold wave that follows one, and the rain shields of a cyclone.
- **Driver attribution in the Scenario Lab.** Change sea temperature, shear, humidity, the ridge, steering, the MJO or wet soil after landfall. Every on/off combination of your changes is simulated, and exact Shapley values say which change caused how much of the difference in peak intensity, landfall position, landfall time and rain over land.
- **Explainable intelligence.** The briefing, the Q&A answers and the advisory are generated only from computed numbers. Every sentence carries its evidence and source (model, ensemble, memory, RI model, earlier cycles). Nothing is free-written.
- **An RI model trained in the browser.** A logistic rapid-intensification model is fitted on about 2,000 archive points when the app starts. Each prediction is shown with the push and pull of every predictor.
- **Alerts in the language of the people at risk.** Alerts go out in English, Hindi and the language of the affected state (Tamil, Telugu, Odia, Bengali, Gujarati, Marathi, Malayalam or Kannada). They come from fixed templates, never machine translation.
- **Impact-based warnings.** IMD's green, yellow, orange and red colours come from a likelihood × impact matrix, per city and per day.
- **Offline and shareable.** Coastlines and fonts are bundled. Political boundaries are deliberately not drawn. The URL holds the season, seed, date, selected event and time.

---

## How to use it

- **Chart.** Synoptic chart with ink isobars, rain, temperature, wind flow or WMO wind barbs, sea temperature and shear. Ensemble layers show strike probability, gale probability, heavy-rain, heat and cold-wave probability by day, and genesis probability. Pick an event in the list, on the map or on the timeline. The dossier has four tabs: Overview, Forecast (landfall, cities, decision clock, earlier cycles, outcome), DNA (strip, genotype, relatives, novelty) and Lineage.
- **Memory.** Browse the archive, see tracks or the DNA map, and open any remembered event's lifecycle, DNA, relatives and family.
- **Scenario Lab.** Choose a focus system, a preset or your own factor values, then run. Compare by overlay or side by side and read the attribution.
- **Briefing.** The generated briefing (hover a sentence for its evidence), the warning grid, Ask the run, public alerts and the teleprinter advisory.
- **Verification.** Scores for the detector, tracks, intensity, cone and RI model.

Keyboard: `←`/`→` step 6 h (hold Shift for 24 h), `Space` play, `1` to `5` switch views, `[` and `]` cycle events, `0` jump to the analysis time, `Esc` clear the selection, `Ctrl K` open the command palette. The palette jumps to events, layers and times ("+48"), and accepts questions.

---

## Honest limits

- The atmosphere is synthetic: an object-based model of weather systems with analytic seasonal climates, rendered to fields. It is designed to behave plausibly, with realistic tracks, IMD categories and error growth. It is not a dynamical NWP model.
- The detection, tracking, DNA, ensemble, cone, decision and intelligence layers never read the synthetic systems directly. They only see the gridded fields, so they would work unchanged on real model output (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#using-real-nwp-output)).
- City populations are approximate. Exposure figures are indicative.
- Alert templates should be reviewed by a native speaker before any real use.
