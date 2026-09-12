# LEGO War Universe · Trusted Production Workbench

LWU turns a film theme into a validated LEGO-style storyboard. It uses a single versioned asset registry, deterministic bilingual intent parsing, typed shot specifications, continuity-aware planning and a Flow model profile before compiling a prompt.

## Start

```powershell
npm run build
npm run verify
```

Open `index.html` through a static HTTP server. The page loads `02_Assets/assets.json` and verifies the embedded offline fallback generated from that same file. Runtime metadata comes from the generated build manifest.

## Production contract

- `02_Assets/assets.json` is the sole asset source.
- `02_Assets/model-profiles.json` states the selected Flow profile's declared capabilities.
- Local planning is default. Ambiguous era requests require confirmation rather than silently choosing an asset.
- The Pages endpoint accepts no browser-supplied asset catalogue. Production calls require Cloudflare Access identity (`ENVIRONMENT=production`, `AUTH_MODE=access`).
- `GET /api/health` does not contact a model. There are no public model probes.

## Release checks

`npm run verify` validates assets, regenerates the fallback and manifest, runs domain/security/UI tests, and checks governance/docs. Review `CONTENT_POLICY.md`, `DATA_PROCESSING.md`, `THIRD_PARTY_ASSETS.md`, and `TRADEMARKS.md` before release.
