# Known Issues & Technical Debt (ISSUES.md)

## Environment Notes
- **[ENV-001] Default `node` in PATH is v16.20.2**
  - **Symptom**: Running `node -v` directly resolves to `D:\node.exe` (`v16.20.2`), below SPEC §2 requirement (`Node ≥ 18`).
  - **Workaround**: Prepend `C:\Users\Administrator\AppData\Local\pi-node\current` (`v22.23.5`) to `PATH` before running `npm` / `node` commands.
  - **Status**: Resolved via environment PATH prefix.
- **[ENV-002] User `.npmrc` points to unreachable/hanging `registry.npmmirror.com`**
  - **Symptom**: Default `npm install` hung indefinitely because global `~/.npmrc` configured `registry.npmmirror.com`, whereas `registry.npmjs.org` returns HTTP 200 immediately.
  - **Workaround**: Added project-local `.npmrc` pinning `registry=https://registry.npmjs.org/`.
  - **Status**: Resolved.

## Open Bugs (Blocking)
- **None.** All M0–M8 acceptance criteria, unit tests (35/35), and E2E tests (9/9) pass with zero console or page errors.

## Known Non-Blocking Issues & Technical Debt
- **[TECH-001] Production bundle chunk size warning (~735 kB unsplit main JS)**
  - **Details**: Vite prints a chunk-size advisory (`> 500 kB`) because Three.js is bundled in the main entry chunk (`gzip: ~198 kB`). Does not impact gameplay or frame rate; could be split via `rollupOptions.output.manualChunks` in a future optimization pass.
- **[TECH-002] Single Web Worker thread for chunk generation & meshing**
  - **Details**: Terrain generation + initial lighting + meshing currently share one dedicated Web Worker (`WorldWorkerClient`), averaging `~14.3ms` gen + `~14.9ms` mesh per chunk. Moving to a 2–4 worker pool would speed up initial Render Distance 8 cold-start loading further on multi-core CPUs.
- **[TECH-003] Simple face-culled meshing (not full greedy meshing)**
  - **Details**: `Mesher.ts` implements full neighbor face culling + 4-corner smooth lighting + vertex AO. At Render Distance 8 (`197` chunks), this yields `~270` draw calls and `~0.8M–1.0M` triangles, which runs locked at `60 FPS` on integrated Intel Iris Xe Graphics (`< 1ms` JS), so greedy meshing was not required to meet the `≥ 55 FPS` target. Adding greedy quad merging per uniform light/AO face could further reduce triangle count on low-end mobile GPUs.
- **[TECH-004] Single-slot latest world save UX**
  - **Details**: IndexedDB stores saves keyed by `worldId` and Continue World resumes the most recently saved world. Multi-world list management / delete-world UI was intentionally kept simple to stay focused on core survival scope.
- **[TECH-005] Simplified finite water flow & no underwater buoyancy currents**
  - **Details**: Per SPEC §3.1 ("源头 + 有限扩散即可"), water spreads finitely up to 7 blocks and falls vertically without pushing entities horizontally or forming infinite 2×2 source regeneration.
