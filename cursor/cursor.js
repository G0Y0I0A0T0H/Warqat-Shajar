/**
 * cursor.js -- Premium leaf cursor system
 *
 * Self-contained, dependency-free. Include after <body> (or with `defer`):
 *   <link rel="stylesheet" href="cursor/cursor.css">
 *   <script src="cursor/cursor.js" defer></script>
 *
 * Disables itself entirely on touch devices and does the minimum necessary
 * when `prefers-reduced-motion` is set (keeps a static cursor, drops the
 * trail/particles/wind ribbon).
 */
(function () {
  "use strict";

  // -------------------------------------------------------------------
  // Environment guards
  // -------------------------------------------------------------------
  var isTouch = matchMedia("(hover: none), (pointer: coarse)").matches;
  if (isTouch) return; // native cursor stays untouched on touch devices

  var reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Resolve cursor.svg relative to this script's own location so the
  // component works regardless of which page/folder depth includes it.
  var scriptEl = document.currentScript;
  var baseUrl = scriptEl ? scriptEl.src.replace(/[^/]*$/, "") : "";

  // -------------------------------------------------------------------
  // Tunables
  // -------------------------------------------------------------------
  var LERP = 0.2; // cursor position easing factor
  var TRAIL_POOL_SIZE = 36;
  var PARTICLE_POOL_SIZE = 26;
  var WIND_POOL_SIZE = 5;
  var TRAIL_SPAWN_PX = 16; // spawn a leaf every N px of cursor travel
  var TRAIL_SPAWN_PX_DOWN = 7; // denser trail while mouse is held down
  var PARTICLE_CHANCE = 0.35; // odds of a particle alongside a leaf
  var WIND_MIN_SPEED = 5.5; // px/frame before a wind ribbon can spawn
  var WIND_COOLDOWN_MS = 140;
  var GRAVITY = 0.0009; // px per ms^2, applied to trail leaves

  var STATE_GLYPH = {
    default: "leaf-default",
    link: "leaf-default",
    text: "leaf-text",
    grab: "leaf-grab",
    grabbing: "leaf-grabbing",
    move: "leaf-move",
    "zoom-in": "leaf-zoom-in",
    "zoom-out": "leaf-zoom-out",
    "not-allowed": "leaf-not-allowed",
    wait: "leaf-wait",
    help: "leaf-help",
    precision: "leaf-precision",
    "resize-h": "leaf-resize",
    "resize-v": "leaf-resize",
    "resize-nesw": "leaf-resize",
    "resize-nwse": "leaf-resize",
  };

  var CSS_CURSOR_TO_STATE = {
    pointer: "link",
    text: "text",
    grab: "grab",
    grabbing: "grabbing",
    move: "move",
    "zoom-in": "zoom-in",
    "zoom-out": "zoom-out",
    "not-allowed": "not-allowed",
    wait: "wait",
    progress: "wait",
    help: "help",
    crosshair: "precision",
    "ew-resize": "resize-h",
    "col-resize": "resize-h",
    "e-resize": "resize-h",
    "w-resize": "resize-h",
    "ns-resize": "resize-v",
    "row-resize": "resize-v",
    "n-resize": "resize-v",
    "s-resize": "resize-v",
    "nesw-resize": "resize-nesw",
    "ne-resize": "resize-nesw",
    "sw-resize": "resize-nesw",
    "nwse-resize": "resize-nwse",
    "nw-resize": "resize-nwse",
    "se-resize": "resize-nwse",
  };

  var HEURISTIC_SELECTORS = [
    ["not-allowed", "[disabled], .is-disabled, [aria-disabled='true']"],
    ["text", "input:not([type]), input[type='text'], input[type='email'], input[type='search'], input[type='password'], input[type='tel'], input[type='number'], input[type='url'], textarea, [contenteditable='true']"],
    ["link", "a[href], button, [role='button'], input[type='submit'], input[type='button'], input[type='reset'], select, label, summary"],
    ["grab", "[draggable='true']"],
  ];

  // -------------------------------------------------------------------
  // Build DOM
  // -------------------------------------------------------------------
  var layer, mainSvg, useEl, trailPool = [], particlePool = [], windPool = [];

  function buildDom() {
    layer = document.createElement("div");
    layer.className = "leaf-cursor-layer";
    layer.dataset.state = "default";

    // Wind ribbons (bottom layer)
    var windSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    windSvg.setAttribute("class", "leaf-wind-layer");
    for (var w = 0; w < WIND_POOL_SIZE; w++) {
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "wind-ribbon-path");
      windSvg.appendChild(path);
      windPool.push({ el: path, anim: null });
    }
    layer.appendChild(windSvg);

    // Particles
    for (var p = 0; p < PARTICLE_POOL_SIZE; p++) {
      var pEl = document.createElement("div");
      pEl.className = "leaf-particle";
      layer.appendChild(pEl);
      particlePool.push(makeParticle(pEl));
    }

    // Trail leaves
    for (var t = 0; t < TRAIL_POOL_SIZE; t++) {
      var tSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      tSvg.setAttribute("class", "leaf-trail-item");
      tSvg.setAttribute("viewBox", "0 0 40 40");
      var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#leaf-trail-item");
      tSvg.appendChild(use);
      layer.appendChild(tSvg);
      trailPool.push(makeLeaf(tSvg));
    }

    // Main cursor (top layer)
    mainSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    mainSvg.setAttribute("class", "leaf-cursor-main");
    mainSvg.setAttribute("viewBox", "0 0 40 40");
    useEl = document.createElementNS("http://www.w3.org/2000/svg", "use");
    useEl.setAttribute("class", "leaf-cursor-use");
    useEl.setAttribute("href", "#leaf-default");
    mainSvg.appendChild(useEl);
    layer.appendChild(mainSvg);

    document.body.appendChild(layer);
  }

  function makeLeaf(el) {
    return {
      el: el, active: false, x: 0, y: 0, vx: 0, vy: 0,
      rotation: 0, rotSpeed: 0, scale: 1, baseOpacity: 1,
      life: 0, maxLife: 1000, swayPhase: 0, swaySpeed: 0, swayAmp: 0,
    };
  }
  function makeParticle(el) {
    return {
      el: el, active: false, x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 800, baseOpacity: 1, twinklePhase: 0, twinkleSpeed: 0,
    };
  }

  // -------------------------------------------------------------------
  // State tracking
  // -------------------------------------------------------------------
  var mouseX = -100, mouseY = -100;
  var cursorX = -100, cursorY = -100;
  var lastX = cursorX, lastY = cursorY;
  var currentState = "default";
  var isDown = false;
  var distanceAccum = 0;
  var lastWindSpawn = 0;
  var windHistory = [];
  var WIND_HISTORY_LEN = 6;
  var lastFrameTime = 0;
  var pendingTarget = null;
  var lastDetectedTarget = null;

  function detectState(target) {
    var node = target;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var cs = window.getComputedStyle(node).cursor;
      if (cs && CSS_CURSOR_TO_STATE[cs]) return CSS_CURSOR_TO_STATE[cs];
      if (cs === "default") break;
      node = node.parentElement;
    }
    if (target && target.closest) {
      for (var i = 0; i < HEURISTIC_SELECTORS.length; i++) {
        var pair = HEURISTIC_SELECTORS[i];
        if (target.closest(pair[1])) return pair[0];
      }
    }
    return "default";
  }

  function setState(state) {
    if (state === currentState) return;
    currentState = state;
    layer.dataset.state = state;
    useEl.setAttribute("href", "#" + (STATE_GLYPH[state] || "leaf-default"));
  }

  // -------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------
  function findFree(pool) {
    for (var i = 0; i < pool.length; i++) {
      if (!pool[i].active) return pool[i];
    }
    // Pool exhausted: recycle whichever item has the least life remaining
    // rather than growing the pool or touching the DOM.
    var oldest = pool[0];
    var oldestRatio = -1;
    for (var j = 0; j < pool.length; j++) {
      var ratio = pool[j].life / pool[j].maxLife;
      if (ratio > oldestRatio) { oldestRatio = ratio; oldest = pool[j]; }
    }
    return oldest;
  }

  function spawnLeaf(x, y, dirX, dirY) {
    var item = findFree(trailPool);
    var speed = 0.02 + Math.random() * 0.05;
    item.active = true;
    item.x = x + (Math.random() - 0.5) * 8;
    item.y = y + (Math.random() - 0.5) * 8;
    item.vx = -dirX * speed + (Math.random() - 0.5) * 0.06;
    item.vy = -dirY * speed + (Math.random() - 0.5) * 0.06;
    item.rotation = Math.random() * 360;
    item.rotSpeed = (Math.random() - 0.5) * 0.09;
    item.scale = 0.55 + Math.random() * 0.75;
    item.baseOpacity = 0.55 + Math.random() * 0.35;
    item.life = 0;
    item.maxLife = 900 + Math.random() * 900;
    item.swayPhase = Math.random() * Math.PI * 2;
    item.swaySpeed = 0.0025 + Math.random() * 0.0025;
    item.swayAmp = 4 + Math.random() * 7;
  }

  function burstLeaves(x, y, count) {
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      spawnLeaf(x, y, Math.cos(angle) * -1, Math.sin(angle) * -1);
    }
  }

  function spawnParticle(x, y) {
    var item = findFree(particlePool);
    item.active = true;
    item.x = x + (Math.random() - 0.5) * 14;
    item.y = y + (Math.random() - 0.5) * 14;
    item.vx = (Math.random() - 0.5) * 0.03;
    item.vy = -0.02 - Math.random() * 0.03;
    item.life = 0;
    item.maxLife = 500 + Math.random() * 700;
    item.baseOpacity = 0.35 + Math.random() * 0.45;
    item.twinklePhase = Math.random() * Math.PI * 2;
    item.twinkleSpeed = 0.006 + Math.random() * 0.008;
  }

  function spawnWind(now) {
    if (now - lastWindSpawn < WIND_COOLDOWN_MS) return;
    if (windHistory.length < WIND_HISTORY_LEN) return;
    lastWindSpawn = now;

    var slot = null;
    for (var i = 0; i < windPool.length; i++) {
      if (!windPool[i].anim || windPool[i].anim.playState === "finished") { slot = windPool[i]; break; }
    }
    if (!slot) slot = windPool[0];

    var p0 = windHistory[0];
    var p1 = windHistory[windHistory.length - 1];
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    var len = Math.hypot(dx, dy) || 1;
    var perpX = -dy / len, perpY = dx / len;
    var curvature = (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 16);
    var midX = (p0.x + p1.x) / 2 + perpX * curvature;
    var midY = (p0.y + p1.y) / 2 + perpY * curvature;

    slot.el.setAttribute(
      "d",
      "M" + p0.x + "," + p0.y + " Q" + midX + "," + midY + " " + p1.x + "," + p1.y
    );

    if (slot.anim) slot.anim.cancel();
    slot.anim = slot.el.animate(
      [{ opacity: 0.6 }, { opacity: 0.35, offset: 0.3 }, { opacity: 0 }],
      { duration: 500, easing: "ease-out" }
    );
  }

  // -------------------------------------------------------------------
  // Per-frame updates
  // -------------------------------------------------------------------
  function updateTrail(dt) {
    for (var i = 0; i < trailPool.length; i++) {
      var it = trailPool[i];
      if (!it.active) continue;
      it.life += dt;
      var t = it.life / it.maxLife;
      if (t >= 1) { it.active = false; it.el.style.opacity = 0; continue; }

      it.vy += GRAVITY * dt;
      it.x += (it.vx * dt);
      it.y += (it.vy * dt);
      it.rotation += it.rotSpeed * dt;

      var sway = Math.sin(it.life * it.swaySpeed + it.swayPhase) * it.swayAmp;

      var scaleNow = it.scale;
      if (t < 0.12) scaleNow *= t / 0.12;
      else if (t > 0.75) scaleNow *= 1 - ((t - 0.75) / 0.25) * 0.45;

      var opacityNow = it.baseOpacity;
      if (t < 0.12) opacityNow *= t / 0.12;
      else if (t > 0.65) opacityNow *= Math.max(0, 1 - (t - 0.65) / 0.35);

      it.el.style.transform =
        "translate3d(" + (it.x + sway) + "px," + it.y + "px,0) rotate(" + it.rotation + "deg) scale(" + scaleNow + ")";
      it.el.style.opacity = opacityNow;
    }
  }

  function updateParticles(dt) {
    for (var i = 0; i < particlePool.length; i++) {
      var it = particlePool[i];
      if (!it.active) continue;
      it.life += dt;
      var t = it.life / it.maxLife;
      if (t >= 1) { it.active = false; it.el.style.opacity = 0; continue; }

      it.x += it.vx * dt;
      it.y += it.vy * dt;

      var twinkle = 0.5 + 0.5 * Math.sin(it.life * it.twinkleSpeed + it.twinklePhase);
      var fade = t < 0.15 ? t / 0.15 : t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;

      it.el.style.transform = "translate3d(" + it.x + "px," + it.y + "px,0)";
      it.el.style.opacity = it.baseOpacity * twinkle * fade;
    }
  }

  // -------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------
  function tick(now) {
    if (!lastFrameTime) lastFrameTime = now;
    var dt = Math.min(now - lastFrameTime, 48); // clamp to avoid huge jumps on tab-back
    lastFrameTime = now;

    cursorX += (mouseX - cursorX) * LERP;
    cursorY += (mouseY - cursorY) * LERP;
    mainSvg.style.transform = "translate3d(" + (cursorX - 8) + "px," + (cursorY - 6) + "px,0)";

    var dx = cursorX - lastX, dy = cursorY - lastY;
    var speed = Math.hypot(dx, dy);
    lastX = cursorX; lastY = cursorY;

    if (!reducedMotion) {
      windHistory.push({ x: cursorX, y: cursorY });
      if (windHistory.length > WIND_HISTORY_LEN) windHistory.shift();

      distanceAccum += speed;
      var spawnInterval = isDown ? TRAIL_SPAWN_PX_DOWN : TRAIL_SPAWN_PX;
      var dirX = dx / (speed || 1), dirY = dy / (speed || 1);
      while (distanceAccum > spawnInterval) {
        distanceAccum -= spawnInterval;
        spawnLeaf(cursorX, cursorY, dirX, dirY);
        if (Math.random() < PARTICLE_CHANCE) spawnParticle(cursorX, cursorY);
      }

      if (speed > WIND_MIN_SPEED) spawnWind(now);

      updateTrail(dt);
      updateParticles(dt);
    }

    // detectState() walks the DOM calling getComputedStyle() at each
    // ancestor -- forces a synchronous style recalc. Used to run inline in
    // onPointerMove on every raw pointer event (which can fire far faster
    // than the display refresh rate on a high-poll-rate mouse/trackpad),
    // effectively thrashing layout on every pixel of movement over content.
    // Deferred here to run at most once per animation frame, and only when
    // the hovered element actually changed, not on every frame regardless.
    if (pendingTarget !== lastDetectedTarget) {
      lastDetectedTarget = pendingTarget;
      setState(detectState(pendingTarget));
    }

    requestAnimationFrame(tick);
  }

  // -------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------
  function onPointerMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    pendingTarget = e.target;
  }

  function onPointerDown(e) {
    isDown = true;
    layer.classList.add("is-down");
    if (!reducedMotion) burstLeaves(e.clientX, e.clientY, 10);
  }

  function onPointerUp() {
    isDown = false;
    layer.classList.remove("is-down");
  }

  function onLeaveWindow() {
    mainSvg.style.opacity = "0";
  }
  function onEnterWindow() {
    mainSvg.style.opacity = "1";
  }

  function wireEvents() {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("mouseleave", onLeaveWindow);
    document.addEventListener("mouseenter", onEnterWindow);
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------
  function start(svgText) {
    // NOT display:none: <use> shape references tolerate a hidden ancestor
    // fine, but gradient/paint-server resolution (fill="url(#leafGrad)")
    // does not in some browsers -- it silently falls back to solid black
    // instead of the gradient. The sprite's own root <svg> already hides
    // itself safely via width:0;height:0;overflow:hidden (see cursor.svg),
    // which every element inside stays visually invisible through without
    // breaking gradient lookups.
    var spriteHost = document.createElement("div");
    spriteHost.innerHTML = svgText;
    document.body.appendChild(spriteHost);

    buildDom();
    wireEvents();
    document.documentElement.classList.add("leaf-cursor-active");
    requestAnimationFrame(tick);
  }

  function boot() {
    fetch(baseUrl + "cursor.svg")
      .then(function (res) {
        if (!res.ok) throw new Error("cursor.svg fetch failed: " + res.status);
        return res.text();
      })
      .then(start)
      .catch(function (err) {
        // Fail safe: leave the native cursor completely alone.
        console.warn("[leaf-cursor] disabled:", err.message);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
