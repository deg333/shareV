# ShareV

A portable, ShareX-style screen capture tool whose annotations are **real SVG vectors**.
Built with Electron; no installer, no registry, all data lives next to the executable in `ShareV-Data/`.

## Capture
| Mode | Default hotkey |
|---|---|
| Region (drag a rectangle, `Esc`/right-click cancels) | `PrintScreen` |
| Active window | `Alt+PrintScreen` |
| Full screen (monitor under the cursor) | `Ctrl+PrintScreen` |
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

**Colour presets**: the ▾ button beside each colour opens basic HTML colours, the brand (Pantone) colours and your saved colours
("+ Save current colour"). **Shortcuts**: the Shortcuts button (or `?` / `F1`) lists every key binding.

**Saved settings**: each tool's colours and options, plus your saved colours, are saved automatically to
`ShareV-Data/ui-settings.json` (portable: copy the folder to carry them along). The Settings menu can export them
to a file, import them on another machine, or reset to the defaults.

**Blur (`U`) and pixelate (`X`)**: drag a region; radius / block size are options. They act on the screenshot itself
and sit under the annotations. By default they are burned into the saved image (Settings menu: "Burn blur / pixelate
into saved image") so the original, unblurred pixels are *not* left inside the SVG — switch it off only if you want
them editable after re-opening. **Shadow**: shapes, lines, text, balloons and steps have a drop-shadow checkbox and size.

**OCR (text → SVG text)**: the OCR button (or the region tool `O`) recognises text with the Windows 10/11 built-in OCR
engine (no download; uses your installed Windows languages) and lists it in a sidebar: edit a line, copy it, or place it
as real, editable SVG text at its original position — optionally painting over the original pixels with the sampled
background colour ("cover original text") and using the sampled text colour. Blur/pixelate are applied before
recognising, so redacted text is never read.

**Emoji stamps (`M`)**: pick an emoji from the bundled blob set (476 SVGs, searchable) and click to stamp it or drag to
size it; select it to resize from a corner (stays square), change "Size", add a shadow, or swap it for another emoji.
Emoji are embedded in the SVG as real vector artwork (ids/classes are scoped per stamp). Add more from
[svgmoji](https://github.com/svgmoji/svgmoji): paste an emoji (e.g. from the Win+. panel) or a hex code, choose
Blobmoji / Noto / OpenMoji / Twemoji and press Add (needs internet once; it is saved to `ShareV-Data/emoji/`), or import
your own `.svg` files. Imported/downloaded SVGs are sanitised (scripts, handlers and external references removed).

**Favourite emoji**: hover an emoji in the picker and click its ☆ (or right-click it) to pin it. Favourites are listed first
in the picker, are saved with your other settings in `ShareV-Data/ui-settings.json` (and included in Settings > Export/Import).

**Capture delay & capturing ShareV itself**: next to the capture buttons, pick a delay (1–5 s) to wait before the
screenshot is taken (time to open a menu or tooltip), and tick "include ShareV" to keep ShareV's own windows visible so
the region / full-screen / window capture can include them. Both settings apply to the hotkeys too and are stored in
`ShareV-Data/settings.json` (`captureDelay`, `captureSelf`). The emoji favourites default to ❌ ✔ 😊 🤣 😬 🤯 until you
change them.

**Hotkey speed**: the region picker window and a blank editor window are kept loaded (hidden) in the background, ShareV
only waits for its windows to hide when one was actually visible, and the region picker gets a screenshot shrunk to its
displayed size. The first capture after starting ShareV can still be slightly slower while those warm up.

**Hotkeys while ShareV has focus**: besides the global keyboard hook, the editor itself also triggers the capture if it
receives a PrintScreen combination. `ShareV-Data/log.txt` records the hook installing, each capture and how long it took
(and if a capture was ignored because another was still running) - send it along if a hotkey ever misbehaves.

**Copy / paste style**: right-click a shape for a menu (Copy style, Paste style, Paint this style onto other shapes,
Duplicate, Bring to front, Send to back, Delete). `Ctrl+Shift+C` / `Ctrl+Shift+V` (or the two brush/clipboard buttons
in the top bar) copy a shape's line/fill colours, widths, opacity, text colour/bold/size, shadow and arrowheads and
paste what applies onto every selected shape (even of a different type). The **Style painter** tool (`K`) copies on the
first click and applies on each further click (Shift-click picks a new style, `Esc` finishes).

**Calculator & unit converter (sidebar, `F2` or the Calc button)**
- *Calculator*: scientific — `+ − × ÷ ^ % !`, parentheses, `sin cos tan asin acos atan sinh… ln log log2 sqrt cbrt abs exp
  nroot atan2 min max mod`, `pi e`, implicit multiplication (`2pi`, `3(4+1)`), Deg/Rad, `ans` and memory (MC MR M+ M−).
  Type in the box (Enter evaluates) or use the keys; a live preview shows the result as you type.
- *Convert*: Length, Mass, Pressure, Speed, Temperature, Time, Volume, Air flow (CFM, m³/h, L/s…) and Torque
  (N·m, lbf·ft, kgf·m…). Type in either box; the other updates. Adjustable digits, swap button.
- *History* (both tabs): click a result to insert it, click an expression/entry to reload it; hover for copy result /
  copy "expression = result" / delete. Histories are saved with your settings (`ShareV-Data/ui-settings.json`).

**Crank & slider simulator (`F3` or the Sim button)**: an animated slider-crank mechanism with all four inversions
(frame / crank / connecting rod / slider fixed), presets (IC Engine, Offset Engine, Quick Return, Rotary Engine, Osc.
Cylinder, Hand Pump), sliders for crank r, rod l, offset e and speed (rpm), SI or Imperial units, and graphs of x(θ),
v(θ), a(θ) and crank torque T(θ) (set the slider force and mass). Live readouts: θ₂, φ, x, v, a, stroke, N = l/r and
the quick-return time ratio. The **"The maths"** panel works every quantity through with your current numbers:
`sin φ = (r·sin θ − e)/l`, `x = r·cos θ + l·cos φ`, `v = −r·ω·sin(θ+φ)/cos φ`, accelerations, dead centres
`√((l±r)² − e²)`, `Q = (180°+α)/(180°−α)` and `T = (F − m·a)·dx/dθ`. Space runs/pauses, ← → step (Shift = 10°), click
the graph to set θ₂. The maths is unit-tested against finite differences and the reference values
(r = 40, l = 120, θ = 18°, 20 rpm → φ = 5.91°, x = 157.4 mm, v = −34.1 mm/s, a = −215 mm/s²).

**Simulator upgrades**: equations are typeset with [KaTeX](https://katex.org) (bundled in `src/vendor/katex`, works offline) and colour-coded by link —
crank (r, θ) teal, connecting rod (l, φ) purple, offset (e) grey, slider (x, v, a) gold, input ω orange, torque pink. The right-hand panel has three
tabs: *The maths* (worked live), *Theory* (degrees of freedom, exact and approximate kinematics, forces and side thrust, inertia and balancing, offset and
quick return, the four inversions, design rules) and *Pros & cons* (of the mechanism and of each inversion). **Export SVG** saves the current frame as a
standalone, well-commented SVG (equations, inputs, values at that instant, the coordinate mapping and one named, explained `<g>` per layer).
Windows open wide by default, scroll bars are dark with breathing room, and the graph dot is a fixed circle that moves smoothly every frame.

**Animated SVG export** (Simulator → *⇩ Animated SVG*): a self-contained, interactive SVG of the current setup (any inversion, units,
offset…). Open it in a browser and it plays by itself, with controls drawn into the file: play/pause (Space), forward/reverse, a speed slider
(1–120 rpm), a crank-angle slider to scrub by hand, and arrow keys to step 1°. Live readouts show θ, φ, x and v. The file is heavily commented:
a header explaining the controls, the equations and the file layout; every moving part is a named element; and a short, readable script
(kinematics → inversion transform → move the elements → animation loop → control handlers) drives it. Browsers run the script when the
file is opened directly; viewers that block SVG scripts (`<img>`, editors) show the exported still frame — use the plain *Export SVG* there.

**No-script animated SVG** (Simulator → *⇩ No-script SVG*): a looping animation built from SMIL `<animate>` elements — no JavaScript at all — so it also
plays inside an `<img>` tag, as a CSS background, in many viewers and in e-mail. The linkage is sampled every 3° of crank rotation and every moving
part carries the list of its 121 values (parts that never move, e.g. the whole frame in the 1st inversion, stay plain attributes). It has no buttons;
a dot travelling along a track shows the crank angle, and one revolution takes `dur="…"` (the exported rpm limited to 2–12 s; replace that string to
change the speed). Verified frame-for-frame against the interactive version in all four inversions.

**Whole tool as one SVG** (Simulator → *⇩ Whole tool SVG*): saves the *entire* interactive simulator — four inversions, presets, all sliders, units, the animated
mechanism, the four graphs, the readouts, the KaTeX-typeset maths, the Theory and Pros & cons tabs and its own export buttons — as a single `.svg` of about 600 KB.
Open it directly in a browser and it starts in the state you exported. Nothing is loaded from the network and no other files are needed. The file explains
its own structure in comments: a static fallback picture, a `<foreignObject>` holding an `<iframe>`, and the application stored as plain, readable text
(CSS, KaTeX, `sim-core.js`, `sim-export.js`, `sim.js`) inside a `<script type="text/html">` block that a few lines of bootstrap code hand to the iframe.
Viewers that cannot run scripts (an `<img>` tag, Inkscape) show only the fallback picture. The exported source comes from `src/editor/sim-bundle.js`, which
`tools/gen_tool_bundle.py` generates (`npm run gen`; `npm test` checks that it is up to date).
