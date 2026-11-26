# ShareV

A portable, ShareX-style screen capture tool whose annotations are **real SVG vectors**.
Built with Electron; no installer, no registry, all data lives next to the executable in `ShareV-Data/`.

## Capture
| Mode | Default hotkey |
|---|---|
| Full screen (monitor under the cursor) | `PrintScreen` |
| Active window | `Alt+PrintScreen` |
| Region (drag a rectangle, `Esc`/right-click cancels) | `Ctrl+PrintScreen` |
| Last region | `Ctrl+Shift+PrintScreen` |

Also available from the tray icon and the editor toolbar. Hotkeys, save folder and
`copyToClipboard` are in `ShareV-Data/settings.json`.

## Annotation tools (all SVG)
Rectangle `R`, ellipse `E`, line `L`, arrow `A`, freehand `P`, text `T`, text box `B`,
balloon `C`, highlight `H`, select/move/resize `V`. Double-click (or `Enter`) edits text;
drag the orange handle to aim a balloon's tail. `Shift` constrains lines to 45° and boxes to squares.

Ctrl+Z / Ctrl+Y undo/redo · Ctrl+D duplicate · Ctrl+]/[ reorder · arrows nudge · Del delete ·
Ctrl+wheel zoom · paste or drop an image to annotate it.

## Files
`Ctrl+S` saves an `.svg`: the screenshot as an embedded `<image>` plus one vector element per
annotation. The file also carries a `<metadata id="sharev-data">` block, so re-opening it in ShareV
restores every shape as editable. Other SVG editors/browsers just see normal SVG.
Also: export PNG, copy to clipboard (`Ctrl+C`), open PNG/JPG/SVG.

## Run / build
```bash
npm install
npm start                # run
npm run dist:win         # Windows portable .exe  (dist/ShareV-<ver>-portable.exe)
npm run dist:linux       # AppImage
npm test                 # headless editor tests (needs playwright)
```
The `build` GitHub workflow produces the Windows portable exe on a tag or manual run.

## Platform notes
* Active-window capture: Windows (PowerShell), Linux/X11 (`xdotool` must be installed), macOS (needs
  Accessibility permission); otherwise it falls back to the full screen.
* macOS needs Screen Recording permission; Wayland uses the system screen-share prompt.
