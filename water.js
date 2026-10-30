/* The paper, at sea.

   The page's paper is a field of the mark's diamonds afloat on water.
   Left alone, long low swells roll slowly across it from the lower left,
   the way the open sea moves: each diamond rises and swells as a crest
   passes under it and sinks small in the trough behind, so the swells
   show as soft bands of diamonds travelling through the field. The cursor
   is a hand trailed through the same water, and a click or a tap lets a
   drop fall. What they stir runs out as real water does, the long waves
   first and the short ripples after, bounces off the edges of the window,
   passes through the swell and through itself, and fades. Every diamond
   also leans a little with the slope of the water under it, the way
   things seen through water do.

   The water is a sum of standing waves across the window, each the shape
   cos(m pi x / width) cos(n pi y / height). Each one swings on its own at
   the speed deep water gives a wave of its length, and dies away the
   faster the shorter it is; none is shorter than about three diamonds, so
   every wave the water carries can be drawn. Because each of them is level
   at the edges of the window, a wave meets the edges as it would a wall
   and bounces back. Each frame moves every wave on exactly by the time
   that has passed, and each diamond's size, strength and lean follow the
   water continuously, so nothing steps or flickers, on a fast screen or a
   slow one. The swell is a few long sea waves worked out directly. It all
   stops while the page is hidden, and for anyone who has asked for less
   motion nothing is drawn at all. */

'use strict';

(function () {
  /* ---------- Tuning ----------
     Distances and heights are in CSS pixels, times in seconds. */

  var PITCH = 16;            // the space between diamonds
  var MAX_DIAMONDS = 8000;   // past this many, they spread further apart
  var MAX_WAVES = 2400;      // past this many standing waves, the shortest grows longer

  var GRAVITY = 4000;        // sets how fast a wave of each length travels, px/s²
  var DAMPING = 0.3;         // how fast the longest waves die away, 1/s
  var VISCOSITY = 60;        // and how much faster the shorter ones do, px²/s

  var HAND = 16;             // the width of the hand's push (sigma), px
  var HAND_PUSH = 5.5;       // how hard it pushes, per px/s of its speed
  var HAND_TOP = 1400;       // speeds above this push no harder, px/s
  var DROP = 18;             // a drop's width (sigma), px
  var DROP_PUSH = 280;       // and how hard it strikes, as a sudden speed of the surface, px/s
  var STILL = 0.02;          // under this much motion, the water lies flat

  /* The swell: long sea waves, each [length px, heading deg, height px, speed px/s].
     Heading 0 runs to the right and -90 runs up the window. */
  var SWELL = [[360, -28, 1.4, 48], [330, -20, 1.0, 44], [420, -36, 0.8, 52], [900, -10, 0.7, 62]];
  var SWELL_IN = 1.8;        // seconds for the swell to rise after the page opens

  /* The diamonds, from the bottom of a trough to the top of a crest. */
  var LEVEL = 3.5;           // the height of water that takes a diamond about three quarters of the way, px
  var TROUGH = 0.1;          // half a diamond's width at the bottom of a trough, px
  var REST = 0.7;            // on level water
  var CREST = 2.7;           // at the top of a crest
  var INK_TROUGH = 0;        // its strength at the bottom of a trough
  var INK_REST = 0.06;       // on level water
  var INK_CREST = 0.5;       // at the top of a crest
  var DARK_INK = 0.8;        // strengths on a dark page, as a share of these
  var LEAN = 12;             // how far the slope beneath shifts a diamond, px per unit of slope
  var MAX_LEAN = 4;          // at most, px
  var LEVELS = 64;           // steps of strength, so diamonds of one strength are filled at once

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

  var ink = '#1a1712', strength = 1;
  function tint() {
    var cs = getComputedStyle(document.body);
    ink = cs.color;
    var m = /(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(cs.backgroundColor || '');
    var dark = m && (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.4;
    strength = dark ? DARK_INK : 1;
  }

  /* ---------- The water ----------
     M by N standing waves over a window wide by tall; a and b hold each
     one's height and speed. The diamonds sit on an X by Y grid. */

  var wide = 0, tall = 0, dpr = 1, M = 0, N = 0, X = 0, Y = 0, stepX = PITCH, stepY = PITCH;
  var km, kn, omega2, damp, wd, a, b, c11, c12, c21, c22, stepDt = -1;
  var cosX, slopeX, cosY, slopeY;   // each wave's shape and slope at the diamonds
  var HR, GR, rowH, rowGx, rowGy;
  var swell = [];
  var awake = false;
  /* Each diamond's place, half-width and strength step this frame, and the
     diamonds ordered by strength step, so each step is filled at once. */
  var dotX, dotY, dotR, dotLevel, order, counts = new Int32Array(LEVELS + 1);

  function measure() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(r.width), t = Math.round(r.height);
    if (w === wide && t === tall && ratio === dpr) return;
    wide = w; tall = t; dpr = ratio;
    canvas.width = Math.round(wide * dpr); canvas.height = Math.round(tall * dpr);

    var pitch = Math.max(PITCH, Math.sqrt(wide * tall / MAX_DIAMONDS));
    X = Math.max(4, Math.round(wide / pitch)); Y = Math.max(4, Math.round(tall / pitch));
    stepX = wide / X; stepY = tall / Y;

    /* The shortest wave is three diamonds long, so each can be drawn. */
    var half = 1.5 * Math.max(stepX, stepY);
    var m = Math.round(wide / half), n = Math.round(tall / half);
    if (m * n > MAX_WAVES) { var f = Math.sqrt(MAX_WAVES / (m * n)); m = Math.floor(m * f); n = Math.floor(n * f); }
    M = Math.max(2, m); N = Math.max(2, n);
    build();
    wake();
  }

  function build() {
    var i, j, k;
    km = new Float32Array(M); kn = new Float32Array(N);
    for (i = 0; i < M; i++) km[i] = i * Math.PI / wide;
    for (j = 0; j < N; j++) kn[j] = j * Math.PI / tall;
    var size = M * N;
    omega2 = new Float32Array(size); damp = new Float32Array(size); wd = new Float32Array(size);
    for (i = 0; i < M; i++) for (j = 0; j < N; j++) {
      k = Math.sqrt(km[i] * km[i] + kn[j] * kn[j]);
      var w2 = GRAVITY * k, g = DAMPING + VISCOSITY * k * k, id = i * N + j;
      omega2[id] = w2; damp[id] = g; wd[id] = Math.sqrt(Math.max(w2 - g * g, 1e-6));
    }
    a = new Float32Array(size); b = new Float32Array(size);
    c11 = new Float32Array(size); c12 = new Float32Array(size);
    c21 = new Float32Array(size); c22 = new Float32Array(size);
    stepDt = -1;

    /* Across as [wave][column] and down as [row][wave], so every sum runs along memory. */
    cosX = new Float32Array(M * X); slopeX = new Float32Array(M * X);
    cosY = new Float32Array(Y * N); slopeY = new Float32Array(Y * N);
    for (i = 0; i < M; i++) for (k = 0; k < X; k++) {
      var x = (k + 0.5) * stepX;
      cosX[i * X + k] = Math.cos(km[i] * x);
      slopeX[i * X + k] = -km[i] * Math.sin(km[i] * x);
    }
    for (k = 0; k < Y; k++) for (j = 0; j < N; j++) {
      var y = (k + 0.5) * stepY;
      cosY[k * N + j] = Math.cos(kn[j] * y);
      slopeY[k * N + j] = -kn[j] * Math.sin(kn[j] * y);
    }
    HR = new Float32Array(M * Y); GR = new Float32Array(M * Y);
    rowH = new Float32Array(X); rowGx = new Float32Array(X); rowGy = new Float32Array(X);
    dotX = new Float32Array(X * Y); dotY = new Float32Array(X * Y); dotR = new Float32Array(X * Y);
    dotLevel = new Uint8Array(X * Y); order = new Int32Array(X * Y);
    swell = [];
    for (k = 0; k < SWELL.length; k++) {
      swell.push({ cx: new Float32Array(X), sx: new Float32Array(X), cy: new Float32Array(Y), sy: new Float32Array(Y) });
    }
    awake = false;
  }

  /* ---------- Stirring ----------
     A push is a soft dent of pressure at (x, y), in window pixels, of the
     given width: it changes the speed of every standing wave by how much
     of that wave's shape lies under the dent. */

  var shapeX = null, shapeY = null;

  function strike(x, y, width, amount) {
    if (!M) return;
    if (!shapeX || shapeX.length !== M || shapeY.length !== N) {
      shapeX = new Float32Array(M); shapeY = new Float32Array(N);
    }
    var s2 = width * width / 2, area = width * Math.sqrt(2 * Math.PI), i, j;
    for (i = 0; i < M; i++) {
      shapeX[i] = (i ? 2 : 1) / wide * area * Math.exp(-km[i] * km[i] * s2) * Math.cos(km[i] * x);
    }
    for (j = 0; j < N; j++) {
      shapeY[j] = (j ? 2 : 1) / tall * area * Math.exp(-kn[j] * kn[j] * s2) * Math.cos(kn[j] * y);
    }
    for (i = 0; i < M; i++) {
      var sx = -amount * shapeX[i], row = i * N;
      for (j = 0; j < N; j++) b[row + j] += sx * shapeY[j];
    }
    b[0] = 0;
    awake = true;
  }

  /* The hand: while the cursor moves it pushes as hard as it is fast, all
     along the way it went, so a quick stroke leaves an unbroken wake. */

  var hand = { on: false, x: 0, y: 0, lastX: 0, lastY: 0, was: false, speed: 0 };
  var drops = [];

  function stir(dt) {
    var s = hand;
    if (!s.on) { s.was = false; s.speed = 0; return; }
    if (!s.was) { s.lastX = s.x; s.lastY = s.y; s.was = true; return; }
    var dx = s.x - s.lastX, dy = s.y - s.lastY, d = Math.sqrt(dx * dx + dy * dy);
    s.speed += (d / dt - s.speed) * (1 - Math.exp(-dt / 0.05));
    if (d > 0.5) {
      var pieces = Math.min(12, Math.max(1, Math.ceil(d / (HAND * 0.6))));
      var push = HAND_PUSH * Math.min(s.speed, HAND_TOP) * dt / pieces;
      for (var k = 1; k <= pieces; k++) {
        strike(s.lastX + dx * k / pieces, s.lastY + dy * k / pieces, HAND, push);
      }
    }
    s.lastX = s.x; s.lastY = s.y;
  }

  /* ---------- Time ----------
     Each standing wave is a damped swing, moved on exactly by dt. */

  function coefficients(dt) {
    if (Math.abs(dt - stepDt) < 1e-5) return;
    stepDt = dt;
    for (var id = 0; id < M * N; id++) {
      var g = damp[id], w = wd[id], e = Math.exp(-g * dt), c = Math.cos(w * dt), s = Math.sin(w * dt);
      c11[id] = e * (c + g / w * s);
      c12[id] = e * s / w;
      c21[id] = -e * omega2[id] / w * s;
      c22[id] = e * (c - g / w * s);
    }
  }

  function advance(dt) {
    stir(dt);
    if (drops.length) {
      for (var k = 0; k < drops.length; k++) strike(drops[k][0], drops[k][1], DROP, DROP_PUSH);
      drops.length = 0;
    }
    if (!awake) return;
    coefficients(dt);
    var e = 0;
    for (var id = 1; id < M * N; id++) {
      var h = a[id], v = b[id];
      a[id] = c11[id] * h + c12[id] * v;
      b[id] = c21[id] * h + c22[id] * v;
      e += omega2[id] * a[id] * a[id] + b[id] * b[id];
    }
    if (e < STILL * STILL && !hand.on) {
      a.fill(0); b.fill(0);
      awake = false;
    }
  }

  /* ---------- Drawing ----------
     The water's height and slope under every diamond are the sums of every
     standing wave's, plus the swell's. Height sets a diamond's size and
     strength, softly limited so a big wave never blots; slope sets its
     lean. Diamonds of one strength are gathered into one shape. */

  function draw(time) {
    var i, j, k, q, x, y, m;

    if (awake) {
      for (i = 0; i < M; i++) {
        var row = i * N, out = i * Y;
        for (y = 0; y < Y; y++) {
          var hs = 0, gs = 0, col = y * N;
          for (j = 0; j < N; j++) { var h = a[row + j]; hs += h * cosY[col + j]; gs += h * slopeY[col + j]; }
          HR[out + y] = hs; GR[out + y] = gs;
        }
      }
    }

    var ramp = Math.min(1, time / SWELL_IN);
    ramp = ramp * ramp * (3 - 2 * ramp);
    for (k = 0; k < SWELL.length; k++) {
      var sw = SWELL[k], kw = 2 * Math.PI / sw[0], th = sw[1] * Math.PI / 180, t = swell[k];
      var kx = kw * Math.cos(th), ky = kw * Math.sin(th), phase = k * 2.1 - kw * sw[3] * time;
      for (x = 0; x < X; x++) { var p = kx * (x + 0.5) * stepX + phase; t.cx[x] = Math.cos(p); t.sx[x] = Math.sin(p); }
      for (y = 0; y < Y; y++) { var pq = ky * (y + 0.5) * stepY; t.cy[y] = Math.cos(pq); t.sy[y] = Math.sin(pq); }
      t.h = sw[2] * ramp; t.gx = t.h * kx; t.gy = t.h * ky;
    }

    counts.fill(0);
    var top = LEVELS - 1, scale = top / (INK_CREST * strength), dot = 0;
    for (y = 0; y < Y; y++) {
      for (x = 0; x < X; x++) { rowH[x] = 0; rowGx[x] = 0; rowGy[x] = 0; }
      if (awake) {
        for (i = 0; i < M; i++) {
          var hr = HR[i * Y + y], gr = GR[i * Y + y];
          if (hr > -1e-7 && hr < 1e-7 && gr > -1e-7 && gr < 1e-7) continue;
          var base = i * X;
          for (x = 0; x < X; x++) {
            rowH[x] += hr * cosX[base + x];
            rowGx[x] += hr * slopeX[base + x];
            rowGy[x] += gr * cosX[base + x];
          }
        }
      }
      for (k = 0; k < SWELL.length; k++) {
        var s = swell[k], cy0 = s.cy[y], sy0 = s.sy[y];
        for (x = 0; x < X; x++) {
          var sn = s.sx[x] * cy0 + s.cx[x] * sy0, cs = s.cx[x] * cy0 - s.sx[x] * sy0;
          rowH[x] += s.h * sn; rowGx[x] += s.gx * cs; rowGy[x] += s.gy * cs;
        }
      }
      var py = (y + 0.5) * stepY;
      for (x = 0; x < X; x++, dot++) {
        m = rowH[x] / LEVEL;
        m = m / Math.sqrt(1 + m * m);
        var r = m >= 0 ? REST + (CREST - REST) * m : REST + (REST - TROUGH) * m;
        var strong = (m >= 0 ? INK_REST + (INK_CREST - INK_REST) * m : INK_REST + (INK_REST - INK_TROUGH) * m) * strength;
        var level = Math.round(strong * scale);
        if (level < 1 || r < 0.15) level = 0;
        else if (level > top) level = top;
        var ox = -LEAN * rowGx[x], oy = -LEAN * rowGy[x];
        ox = ox > MAX_LEAN ? MAX_LEAN : ox < -MAX_LEAN ? -MAX_LEAN : ox;
        oy = oy > MAX_LEAN ? MAX_LEAN : oy < -MAX_LEAN ? -MAX_LEAN : oy;
        dotX[dot] = (x + 0.5) * stepX + ox; dotY[dot] = py + oy; dotR[dot] = r;
        dotLevel[dot] = level;
        counts[level + 1]++;
      }
    }
    for (q = 1; q <= LEVELS; q++) counts[q] += counts[q - 1];
    for (dot = 0; dot < X * Y; dot++) order[counts[dotLevel[dot]]++] = dot;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = ink;
    var from = counts[0];
    for (q = 1; q < LEVELS; q++) {
      var to = counts[q];
      if (to > from) {
        ctx.globalAlpha = q / scale;
        ctx.beginPath();
        for (var n = from; n < to; n++) {
          var id = order[n], cx = dotX[id], cy = dotY[id], rr = dotR[id];
          ctx.moveTo(cx, cy - rr);
          ctx.lineTo(cx + rr, cy);
          ctx.lineTo(cx, cy + rr);
          ctx.lineTo(cx - rr, cy);
          ctx.closePath();
        }
        ctx.fill();
      }
      from = to;
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- The loop ----------
     Every frame moves the water on by the time since the last; while
     only the swell moves, frames come at most about sixty times a
     second. */

  var raf = 0, then = 0, clock = 0, drawnAt = 0;

  function wake() {
    if (still || raf || document.hidden || !M) return;
    then = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = (now - then) / 1000;
    then = now;
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    clock += dt;
    advance(dt);
    if (!awake && now - drawnAt < 15) return;
    drawnAt = now;
    draw(clock);
  }

  function halt() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ---------- Listening ---------- */

  function lift() { hand.on = false; }

  document.addEventListener('pointermove', function (e) {
    if (!e.isPrimary) return;
    hand.x = e.clientX; hand.y = e.clientY;
    hand.on = true;
  }, passive);

  /* A click or a tap lets a drop fall where it lands. */
  document.addEventListener('pointerdown', function (e) {
    if (!e.isPrimary) return;
    drops.push([e.clientX, e.clientY]);
  }, passive);

  document.addEventListener('pointerup', function (e) {
    if (e.isPrimary && e.pointerType === 'touch') lift();
  }, passive);
  document.addEventListener('pointercancel', lift, passive);

  /* Off the edge of the window, the hand comes out of the water. */
  document.addEventListener('pointerout', function (e) {
    if (!e.relatedTarget) lift();
  }, passive);
  window.addEventListener('blur', lift);

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

  listen(window.matchMedia('(prefers-color-scheme: dark)'), tint);

  /* Asking for less motion part way through clears the water away;
     asking for it back lets the sea return. */
  if (calm) listen(calm, function () {
    still = calm.matches;
    if (!still) { wake(); return; }
    halt();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  /* ---------- Start ---------- */

  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:0;display:block;width:100%;' +
    'height:100vh;height:100lvh;pointer-events:none;margin:0;padding:0;border:0';
  document.body.appendChild(canvas);
  tint();
  measure();
})();
