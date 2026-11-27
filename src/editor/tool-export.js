'use strict';
/* Builds the "Whole tool SVG": ONE self-contained .svg file that contains the entire interactive crank & slider simulator.
   Pure string building (no DOM) so it can be tested in Node. The pieces it assembles - CSS, KaTeX, the maths and the UI
   scripts - come from sim-bundle.js, which tools/gen_tool_bundle.py generates from the real source files. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ToolExport = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  /* Text that goes inside a CDATA section must not contain "]]>" (it would end the section early). The standard trick is
     to close and re-open the section around it; a parser then simply joins the pieces back together. */
  const cdata = (s) => `<![CDATA[${s.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
  /* Text that goes inside an HTML <script> must not contain "</script" or "<!--". In JavaScript source an escaped slash or
     bang is the same character, so the code keeps working. */
  const safeJs = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

  /**
   * @param bundle   window.SIM_BUNDLE: {css, katexCss, katexJs, simCore, simExport, sim, digest}
   * @param init     state the tool should start in (inversion, lengths, units ...)
   * @param fallback SVG markup of the current still picture (drawn behind the tool; visible if scripts are blocked)
   * @param meta     {date, invName, rKmm...} short strings used in the header comment
   */
  function build(bundle, init, fallback, meta) {
    const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Crank &amp; slider simulator</title>

<!-- ======== 1. ShareV's own styles (buttons, sliders, cards, the simulator layout, dark scroll bars) ======== -->
<style>
${bundle.css}
</style>

<!-- ======== 2. KaTeX styles (the typeset equations) with the fonts they need embedded as data: URIs ======== -->
<style>
${bundle.katexCss}
</style>

<!-- ======== 3. Tweaks for running stand-alone: the close button has nothing to close, and the tool fills the page ======== -->
<style>
  html, body { margin: 0; height: 100%; background: #0b1220; }
  #simClose  { display: none; }
</style>
</head>
<body>

<!-- ======== 4. The tool mounts here. sim.js builds every control, card, graph and panel inside this element. ======== -->
<div id="sim" tabindex="-1"></div>

<!-- ======== 5. Starting state: whatever the simulator was showing when this file was exported ======== -->
<script>
window.__SIM_INITIAL = ${JSON.stringify(init)};
</script>

<!-- ======== 6. KaTeX 0.x (MIT) - typesets the equations in "The maths", "Theory" and "Pros & cons". Minified vendor code. ======== -->
<script>
${safeJs(bundle.katexJs)}
</script>

<!-- ======== 7. sim-core.js - the kinematics: position, velocity, acceleration, torque, dead centres, time ratio, presets ======== -->
<script>
${safeJs(bundle.simCore)}
</script>

<!-- ======== 8. sim-export.js - builds the exported SVG files (the tool's own export buttons keep working here) ======== -->
<script>
${safeJs(bundle.simExport)}
</script>

<!-- ======== 9. sim.js - the user interface: drawing, controls, graphs, readouts, the maths panel, the animation loop ======== -->
<script>
${safeJs(bundle.sim)}
</script>

<!-- ======== 10. Start it ======== -->
<script>
window.ShareVSim.open();
</script>
</body>
</html>
`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  ===========================================================================================
  CRANK & SLIDER SIMULATOR  -  THE WHOLE INTERACTIVE TOOL IN ONE SVG FILE
  exported from ShareV on ${meta.date}   (source digest ${bundle.digest})
  ===========================================================================================

  OPEN THIS FILE DIRECTLY IN A BROWSER (Chrome, Edge, Firefox, Safari).  It then runs the complete simulator:
    - four inversions (frame / crank / connecting rod / slider fixed) and six presets
    - sliders for crank r, rod l, offset e, input speed, slider force and mass; SI or Imperial units
    - animated mechanism with protractor, dead centres, stroke and offset dimensions
    - graphs of x(theta), v(theta), a(theta) and crank torque T(theta); click a graph to set the angle
    - live readouts (theta, phi, x, v, a, stroke, N = l/r, time ratio)
    - "The maths" worked through with live numbers (KaTeX), a Theory tab and a Pros & cons tab
    - its own export buttons (still SVG, animated SVG, no-script looping SVG)
  Space runs / pauses, Left / Right step the crank.

  It started in the state ShareV was in when you exported it: ${meta.invName} inversion, ${meta.params}.

  REQUIREMENTS
    The file needs a browser that runs scripts in SVG.  Opened as an <img>, in Inkscape, in most editors, or in an
    e-mail preview the script cannot run and you only see the still picture drawn below the tool (the "fallback").

  HOW THIS FILE IS BUILT  (read top to bottom)
    1. <style>           look of the small wrapper only
    2. #fallback         a static picture of the mechanism, drawn with plain SVG shapes
    3. <foreignObject>   a window the size of the page; inside it an <iframe> that will hold the tool
    4. <script id="tool-html" type="text/html">
                         the ENTIRE tool as an ordinary HTML page, stored as text (inside CDATA so it needs no escaping):
                           - the CSS (ShareV styles + KaTeX styles with embedded fonts)
                           - the empty <div id="sim"> the tool mounts into
                           - the starting state
                           - KaTeX (minified), then sim-core.js, sim-export.js and sim.js (readable, commented source)
                           - one line that starts it
                         A "text/html" script is never executed by the browser; it is just a container for text.
    5. <script> (last)   a few lines that copy that text into the iframe, which loads and runs it

  WHY AN IFRAME?  The simulator is a normal HTML application (buttons, range sliders, a scrolling maths panel). Inside an
  SVG document the browser's HTML parser is not available, so the HTML application is hosted in an iframe via its
  "srcdoc" attribute. Everything stays in this one file - no other files are needed and nothing is fetched from the network.
  ===========================================================================================
-->
<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
  <title>Crank and slider simulator (interactive)</title>
  <desc>The complete interactive slider-crank simulator as a single SVG file. Open it directly in a browser.</desc>

  <style>
    text { font-family: "Segoe UI", Arial, sans-serif; }
    #tool { width: 100%; height: 100%; border: 0; background: #0b1220; }
  </style>

  <!-- 2. FALLBACK PICTURE - visible only if the script below cannot run (the iframe covers it otherwise) -->
  <rect width="100%" height="100%" fill="#0b1220"/>
  <g id="fallback" transform="translate(40 70)">
    ${fallback}
  </g>
  <text x="40" y="40" fill="#ffd166" font-size="16" font-weight="700">This is the interactive crank &amp; slider simulator.</text>
  <text x="40" y="58" fill="#9fb1d4" font-size="13">Open this file directly in a web browser to run it (it needs scripts, which an image viewer or editor does not run).</text>

  <!-- 3. THE TOOL'S WINDOW: an iframe stretched over the whole page -->
  <foreignObject id="stage" x="0" y="0" width="100%" height="100%">
    <iframe xmlns="http://www.w3.org/1999/xhtml" id="tool" title="Crank and slider simulator"></iframe>
  </foreignObject>

  <!-- 4. THE TOOL ITSELF, stored as text. (Never executed here; step 5 hands it to the iframe.)
        Inside is a complete HTML page: styles, the mount point, the starting state, KaTeX and the three simulator scripts. -->
  <script type="text/html" id="tool-html">${cdata(page)}</script>

  <!-- 5. START: put the stored page into the iframe, then give the iframe keyboard focus so Space / arrow keys work -->
  <script>${cdata(`
(function () {
  "use strict";
  var frame = document.getElementById("tool");
  var source = document.getElementById("tool-html").textContent;   // the whole HTML page from step 4
  frame.setAttribute("srcdoc", source);                            // load it into the iframe
  frame.addEventListener("load", function () {
    try { frame.contentWindow.focus(); } catch (e) { /* focus is a convenience only */ }
  });
}());
`)}</script>
</svg>
`;
  }
  return { build, cdata, safeJs };
}));
