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

## Open Bugs
*(None yet — project initialization in progress.)*
