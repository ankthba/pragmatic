/* The paper, stirred.

   The page's paper hides a fine field of the mark's diamonds, and the
   water under it is never quite still. Left alone, it plays by itself:
   a drop here and there, a short patter of rain, two drops at once
   whose rings cross, or an unseen finger drawn slowly through it. The
   cursor moves through the same water like a finger drawn through a
   bowl: only while it moves does it push, and its wake runs into
   whatever rings are already out. While the cursor is in play the
   water's own weather quietens; a couple of seconds after it stops, the
   weather comes back.

   The diamonds come up where the surface bends, the way light catches
   on ripples, so every disturbance shows as fine rings running out and
   fading. The words float above it; nothing is kept out.

   The water is the one on aniketh.net (assets/js/surface.js): a damped
   wave equation on a bed of springs, worked out on a fine grid at a
   fixed step. A diamond sits on every other point of that grid, its
   size and strength set mostly by the slope of the water beneath it and
   a little by its depth. Between disturbances it rests until the next,
   it stops while the page is hidden, and for anyone who has asked for
   less motion it draws nothing at all. */

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
  var STILL_STEPS = 12;      // for this many steps running, before it rests

  /* The water's own weather, for when the cursor leaves it alone. */
  var FIRST = 0.9;           // the first drop, after the page opens
  var IDLE_AFTER = 2;        // seconds of a still cursor before the weather is back in full
  var EASE = 0.8;            // seconds for the weather to rise or quieten
  var IN_PLAY = 0.2;         // how much of it goes on while the cursor is moving
  var RATE = 0.9;            // things that happen a second, on a 1440 by 900 window
  var GAP = 0.45;            // and never sooner than this after the last
  var LULL = 3;              // and, left alone, never longer than this
  var EDGE = 0.08;           // the share of the window at each edge where nothing starts
  var DROP = 14;             // a drop's push
  var DROP_SPREAD = 26;      // and its width (sigma), px
  var PATTER = 4;            // drops in a patter of rain, give or take
  var PATTER_TIME = 1;       // spread over this long
  var PATTER_REACH = 150;    // and this far around, px
  var TWIN = 220;            // how far apart two drops fall together, px
  var GLIDE_TIME = 2.4;      // how long the unseen finger takes
  var GLIDE_LENGTH = 0.45;   // and how far it goes, as a share of the window's diagonal
  var GLIDE_PUSH = 0.7;      // and how hard it pushes, against the cursor
  var MIX = [0.45, 0.2, 0.15, 0.2]; // drop, patter, twin, glide

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
  var dropWeights = new Float32Array(2 * Math.ceil(4 * DROP_SPREAD / CELL) + 3);

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
    if (c !== cols || n !== rows || ratio !== dpr || bw !== canvas.width || bh !== canvas.height) {
      dpr = ratio;
      cellX = r.width / c; cellY = r.height / n; cell = (cellX + cellY) / 2;
      pitch = cell * STRIDE;
      canvas.width = bw; canvas.height = bh;
      shown = false;
      build(c, n);
      if (raf) draw();
    }
    wake();
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

  /* ---------- Stirring ----------
     The cursor and the unseen finger stir the water the same way. */

  function stirrer() {
    return { x: 0, y: 0, on: false, down: false, was: false, fromX: 0, fromY: 0, toX: 0, toY: 0,
      lastX: 0, lastY: 0, speed: 0, force: 0, before: 0, dirX: 1, dirY: 0 };
  }
  var pointer = stirrer(), ghost = stirrer();
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

  /* Where a stirrer goes this step and how hard it pushes: like a finger
     drawn through water, only while it moves, as hard as it is fast
     (harder held down). Returns whether anything about it changed. */
  function aim(s, gain) {
    var a = 0;
    s.toX = s.fromX; s.toY = s.fromY;
    if (s.on) {
      s.toX = PAD + s.x / cellX - 0.5;
      s.toY = PAD + s.y / cellY - 0.5;
      if (!s.was) { s.lastX = s.x; s.lastY = s.y; s.fromX = s.toX; s.fromY = s.toY; s.speed = 0; }
      var dx = s.x - s.lastX, dy = s.y - s.lastY;
      s.lastX = s.x; s.lastY = s.y;
      s.speed += (Math.sqrt(dx * dx + dy * dy) / STEP - s.speed) * SMOOTH;
      if (s.speed < 1) s.speed = 0;
      a = WAKE * Math.min(1, s.speed / WAKE_SPEED) * (s.down ? PRESS : 1) * gain;
    } else {
      s.speed = 0;
    }
    /* Which way it is heading, smoothed, for the water it heaps ahead. */
    var mx = s.toX - s.fromX, my = s.toY - s.fromY, ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1e-3) {
      s.dirX += (mx / ml - s.dirX) * 0.4; s.dirY += (my / ml - s.dirY) * 0.4;
      var dl = Math.sqrt(s.dirX * s.dirX + s.dirY * s.dirY) || 1;
      s.dirX /= dl; s.dirY /= dl;
    }
    var changed = s.was !== s.on || s.toX !== s.fromX || s.toY !== s.fromY;
    s.was = s.on;
    s.before = s.force;
    s.force = a;
    return changed || s.force !== s.before;
  }

  /* A finger drawn through water leaves a hollow behind it and heaps the
     water up ahead; f is how far through the step this substep falls. */
  function push(s, f) {
    if (!(s.force > 0 || s.before > 0)) return;
    var p = (s.before + (s.force - s.before) * f) * PUSH * dt;
    if (!(p > 0)) return;
    var px = s.fromX + (s.toX - s.fromX) * f, py = s.fromY + (s.toY - s.fromY) * f, lead = spread * LEAD;
    press(px - s.dirX * lead, py - s.dirY * lead, p);
    press(px + s.dirX * lead, py + s.dirY * lead, -p * BOW);
  }

  /* A drop: a sudden push down at (px, py), in window pixels, over a
     Gaussian of the given width. */
  function strike(px, py, width, amount) {
    var cx = PAD + px / cellX - 0.5, cy = PAD + py / cellY - 0.5;
    var s = Math.min(width, 1.3 * DROP_SPREAD) / cell, r = Math.ceil(s * 3), k = 1 / (2 * s * s);
    if (dropWeights.length < 2 * r + 3) dropWeights = new Float32Array(2 * r + 3);
    var x0 = Math.max(1, Math.ceil(cx - r)), x1 = Math.min(W - 2, Math.floor(cx + r));
    var y0 = Math.max(1, Math.ceil(cy - r)), y1 = Math.min(H - 2, Math.floor(cy + r));
    var x, y, d;
    for (x = x0; x <= x1; x++) { d = x - cx; dropWeights[x - x0] = Math.exp(-d * d * k); }
    for (y = y0; y <= y1; y++) {
      d = y - cy;
      var wy = Math.exp(-d * d * k) * amount;
      if (wy < 1e-6) continue;
      var i = y * W + x0;
      for (x = x0; x <= x1; x++, i++) v[i] -= wy * dropWeights[x - x0];
    }
  }

  /* ---------- The weather ----------
     Things happen at random, about RATE a second when the cursor has
     been still a while, and less while it is in play. */

  var clock = 0, weather = 1, stirredAt = -1e9, lastAt = 0, begun = false;
  var falling = [];          // drops still to fall: time, x, y, width, push
  var path = null;           // the unseen finger's way: when, how long, four points

  var vary = function (x) { return x * (2 / 3 + Math.random() * 2 / 3); };
  var wide = function () { return cols * cellX; };
  var tall = function () { return rows * cellY; };
  var area = function () { return Math.min(1.6, Math.max(0.5, wide() * tall() / (1440 * 900))); };

  /* Somewhere on the window, away from its edges. */
  function spot() {
    return [wide() * (EDGE + (1 - 2 * EDGE) * Math.random()), tall() * (EDGE + (1 - 2 * EDGE) * Math.random())];
  }

  function fall(at, x, y, width, amount) { falling.push([at, x, y, width, amount]); }

  /* The unseen finger: a slow arc from p to somewhere a fair way off,
     bowed to one side or into a gentle S. */
  function glide(p) {
    var want = vary(GLIDE_LENGTH) * Math.sqrt(wide() * wide() + tall() * tall());
    var q = spot(), miss = Infinity;
    for (var k = 0; k < 8; k++) {
      var c = spot(), off = Math.abs(Math.hypot(c[0] - p[0], c[1] - p[1]) - want);
      if (off < miss) { q = c; miss = off; }
    }
    var dx = q[0] - p[0], dy = q[1] - p[1];
    var b1 = (Math.random() - 0.5) * 0.7, b2 = (Math.random() - 0.5) * 0.7;
    path = { at: clock, time: vary(GLIDE_TIME), pts: [
      p[0], p[1],
      p[0] + dx / 3 - dy * b1, p[1] + dy / 3 + dx * b1,
      p[0] + 2 * dx / 3 - dy * b2, p[1] + 2 * dy / 3 + dx * b2,
      q[0], q[1]] };
  }

  /* Something happens: a drop, a patter of rain, two drops at once, or
     the unseen finger, if it is not already out. */
  function happen() {
    var p = spot(), r = Math.random(), k;
    lastAt = clock;
    if (r < MIX[0]) {
      fall(clock, p[0], p[1], vary(DROP_SPREAD), vary(DROP));
    } else if (r < MIX[0] + MIX[1]) {
      var n = PATTER - 1 + Math.floor(Math.random() * 4);
      for (k = 0; k < n; k++) {
        var a = Math.random() * 2 * Math.PI, d = PATTER_REACH * Math.sqrt(Math.random());
        fall(clock + Math.random() * PATTER_TIME, p[0] + d * Math.cos(a), p[1] + d * Math.sin(a),
          vary(0.75 * DROP_SPREAD), vary(0.55 * DROP));
      }
    } else if (r < MIX[0] + MIX[1] + MIX[2]) {
      var t = Math.random() * Math.PI, half = vary(TWIN) / 2, cx = half * Math.cos(t), cy = half * Math.sin(t);
      fall(clock, p[0] + cx, p[1] + cy, DROP_SPREAD, 0.8 * DROP);
      fall(clock, p[0] - cx, p[1] - cy, DROP_SPREAD, 0.8 * DROP);
    } else if (!path) {
      glide(p);
    } else {
      fall(clock, p[0], p[1], vary(DROP_SPREAD), vary(DROP));
    }
  }

  /* The weather for one step: it rises when the cursor has been still a
     while and quietens while it plays; what is due happens, drops that
     are due fall, and the unseen finger moves on along its way. Returns
     whether anything struck the water. */
  function forecast() {
    var goal = clock - stirredAt < IDLE_AFTER ? IN_PLAY : 1;
    weather += (goal - weather) * (1 - Math.exp(-STEP / EASE));
    if (!begun) {
      if (clock >= FIRST) { begun = true; happen(); }
    } else if (clock - lastAt >= GAP &&
        (Math.random() < RATE * area() * weather * STEP || weather > 0.9 && clock - lastAt >= LULL)) {
      happen();
    }
    var struck = false;
    for (var k = falling.length - 1; k >= 0; k--) {
      var f = falling[k];
      if (f[0] > clock) continue;
      strike(f[1], f[2], f[3], f[4]);
      falling.splice(k, 1);
      struck = true;
    }
    if (path) {
      var u = (clock - path.at) / path.time;
      if (u >= 1) {
        path = null;
        ghost.on = false;
      } else {
        var e = u * u * (3 - 2 * u), o = 1 - e, P = path.pts;
        var b0 = o * o * o, b1 = 3 * o * o * e, b2 = 3 * o * e * e, b3 = e * e * e;
        ghost.x = b0 * P[0] + b1 * P[2] + b2 * P[4] + b3 * P[6];
        ghost.y = b0 * P[1] + b1 * P[3] + b2 * P[5] + b3 * P[7];
        ghost.on = true;
      }
    }
    return struck;
  }

  /* ---------- The step ---------- */

  var quiet = 0;

  function step() {
    clock += STEP;
    var struck = forecast();
    var a = aim(pointer, 1), b = aim(ghost, GLIDE_PUSH * weather);
    var moving = a || b || struck;

    var y, x, i, acc, hc, vc, peak = 0;
    for (var s = 1; s <= subs; s++) {
      /* Each cell's acceleration: the pull of its neighbours (the
         wave), the spring back to rest, drag, and a viscous drag that
         smooths away the finest ripples. */
      for (y = 1; y < H - 1; y++) {
        i = y * W + 1;
        for (x = 1; x < W - 1; x++, i++) {
          hc = h[i]; vc = v[i];
          acc = C2 * (h[i - 1] + h[i + 1] + h[i - W] + h[i + W] - 4 * hc) +
                NU * (v[i - 1] + v[i + 1] + v[i - W] + v[i + W] - 4 * vc) -
                K * hc - drag[i] * vc;
          vn[i] = vc + acc * dt;
        }
      }
      var f = s / subs;
      push(pointer, f);
      push(ghost, f);
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
    pointer.fromX = pointer.toX; pointer.fromY = pointer.toY;
    ghost.fromX = ghost.toX; ghost.fromY = ghost.toY;
    quiet = !moving && peak < STILL ? quiet + 1 : 0;
  }

  /* ---------- Drawing ----------
     Seen through the water: a diamond comes up where the surface bends,
     swells with it, and leans a little with the slope. Diamonds of one
     size are gathered into one shape and filled at once. */

  var shown = false;

  function blank() {
    if (!shown) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    shown = false;
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
    shown = true;
  }

  /* ---------- The loop ----------
     Steps are a fixed sixtieth of a second, as many as the time since
     the last frame calls for. Once the water is still, the loop rests
     until the next thing is due to happen, as a Poisson process would
     have it, and the clock is moved on by the time it rested. */

  var raf = 0, then = 0, spare = 0, nap = 0;

  function wake() {
    if (still || raf || document.hidden || !N) return;
    clearTimeout(nap);
    nap = 0;
    quiet = 0;
    then = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function rest() {
    var rate = RATE * area() * weather;
    var wait = Math.max(0, !begun ? FIRST - clock : Math.max(GAP - (clock - lastAt), -Math.log(1 - Math.random()) / rate));
    if (weather > 0.9) wait = Math.min(wait, Math.max(0, LULL - (clock - lastAt)));
    if (!isFinite(wait)) return;
    nap = setTimeout(function () {
      nap = 0;
      clock += wait;
      begun = true;
      happen();
      wake();
    }, wait * 1000);
  }

  function frame(now) {
    raf = 0;
    var t = (now - then) / 1000;
    then = now;
    t = t < 0 ? 0 : t > 0.1 ? 0.1 : t;
    spare += t;
    if (spare > MAX_STEPS * STEP) spare = MAX_STEPS * STEP;
    while (spare >= STEP) { step(); spare -= STEP; }
    if (quiet >= STILL_STEPS && !path && !falling.length) {
      blank();
      rest();
      return;
    }
    draw();
    raf = requestAnimationFrame(frame);
  }

  function halt() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(nap);
    nap = 0;
  }

  /* ---------- Listening ---------- */

  function release() { pointer.on = false; pointer.down = false; wake(); }

  document.addEventListener('pointermove', function (e) {
    if (!e.isPrimary || (e.pointerType === 'touch' && !pointer.down)) return;
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.on = true;
    stirredAt = clock;
    wake();
  }, passive);

  /* A finger is always a press; a mouse presses with its main button. */
  document.addEventListener('pointerdown', function (e) {
    if (!e.isPrimary) return;
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.down = e.pointerType === 'touch' || e.button === 0;
    pointer.on = true;
    stirredAt = clock;
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
    if (document.hidden) halt();
    else wake();
  });

  var sizing = 0;
  var resize = function () {
    if (!sizing) sizing = requestAnimationFrame(function () { sizing = 0; measure(); });
  };
  window.addEventListener('resize', resize, passive);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

  listen(window.matchMedia('(prefers-color-scheme: dark)'), function () { tint(); if (raf) draw(); });

  /* Asking for less motion part way through clears the water away;
     asking for it back lets the weather return. */
  if (calm) listen(calm, function () {
    still = calm.matches;
    if (!still) { wake(); return; }
    halt();
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
