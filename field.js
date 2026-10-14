// The field: the paper answers the pointer.
//
// Most of every page is open paper. Under a fine pointer that can hover,
// a field of the mark's diamonds lies over it, set on the page's own
// columns, and invisible at rest. Near the pointer the diamonds appear
// and swell, warm ink on the paper and ivory on the dark bands; as the
// pointer moves on they settle again behind it, so a moving pointer
// leaves a soft wake. The swell falls away smoothly with distance, so it
// has no edge, and it is never brighter than a faint mark on the page.
//
// The field keeps clear of the type, the console on the homepage, code,
// pictures, controls and the header, fading out softly as it nears them,
// and of the footer, which has a field of its own (pragmatic.js). It is
// drawn the way that field is: the same small diamond, on a pitch that
// divides the page's column track, swelling on a critically damped spring.
//
// It is off on touch screens and under reduced motion, and nothing runs
// while the pointer is still and every diamond has settled.
(function () {
    'use strict';
    if (!window.matchMedia || !window.requestAnimationFrame || !window.Map) return;

    var fineQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    var stillQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    var canPlay = function () { return fineQuery.matches && !stillQuery.matches; };

    // The diamonds
    var PITCH = 36;         // px; the nearest even division of a column track is used
    var HALF = 1.3;         // half a diamond's width at scale 1: 2.6px across
    var BUD = 0.7;          // its scale as it first appears: under 2px
    var PEAK = 2.2;         // its scale at the peak of the swell: about 5.7px
    var REACH = 124;        // px; a diamond's energy goes toward exp(-d^2 / REACH^2)
    var FAINT = 0.12;       // below this energy a diamond cannot be seen, and is let go
    var CUT = REACH * Math.sqrt(-Math.log(FAINT));   // where the pull falls to FAINT
    var INK_A = 0.12;       // peak opacity, ink on the paper
    var IVORY_A = 0.13;     // peak opacity, ivory on a dark band
    var INK_CURVE = 1.5;    // opacity goes as energy to this power, so the faint edge thins
    var RISE = 18;          // the spring, rad/s, critically damped, while a diamond swells
    var FALL = 6.5;         // and while it settles: out of sight in about half a second
    var LEVELS = 24;        // opacity steps, so diamonds are filled in a few batches

    // How far each kind of thing keeps the field away: a clear margin,
    // then a fade over the given distance (a smoothstep on the distance
    // from the thing's box, so the clear space has soft, rounded edges).
    var TEXT = [10, 50];
    var SOLID = [14, 72];   // the console, code, pictures, controls, cards
    var RULE = [3, 16];     // hairlines
    var FOOT = [28, 84];    // the footer, which has its own field
    var HEAD = [6, 56];     // the header, wherever it is

    // Whole things the field never draws over.
    var SOLID_SEL = [
        'img', 'picture', 'video', 'svg', 'canvas', 'iframe', 'figure', 'pre',
        'a', 'button', 'summary', 'label', 'input', 'textarea', 'select', '[role="button"]',
        '.replay', '.pc-stage', '.pc', '.code-wrap', '.code-snippet', '.doc-code',
        '.doc-table', 'table'
    ].join(',');
    // Labels with a hanging diamond (drawn by the stylesheet, left of the words).
    var HANG_SEL = '.running-head, .art-sign, .next-page a, .doc .measure li';
    var HANG = 28;          // px the clear space reaches left of such a label

    var canvas = null, ctx = null;
    var W = 0, H = 0, dpr = 1;
    var on = false;                     // listening and drawing
    var raf = 0, last = 0, frameNo = 0;
    var present = false, px = 0, py = 0;

    // The page, as last measured (document coordinates).
    var geo = null;                     // { x0, p, kMin, kMax, segs, key }
    var zones = [];                     // [l, t, r, b, clear, fade]
    var buckets = [];                   // zone indices per 128px of height
    var BUCKET = 128;
    var bands = [];                     // dark bands: [l, t, r, b]
    var dyn = [];                       // sticky things: { el, rects (relative), kind }
    var dynNow = [];                    // their zones this frame (viewport coordinates)
    var ink = '26,23,18', ivory = '242,239,230';

    var live = new Map();               // diamonds with energy, by cell
    var quiet = new Map();              // each cell's distance factor and colour
    var drawX = [], drawY = [], drawH = [];
    var lists = [[], []];
    for (var c0 = 0; c0 < 2; c0++) for (var l0 = 0; l0 <= LEVELS; l0++) lists[c0].push([]);

    var smooth = function (e0, e1, x) {
        var u = (x - e0) / (e1 - e0);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        return u * u * (3 - 2 * u);
    };

    var rgbOf = function (s) {
        var m = s && s.match(/[\d.]+/g);
        return m && m.length >= 3 ? [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1] : null;
    };
    var lum = function (c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; };
    var near = function (a, b) {
        return a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 12;
    };

    // ── Measuring ──────────────────────────────────────────────────────

    var range = document.createRange();
    var shown = function (el) { return el.getClientRects().length > 0; };

    var addZone = function (l, t, r, b, kind) {
        if (!(r > l) && !(b > t)) return;
        zones.push([l, t, r, b, kind[0], kind[1]]);
    };

    // Every line of type under an element, as boxes in viewport
    // coordinates, leaving out whatever is under an element in `skip`.
    var textRects = function (root, out, skip) {
        var walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
                if (skip && skip.has(n)) return NodeFilter.FILTER_REJECT;
                return /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
            }
        });
        for (var n = walk.nextNode(); n; n = walk.nextNode()) {
            if (!/\S/.test(n.nodeValue)) continue;
            range.selectNodeContents(n);
            var rs = range.getClientRects();
            for (var k = 0; k < rs.length; k++) if (rs[k].width && rs[k].height) out.push(rs[k]);
        }
    };

    // The page's columns: the content's left edge and the column track,
    // from the same custom properties the stylesheet lays the page out by.
    var columns = function () {
        var probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:0;top:0;height:0;visibility:hidden;pointer-events:none;' +
            'width:var(--cg,40px);padding-left:var(--gutter,72px);box-sizing:content-box';
        document.body.appendChild(probe);
        var cs = getComputedStyle(probe);
        var cg = parseFloat(cs.width) || 0, gutter = parseFloat(cs.paddingLeft) || 0;
        document.body.removeChild(probe);
        var content = W - 2 * gutter;
        var track = content > 0 ? (content - 11 * cg) / 12 + cg : 0;
        var p = PITCH;
        if (track > 0) p = track / Math.max(1, Math.round(track / PITCH));
        if (p < 28 || p > 44) p = PITCH;
        return { x0: gutter, p: p };
    };

    var measure = function () {
        var sx = window.scrollX, sy = window.scrollY;
        var doc = document.documentElement;
        var docH = Math.max(doc.scrollHeight, document.body.scrollHeight);
        var rootCs = getComputedStyle(doc);
        var bodyCs = getComputedStyle(document.body);
        var inkC = rgbOf(rootCs.getPropertyValue('--ink')) || rgbOf(bodyCs.color);
        var ivoryC = rgbOf(rootCs.getPropertyValue('--ivory')) || rgbOf(bodyCs.backgroundColor);
        if (inkC) ink = inkC.slice(0, 3).join(',');
        if (ivoryC) ivory = ivoryC.slice(0, 3).join(',');
        var paper = rgbOf(bodyCs.backgroundColor);

        zones = []; bands = []; dyn = [];
        var grounds = [paper];
        var header = document.querySelector('body > header, header');
        var footers = [];
        var rules = [];

        // One pass over the elements, in document order (so a band is
        // found before what sits on it). Whatever is kept clear as a whole
        // is not looked inside.
        var solids = [], hidden = [], marks = [];
        var REJECT = NodeFilter.FILTER_REJECT, SKIP = NodeFilter.FILTER_SKIP;
        var side = function (w, style, colour) {
            if (!(parseFloat(w) > 0) || style === 'none' || style === 'hidden') return false;
            var col = rgbOf(colour);
            return !!(col && col[3] > 0.04);
        };
        var classify = function (el) {
            var tag = el.tagName;
            if (el === canvas || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/.test(tag)) return REJECT;
            if (el === header) return REJECT;
            if (tag === 'FOOTER' || el.classList.contains('pf-colophon')) { footers.push(el); return REJECT; }
            var cs = getComputedStyle(el);
            if (cs.display === 'none') { hidden.push(el); return REJECT; }
            if (cs.display === 'contents' || !shown(el)) return SKIP;
            if (cs.position === 'sticky' || cs.position === 'fixed') {
                dyn.push({ el: el, kind: TEXT, rects: null });
                return REJECT;
            }
            if (el.matches(SOLID_SEL)) { solids.push(el); return REJECT; }

            var r = el.getBoundingClientRect();
            var bg = rgbOf(cs.backgroundColor);
            if (bg && bg[3] > 0.5) {
                var ground = false;
                for (var g = 0; g < grounds.length; g++) if (near(bg, grounds[g])) { ground = true; break; }
                if (!ground) {
                    if (lum(bg) < 0.3 && r.width >= 0.9 * W && r.height >= 120) {
                        bands.push([r.left + sx, r.top + sy, r.right + sx, r.bottom + sy]);
                        grounds.push(bg);
                    } else {
                        solids.push(el);
                        return REJECT;
                    }
                }
            }
            if ((cs.boxShadow && cs.boxShadow !== 'none') || /url\(/.test(cs.backgroundImage)) {
                solids.push(el);
                return REJECT;
            }

            // Hairlines: each drawn side is a thin box; a box drawn on all
            // four sides is a frame, and is kept clear as a whole.
            var t = side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor);
            var b = side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor);
            var l = side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor);
            var rt = side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor);
            if (t && b && l && rt) { solids.push(el); return REJECT; }
            if (t) rules.push([r.left, r.top, r.right, r.top + 1]);
            if (b) rules.push([r.left, r.bottom - 1, r.right, r.bottom]);
            if (l) rules.push([r.left, r.top, r.left + 1, r.bottom]);
            if (rt) rules.push([r.right - 1, r.top, r.right, r.bottom]);
            // A small empty element is a mark drawn by the stylesheet (an
            // open diamond beside a question, say): kept clear like type.
            if (r.width && r.width <= 48 && r.height <= 48 && !/\S/.test(el.textContent)) {
                marks.push([r.left, r.top, r.right, r.bottom]);
            }
            return SKIP;
        };
        var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, { acceptNode: classify });
        while (walk.nextNode()) { /* classify does the work */ }

        var away = new Set(solids.concat(hidden, footers, dyn.map(function (d) { return d.el; })));
        if (header) away.add(header);
        if (canvas) away.add(canvas);
        var isAway = function (el) {
            for (var a = el; a && a !== document.body; a = a.parentElement) if (away.has(a)) return true;
            return false;
        };

        // Type: every line, plus the hanging diamond of a label.
        var rects = [];
        textRects(document.body, rects, away);
        for (var i = 0; i < rects.length; i++) {
            var q = rects[i];
            addZone(q.left + sx, q.top + sy, q.right + sx, q.bottom + sy, TEXT);
        }
        document.querySelectorAll(HANG_SEL).forEach(function (h) {
            if (isAway(h) || !shown(h)) return;
            var first = null, rs = [];
            textRects(h, rs);
            for (var k = 0; k < rs.length; k++) if (!first || rs[k].top < first.top - 2) first = rs[k];
            if (first) addZone(first.left - HANG + sx, first.top + sy, first.left + sx, first.bottom + sy, TEXT);
        });
        solids.forEach(function (s) {
            var b = s.getBoundingClientRect();
            addZone(b.left + sx, b.top + sy, b.right + sx, b.bottom + sy, SOLID);
        });
        rules.forEach(function (b) { addZone(b[0] + sx, b[1] + sy, b[2] + sx, b[3] + sy, RULE); });
        marks.forEach(function (b) { addZone(b[0] + sx, b[1] + sy, b[2] + sx, b[3] + sy, TEXT); });
        footers.forEach(function (f) {
            var b = f.getBoundingClientRect();
            if (b.height) addZone(-1e4, b.top + sy, 1e5, Math.max(b.bottom + sy, docH + 1e4), FOOT);
        });

        // Sticky things move as the page scrolls, so their type is kept
        // relative to their own box and placed again on every frame.
        dyn.forEach(function (d) {
            var b = d.el.getBoundingClientRect(), rs = [];
            textRects(d.el, rs);
            d.rects = rs.map(function (q) { return [q.left - b.left, q.top - b.top, q.right - b.left, q.bottom - b.top]; });
            if (d.el.matches(HANG_SEL) && rs.length) {
                var f = d.rects[0];
                d.rects.push([f[0] - HANG, f[1], f[0], f[3]]);
            }
        });
        if (header) dyn.push({ el: header, kind: HEAD, rects: null });

        // Index the zones by height.
        buckets = [];
        for (var z = 0; z < zones.length; z++) {
            var zz = zones[z], m = zz[4] + zz[5];
            var b0 = Math.max(0, Math.floor((zz[1] - m) / BUCKET));
            var b1 = Math.min(Math.floor((docH + 2000) / BUCKET), Math.floor((zz[3] + m) / BUCKET));
            for (var bi = b0; bi <= b1; bi++) (buckets[bi] || (buckets[bi] = [])).push(z);
        }

        // Rows: the page is cut at the edges of every dark band and at the
        // footer, and each piece is divided into a whole number of rows
        // within a few percent of the pitch, so that no row of diamonds
        // ever sits on an edge: every edge falls halfway between two rows.
        var cols = columns();
        var p = cols.p;
        var cuts = [0, docH];
        bands.forEach(function (b) { cuts.push(b[1], b[3]); });
        footers.forEach(function (f) {
            var b = f.getBoundingClientRect();
            if (b.height) cuts.push(b.top + sy);
        });
        cuts = cuts.map(function (v) { return Math.round(v * 2) / 2; })
            .filter(function (v) { return v >= 0 && v <= docH; })
            .sort(function (a, b) { return a - b; });
        var segs = [], base = 0;
        for (var s = 0; s + 1 < cuts.length; s++) {
            var t = cuts[s], btm = cuts[s + 1];
            if (btm - t < 1) continue;
            var n = Math.max(1, Math.round((btm - t) / p));
            segs.push({ t: t, b: btm, q: (btm - t) / n, n: n, base: base });
            base += n;
        }
        var kMin = Math.ceil((p / 2 - cols.x0) / p - 1e-6);
        var kMax = Math.floor((W - p / 2 - cols.x0) / p + 1e-6);
        var key = [W, cols.x0.toFixed(2), p.toFixed(3), segs.map(function (g) { return g.t + ':' + g.n; }).join()].join('|');
        return { x0: cols.x0, p: p, kMin: kMin, kMax: kMax, segs: segs, key: key };
    };

    // A cell's distance factor (1 in open paper, 0 at the type) and its
    // colour (0 ink, 1 ivory), packed as factor + 2 * colour.
    var quietAt = function (x, y) {
        var a = 1;
        var list = buckets[Math.floor(y / BUCKET)];
        if (list) {
            for (var i = 0; i < list.length && a > 0; i++) {
                var z = zones[list[i]];
                var dx = Math.max(z[0] - x, 0, x - z[2]);
                var dy = Math.max(z[1] - y, 0, y - z[3]);
                var d = dx * dx + dy * dy;
                var reach = z[4] + z[5];
                if (d >= reach * reach) continue;
                var f = smooth(z[4], reach, Math.sqrt(d));
                if (f < a) a = f;
            }
        }
        var tone = 0;
        for (var b = 0; b < bands.length; b++) {
            var bb = bands[b];
            if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3]) { tone = 1; break; }
        }
        return a + 2 * tone;
    };

    var refreshTimer = 0;
    var refresh = function () {
        refreshTimer = 0;
        if (!on) return;
        sizeCanvas();
        var next = measure();
        quiet.clear();
        if (!geo || next.key !== geo.key) {
            live.clear();
        } else {
            // Same cells: keep each diamond's energy, with its new factor.
            live.forEach(function (d) {
                var v = quietAt(d.x, d.y);
                d.ivory = v >= 2 ? 1 : 0;
                d.q = v - 2 * d.ivory;
            });
        }
        geo = next;
        kick();
    };
    var later = function (ms) {
        if (!on) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, ms || 160);
    };

    // ── Drawing ────────────────────────────────────────────────────────

    var sizeCanvas = function () {
        var doc = document.documentElement;
        var w = doc.clientWidth, h = doc.clientHeight;
        var d = Math.min(window.devicePixelRatio || 1, 2);
        if (w === W && h === H && d === dpr) return false;
        W = w; H = h; dpr = d;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        return true;
    };

    // Energise every cell within reach of the pointer (document coordinates).
    var reachCells = function (X, Y) {
        var g = geo, p = g.p, c2 = CUT * CUT, r2 = REACH * REACH;
        for (var s = 0; s < g.segs.length; s++) {
            var seg = g.segs[s];
            if (seg.b < Y - CUT || seg.t > Y + CUT) continue;
            var j0 = Math.max(0, Math.ceil((Y - CUT - seg.t) / seg.q - 0.5));
            var j1 = Math.min(seg.n - 1, Math.floor((Y + CUT - seg.t) / seg.q - 0.5));
            for (var j = j0; j <= j1; j++) {
                var y = seg.t + (j + 0.5) * seg.q;
                var dy = y - Y;
                if (dy * dy >= c2) continue;
                var span = Math.sqrt(c2 - dy * dy);
                var k0 = Math.max(g.kMin, Math.ceil((X - span - g.x0) / p));
                var k1 = Math.min(g.kMax, Math.floor((X + span - g.x0) / p));
                var row = (seg.base + j) * 4096;
                for (var k = k0; k <= k1; k++) {
                    var key = row + (k + 2048);
                    var dmd = live.get(key);
                    var x = g.x0 + k * p, dx = x - X;
                    var pull = Math.exp(-(dx * dx + dy * dy) / r2);
                    if (!dmd) {
                        if (pull < FAINT) continue;
                        var v = quiet.get(key);
                        if (v === undefined) { v = quietAt(x, y); quiet.set(key, v); }
                        var tone = v >= 2 ? 1 : 0, f = v - 2 * tone;
                        if (f < 0.02) continue;
                        dmd = { x: x, y: y, q: f, ivory: tone, e: 0, v: 0, t: 0, seen: 0 };
                        live.set(key, dmd);
                    }
                    dmd.t = pull;
                    dmd.seen = frameNo;
                }
            }
        }
    };

    // One step of a critically damped spring for every diamond toward its
    // energy (the exact solution, so any frame time is stable). Returns
    // true while any diamond is still on its way.
    var stepAll = function (dt) {
        var busy = false;
        var eRise = Math.exp(-RISE * dt), eFall = Math.exp(-FALL * dt);
        live.forEach(function (d, key) {
            var target = d.seen === frameNo ? d.t : 0;
            // Too faint to see, and going nowhere it could be seen: let it go.
            if (target < FAINT && d.e < FAINT) { live.delete(key); return; }
            var x = d.e - target, v = d.v;
            if (x === 0 && v === 0) return;
            var w = x < 0 ? RISE : FALL, ex = x < 0 ? eRise : eFall;
            var c = v + w * x;
            x = (x + c * dt) * ex;
            v = (v - w * c * dt) * ex;
            // Close enough that the rest of the way could not be seen.
            if (Math.abs(x) < 0.01 && Math.abs(v) < 0.06) { x = 0; v = 0; }
            else busy = true;
            d.e = target + x; d.v = v;
            if (d.e <= 0 && target === 0 && v <= 0) live.delete(key);
        });
        return busy;
    };

    // Where the header and other sticky things are now.
    var placeDyn = function () {
        dynNow.length = 0;
        for (var i = 0; i < dyn.length; i++) {
            var d = dyn[i];
            if (!d.el.isConnected) continue;
            var b = d.el.getBoundingClientRect();
            if (!b.width && !b.height) continue;
            var m = d.kind[0] + d.kind[1];
            if (b.bottom < -m - 200 || b.top > H + m + 200) continue;
            if (!d.rects) dynNow.push([b.left, b.top, b.right, b.bottom, d.kind[0], d.kind[1]]);
            else for (var k = 0; k < d.rects.length; k++) {
                var q = d.rects[k];
                dynNow.push([b.left + q[0], b.top + q[1], b.left + q[2], b.top + q[3], d.kind[0], d.kind[1]]);
            }
        }
    };
    var dynQuiet = function (x, y) {
        var a = 1;
        for (var i = 0; i < dynNow.length && a > 0; i++) {
            var z = dynNow[i];
            var dx = Math.max(z[0] - x, 0, x - z[2]);
            var dy = Math.max(z[1] - y, 0, y - z[3]);
            var reach = z[4] + z[5];
            var d = dx * dx + dy * dy;
            if (d >= reach * reach) continue;
            var f = smooth(z[4], reach, Math.sqrt(d));
            if (f < a) a = f;
        }
        return a;
    };

    var draw = function (sx, sy) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!live.size) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var c, lv;
        for (c = 0; c < 2; c++) for (lv = 0; lv <= LEVELS; lv++) lists[c][lv].length = 0;
        var n = 0;
        live.forEach(function (d) {
            if (d.e <= 0.02) return;
            var x = d.x - sx, y = d.y - sy;
            if (x < -8 || y < -8 || x > W + 8 || y > H + 8) return;
            var f = d.q;
            if (dynNow.length) f *= dynQuiet(x, y);
            var e = d.e > 1 ? 1 : d.e;
            var a = Math.pow(e, INK_CURVE) * f;
            if (a < 0.04) return;
            var level = Math.round(a * LEVELS);
            if (!level) return;
            drawX[n] = (Math.round(x * dpr - 0.5) + 0.5) / dpr;
            drawY[n] = (Math.round(y * dpr - 0.5) + 0.5) / dpr;
            drawH[n] = HALF * (BUD + (PEAK - BUD) * e * f);
            lists[d.ivory][level].push(n);
            n++;
        });
        for (c = 0; c < 2; c++) {
            var rgb = c ? ivory : ink, peak = c ? IVORY_A : INK_A;
            for (lv = 1; lv <= LEVELS; lv++) {
                var list = lists[c][lv];
                if (!list.length) continue;
                ctx.fillStyle = 'rgba(' + rgb + ',' + (lv / LEVELS * peak).toFixed(4) + ')';
                ctx.beginPath();
                for (var k = 0; k < list.length; k++) {
                    var i = list[k], x = drawX[i], y = drawY[i], h = drawH[i];
                    ctx.moveTo(x, y - h);
                    ctx.lineTo(x + h, y);
                    ctx.lineTo(x, y + h);
                    ctx.lineTo(x - h, y);
                    ctx.closePath();
                }
                ctx.fill();
            }
        }
    };

    var frame = function (now) {
        raf = 0;
        if (!on || !geo) return;
        var dt = last ? Math.min(now - last, 50) / 1000 : 1 / 60;
        last = now;
        frameNo++;
        if (sizeCanvas()) { later(60); }
        var sx = window.scrollX, sy = window.scrollY;
        if (present && !document.documentElement.classList.contains('menu-open')) reachCells(px + sx, py + sy);
        var busy = stepAll(dt);
        placeDyn();
        draw(sx, sy);
        if (busy) raf = requestAnimationFrame(frame);
        else last = 0;
    };

    var kick = function () {
        if (!raf && on && geo && !document.hidden) raf = requestAnimationFrame(frame);
    };
    var halt = function () {
        if (raf) cancelAnimationFrame(raf);
        raf = 0; last = 0;
    };
    var blank = function () {
        halt();
        live.clear();
        if (ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    // ── Listening ──────────────────────────────────────────────────────

    var onMove = function (e) {
        if (e.pointerType === 'touch') return;
        px = e.clientX; py = e.clientY;
        present = true;
        kick();
    };
    var onOut = function (e) {
        if (!e.relatedTarget) { present = false; kick(); }
    };
    var onBlur = function () { present = false; kick(); };
    var scrollTimer = 0;
    var onScroll = function () {
        if (present) kick();
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () { scrollTimer = 0; later(40); }, 180);
    };
    var onResize = function () { later(160); };
    var onVisibility = function () {
        if (document.hidden) { present = false; blank(); }
    };
    var onTransition = function (e) {
        var t = e.target;
        if (!t || !t.closest || e.propertyName !== 'transform') return;
        if (t.closest('header, footer, .pf-colophon, .replay, .pc-stage')) return;
        later(200);
    };
    var onPrint = function () { if (canvas) canvas.style.visibility = 'hidden'; };
    var onPrinted = function () { if (canvas) canvas.style.visibility = ''; };

    var ro = window.ResizeObserver ? new ResizeObserver(function () { later(160); }) : null;

    var start = function () {
        if (on || !document.body) return;
        if (!canvas) {
            canvas = document.createElement('canvas');
            ctx = canvas.getContext ? canvas.getContext('2d') : null;
            if (!ctx) { canvas = null; return; }
            canvas.className = 'pf-field';
            canvas.setAttribute('aria-hidden', 'true');
            // Over the paper and the bands, under the header, the menu and
            // anything else the page lifts above it.
            canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;' +
                'z-index:0;pointer-events:none;display:block;margin:0;padding:0;border:0';
        }
        document.body.appendChild(canvas);
        on = true;
        W = H = 0;
        sizeCanvas();
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerdown', onMove, { passive: true });
        document.addEventListener('pointerout', onOut, { passive: true });
        window.addEventListener('blur', onBlur);
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });
        document.addEventListener('visibilitychange', onVisibility);
        document.addEventListener('transitionend', onTransition, { passive: true });
        window.addEventListener('beforeprint', onPrint);
        window.addEventListener('afterprint', onPrinted);
        if (ro) {
            ro.observe(document.body);
            var main = document.querySelector('main');
            if (main) Array.prototype.forEach.call(main.children, function (el) { ro.observe(el); });
        }
        if (document.fonts) {
            if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onResize);
            document.fonts.ready.then(function () { later(30); });
        }
        later(30);
    };

    var stop = function () {
        if (!on) return;
        on = false;
        present = false;
        blank();
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = 0; }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerdown', onMove);
        document.removeEventListener('pointerout', onOut);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('transitionend', onTransition);
        window.removeEventListener('beforeprint', onPrint);
        window.removeEventListener('afterprint', onPrinted);
        if (ro) ro.disconnect();
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onResize);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        geo = null;
        quiet.clear();
    };

    var sync = function () { if (canPlay()) start(); else stop(); };
    [fineQuery, stillQuery].forEach(function (q) {
        if (q.addEventListener) q.addEventListener('change', sync);
        else if (q.addListener) q.addListener(sync);
    });
    sync();
})();
