/* The paper, stirred.

   The page's paper hides a fine field of the mark's diamonds. At rest
   it is bare. The cursor moves through it like a finger drawn through a
   bowl of water: only while it moves does it push, and the diamonds
   come up where the surface bends, the way light catches on ripples, so
   the wake shows as fine rings running out and fading rather than as a
   patch. The words float above it; nothing is kept out. When the cursor
   stops, the water settles of its own accord and the paper is bare
   again.

   The water is the one on aniketh.net (assets/js/surface.js): a damped
   wave equation on a bed of springs, worked out on a fine grid at a
   fixed step, pressed by the cursor. A diamond sits on every other
   point of that grid, its size and strength set mostly by the slope of
   the water beneath it and a little by its depth. It sleeps when
   nothing moves, and draws nothing for anyone who has asked for less
   motion. */

'use strict';

(function () {
  /* ---------- Tuning ----------
     Distances are in CSS pixels, times in seconds. */

  var CELL = 12;             // the water's grid
  var MAX_CELLS = 20000;     // past this many, the grid grows coarser instead
  var STRIDE = 2;            // a diamond on every this many points of the grid, each way

  var HALF = 0.55;           // half a diamond's width as it first shows
  var SWELL = 3.2;           // and at its fullest
  var PEAK = 0.36;           // its strength at its fullest
  var CURVE = 1.15;          // strength goes as the light to this power, so the faint stays faint
  var LEVELS = 32;           // steps of size and strength, so diamonds are filled in batches

  var PAD = 3;               // cells worked out beyond each edge of the window
  var STEP = 1 / 60;         // the fixed step, whatever the screen's refresh rate
  var MAX_STEPS = 3;         // steps one frame may catch up before time is let go
  var SPEED = 260;           // how fast a ripple travels, px/s
  var SPRING = 3;            // the pull back to level, so nothing is left standing, rad/s
  var DAMPING = 5;           // drag on all motion, 1/s
  var VISCOSITY = 170;       // further drag on fine ripples, px²/s
  var SPONGE = 30;           // extra drag past the window's edges, so nothing echoes back

  var RADIUS = 44;           // the spread of the cursor's pressure (sigma)
  var WAKE = 2.4;            // how hard the cursor pushes the water at full speed
  var WAKE_SPEED = 1400;     // the speed that counts as full speed, px/s
  var PRESS = 1.6;           // how much harder a held button or a finger pushes
  var PUSH = 60;             // the push, as an acceleration of the surface
  var BOW = 0.7;             // the water heaped up ahead, against the hollow left behind
  var LEAD = 0.6;            // how far ahead and behind those sit, in spreads

  var GLOW = 0.5;            // how much the water's depth raises a diamond
  var SHEEN = 7;             // and how much its slope does, as light caught on a ripple
  var BEND = 8;              // how far a slope shifts a diamond, px per unit of slope
  var MAX_BEND = 0.12;       // at most, as a share of the space between diamonds
  var FAINT = 0.1;           // light under this shows nothing, so only the ripples come up
  var STILL = 0.004;         // under this speed everywhere, the water counts as still
  var STILL_STEPS = 12;      // for this many steps running, before it sleeps

  if (!window.requestAnimationFrame || !window.Float32Array) return;
  var calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var still = !!(calm && calm.matches);

  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  var listen = function (mq, fn) {
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  };
  var passive = { passive: true };

  var ink = '#1a1712';
  function tint() { ink = getComputedStyle(document.body).color; }

  /* ---------- The grid ----------
     cols by rows cells cover the window; the water beneath them, W by
     H, has PAD more on every side, the outermost ring held at rest. */

  var cols = 0, rows = 0, W = 0, H = 0, N = 0, cellX = CELL, cellY = CELL, cell = CELL;
  var dpr = 1, pitch = CELL * STRIDE;
  var h, v, vn, drag;
  var subs = 1, dt = STEP, C2 = 0, K = SPRING * SPRING, NU = 0;
  var spread = 1, reach = 1, weights = null;

  /* The diamonds: where each sits, and the water cell beneath it. */
  var count = 0, dotX, dotY, dotAt;
  var lists = [];
  for (var q = 0; q < LEVELS; q++) lists.push([]);

  function measure() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var ratio = Math.min(window.devicePixelRatio || 1, 3);
    var size = Math.max(CELL, Math.sqrt(r.width * r.height / MAX_CELLS));
    var c = Math.max(4, Math.round(r.width / size));
    var n = Math.max(4, Math.round(r.height / size));
    var bw = Math.round(r.width * ratio), bh = Math.round(r.height * ratio);
    if (c === cols && n === rows && ratio === dpr && bw === canvas.width && bh === canvas.height) return;
    dpr = ratio;
    cellX = r.width / c; cellY = r.height / n; cell = (cellX + cellY) / 2;
    pitch = cell * STRIDE;
    canvas.width = bw; canvas.height = bh;
    build(c, n);
    if (raf) draw(); else blank();
  }

  function build(c, n) {
    cols = c; rows = n;
    W = cols + 2 * PAD; H = rows + 2 * PAD; N = W * H;

    h = new Float32Array(N); v = new Float32Array(N); vn = new Float32Array(N);
    drag = new Float32Array(N);
    var x, y;
    for (y = 0; y < H; y++) {
      var ey = y < PAD ? (PAD - y) / PAD : y >= H - PAD ? (y - (H - PAD - 1)) / PAD : 0;
      for (x = 0; x < W; x++) {
        var ex = x < PAD ? (PAD - x) / PAD : x >= W - PAD ? (x - (W - PAD - 1)) / PAD : 0;
        var e = Math.max(ex, ey);
        drag[y * W + x] = DAMPING + SPONGE * e * e;
      }
    }

    /* The constants in cells, and as many substeps a step as it takes
       to keep the fastest ripple the grid can hold stable. */
    C2 = (SPEED / cell) * (SPEED / cell);
    NU = VISCOSITY / (cell * cell);
    var omega2 = 8 * C2 + K, beta = DAMPING + SPONGE + 8 * NU;
    for (subs = 1; subs < 8; subs++) {
      dt = STEP / subs;
      if (beta * dt < 1 && omega2 * dt * dt < 0.7 * (4 - 2 * beta * dt)) break;
    }
    spread = RADIUS / cell;
    reach = Math.ceil(spread * 3);
    weights = new Float32Array(2 * reach + 3);
    quiet = 0;

    /* A diamond on every STRIDE-th point each way, the first half a
       stride in from the corner. */
    var start = STRIDE >> 1, across = Math.ceil((cols - start) / STRIDE), down = Math.ceil((rows - start) / STRIDE);
    count = across * down;
    dotX = new Float32Array(count); dotY = new Float32Array(count);
    dotAt = new Int32Array(count);
    var d = 0;
    for (y = start; y < rows; y += STRIDE) {
      for (x = start; x < cols; x += STRIDE, d++) {
        dotX[d] = (x + 0.5) * cellX;
        dotY[d] = (y + 0.5) * cellY;
        dotAt[d] = (y + PAD) * W + x + PAD;
      }
    }
  }

  /* ---------- The cursor ---------- */

  var pointer = { x: 0, y: 0, on: false, down: false };
  var was = false, fromX = 0, fromY = 0, lastX = 0, lastY = 0;
  var speed = 0, force = 0, dirX = 1, dirY = 0;
  var SMOOTH = 1 - Math.exp(-STEP / 0.06);

  /* Press the water at (cx, cy), in cells, with a Gaussian of pressure. */
  function press(cx, cy, amount) {
    var x0 = Math.max(1, Math.ceil(cx - reach)), x1 = Math.min(W - 2, Math.floor(cx + reach));
    var y0 = Math.max(1, Math.ceil(cy - reach)), y1 = Math.min(H - 2, Math.floor(cy + reach));
    var k = 1 / (2 * spread * spread), x, y, d;
    for (x = x0; x <= x1; x++) { d = x - cx; weights[x - x0] = Math.exp(-d * d * k); }
    for (y = y0; y <= y1; y++) {
      d = y - cy;
      var wy = Math.exp(-d * d * k) * amount;
      if (wy < 1e-6) continue;
      var i = y * W + x0;
      for (x = x0; x <= x1; x++, i++) vn[i] -= wy * weights[x - x0];
    }
  }

  /* ---------- The step ---------- */

  var quiet = 0;

  function step() {
    /* Like a finger drawn through water, the cursor only pushes while
       it moves, as hard as it is fast (harder held down); stopped, it
       leaves the water to settle. */
    var aim = 0, toX = fromX, toY = fromY;
    if (pointer.on) {
      toX = PAD + pointer.x / cellX - 0.5;
      toY = PAD + pointer.y / cellY - 0.5;
      if (!was) { lastX = pointer.x; lastY = pointer.y; fromX = toX; fromY = toY; speed = 0; }
      var dx = pointer.x - lastX, dy = pointer.y - lastY;
      lastX = pointer.x; lastY = pointer.y;
      speed += (Math.sqrt(dx * dx + dy * dy) / STEP - speed) * SMOOTH;
      if (speed < 1) speed = 0;
      aim = WAKE * Math.min(1, speed / WAKE_SPEED) * (pointer.down ? PRESS : 1);
    } else {
      speed = 0;
    }
    /* Which way it is heading, smoothed, for the water it heaps ahead. */
    var mx = toX - fromX, my = toY - fromY, ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1e-3) {
      dirX += (mx / ml - dirX) * 0.4; dirY += (my / ml - dirY) * 0.4;
      var dl = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
      dirX /= dl; dirY /= dl;
    }
    var moving = was !== pointer.on || toX !== fromX || toY !== fromY;
    was = pointer.on;
    var before = force;
    force = aim;
    if (force !== before) moving = true;

    var y, x, i, a, hc, vc, peak = 0;
    for (var s = 1; s <= subs; s++) {
      /* Each cell's acceleration: the pull of its neighbours (the
         wave), the spring back to rest, drag, and a viscous drag that
         smooths away the finest ripples. */
      for (y = 1; y < H - 1; y++) {
        i = y * W + 1;
        for (x = 1; x < W - 1; x++, i++) {
          hc = h[i]; vc = v[i];
          a = C2 * (h[i - 1] + h[i + 1] + h[i - W] + h[i + W] - 4 * hc) +
              NU * (v[i - 1] + v[i + 1] + v[i - W] + v[i + W] - 4 * vc) -
              K * hc - drag[i] * vc;
          vn[i] = vc + a * dt;
        }
      }
      /* A finger drawn through water leaves a hollow behind it and
         heaps the water up ahead. */
      if (force > 0 || before > 0) {
        var f = s / subs;
        var p = (before + (force - before) * f) * PUSH * dt;
        if (p > 0) {
          var px = fromX + (toX - fromX) * f, py = fromY + (toY - fromY) * f, lead = spread * LEAD;
          press(px - dirX * lead, py - dirY * lead, p);
          press(px + dirX * lead, py + dirY * lead, -p * BOW);
        }
      }
      var last = s === subs;
      for (y = 1; y < H - 1; y++) {
        i = y * W + 1;
        for (x = 1; x < W - 1; x++, i++) {
          vc = vn[i];
          h[i] += vc * dt;
          if (last) { if (vc > peak) peak = vc; else if (-vc > peak) peak = -vc; }
        }
      }
      var t = v; v = vn; vn = t;
    }
    fromX = toX; fromY = toY;
    quiet = !moving && peak < STILL ? quiet + 1 : 0;
  }

  /* ---------- Drawing ----------
     Seen through the water: a diamond comes up where the surface bends,
     swells with it, and leans a little with the slope. Diamonds of one
     size are gathered into one shape and filled at once. */

  function blank() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function draw() {
    blank();
    if (!count) return;
    var top = LEVELS - 1, most = MAX_BEND * pitch, any = false, q;
    for (q = 1; q < LEVELS; q++) lists[q].length = 0;
    for (var d = 0; d < count; d++) {
      var i = dotAt[d];
      var gx = (h[i + 1] - h[i - 1]) * 0.5, gy = (h[i + W] - h[i - W]) * 0.5;
      var hc = h[i] < 0 ? -h[i] : h[i];
      var e = Math.sqrt(gx * gx + gy * gy) * SHEEN + hc * GLOW - FAINT;
      if (e <= 0.002) continue;
      var l = Math.round(top * Math.pow(1 - Math.exp(-e), CURVE));
      if (!l) continue;
      var ox = -gx * BEND, oy = -gy * BEND;
      ox = ox > most ? most : ox < -most ? -most : ox;
      oy = oy > most ? most : oy < -most ? -most : oy;
      lists[l].push(dotX[d] + ox, dotY[d] + oy);
      any = true;
    }
    if (!any) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = ink;
    for (q = 1; q < LEVELS; q++) {
      var list = lists[q];
      if (!list.length) continue;
      var r = HALF + (SWELL - HALF) * q / top;
      ctx.globalAlpha = PEAK * q / top;
      ctx.beginPath();
      for (var k = 0; k < list.length; k += 2) {
        var x = list[k], y = list[k + 1];
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- The loop ----------
     Steps are a fixed sixtieth of a second, as many as the time since
     the last frame calls for. Still water is cleared away and left. */

  var raf = 0, then = 0, spare = 0;

  function wake() {
    if (still || raf || document.hidden || !N) return;
    quiet = 0;
    then = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    var t = (now - then) / 1000;
    then = now;
    t = t < 0 ? 0 : t > 0.1 ? 0.1 : t;
    spare += t;
    if (spare > MAX_STEPS * STEP) spare = MAX_STEPS * STEP;
    while (spare >= STEP) { step(); spare -= STEP; }
    if (quiet >= STILL_STEPS) { blank(); return; }
    draw();
    raf = requestAnimationFrame(frame);
  }

  /* ---------- Listening ---------- */

  function release() { pointer.on = false; pointer.down = false; wake(); }

  document.addEventListener('pointermove', function (e) {
    if (!e.isPrimary || (e.pointerType === 'touch' && !pointer.down)) return;
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.on = true;
    wake();
  }, passive);

  /* A finger is always a press; a mouse presses with its main button. */
  document.addEventListener('pointerdown', function (e) {
    if (!e.isPrimary) return;
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.down = e.pointerType === 'touch' || e.button === 0;
    pointer.on = true;
    wake();
  }, passive);

  var lift = function (e) {
    if (!e.isPrimary) return;
    if (e.pointerType === 'touch') release();
    else { pointer.down = false; wake(); }
  };
  document.addEventListener('pointerup', lift, passive);
  document.addEventListener('pointercancel', lift, passive);

  /* Off the edge of the window, the water is let go. */
  document.addEventListener('pointerout', function (e) {
    if (!e.relatedTarget && e.pointerType !== 'touch') release();
  }, passive);
  window.addEventListener('blur', release);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { wake(); return; }
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  });

  var sizing = 0;
  var resize = function () {
    if (!sizing) sizing = requestAnimationFrame(function () { sizing = 0; measure(); });
  };
  window.addEventListener('resize', resize, passive);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

  listen(window.matchMedia('(prefers-color-scheme: dark)'), function () { tint(); if (raf) draw(); });

  /* Asking for less motion part way through clears the water away. */
  if (calm) listen(calm, function () {
    still = calm.matches;
    if (!still) return;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pointer.on = false;
    blank();
  });

  /* ---------- Start ---------- */

  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:0;display:block;width:100%;' +
    'height:100vh;height:100lvh;pointer-events:none;margin:0;padding:0;border:0';
  document.body.appendChild(canvas);
  tint();
  measure();
})();
