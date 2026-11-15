# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Build and test:**
```bash
npm run build    # Regenerate index.html and dist/visual-pcs.html from src/
npm test         # Run Node test suite (node:test + assert/strict)
npm run serve    # Start HTTP server at localhost:8080
```

**Development:**
- Edit source files under `src/js/`, `src/css/`, `src/html/`
- Don't edit `index.html` or `dist/visual-pcs.html` directly — run `npm run build` after source changes
- Tests go in `test/` as `.test.mjs` files; run `npm test` to execute
- No linter or formatter configured; match existing code style (plain JS/CSS, no build tools)

## Architecture Overview

### Model & Scene Rendering

The app is a browser-based 3D explainer for 200GBASE-R Ethernet PCS lane architecture using Three.js. It simulates data flow through TX stages (left), a channel (center), and RX stages (right), rendered as a 3D scene where each "unit" is 4 PCS-lane symbols.

**Core modules:**
- **`model.js`**: Pure PCS model (no DOM, no Three.js). Defines lane count, timing constants, skew/deskew, AM (alignment marker) lock state, visual layout coordinates, and helper functions for lane-to-symbol mapping. All state hangs off `globalThis.PCS`.
- **`state.js`**: Application state (user selections, playback, selected lane/symbol, fault injection). Central point for all mutable UI state.
- **`scene-core.js` / `scene-static.js`**: Three.js scene construction. Static scene builds the stage boxes, lane tracks, SerDes cables, deskew bars. Core scene updates the dynamic 3D geometry as data flows (camera, lane paths, light pulse).
- **`payload.js`**: Generates synthetic payload (test packets, patterns). Used to drive the TX side and verify RX correctness.
- **`fec.js` / `rs.js`**: FEC state machine and Reed-Solomon codec (Berlekamp-Massey, Chien search, Forney). Tests in `test/rs.test.mjs`.

### Data Flow & Stepping

Playback advances through discrete units (4-symbol chunks) at a user-controlled rate (play speed × stepping velocity). The `tick()` function advances by one unit; `fecPulse()` runs the FEC state machine once per 100 ms of wall time at 1x speed. Data flows through the scene stages, with each unit visualized as a colored lane cube moving left-to-right.

### UI & Visualization

- **`inspector.js`**: Interactive inspection panel showing details of the selected symbol/lane (codeword contents, AM status, FEC state).
- **`lens.js`**: Modal "bit-lens" detail popups showing data distribution and transformations at each stage (symbol distribution, de-interleave, RS decode, etc.). Shares the symbol-selection state with the main scene.
- **`packets.js`**: Renders the flowing 3D packets (colored cubes) as data moves through the stages.
- **`labels.js`**: Places text labels on the 3D scene for each stage box and lane.
- **`ui-map.js`, `ui-faults.js`, `ui-diag.js`**: Control panels for lane mapping, fault injection (bit errors, AM corruption), and diagnostics (oscilloscope-style scope view).
- **`figures.js`**: Helper functions for drawing on canvas (boxes, labels, arrows, curves).

### Page Structure

The HTML is split across multiple fragments in `src/html/`:
- **`intro.html`**: Title and introduction
- **`lab.html`**: Interactive 3D canvas and detail panels (inspector, lens, scope)
- **`story-1.html` / `story-2.html`**: Educational narrative sections with embedded diagrams
- **`footer.html`**: Attribution and links

The build process (via `build.mjs`) combines CSS, HTML, and JavaScript into two outputs:
- **`index.html`**: Standalone document (open in browser directly)
- **`dist/visual-pcs.html`**: Fragment (body + styles + scripts) for embedding in external hosts

## Key Data Structures

- **`P.X`** (model.js): Visual layout — x-coordinates of major stages (TX lanes start/end, mux, demux, etc.). Used for positioning scene boxes and scene-to-model mapping.
- **`P.BOXES`** (content.js): Scene box definitions (x-range, stage number, name, whether it spans the full lane stack, associated detail view).
- **`S.state`** (state.js): Playback state — current unit `u`, playing flag, selected lane `lane`, selected symbol `sel`, fault injection mode, speed.
- **`G.g`** (scene-core.js): Three.js graphics context — scene, camera, renderer, box meshes, lane geometry.

## Testing

Tests use Node's built-in `node:test` runner with `node:assert/strict`. Focus on:
- Protocol mapping and lane-to-symbol conversions (deterministic, should have fixed expected values)
- Payload generation and verification
- Reed-Solomon encoding and decoding (especially error correction and failure modes)

Run `npm test` before committing. No coverage threshold or browser automation suite; manual browser testing is expected for UI changes.

## Commit Conventions

Use short imperative subjects with conventional prefixes:
- `feat:` — user-visible or architectural change
- `fix:` — bug fix
- `refactor:` — internal reorganization (no behavior change)
- `docs:` — documentation or comments

End commits with:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Pull requests should include a summary of changes, relevant test/build commands run, and screenshots for UI changes. End PR descriptions with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Common Tasks

**Add a new stage box or detail view:**
1. Add a box entry to `P.BOXES` in `content.js` (x-range, name, stage, view name)
2. Create a detail-view drawing function in `lens.js` (e.g., `function drawRsenc(W, rx)`)
3. Register it in the `VIEWS` object in `lens.js`
4. If it processes data, add corresponding logic to the core model or FEC modules
5. Run `npm run build && npm test`

**Modify the 3D scene or camera:**
- Scene construction: `scene-core.js` (lighting, camera, renderer setup) and `scene-static.js` (boxes, cables, deskew bars)
- Dynamic scene updates (packet movement, highlighting): `packets.js` and core frame loop in `main.js`
- Lane paths and positioning: `paths.js`

**Debug data flow or FEC state:**
- Trace through `model.js` for lane/symbol mappings
- Use the inspector panel (top-right) to select a symbol and see its codeword position and FEC status
- Check `fec.js` for encoding/decoding state machines
- Tests in `test/rs.test.mjs` show concrete examples of RS encode/decode behavior

## No External Dependencies

The project has no npm packages. Three.js and fonts load from CDNs (see `build.mjs`). All calculations are plain JavaScript. Avoid adding dependencies; instead, implement algorithms directly (e.g., RS codec is implemented from scratch).

## Avoid

- Editing `index.html` or `dist/visual-pcs.html` directly — always make changes in `src/` and rebuild
- Changing the module load order in `build.mjs` unless necessary; it affects initialization and global state setup
- Large IEEE reference PDFs or generated diagrams; keep implementation in source files only
