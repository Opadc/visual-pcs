# Repository Guidelines

## Project Structure & Module Organization

This repository is a browser-based explainer for the 200GBASE-R Ethernet PCS. Edit source files under `src/`: JavaScript modules are in `src/js/`, styles in `src/css/`, and page fragments in `src/html/`. The core PCS and payload models live in `model.js`, `fec.js`, `rs.js`, and `payload.js`; UI and scene behavior is split across the remaining modules. Tests are in `test/` as `.test.mjs` files. `build.mjs` combines source into `index.html` and the embeddable `dist/visual-pcs.html`; treat these as generated outputs and make source changes first.

## Build, Test, and Development Commands

- `npm test` runs the Node.js test suite using the built-in test runner.
- `npm run build` regenerates both HTML outputs from `src/`.
- `npm run serve` starts a static server at `http://localhost:8080` for browser testing.

Run tests after model or UI logic changes, and run the build when updating source intended for the delivered pages. The page loads Three.js and fonts from external CDNs, so those assets require network access in the browser.

## Coding Style & Naming Conventions

Use the existing plain JavaScript and CSS conventions; no formatter or linter is configured. Follow nearby indentation and naming: JavaScript functions and variables use `camelCase`, constants use uppercase names where already established, and CSS classes use descriptive kebab-case. Keep model calculations separate from rendering and UI code. Preserve the explicit module ordering in `build.mjs` when adding a script or stylesheet, since the project bundles files in that order.

## Testing Guidelines

Add focused tests under `test/` using filenames like `feature.test.mjs` and `node:test` with `node:assert/strict`. Cover protocol mapping, payload, and Reed-Solomon behavior with concrete expected values or invariants. Run `npm test` before submitting; there is no configured coverage threshold or browser automation suite.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects with a conventional prefix, such as `feat:`, `fix:`, `refactor:`, or `docs:`. Keep commits focused and explain the user-visible or technical change. Pull requests should describe the behavior changed, list relevant tests and build commands run, link related issues when applicable, and include screenshots for visible UI changes. Regenerate committed HTML outputs with `npm run build` when source changes affect the deliverable.

## Configuration & Assets

The project has no package dependencies or environment configuration. Avoid editing the large IEEE reference PDF or generated HTML unless the task specifically requires it; keep implementation changes in the source tree and build outputs synchronized.
