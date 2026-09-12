# LWU Trusted Production Platform Design

## Goal

Turn LWU into a reproducible, safe-to-deploy production tool: the same project state and model profile must yield the same validated shot specifications before any prompt is generated.

## Non-goals

This iteration does not automate Google Flow itself, provide legal advice, or ship multi-user collaboration. It provides the structures, policy gates and artifact manifests that make those later additions safe.

## Source of truth and build contract

`02_Assets/assets.json` is the sole asset source. A build script validates it and injects its exact JSON into `index.html` as the offline fallback. The script also writes `public/build-manifest.json` containing project version, asset count, SHA-256 asset hash, model-profile version, and build time. The browser displays these values; no human-maintained count/version labels remain.

The build fails if the embedded and external asset JSON normalizations differ, an asset reference is missing, or the asset schema does not validate. `referenceImage` is optional but must resolve to the public reference manifest when set.

## Domain model

New `src/domain/shot-spec.js` owns domain validation and has no DOM or network dependency. `validateShotSpec(spec, registry, policy)` returns `{ ok, value, violations }`.

`ShotSpec` contains: `subjects` (1–3), one `environment`, `camera`, `lighting`, `colorGrade`, `fx` (0–3), `audio` (0–2), `motion`, `action`, optional short `dialogue`, and `continuityIn`/`continuityOut`. Every referenced ID is resolved from the server-owned registry. The validator requires allowed kinds, era compatibility, faction compatibility unless `intent.conflict=true`, valid motion host classes, one-core-action action text, and a valid continuity transition.

`FilmPlan` contains `intent`, `project`, `modelProfile`, top-level environment/color lock policy, and an ordered `shots` array. Its validator checks phase order (`establish`, `build`, `climax`, `resolve`), 8-second logical beat duration by default, recurring cast policy, and adjacent continuity state.

## Intent, planning and compilation

`src/domain/intent.js` implements deterministic bilingual intent extraction for era, faction, task, setting, weather, platform, safety tags and confidence. Ambiguous/missing era returns a `needsConfirmation` flag; it never randomly chooses a hero asset.

`src/domain/planner.js` is the offline planner. It ranks only compatible assets, selects a task template, emits a valid FilmPlan and includes selection reasons. It uses no model endpoint.

`src/domain/compiler.js` turns a validated ShotSpec into the English Flow prompt and the Chinese preview. It alone owns style/negative blocks and model-specific output syntax. The UI cannot create a prompt from an unvalidated object.

The Pages Function receives only `{theme, projectId, assetManifestVersion, mode, requestedShots, rhythm}`. It reads the bundled registry, calls an allowed model after authorization, parses candidate JSON, validates it, permits one repair request with violations, and falls back to the offline-compatible deterministic planner response when configured. The browser does not post an arbitrary asset catalogue.

## Model profiles

`02_Assets/model-profiles.json` describes supported Flow profiles: model name, aspect ratios, durations, resolution labels, Ingredients/references, first/last frames, extension and native audio. `veo-3.1-lite` is the initial default profile. The UI presents profile capabilities and builds prompts from them. The production system retains `8 seconds` as the default editorial beat, not a global technical fact.

## Continuity and references

Projects use versioned JSON with `schemaVersion`, asset manifest hash, model profile and a `continuity` map. Each shot records a deterministic `continuityIn` and `continuityOut`: cast appearance variants, vehicle state, screen direction, scene/time/weather, camera side and optional `lastFrameReferenceId`. Each hero reference has an ID, asset ID, path, source/license note, version and checksum in `02_Assets/references.json`.

The UI shows explicit continuity violations and supports approving an intentional discontinuity with a reason. It does not claim Flow reference support when the selected model profile lacks it.

## Security and operations

Production Pages Functions reject unauthenticated generation by default. `AUTH_MODE=access` requires Cloudflare Access-provided identity headers; `AUTH_MODE=dev-token` permits a short-lived server-issued development token only in preview; `AUTH_MODE=disabled` is accepted solely with `ENVIRONMENT=development`. CORS uses configured `ALLOWED_ORIGIN`, never `*` in production.

`/api/compose` has no public active probe. A protected `GET /api/health` returns non-sensitive configuration state without calling a model. Model requests enforce per-client rate limits and request limits; providers are explicit allow-listed configuration entries. Key pools and automatic retries on quota/auth failures are removed. Logs return a request ID and sanitised error code, never raw provider messages or key suffixes.

## UI and storage

The new UI remains static HTML/CSS/JS but imports focused ES modules. It reads generated manifest data, offers deterministic planning by default, makes cloud planning an authenticated opt-in, presents unresolved intent questions, and exposes a validation report before copying/exporting a prompt.

Projects persist in IndexedDB where available, with a versioned localStorage fallback. Imports are schema-validated, previewed and migrated; exports contain the manifest hash and all continuity state. DOM rendering uses text nodes/escaped content; CSP is supplied through `_headers`.

## Content and rights governance

Add `LICENSE`, `TRADEMARKS.md`, `CONTENT_POLICY.md`, `DATA_PROCESSING.md`, and `THIRD_PARTY_ASSETS.md`. The product describes itself as unaffiliated with LEGO. Intent safety classification disallows protected-symbol reconstruction, graphic injury, real-person impersonation and other policy-marked requests from entering a cloud model call; it returns a neutral, non-graphic alternative with a review reason.

## Testing and release gates

Node's built-in test runner covers registry/schema rules, embedded parity, intent regression corpus, ShotSpec/FilmPlan invalid cases, compiler profile behavior, and security configuration. Browser smoke tests run with a static HTTP server and assert no raw `innerHTML` from user project fields. CI executes validation, build, all tests, JavaScript syntax checks, and documentation/manifest consistency checks.

Release is blocked unless: source/embedded asset hash equality holds; every regression intent produces a valid plan; the public endpoint rejects unauthenticated production calls; no test fixture yields an era/faction/kind violation; required governance documents and model profile references exist.

## Acceptance criteria

1. Asset source and fallback are byte-equivalent after normalization and rendered count equals the build manifest.
2. Snow rescue, carrier launch, WWII Pacific and modern urban examples select compatible environments and subjects; ambiguous requests require confirmation rather than random selection.
3. Invalid model output such as character-as-camera, too many subjects, incompatible era/faction, or invalid motion is rejected with exact violations.
4. Prompt export is impossible until its spec validates.
5. The production API permits neither anonymous model invocation nor active probe endpoints, and does not accept a client asset catalogue.
6. A project export/import preserves version, manifest hash and continuity state.
7. Documentation labels, runtime manifest, model profile and asset count agree.
