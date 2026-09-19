/*!
 * geometric-bg.js
 *
 * An animated "dynamic geometry" background for the Butterfly theme.
 *
 * It paints a slow-drifting field of wireframe polygons, a plexus
 * (constellation) of linked nodes, and a few very faint rotating rings onto a
 * fixed, full-viewport canvas that sits behind every page element.
 *
 * Design notes
 * ------------
 * - Colours follow the site theme (`<html data-theme="light|dark">`), so the
 *   background stays legible after the reader flips the dark-mode switch.
 * - Positions are stored in normalised (0..1) space so the layout survives
 *   resizes and orientation changes without having to re-seed the field.
 * - The animation yields to the visitor: it renders a single static frame when
 *   `prefers-reduced-motion: reduce` is set, and freezes while the tab is
 *   hidden or the window is off-screen.
 * - Everything is wrapped in a closure, so nothing leaks onto `window`.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Tunables
   * ------------------------------------------------------------------ */

  var CONFIG = {
    // Entity counts are derived from viewport area, then clamped to a sane
    // range so phones stay cheap and ultra-wide monitors stay sparse.
    shapesPerMegapixel: 1.1,
    nodesPerMegapixel: 2.8,
    minShapes: 5,
    maxShapes: 20,
    minNodes: 16,
    maxNodes: 64,

    // Wireframe polygons
    minSides: 3,
    maxSides: 8,
    minRadius: 0.045, // fraction of the shorter viewport edge
    maxRadius: 0.15,

    // Plexus links
    linkDistance: 190, // px between two nodes before the link disappears
    pointerLinkDistance: 250, // px between the pointer and a node

    // Motion
    drift: 9, // px per second for the nearest layer
    spinMin: 0.05, // radians per second
    spinMax: 0.22,
    parallax: 30, // px the nearest layer travels behind the pointer
    parallaxEase: 0.055,

    // Rendering
    maxPixelRatio: 2,
    rings: 2
  };

  // RGB triples; alphas are applied per-entity so one palette entry can be used
  // for both a faint link and a bright vertex.
  var PALETTE = {
    light: [
      [73, 177, 245],
      [0, 196, 182],
      [124, 131, 253]
    ],
    dark: [
      [96, 190, 255],
      [46, 226, 210],
      [152, 158, 255]
    ]
  };

  var CANVAS_ID = 'geometric-bg';

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function rgba(rgb, alpha) {
    var a = alpha > 1 ? 1 : alpha < 0 ? 0 : alpha;
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a.toFixed(3) + ')';
  }

  // Wrap a normalised coordinate into [-margin, 1 + margin] so entities that
  // drift off one edge reappear on the other.
  function wrap(value, margin) {
    var span = 1 + margin * 2;
    var shifted = value + margin;
    shifted = shifted - Math.floor(shifted / span) * span;
    return shifted - margin;
  }

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  var canvas = null;
  var ctx = null;
  var shapes = [];
  var nodes = [];
  var rings = [];

  var width = 0;
  var height = 0;
  var pixelRatio = 1;

  var mode = 'light';
  var pointer = { x: 0, y: 0, hasMoved: false };
  var view = { x: 0, y: 0, targetX: 0, targetY: 0 };

  var frameId = null;
  var lastTime = 0;
  var resizeTimer = null;

  /* ------------------------------------------------------------------ *
   * Theme
   * ------------------------------------------------------------------ */

  function readMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function palette() {
    return PALETTE[mode] || PALETTE.light;
  }

  /* ------------------------------------------------------------------ *
   * Entity construction
   * ------------------------------------------------------------------ */

  function createShape(seedRandom) {
    var radius = rand(CONFIG.minRadius, CONFIG.maxRadius);
    // Depth drives size, speed, opacity and parallax together, which is what
    // sells the illusion of a third dimension.
    var depth = rand(0.15, 1);

    return {
      x: seedRandom ? Math.random() : rand(-0.1, 1.1),
      y: seedRandom ? Math.random() : rand(-0.1, 1.1),
      radius: radius * (0.45 + 0.85 * depth),
      sides: randInt(CONFIG.minSides, CONFIG.maxSides),
      rotation: rand(0, Math.PI * 2),
      spin: rand(CONFIG.spinMin, CONFIG.spinMax) * (Math.random() < 0.5 ? -1 : 1),
      depth: depth,
      vx: rand(-1, 1) * 0.6,
      vy: rand(-1, 1) * 0.6,
      color: randInt(0, 2)
    };
  }

  function createNode() {
    var depth = rand(0.12, 1);

    return {
      x: Math.random(),
      y: Math.random(),
      depth: depth,
      radius: 0.9 + 1.5 * depth,
      vx: rand(-1, 1) * 0.5,
      vy: rand(-1, 1) * 0.5
    };
  }

  function createRing(index) {
    return {
      x: rand(0.15, 0.85),
      y: rand(0.15, 0.85),
      radius: rand(0.28, 0.52),
      rotation: rand(0, Math.PI * 2),
      spin: rand(0.02, 0.06) * (index % 2 === 0 ? 1 : -1),
      color: index % 2
    };
  }

  function seed() {
    var megapixels = (width * height) / 1e6;
    var shapeCount = clamp(
      Math.round(megapixels * CONFIG.shapesPerMegapixel),
      CONFIG.minShapes,
      CONFIG.maxShapes
    );
    var nodeCount = clamp(
      Math.round(megapixels * CONFIG.nodesPerMegapixel),
      CONFIG.minNodes,
      CONFIG.maxNodes
    );

    shapes = [];
    for (var s = 0; s < shapeCount; s++) shapes.push(createShape(true));

    nodes = [];
    for (var n = 0; n < nodeCount; n++) nodes.push(createNode());

    rings = [];
    for (var r = 0; r < CONFIG.rings; r++) rings.push(createRing(r));
  }

  /* ------------------------------------------------------------------ *
   * Canvas plumbing
   * ------------------------------------------------------------------ */

  function createCanvas() {
    var existing = document.getElementById(CANVAS_ID);

    if (existing && existing.tagName === 'CANVAS') {
      canvas = existing;
    } else {
      canvas = document.createElement('canvas');
      canvas.id = CANVAS_ID;
      canvas.setAttribute('aria-hidden', 'true');
      // Inserted as the first child so it paints under everything else that
      // lives in the default stacking context.
      document.body.insertBefore(canvas, document.body.firstChild);
    }

    canvas.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'z-index:-1',
      'pointer-events:none',
      'display:block'
    ].join(';');

    ctx = canvas.getContext('2d');
    return !!ctx;
  }

  function measure() {
    width = window.innerWidth || document.documentElement.clientWidth || 1;
    height = window.innerHeight || document.documentElement.clientHeight || 1;
    pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio);

    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  /* ------------------------------------------------------------------ *
   * Simulation
   * ------------------------------------------------------------------ */

  function advance(dt) {
    var scale = Math.min(width, height);

    for (var i = 0; i < shapes.length; i++) {
      var shape = shapes[i];
      var speed = (CONFIG.drift / scale) * (0.3 + shape.depth);
      shape.x = wrap(shape.x + shape.vx * speed * dt, 0.15);
      shape.y = wrap(shape.y + shape.vy * speed * dt, 0.15);
      shape.rotation += shape.spin * dt;
    }

    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var nodeSpeed = (CONFIG.drift / scale) * (0.25 + node.depth) * 0.8;
      node.x = wrap(node.x + node.vx * nodeSpeed * dt, 0.05);
      node.y = wrap(node.y + node.vy * nodeSpeed * dt, 0.05);
    }

    for (var k = 0; k < rings.length; k++) {
      rings[k].rotation += rings[k].spin * dt;
    }

    // Ease the parallax offset towards the pointer so movement feels fluid
    // instead of snapping to the cursor.
    view.x += (view.targetX - view.x) * CONFIG.parallaxEase;
    view.y += (view.targetY - view.y) * CONFIG.parallaxEase;
  }

  /* ------------------------------------------------------------------ *
   * Drawing
   * ------------------------------------------------------------------ */

  function drawBackdrop() {
    var colors = palette();

    // A soft ambient wash gives the flat background some depth; drawn first so
    // the geometry reads as sitting on top of it.
    ctx.save();
    var glow = ctx.createRadialGradient(
      width * 0.72,
      height * 0.12,
      0,
      width * 0.72,
      height * 0.12,
      Math.max(width, height) * 0.85
    );
    glow.addColorStop(0, rgba(colors[0], mode === 'dark' ? 0.1 : 0.13));
    glow.addColorStop(0.55, rgba(colors[1], mode === 'dark' ? 0.045 : 0.05));
    glow.addColorStop(1, rgba(colors[2], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function drawRings(offsetX, offsetY) {
    var colors = palette();

    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i];
      var baseAlpha = mode === 'dark' ? 0.16 : 0.14;
      var fade = clamp(ring.radius * 2.4, 0, 1);

      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.beginPath();
      ctx.arc(ring.x * width, ring.y * height, ring.radius * Math.min(width, height), 0, Math.PI * 2);
      ctx.setLineDash([8, 14]);
      ctx.lineDashOffset = -ring.rotation * 40;
      ctx.strokeStyle = rgba(colors[ring.color], baseAlpha * fade);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawLinks(offsetX, offsetY) {
    var colors = palette();
    var maxDistance = CONFIG.linkDistance;

    ctx.lineWidth = 1;

    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      var ax = a.x * width + offsetX * a.depth;
      var ay = a.y * height + offsetY * a.depth;

      for (var j = i + 1; j < nodes.length; j++) {
        var b = nodes[j];
        var bx = b.x * width + offsetX * b.depth;
        var by = b.y * height + offsetY * b.depth;

        var dx = bx - ax;
        var dy = by - ay;
        var distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > maxDistance) continue;

        var proximity = 1 - distance / maxDistance;
        var alpha = proximity * 0.36 * (0.35 + Math.min(a.depth, b.depth) * 0.65);

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = rgba(colors[0], alpha);
        ctx.stroke();
      }
    }
  }

  function drawPointerLinks(offsetX, offsetY) {
    if (!pointer.hasMoved) return;

    var colors = palette();
    var maxDistance = CONFIG.pointerLinkDistance;
    var px = pointer.x - offsetX * 0.6;
    var py = pointer.y - offsetY * 0.6;

    ctx.lineWidth = 1;

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var nx = node.x * width + offsetX * node.depth;
      var ny = node.y * height + offsetY * node.depth;

      var dx = nx - px;
      var dy = ny - py;
      var distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > maxDistance) continue;

      var proximity = 1 - distance / maxDistance;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = rgba(colors[2], proximity * 0.3);
      ctx.stroke();
    }
  }

  function drawShape(shape, offsetX, offsetY) {
    var colors = palette();
    var scale = Math.min(width, height);
    var radius = shape.radius * scale;
    var cx = shape.x * width + offsetX * shape.depth;
    var cy = shape.y * height + offsetY * shape.depth;
    var stroke = colors[shape.color];
    // Nearer polygons are larger *and* more opaque; the far ones recede into
    // the background instead of forming a busy, uniform texture.
    var alpha = 0.2 + 0.38 * shape.depth;
    var step = (Math.PI * 2) / shape.sides;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(shape.rotation);

    ctx.beginPath();
    for (var i = 0; i < shape.sides; i++) {
      var angle = i * step;
      var px = Math.cos(angle) * radius;
      var py = Math.sin(angle) * radius;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    ctx.strokeStyle = rgba(stroke, alpha);
    ctx.lineWidth = 1 + shape.depth * 0.9;
    ctx.stroke();

    // Vertex dots make the polygons read as constructed geometry rather than
    // as floating shapes.
    ctx.fillStyle = rgba(stroke, alpha * 2.1);
    for (var v = 0; v < shape.sides; v++) {
      var va = v * step;
      ctx.beginPath();
      ctx.arc(Math.cos(va) * radius, Math.sin(va) * radius, 1.1 + shape.depth, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawNodes(offsetX, offsetY) {
    var colors = palette();

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var x = node.x * width + offsetX * node.depth;
      var y = node.y * height + offsetY * node.depth;

      ctx.beginPath();
      ctx.arc(x, y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = rgba(colors[1], 0.2 + node.depth * 0.42);
      ctx.fill();
    }
  }

  function render() {
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    var offsetX = view.x;
    var offsetY = view.y;

    drawBackdrop();
    drawRings(offsetX, offsetY);
    drawLinks(offsetX, offsetY);
    drawPointerLinks(offsetX, offsetY);

    // Painter's algorithm: farthest polygons first so nearer ones overlap them.
    var ordered = shapes.slice().sort(function (a, b) {
      return a.depth - b.depth;
    });

    for (var i = 0; i < ordered.length; i++) {
      drawShape(ordered[i], offsetX, offsetY);
    }

    drawNodes(offsetX, offsetY);
  }

  /* ------------------------------------------------------------------ *
   * Loop
   * ------------------------------------------------------------------ */

  function stop() {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  function start() {
    if (frameId !== null) return;

    lastTime = 0;
    frameId = window.requestAnimationFrame(tick);
  }

  function tick(now) {
    frameId = window.requestAnimationFrame(tick);

    // Skip the first delta so a long pause (hidden tab) never produces a jump.
    if (!lastTime) {
      lastTime = now;
      render();
      return;
    }

    // Cap the step so returning to a backgrounded tab never teleports entities.
    var dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    advance(dt);
    render();
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  function onPointerMove(event) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.hasMoved = true;
    view.targetX = (event.clientX - width / 2) / (width / 2) * -(CONFIG.parallax / 2);
    view.targetY = (event.clientY - height / 2) / (height / 2) * -(CONFIG.parallax / 2);
  }

  function onPointerLeave() {
    view.targetX = 0;
    view.targetY = 0;
  }

  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      measure();
      render();
    }, 150);
  }

  function onVisibilityChange() {
    if (document.hidden) stop();
    else if (!prefersReducedMotion()) start();
  }

  function bind() {
    if (window.matchMedia === 'function') {
      var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onMotionChange = function () {
        if (prefersReducedMotion()) {
          stop();
          render();
        } else {
          start();
        }
      };

      if (typeof motionQuery.addEventListener === 'function') {
        motionQuery.addEventListener('change', onMotionChange);
      } else if (typeof motionQuery.addListener === 'function') {
        motionQuery.addListener(onMotionChange);
      }
    }

    // The dark-mode switch rewrites `data-theme`, so re-render with the new
    // palette instead of waiting for the next animation frame.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        mode = readMode();
        render();
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      });
    }

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', function () {
      if (!prefersReducedMotion()) start();
    });
  }

  /* ------------------------------------------------------------------ *
   * Bootstrap
   * ------------------------------------------------------------------ */

  function init() {
    if (!createCanvas()) return;

    mode = readMode();
    measure();
    seed();
    bind();

    if (prefersReducedMotion()) {
      render();
    } else {
      start();
    }
  }

  function boot() {
    if (!document.body) return;
    try {
      init();
    } catch (error) {
      // A decorative layer must never take the page down with it.
      if (window.console && console.warn) console.warn('[geometric-bg] disabled:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
