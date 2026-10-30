/* The paper, under water.

   The page's paper is a field of the mark's diamonds lying under water,
   and the diamonds are the light that reaches them. A curved surface acts
   as a lens: where the water above bends just enough to bring the light
   to a point on the paper, it draws a thin bright line, the way sunlight
   draws a moving web on the floor of a pool. The diamonds along those
   lines swell and darken; where the light spreads out they shrink and
   fade; under calm water they rest small and faint. Each diamond also
   leans a little with the slope above it, the way things seen through
   water do.

   Left alone, the water is a random sea: a few dozen waves of every
   heading and of many lengths, chosen afresh on every visit, the longer
   ones travelling faster as they do at sea, so the web of light shifts,
   splits and joins everywhere and never repeats. The cursor is a hand
   trailed through the same water and a click or a tap lets a drop fall.
   What they stir runs out as real water does, the long waves first and
   the short ripples after, bounces off the edges of the window, passes
   through the sea and through itself, and fades.

   The stirred water is a sum of standing waves across the window, each
   the shape cos(m pi x / width) cos(n pi y / height). Each one swings on
   its own at the speed deep water gives a wave of its length and dies
   away the faster the shorter it is; none is shorter than about three
   diamonds, so every wave can be drawn. Because each of them is level at
   the edges of the window, a wave meets the edges as it would a wall and
   bounces back. Each frame moves every wave on exactly by the time that
   has passed, and every diamond follows the water continuously, so
   nothing steps or flickers, on a fast screen or a slow one. It all stops
   while the page is hidden, and for anyone who has asked for less motion
   nothing is drawn at all. */

'use strict';

(function () {
  /* ---------- Tuning ----------
     Distances and heights are in CSS pixels, times in seconds. */

  var PITCH = 16;            // the space between diamonds
  var MAX_DIAMONDS = 8000;   // past this many, they spread further apart
  var MAX_WAVES = 2400;      // past this many standing waves, the shortest grows longer

  var GRAVITY = 4000;        // sets how fast a stirred wave of each length travels, px/s²
  var DAMPING = 0.3;         // how fast the longest stirred waves die away, 1/s
  var VISCOSITY = 60;        // and how much faster the shorter ones do, px²/s

  var HAND = 16;             // the width of the hand's push (sigma), px
  var HAND_PUSH = 5.5;       // how hard it pushes, per px/s of its speed
  var HAND_TOP = 1400;       // speeds above this push no harder, px/s
  var DROP = 18;             // a drop's width (sigma), px
  var DROP_PUSH = 280;       // and how hard it strikes, as a sudden speed of the surface, px/s
  var STILL = 0.02;          // under this much motion, the stirred water lies flat

  /* The sea: waves of every heading, chosen afresh on every visit. */
  var SEA_WAVES = 24;        // how many waves make up the sea
  var SEA_SHORTEST = 110;    // the range of their lengths, px
  var SEA_LONGEST = 380;
  var SEA_STEEP = 0.03;      // how steep each wave is (its height times its wavenumber)
  var SEA_GRAVITY = 380;     // sets how fast each travels, the longer the faster, px/s²
  var SEA_IN = 1.5;          // seconds for the sea to rise after the page opens

  /* The light on the paper, and the diamonds that show it. */
  var DEPTH = 150;           // how far below the surface the paper lies, px: deeper draws finer lines
  var GATHER = 0.15;         // the most the light may gather, so a line never glares or flickers
  var BRIGHT = 1.6;          // the gathering of light that takes a diamond about three quarters up
  var DIM = 0.15;            // half a diamond's width where the light spreads out, px
  var REST = 0.65;           // under calm water
  var LIT = 2.8;             // on a line of light
  var INK_DIM = 0.012;       // its strength where the light spreads out
  var INK_REST = 0.055;      // under calm water
  var INK_LIT = 0.55;        // on a line of light
  var DARK_INK = 0.8;        // strengths on a dark page, as a share of these
  var LEAN = 12;             // how far the slope above shifts a diamond, px per unit of slope
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

  /* ---------- The stirred water ----------
     M by N standing waves over a window wide by tall; a and b hold each
     one's height and speed. The diamonds sit on an X by Y grid. */

  var wide = 0, tall = 0, dpr = 1, M = 0, N = 0, X = 0, Y = 0, stepX = PITCH, stepY = PITCH;
  var km, kn, omega2, damp, wd, a, b, c11, c12, c21, c22, stepDt = -1;
  /* Each standing wave's shape, slope and bend at the diamonds: across as
     [wave][column] and down as [row][wave], so every sum runs along memory. */
  var cosX, slopeX, bendX, cosY, slopeY, bendY;
  var HR, GR, BR;                    // sums down each row of standing waves
  var gx, gy, hxx, hyy, hxy;         // slope and bend under the diamonds of one row
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
      var id = i * N + j;
      k = Math.sqrt(km[i] * km[i] + kn[j] * kn[j]);
      var w2 = GRAVITY * k, g = DAMPING + VISCOSITY * k * k;
      omega2[id] = w2; damp[id] = g; wd[id] = Math.sqrt(Math.max(w2 - g * g, 1e-6));
    }
    a = new Float32Array(size); b = new Float32Array(size);
    c11 = new Float32Array(size); c12 = new Float32Array(size);
    c21 = new Float32Array(size); c22 = new Float32Array(size);
    stepDt = -1;

    cosX = new Float32Array(M * X); slopeX = new Float32Array(M * X); bendX = new Float32Array(M * X);
    cosY = new Float32Array(Y * N); slopeY = new Float32Array(Y * N); bendY = new Float32Array(Y * N);
    for (i = 0; i < M; i++) for (k = 0; k < X; k++) {
      var x = (k + 0.5) * stepX, c = Math.cos(km[i] * x);
      cosX[i * X + k] = c;
      slopeX[i * X + k] = -km[i] * Math.sin(km[i] * x);
      bendX[i * X + k] = -km[i] * km[i] * c;
    }
    for (k = 0; k < Y; k++) for (j = 0; j < N; j++) {
      var y = (k + 0.5) * stepY, cy = Math.cos(kn[j] * y);
      cosY[k * N + j] = cy;
      slopeY[k * N + j] = -kn[j] * Math.sin(kn[j] * y);
      bendY[k * N + j] = -kn[j] * kn[j] * cy;
    }
    HR = new Float32Array(M * Y); GR = new Float32Array(M * Y); BR = new Float32Array(M * Y);
    gx = new Float32Array(X); gy = new Float32Array(X);
    hxx = new Float32Array(X); hyy = new Float32Array(X); hxy = new Float32Array(X);
    dotX = new Float32Array(X * Y); dotY = new Float32Array(X * Y); dotR = new Float32Array(X * Y);
    dotLevel = new Uint8Array(X * Y); order = new Int32Array(X * Y);
    seaCosX = new Float32Array(SEA_WAVES * X); seaSinX = new Float32Array(SEA_WAVES * X);
    seaCosY = new Float32Array(SEA_WAVES * Y); seaSinY = new Float32Array(SEA_WAVES * Y);
    awake = false;
  }

  /* ---------- The sea ----------
     Each wave has a wavenumber across and down, a speed of swing, a height
     and a starting phase. Lengths are spread evenly on a log scale, so long
     and short waves are equally represented, and headings go all round. */

  var sea = [], seaCosX, seaSinX, seaCosY, seaSinY;
  (function () {
    var lo = Math.log(SEA_SHORTEST), hi = Math.log(SEA_LONGEST);
    for (var k = 0; k < SEA_WAVES; k++) {
      var len = Math.exp(lo + (hi - lo) * (k + Math.random()) / SEA_WAVES);
      var kw = 2 * Math.PI / len, th = 2 * Math.PI * Math.random();
      sea.push({
        kx: kw * Math.cos(th), ky: kw * Math.sin(th), w: Math.sqrt(SEA_GRAVITY * kw),
        h: SEA_STEEP / kw * (0.7 + 0.6 * Math.random()), phase: 2 * Math.PI * Math.random(),
      });
    }
  })();
  var seaStart = 600 * Math.random();   // a different moment of the sea on every visit

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
     Under every diamond, the slope of the water and how it bends (across,
     down and on the diagonal) are the sums of every standing wave's and
     every sea wave's. The bend says how the water above spreads or gathers
     the light onto the paper DEPTH below: light gathered fourfold onto a
     quarter of the area. That gathering sets the diamond's size and
     strength, softly limited so nothing blots; the slope sets its lean.
     Diamonds of one strength are filled at once. */

  function draw(time) {
    var i, j, k, q, x, y, m;

    if (awake) {
      for (i = 0; i < M; i++) {
        var row = i * N, out = i * Y;
        for (y = 0; y < Y; y++) {
          var hs = 0, gs = 0, bs = 0, col = y * N;
          for (j = 0; j < N; j++) {
            var h = a[row + j];
            hs += h * cosY[col + j]; gs += h * slopeY[col + j]; bs += h * bendY[col + j];
          }
          HR[out + y] = hs; GR[out + y] = gs; BR[out + y] = bs;
        }
      }
    }

    /* Each sea wave along the columns (with time) and down the rows, so a
       diamond only has to combine the two. */
    var ramp = Math.min(1, time / SEA_IN);
    ramp = ramp * ramp * (3 - 2 * ramp);
    var seaTime = seaStart + time;
    for (k = 0; k < SEA_WAVES; k++) {
      var w = sea[k], bx = k * X, by = k * Y, p0 = w.phase - w.w * seaTime;
      for (x = 0; x < X; x++) { var p = w.kx * (x + 0.5) * stepX + p0; seaCosX[bx + x] = Math.cos(p); seaSinX[bx + x] = Math.sin(p); }
      for (y = 0; y < Y; y++) { var pq = w.ky * (y + 0.5) * stepY; seaCosY[by + y] = Math.cos(pq); seaSinY[by + y] = Math.sin(pq); }
    }

    counts.fill(0);
    var top = LEVELS - 1, scale = top / (INK_LIT * strength), dot = 0;
    for (y = 0; y < Y; y++) {
      for (x = 0; x < X; x++) { gx[x] = 0; gy[x] = 0; hxx[x] = 0; hyy[x] = 0; hxy[x] = 0; }
      if (awake) {
        for (i = 0; i < M; i++) {
          var hr = HR[i * Y + y], gr = GR[i * Y + y], br = BR[i * Y + y];
          if (hr > -1e-7 && hr < 1e-7 && gr > -1e-7 && gr < 1e-7) continue;
          var base = i * X;
          for (x = 0; x < X; x++) {
            var cx0 = cosX[base + x], sx0 = slopeX[base + x];
            gx[x] += hr * sx0; gy[x] += gr * cx0;
            hxx[x] += hr * bendX[base + x]; hyy[x] += br * cx0; hxy[x] += gr * sx0;
          }
        }
      }
      for (k = 0; k < SEA_WAVES; k++) {
        var sw = sea[k], cy0 = seaCosY[k * Y + y], sy0 = seaSinY[k * Y + y], bk = k * X;
        var amp = sw.h * ramp, ax = amp * sw.kx, ay = amp * sw.ky;
        var axx = -ax * sw.kx, ayy = -ay * sw.ky, axy = -ax * sw.ky;
        for (x = 0; x < X; x++) {
          var cxs = seaCosX[bk + x], sxs = seaSinX[bk + x];
          var cs = cxs * cy0 - sxs * sy0, sn = sxs * cy0 + cxs * sy0;
          gx[x] += ax * cs; gy[x] += ay * cs;
          hxx[x] += axx * sn; hyy[x] += ayy * sn; hxy[x] += axy * sn;
        }
      }
      var py = (y + 0.5) * stepY;
      for (x = 0; x < X; x++, dot++) {
        /* The area a patch of light covers on the paper, against the
           surface it came through; its inverse is how much it gathers. */
        var fx = 1 - DEPTH * hxx[x], fy = 1 - DEPTH * hyy[x], fxy = DEPTH * hxy[x];
        var area = fx * fy - fxy * fxy;
        if (area < 0) area = -area;
        if (area < GATHER) area = GATHER;
        m = (1 / area - 1) / BRIGHT;
        m = m / Math.sqrt(1 + m * m);
        var r = m >= 0 ? REST + (LIT - REST) * m : REST + (REST - DIM) * m;
        var strong = (m >= 0 ? INK_REST + (INK_LIT - INK_REST) * m : INK_REST + (INK_REST - INK_DIM) * m) * strength;
        var level = Math.round(strong * scale);
        if (level < 1 || r < 0.15) level = 0;
        else if (level > top) level = top;
        var ox = -LEAN * gx[x], oy = -LEAN * gy[x];
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
     only the sea moves, frames come at most about sixty times a
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
