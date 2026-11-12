# Headless export (fork notes)

This branch (`headless-export`) is a fork of [webadderallorg/Recordly](https://github.com/webadderallorg/Recordly)
at `e4a9d048` (v1.4.0). It adds a way to export `.recordly` projects to MP4 **without showing any window or
touching the mouse**, so recordings can be produced from scripts while the installed Recordly app stays open.

It is used by the `videos-de-ayuda` Claude Code skill, which records help animations with Playwright, builds a
Recordly project from them and exports it with this script.

## Usage

```bash
npm ci
npm run build:headless
node scripts/headless-export.mjs <project.recordly | project name>... --out-dir <dir>
```

See the header of `scripts/headless-export.mjs` for every option (fps, quality, encoder, timeout, profile).

## Changes from upstream

| File | Change |
|---|---|
| `scripts/headless-export.mjs` | New. Runs the editor's existing smoke-export mode (`RECORDLY_SMOKE_EXPORT`) in a hidden window with a temporary profile, writes the MP4 straight to the output path and kills runs that exceed a timeout. |
| `package.json` | `build:headless` (renderer + main bundle without native helpers or installers) and `export:headless`. |
| `electron/appPaths.ts` | `RECORDLY_USER_DATA_DIR` sets its own user-data/session path, so an export does not share the installed app's locked profile. |
| `electron/main.ts` | With `RECORDLY_HEADLESS=1`, a hidden editor keeps rendering at full speed (no occlusion tracking, backgrounding or timer throttling). Smoke exports skip the single-instance lock and close without the save prompt. |
| `electron/windows.ts` | With `RECORDLY_HEADLESS=1`, the editor window is never shown, is kept off the taskbar and paints while hidden. |

The app behaves exactly like upstream unless those environment variables are set.

Recordly is licensed under the GNU AGPL-3.0 (see `LICENSE.md`); these changes are under the same license.
