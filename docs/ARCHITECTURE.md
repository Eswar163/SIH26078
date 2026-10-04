# Trikaal architecture

## Shape of the system

```
                         UI thread (React)                                   Web Workers
 ┌──────────────────────────────────────────────────────────┐   ┌────────────────────────────────────────┐
 │ App shell: top bar, timeline, command palette            │   │ engine.worker                           │
 │ Views: Chart | Memory | Scenario Lab | Briefing | Verify │   │  world (truth)  -> deterministic run    │
 │ Map renderer (canvas): fields, isobars, flow, tracks,    │◄──┤  fields, detections, tracks, events     │
 │   cone, ellipses, cities, warnings                       │   │  aggregate ensemble -> cones, products  │
 │ Intelligence (pure functions): briefing, Q&A, alerts,    │   │  earlier cycles -> trends, verification │
 │   advisory, warnings, decision clock                     │   │  Event Memory, RI model, analogs        │
 │ State: one zustand store, run token guards stale results │   │  Scenario runs + Shapley attribution    │
 └──────────────────────────────────────────────────────────┘   ├────────────────────────────────────────┤
                                                                │ member.worker × N (pool)                │
                                                                │  ensemble members 0..20 in parallel     │
                                                                └────────────────────────────────────────┘
```

Everything under `src/engine` is pure TypeScript with no DOM dependency. The workers, the tests and the UI all call the same functions.

## Data flow

```
season, seed, analysis date
        │
        ▼
 world.ts   weather systems evolved hour by hour (truth, the "nature run")
        │                     │
        │ t ≤ 0 (analysis)    │ forecast from t = 0 with analysis error and model error
        ▼                     ▼
 synth.ts   gridded fields every 6 h on 0.25° (mslp, u10, v10, rain6, t2m, tmax, tmin, z500)
        │
        ▼
 detect.ts  detections per step (cyclone, wd, rain, heat, cold, storm)
        │
        ▼
 track.ts   tracks + lineage (split, merge, regenerated, induced, rain shield)
        │
        ▼
 events.ts  labels and names, lifecycle stages, milestones, landfall, DNA, environment
        │
        ├── ensemble.ts  21 members at 0.5° (same pipeline) ──► cone.ts (ellipses, envelope,
        │                                                        strike, landfall ribbon, cities)
        ├── runs.ts      forecasts from −48, −36, −24, −12 h ──► run-to-run trend
        ├── archive.ts   35 years × 4 seasons of truth ──► analogs.ts, ri.ts (training data)
        ├── scenario.ts  forecast with altered environment ──► comparison + Shapley attribution
        ├── decision.ts  warnings by city and day, decision clock
        └── intel/*      briefing, Q&A, advisory, alerts (every sentence with evidence)
```

## The synthetic atmosphere

`world.ts` holds weather systems: tropical lows and cyclones, monsoon lows, western disturbances, heat domes, cold anomalies and convective clusters. Season scripts in the same file decide roughly where and when they form. Hourly dynamics:

- **Motion.** Deep-layer steering from an analytic subtropical ridge whose latitude oscillates over the run, with an optional Arabian Sea override. Western-disturbance troughs add southerlies ahead and northerlies behind, which is how Bay storms recurve. On top of that: beta drift (north-west), binary interaction (Fujiwhara rotation and attraction) and red noise.
- **Intensity.** Relaxation towards a potential intensity from sea temperature (DeMaria and Kaplan 1994), reduced by shear, dry air and slow-motion upwelling. Over land, Kaplan-DeMaria exponential decay applies, slowed by a "brown ocean" factor. Monsoon lows are capped by monsoon shear and kept alive over moist land.
- **Structure.** Radius of maximum wind and outer radius follow intensity. Holland B rises with intensity. The pressure deficit comes from an Atkinson-Holliday-type wind-pressure relation.

`climate.ts` gives four seasonal climates as radial-basis control points: pressure, low-level wind, sea temperature, shear, humidity and background rain. It also sets land temperature by latitude, the diurnal range and a 500 hPa height profile. `terrain.ts` approximates the Himalaya, the Tibetan Plateau, both Ghats, the north-east hills, the Arakan Yoma and others. Terrain drives lapse-rate cooling, orographic rain (rain on the upslope, shadow on the lee) and faster decay over mountains.

`synth.ts` renders fields:

- a Holland pressure and wind profile with inflow angle and motion asymmetry,
- spiral rain bands with front-left or south-west enhancement,
- trough-east precipitation for western disturbances, enhanced on terrain,
- heat and cold anomalies on Tmax and Tmin,
- drifting fractal background rain with a diurnal cycle,
- orographic enhancement,
- rain cooling.

**Forecasts and ensembles.** Each forecast starts from the truth at its initial time, with analysis error. It then evolves with its own noise, a model ridge and steering error, and probabilistic re-creation of future genesis (with timing and position errors). Spurious genesis is included, because real models spin up phantom lows. Members add perturbed ridge, steering, sea temperature, shear, humidity and growth. Because the truth is just another draw from the same distribution, the ensemble is calibrated by construction. The Verification view confirms it.

## Detection (fields only)

- **Cyclonic systems.** The detector finds minima of 2-pass smoothed MSLP in roughly 1° windows. For each minimum it runs a priority flood: cells are added in order of pressure until the flood spills over a saddle into another basin, reaches the domain edge or passes 1,200 km.
  - Basin depth gives the number of closed 2 hPa isobars. The outermost closed isobar gives the size (ROCI).
  - Intensity is the maximum azimuthal-mean tangential wind of the disturbance field. The disturbance field is the raw wind minus a 3° double box filter, the classic vortex-separation idea. Asymmetry can add at most 25%. This keeps monsoon westerlies and trough shear from inflating monsoon depressions into cyclones.
  - Quadrant 34 kt radii come from raw winds.
  - The IMD class follows from wind and closed isobars.
  - The detector also requires cyclonic vorticity, excludes high terrain, and skips the surface reflection of a western disturbance.
- **Western disturbances.** Minima of the zonal-anomaly 500 hPa height north of 27°N, with non-maximum suppression. Classed as feeble, moderate or active.
- **Heavy rain.** 24 h totals of at least 64.5 mm, as 8-connected clusters with at least a quarter of their area over land. Outlines come from masked marching squares with Chaikin smoothing.
- **Heat and cold waves.** IMD criteria on Tmax and Tmin against normal, separately for plains, hills and coasts. The absolute and departure rules are combined, and the stronger one wins.
- **Thunderstorms.** Compact intense 6 h rain cores away from cyclones.

## Tracking and lineage

- **Vortices.** Each track predicts its next position from damped persistence. Detections are assigned by minimum total cost (Kuhn-Munkres) with a distance gate and an intensity term. One missed step is bridged by interpolation.
- **Areal events.** Assignment is by cell overlap, falling back to centroid distance. One-to-many overlap is a split; many-to-one is a merge.
- **Lineage inference.** The tracker infers:
  - basin-crossing regeneration (Bay, then land, then Arabian Sea and back to depression strength),
  - merges next to a stronger system,
  - regeneration over the sea within 48 h of a land-faded track,
  - splits inside an established circulation,
  - lows induced south of a western disturbance,
  - cold waves following a western disturbance,
  - rain shields.

## DNA, lifecycle, memory

- **Lifecycle.** Stages come from smoothed intensity slopes. Milestones include genesis, upgrades, naming, peak, rapid intensification (+30 kt in 24 h), landfall (bisected against the coastline polygons), recurvature, stall, downgrades and dissipation.
- **DNA.**
  - The strip has eight traits per step for cyclones.
  - The genome has twelve whole-life traits.
  - Partial genomes are age-aligned, for analog forecasting.
  - Similarity is a weighted RBF of normalised trait distance.
  - The genotype code is: origin and latitude band, peak class, track shape, rain class.
- **Event Memory.** 140 synthetic seasons (1991 to 2025, four seasons each) are rendered as best tracks with analysis noise. They carry generator lineage plus inferred lineage. Event Memory supports analog search, analog guidance (what relatives did next and whether they agree with the model), novelty, and a principal-component DNA map.
- **RI model.** Logistic regression on standardised predictors: intensity, 12 h change, sea temperature, shear, humidity, latitude and speed. It uses class weighting, intercept recalibration to the base rate, and a held-out AUC and Brier score.

## Probability cone

For each lead time the cone uses the matched members' positions. It computes the mean and covariance, inflated by 1.15 plus a floor that grows with lead. That gives a 67% ellipse (and a 90% one). The envelope is the support line of the ellipses normal to the mean track, plus an end cap. The cone also produces:

- **Strike probability:** the share of members passing within 120 km.
- **Landfall:** the first sea-to-land crossing per member, projected on the ordered coastline. From these come a kernel density, the shortest 50% stretch, timing and intensity quantiles.
- **City wind threat:** a decaying wind profile from each member's Vmax and RMW, giving the probability of 34, 48 and 64 kt winds and per-member arrival times.
- **Confidence:** spread per hour of lead.

## Decision support

- **Warnings.** Each city and day gets the strongest hazard on the likelihood × impact matrix. Hazards are wind from the cones, rain, heat and cold from ensemble daily probabilities (or the deterministic run while the ensemble is still running).
- **Decision clock.** For each action: `p ≥ cost/loss` (act) and `last moment = earliest arrival (10th percentile) − lead time needed`.

## Performance

- The deterministic run takes about 0.9 s (41 steps on a 201 × 161 grid). One ensemble member takes about 0.2 s, and the members run across a pool of up to six workers. Event Memory takes about 0.25 s.
- Field buffers are transferred, not copied. Raster images and isolines are cached per field array.
- Rasters are upsampled by bilinear interpolation of the data, so colour edges follow contours. Particles run on their own canvas and pause when the tab is hidden or reduced motion is requested.
- Views other than the chart are lazy-loaded.

## Using real NWP output

The detectors, tracker, DNA, cone and intelligence layers only consume `FieldSet` arrays on a `GridSpec`. To run on real model output (for example GFS 0.25° or NCUM):

1. Convert GRIB2 or NetCDF to the Trikaal grid: 50 to 100°E, 0 to 40°N, 0.25°, south to north. The fields are MSLP (hPa), 10 m u and v (m/s), 6 h precipitation (mm), 2 m temperature and its 24 h max and min (°C), and 500 hPa height (gpm).
2. Feed each step to `runPipeline` in place of `synthesize`. The `source` function is the only synthetic dependency.
3. For a real ensemble, run the same pipeline on each member and pass the cyclone tracks to `aggregate` and `buildCone`.
4. For real Event Memory, replace `buildArchive` with best tracks (for example IBTrACS North Indian Ocean) converted to `TrackPoint`s. DNA and analogs work unchanged.

## Testing

`npm test` runs 36 tests:

- **Core:** deterministic randomness, geodesy, contours on an analytic field, Kuhn-Munkres against brute force, IMD criteria.
- **Detection:** a synthetic cyclone is found within 60 km with the right class, and a monsoon low is not over-classified.
- **Tracking:** gaps are bridged, nearby systems stay apart, splits are found.
- **Pipeline:** the run is reproducible; the detector reaches POD ≥ 0.85 and FAR ≤ 0.25; regeneration is linked.
- **Cone:** spread grows with lead.
- **Verification:** earlier cycles beat persistence.
- **Scenarios:** a neutral scenario equals the deterministic run, and Shapley contributions sum to the total change.
- **Intelligence:** the briefing, Q&A, alerts (English, Hindi and Tamil for a Tamil Nadu landfall) and the advisory.
- **Performance budget.**
