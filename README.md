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

Also available from the tray icon and the editor toolbar. On Windows the PrintScreen combinations use a low-level keyboard hook, so they work even though the shell/Snipping Tool normally owns that key (and are swallowed so it does not also open). Hotkeys, save folder and
`copyToClipboard` are in `ShareV-Data/settings.json`.

## Annotation tools (all SVG)
Rectangle `R`, ellipse `E`, line `L`, arrow `A`, freehand (smoothed) `F`, pen with bezier curves `P` (click = corner, drag = curve, click the first point to close, Enter/double-click to finish), text `T`, text box `B`,
balloon `C`, highlight `H`, select/move/resize `V`. Double-click (or `Enter`) edits text;
drag the orange handle to aim a balloon's tail. `Shift` constrains lines to 45° and boxes to squares.

Ctrl+Z / Ctrl+Y undo/redo · Ctrl+D duplicate · Ctrl+]/[ reorder · arrows nudge · Del delete ·
Ctrl+wheel zoom · paste or drop an image to annotate it.

## Files
`Ctrl+S` saves an `.svg`: the screenshot as an embedded `<image>` plus one vector element per
annotation. The file also carries a `<metadata id="sharev-data">` block, so re-opening it in ShareV
restores every shape as editable. Other SVG editors/browsers just see normal SVG.
Also: export PNG, copy to clipboard (`Ctrl+C`), open PNG/JPG/SVG.

## Run / build (Tauri 2)
Needs Node, Rust, and on Linux `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev`
(Windows needs the WebView2 runtime, preinstalled on Windows 10/11).
```bash
npm install
npm run dev              # run in dev mode
npm run build            # single portable executable: src-tauri/target/release/sharev(.exe)
npm run bundle           # installers (msi/nsis, deb/AppImage, dmg)
npm test                 # headless editor tests (needs playwright)
```
`sharev.exe` is portable: copy it anywhere; settings, screenshots and the WebView profile live in
`ShareV-Data/` next to it. The `build` GitHub workflow produces the Windows exe on a tag or manual run.

## Platform notes
* Capture uses the `xcap` crate. Active window = the focused window, or the top-most normal window
  if focus can't be determined. Wayland and macOS need the system screen-capture permission.
* Only one instance should run at a time (a second one fails to register the hotkeys).

## Tool options
Each tool remembers its own colour / width / fill / font settings (stored in the app's local storage).
Defaults: rectangle & ellipse red, no fill; text white with a red outline; text box & balloon red fill,
white border and white text; highlight yellow (255,255,0).

Line-like tools (line, arrow, freehand, pen) have optional arrowheads at the start and/or end and a head-size
setting (arrow defaults to an end head). Every colour (line, fill, text) has its own opacity slider; highlight
can have an outline (Width 0 = none) and defaults to 50 % yellow.
Errors (e.g. a hotkey that could not be registered) are written to `ShareV-Data/log.txt`.

**Step tool (`N`)**: every click drops a red numbered circle (1, 2, 3 …). The next number is shown in the
"No." box and can be changed before clicking; colours, size and border are per-tool options. Select a
step to change its own number.

**Multi-select**: drag a rubber band on empty canvas, Shift/Ctrl-click to add or remove shapes, `Ctrl+A` for all.
Option changes (colour, width, opacity, font, arrowheads…) apply to every selected shape that has that option;
drag, arrow-key nudge, `Ctrl+D`, `Ctrl+]`/`[` and `Del` work on the whole selection.
