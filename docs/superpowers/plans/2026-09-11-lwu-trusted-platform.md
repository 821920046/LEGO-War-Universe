# LWU Trusted Production Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unverified prompt workbench with a reproducible, validated and secure LWU production pipeline.

**Architecture:** A generated asset manifest is the only data source. Pure domain modules parse intent, plan typed shot specifications, validate them and compile prompts by model profile. The static UI consumes only validated plans; the Pages Function uses the same registry and validators after auth.

**Tech Stack:** Vanilla ES modules, Node 24 built-in test runner, JSON Schema, Cloudflare Pages Functions, Python asset validator, static HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-09-11-lwu-trusted-production-platform-design.md`

## Global Constraints

- Do not add third-party runtime dependencies.
- `02_Assets/assets.json` remains the sole asset source.
- All runtime UI copy must reflect generated build metadata, not hard-coded counts/versions.
- Production cloud generation must be authenticated and must not accept client asset catalogues.
- New behavior requires a red test before implementation.

---

### Task 1: Establish the Node test/build harness and generated build manifest

**Files:**
- Create: `package.json`
- Create: `scripts/build-assets.mjs`
- Create: `tests/build-assets.test.mjs`
- Modify: `index.html`

**Interfaces:**
- Produces `public/build-manifest.json` and an exact generated `#lwu-data` payload.
- Exposes `buildAssets({ root })` returning `{ assetCount, assetSha256, manifest }`.

- [ ] **Step 1: Write the failing parity test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssets } from '../scripts/build-assets.mjs';

test('buildAssets embeds the normalized external registry and writes its hash', async () => {
  const out = await buildAssets({ root: fixtureRoot });
  assert.equal(out.assetCount, 381);
  assert.equal(readEmbeddedJson(), readJson('02_Assets/assets.json'));
  assert.equal(readJson('public/build-manifest.json').assetSha256, out.assetSha256);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/build-assets.test.mjs`

Expected: FAIL because `scripts/build-assets.mjs` does not exist.

- [ ] **Step 3: Implement the minimal build module and package scripts**

```js
export async function buildAssets({ root }) {
  const raw = await readFile(join(root, '02_Assets/assets.json'), 'utf8');
  const data = JSON.parse(raw);
  const canonical = JSON.stringify(data);
  const assetSha256 = createHash('sha256').update(canonical).digest('hex');
  // replace exactly the lwu-data script content, write public/build-manifest.json
  return { assetCount: countAssets(data), assetSha256, manifest };
}
```

- [ ] **Step 4: Run build and the test to verify green**

Run: `npm run build && npm test -- tests/build-assets.test.mjs`

Expected: PASS; generated fallback equals the external registry.

### Task 2: Version the registry, references and Flow model profiles

**Files:**
- Create: `02_Assets/model-profiles.json`
- Create: `02_Assets/references.json`
- Create: `src/domain/registry.js`
- Create: `tests/registry.test.mjs`
- Modify: `02_Assets/assets.schema.json`
- Modify: `02_Assets/validate.py`

**Interfaces:**
- `createRegistry(data, profiles, references)` returns `{ byId, byKind, manifestVersion, profileById, referenceById }` or throws diagnostics.
- Model profiles use `{ id, durations, aspectRatios, resolutions, supportsIngredients, supportsFirstLastFrames, supportsExtend, supportsNativeAudio }`.

- [ ] **Step 1: Write failing registry tests**

```js
test('registry rejects a missing reference target and finds a valid model profile', () => {
  assert.throws(() => createRegistry(assets, profiles, [{ id: 'REF-1', assetId: 'NOPE' }]));
  assert.equal(createRegistry(assets, profiles, []).profileById.get('veo-3.1-lite').supportsNativeAudio, true);
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- tests/registry.test.mjs`

Expected: FAIL because registry module/profile data do not exist.

- [ ] **Step 3: Implement registry and extend structural validation**

Require explicit `kind`, normalize missing era to `shared`, validate reference IDs and profile schema. Include an initial `veo-3.1-lite` profile and an empty but valid reference manifest.

- [ ] **Step 4: Run green**

Run: `python 02_Assets/validate.py 02_Assets/assets.json && npm test -- tests/registry.test.mjs`

Expected: Python validation and Node test pass.

### Task 3: Build deterministic bilingual intent extraction

**Files:**
- Create: `src/domain/intent.js`
- Create: `tests/intent.test.mjs`
- Create: `tests/fixtures/intent-regression.json`

**Interfaces:**
- `parseIntent(theme)` returns `{ era, faction, task, setting, weather, conflict, safetyTags, confidence, needsConfirmation }`.

- [ ] **Step 1: Write failing fixture-driven tests**

```js
test('snow rescue resolves to rescue/snow and does not silently choose an era', () => {
  const result = parseIntent('搜救直升机在雪山峡谷营救落难飞行员');
  assert.equal(result.task, 'rescue');
  assert.equal(result.weather, 'snow');
  assert.equal(result.needsConfirmation, true);
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- tests/intent.test.mjs`

Expected: FAIL because parser is absent.

- [ ] **Step 3: Implement phrase tables and confidence policy**

Implement longest-match Chinese/English aliases, explicit era/setting/task tables, and unknown/ambiguous confidence handling. Include regression fixtures for snow rescue, carrier launch, WWII Pacific, modern urban CQB and a deliberately ambiguous generic battle.

- [ ] **Step 4: Run green**

Run: `npm test -- tests/intent.test.mjs`

Expected: all fixture assertions pass.

### Task 4: Add typed ShotSpec and FilmPlan validation

**Files:**
- Create: `src/domain/shot-spec.js`
- Create: `tests/shot-spec.test.mjs`
- Create: `tests/fixtures/valid-shot.json`

**Interfaces:**
- `validateShotSpec(spec, registry, intent)` returns `{ ok, value, violations }`.
- `validateFilmPlan(plan, registry)` returns the same shape.

- [ ] **Step 1: Write failing invalid-output tests**

```js
test('rejects character as camera and an incompatible era', () => {
  const result = validateShotSpec({ ...validShot, camera: 'CHR-001', subjects: ['CHR-401'] }, registry, { era: 'Modern' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map(v => v.code), ['INVALID_KIND', 'ERA_MISMATCH']);
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- tests/shot-spec.test.mjs`

Expected: FAIL because validator is absent.

- [ ] **Step 3: Implement category, quota, era/faction, motion and continuity checks**

Use registry kinds to enforce one environment/camera/lighting/color grade, 1–3 subjects, 0–3 FX, 0–2 audio. Check motion host class, required action, phase order and adjacent `continuityOut`/`continuityIn` equality unless `approvedDiscontinuityReason` exists.

- [ ] **Step 4: Run green**

Run: `npm test -- tests/shot-spec.test.mjs`

Expected: valid fixture passes and every malformed fixture returns precise violations.

### Task 5: Implement deterministic planner and profile-aware compiler

**Files:**
- Create: `src/domain/planner.js`
- Create: `src/domain/compiler.js`
- Create: `tests/planner.test.mjs`
- Create: `tests/compiler.test.mjs`

**Interfaces:**
- `planFilm({ theme, requestedShots, profileId }, registry)` returns `{ intent, plan, warnings }`.
- `compileShot(shotSpec, registry, profile)` returns `{ prompt, promptZh }` only for validated specs.

- [ ] **Step 1: Write failing end-to-end planner tests**

```js
test('carrier launch plan selects naval-compatible assets without random defaults', () => {
  const { plan } = planFilm({ theme: '航母战斗群在远海风暴中放飞舰载机', requestedShots: 4, profileId: 'veo-3.1-lite' }, registry);
  assert.equal(plan.shots.every(s => validateShotSpec(s, registry, plan.intent).ok), true);
  assert.match(compileShot(plan.shots[0], registry, profile).prompt, /8-second shot/);
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- tests/planner.test.mjs tests/compiler.test.mjs`

Expected: FAIL because planner/compiler are absent.

- [ ] **Step 3: Implement planner and compiler**

Rank compatible subjects/environments by parsed intent, build a four-phase plan with stable cast/state, and compile style/negative blocks from registry. The profile determines duration and aspect instruction; compiler rejects invalid profile combinations.

- [ ] **Step 4: Run green**

Run: `npm test -- tests/planner.test.mjs tests/compiler.test.mjs`

Expected: all representative themes plan and compile successfully.

### Task 6: Replace the monolithic UI data/film path with validated modules

**Files:**
- Create: `src/ui/app.js`
- Create: `src/ui/render.js`
- Modify: `index.html`
- Create: `tests/ui-contract.test.mjs`

**Interfaces:**
- Browser boot loads `public/build-manifest.json`, external registry or hash-identical fallback, then `planFilm`/`compileShot`.
- `renderText(node, value)` is the only project/theme content renderer.

- [ ] **Step 1: Write failing UI contract tests**

```js
test('static page contains no hard-coded asset total and mounts the module entrypoint', () => {
  assert.doesNotMatch(html, /资产 392/);
  assert.match(html, /type="module" src="\.\/src\/ui\/app\.js"/);
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- tests/ui-contract.test.mjs`

Expected: FAIL against the legacy monolithic page.

- [ ] **Step 3: Implement module bootstrap and safe render path**

Replace legacy inline operational scripts with module imports. Render user/project fields using `textContent`; show intent confirmation, validation violations, build manifest and continuity in/out information. Make cloud plan a distinct authenticated action; never call it automatically.

- [ ] **Step 4: Run green and browser smoke test**

Run: `npm test -- tests/ui-contract.test.mjs && npm run test:smoke`

Expected: UI contract passes and static smoke test shows manifest/validated local plan.

### Task 7: Secure the Pages Function and share validation code

**Files:**
- Modify: `functions/api/compose.js`
- Create: `src/server/auth.js`
- Create: `src/server/rate-limit.js`
- Create: `tests/api-security.test.mjs`
- Create: `_headers`

**Interfaces:**
- POST body accepts `{ theme, projectId, assetManifestVersion, mode, requestedShots, rhythm, profileId }` only.
- `authorize(request, env)` returns `{ ok, clientId }`; `rateLimit(clientId, env)` returns `{ ok, retryAfter }`.

- [ ] **Step 1: Write failing security tests**

```js
test('production compose rejects anonymous client catalogues before model invocation', async () => {
  const response = await onRequest(contextFor({ ENVIRONMENT: 'production', AUTH_MODE: 'access' }, { theme: 'test', assets: [{ id: 'INJECT' }] }));
  assert.equal(response.status, 401);
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- tests/api-security.test.mjs`

Expected: FAIL because the legacy handler accepts anonymous payloads.

- [ ] **Step 3: Implement auth, origin policy, request allow-list and safe health endpoint**

Remove probe/key-pool code and raw provider error returns. Load bundled registry server-side, validate candidate model output with `validateShotSpec`/`validateFilmPlan`, enforce configured origin, identity and rate limit. `GET /api/health` reports only a request ID and non-sensitive readiness. Add restrictive CSP/security headers in `_headers`.

- [ ] **Step 4: Run green**

Run: `npm test -- tests/api-security.test.mjs`

Expected: anonymous production POST is rejected; valid authenticated request reaches a stubbed provider and invalid candidate output is rejected.

### Task 8: Migrate project persistence and import/export safety

**Files:**
- Create: `src/ui/project-store.js`
- Create: `tests/project-store.test.mjs`
- Modify: `src/ui/app.js`

**Interfaces:**
- `ProjectStore.load()` returns a versioned project or a new project.
- `ProjectStore.import(json)` returns `{ project }` or `{ violations }`.

- [ ] **Step 1: Write failing persistence tests**

```js
test('import preserves continuity and rejects an unknown schema version', async () => {
  const imported = await store.import(JSON.stringify(validProject));
  assert.equal(imported.project.shots[0].continuityOut.screenDirection, 'left-to-right');
  assert.equal((await store.import('{"schemaVersion":"99"}')).violations[0].code, 'UNSUPPORTED_PROJECT_SCHEMA');
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- tests/project-store.test.mjs`

Expected: FAIL because store module is absent.

- [ ] **Step 3: Implement IndexedDB-first store and schema migration**

Use IndexedDB when present, localStorage fallback otherwise. Stamp exports with asset hash/profile/version, validate imported JSON before persistence, preview violations and preserve approved discontinuity reasons.

- [ ] **Step 4: Run green**

Run: `npm test -- tests/project-store.test.mjs`

Expected: valid roundtrip and invalid import cases pass.

### Task 9: Add governance documents, documentation generator and release checks

**Files:**
- Create: `LICENSE`
- Create: `TRADEMARKS.md`
- Create: `CONTENT_POLICY.md`
- Create: `DATA_PROCESSING.md`
- Create: `THIRD_PARTY_ASSETS.md`
- Create: `scripts/check-release.mjs`
- Create: `tests/release.test.mjs`
- Modify: `README.md`
- Modify: `06_Deploy/README.md`

**Interfaces:**
- `checkRelease({ root })` returns `{ ok, violations }`.

- [ ] **Step 1: Write failing release-gate test**

```js
test('release gate rejects missing governance documents and a stale README asset claim', async () => {
  const report = await checkRelease({ root: fixtureRoot });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(v => v.code === 'MISSING_GOVERNANCE_DOCUMENT'));
});
```

- [ ] **Step 2: Run red**

Run: `npm test -- tests/release.test.mjs`

Expected: FAIL because documents/checker are absent.

- [ ] **Step 3: Add governance and generated release documentation**

State non-affiliation, internal license terms, content review policy, data routing/retention boundaries and asset attribution requirements. Rewrite README/deployment guide around the actual generated manifest, model profiles, authentication and supported workflows. `check-release` verifies docs, asset/fallback parity, profile references and no stale fixed count/version claims.

- [ ] **Step 4: Run green**

Run: `npm run build && npm test -- tests/release.test.mjs && node scripts/check-release.mjs`

Expected: all release assertions pass.

### Task 10: Run the complete regression and produce a distributable output package

**Files:**
- Modify: `CHANGELOG.md`
- Create: `outputs/LEGO-War-Universe-optimized.zip`
- Create: `outputs/VERIFICATION.md`

- [ ] **Step 1: Write the final regression command into package scripts**

```json
"verify": "python 02_Assets/validate.py 02_Assets/assets.json && npm run build && npm test && node scripts/check-release.mjs"
```

- [ ] **Step 2: Run the complete verification**

Run: `npm run verify`

Expected: zero test failures; generated manifest and release checks pass.

- [ ] **Step 3: Perform adversarial verification**

Run production-auth rejection, client-catalogue rejection, malformed model-output tests, asset parity test, ambiguous-intent test, and four representative theme plan tests. Record commands and output summaries in `outputs/VERIFICATION.md`.

- [ ] **Step 4: Package only validated source**

Create `outputs/LEGO-War-Universe-optimized.zip` from the optimized project excluding tests' temporary artifacts and secrets. Confirm the archive contains manifest, governance documents, source modules and tests but no credentials.
