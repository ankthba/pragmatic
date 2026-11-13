// The field: the paper answers the pointer.
//
// Most of every page is open paper. Under a fine pointer that can hover,
// the mark's small diamonds come up out of the paper where the pointer
// moves, swell, and settle again behind it, so a moving pointer leaves a
// soft wake: warm ink on the paper, ivory on the dark bands. The field
// answers movement, not position. A pointer that stops, or a page that
// scrolls under a still pointer, lights nothing, and within about a
// second the paper is plain again.
//
// The diamonds keep clear of the type. Each one's size and strength are
// scaled by its distance from the nearest line of type: nothing within
// 12px of a line, then a soft rise to full strength 64px away, so the
// field thins out as it nears the words and has no edge. The console,
// code, pictures, controls, hairlines and the header are kept clear the
// same way, each at its own distance. The footer has a field of its own
// (pragmatic.js); this one is set on the same columns as that one.
//
// The canvas lies on the page, not on the window, so the diamonds scroll
// with the paper. It is off on touch screens and under reduced motion,
// and it is taken off the page whenever no diamond is showing.
(function () {
    'use strict';
    if (!window.matchMedia || !window.requestAnimationFrame || !window.Map || !window.Set) return;

    var fineQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    var stillQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    var canPlay = function () { return fineQuery.matches && !stillQuery.matches; };

    // The diamonds
    var PITCH = 56;         // px; the footer's: the content width is divided into whole columns near this
    var HALF = 1.3;         // half a diamond's width at scale 1: 2.6px across
    var BUD = 0.7;          // its scale as it first appears: under 2px
    var PEAK = 2.2;         // its scale at the peak of the swell: about 5.7px
    var REACH = 124;        // px; a diamond's energy goes toward exp(-d^2 / REACH^2)
    var FAINT = 0.12;       // below this energy a diamond cannot be seen, and is let go
    var CUT = REACH * Math.sqrt(-Math.log(FAINT));   // where the pull falls to FAINT
    var INK_A = 0.12;       // peak opacity, ink on the paper
    var IVORY_A = 0.088;    // peak opacity, ivory on a dark band: the same lightness step as ink on paper
    var INK_CURVE = 1.5;    // opacity goes as energy to this power, so the faint edge thins
    var RISE = 18;          // the spring, rad/s, critically damped, while a diamond swells
    var FALL = 6.5;         // and while it settles: out of sight in about half a second
    var LEVELS = 24;        // opacity steps, so diamonds are filled in a few batches

    // Movement. The field's strength follows how briskly the pointer
    // travels, on a square-root curve, so a slow drift still shows faintly.
    var BRISK = 600;        // px/s of travel at full strength
    var WAKE = 0.06;        // s; how quickly the strength follows a pointer that speeds up
    var SLEEP = 0.3;        // s; and one that slows or stops

    // The canvas covers the window and this much page above and below it,
    // so the diamonds stay on the paper while the page scrolls between frames.
    var MARGIN = 200;
    var RELEASE = 3000;     // ms after the last diamond settles that the canvas's pixels are freed

    // How far each kind of thing keeps the field away: a clear margin,
    // then a smoothstep rise to full strength over the given distance.
    var TEXT = [12, 52];    // type: clear within 12px of a line, full strength 64px away
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
    var VW = 0, VH = 0;                 // the window, CSS px
    var CW = 0, CH = 0, dpr = 1;        // the canvas, CSS px, and its pixel ratio
    var ctop = -1;                      // the canvas's top on the page
    var shownCanvas = false, releaseTimer = 0;
    var on = false;                     // listening and drawing
    var raf = 0, last = 0, frameNo = 0;
    var present = false, px = 0, py = 0;
    var travel = 0;                     // px the pointer has moved since the last frame
    var act = 0;                        // the field's strength, 0 to 1, from the pointer's speed
    var scrolling = false, scrollTimer = 0;
    var orphan = 0;

    // The page, as last measured (document coordinates).
    var geo = null;                     // { x0, p, kMin, kMax, segs, key, docH }
    var zones = [];                     // [l, t, r, b, clear, fade]
    var buckets = [];                   // zone indices per 128px of height
    var BUCKET = 128;
    var bands = [];                     // dark bands: [l, t, r, b]
    var dyn = [];                       // sticky things: { el, rects (relative), kind }
    var dynNow = [];                    // their zones this frame (window coordinates)
    var ink = '26,23,18', ivory = '242,239,230';

    var live = new Map();               // diamonds with energy, by cell (negative: a cell that is gone)
    var quiet = new Map();              // each cell's distance factor and colour
    var drawX = [], drawY = [], drawH = [];
    var lists = [[], []];
    for (var c0 = 0; c0 < 2; c0++) for (var l0 = 0; l0 <= LEVELS; l0++) lists[c0].push([]);

    var smooth = function (e0, e1, x) {
        var u = (x - e0) / (e1 - e0);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        return u * u * (3 - 2 * u);
    };

    // A computed colour, which the browser always gives as rgb() or rgba().
    var rgbOf = function (s) {
        var m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/.exec(s || '');
        if (!m) return null;
        var a = m[4] === undefined ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : +m[4];
        return [+m[1], +m[2], +m[3], a];
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

    // Every line of type under an element, as boxes in window
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

    var measure = function () {
        var doc = document.documentElement;
        // The canvas lies on the page: take it off while the page is
        // measured, so it can never hold the page open at an old height.
        if (canvas) canvas.style.display = 'none';
        var sx = window.scrollX, sy = window.scrollY;
        var bodyCs = getComputedStyle(document.body);

        // The colours and the gutter, read off a probe the stylesheet
        // lays out, so they always come back in one form.
        var probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;' +
            'pointer-events:none;box-sizing:content-box;padding:0 0 0 var(--gutter,72px);' +
            'color:var(--ink,' + bodyCs.color + ')';
        document.body.appendChild(probe);
        var pcs = getComputedStyle(probe);
        var gutter = parseFloat(pcs.paddingLeft) || 0;
        var inkC = rgbOf(pcs.color);
        probe.style.color = 'var(--ivory,' + bodyCs.backgroundColor + ')';
        var ivoryC = rgbOf(getComputedStyle(probe).color);
        document.body.removeChild(probe);
        if (inkC) ink = inkC.slice(0, 3).join(',');
        if (ivoryC) ivory = ivoryC.slice(0, 3).join(',');
        var paper = rgbOf(bodyCs.backgroundColor);

        VW = doc.clientWidth; VH = doc.clientHeight;
        var docH = Math.max(doc.scrollHeight, document.body.scrollHeight);

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
                    if (lum(bg) < 0.3 && r.width >= 0.9 * VW && r.height >= 120) {
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
        var foot = docH;            // where the footer begins: no rows from here down
        footers.forEach(function (f) {
            var b = f.getBoundingClientRect();
            if (!b.height) return;
            addZone(-1e4, b.top + sy, 1e5, Math.max(b.bottom + sy, docH + 1e4), FOOT);
            foot = Math.min(foot, b.top + sy);
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

        // Columns: the footer's. The content's width is divided into whole
        // columns near PITCH wide, counted from the content's left edge, so
        // the paper's diamonds and the footer's fall in the same columns.
        var x0 = gutter, cw = VW - 2 * gutter;
        var inner = document.querySelector('.pf-colophon .pfc-inner');
        if (inner && shown(inner)) {
            var ir = inner.getBoundingClientRect();
            if (ir.width > 0) { x0 = ir.left + sx; cw = ir.width; }
        }
        var p = PITCH;
        if (cw > 0) p = cw / Math.max(1, Math.round(cw / PITCH));
        if (p < 44 || p > 72) p = PITCH;

        // Rows. The page is cut at the edges of every dark band and at the
        // footer. On the paper, rows run a pitch apart from the top of each
        // piece, so a change further down the page never moves a row above
        // it, and the last row keeps at least half a pitch from the edge
        // below. A band is divided into a whole number of rows near the
        // pitch, so that both of its edges fall halfway between two rows.
        foot = Math.round(foot * 2) / 2;
        var cuts = [0, foot];
        bands.forEach(function (b) { cuts.push(b[1], b[3]); });
        cuts = cuts.map(function (v) { return Math.round(v * 2) / 2; })
            .filter(function (v) { return v >= 0 && v <= foot; })
            .sort(function (a, b) { return a - b; });
        var segs = [], base = 0;
        for (var s = 0; s + 1 < cuts.length; s++) {
            var top = cuts[s], btm = cuts[s + 1];
            if (btm - top < 1) continue;
            var mid = (top + btm) / 2, dark = false;
            for (var bd = 0; bd < bands.length; bd++) if (mid > bands[bd][1] && mid < bands[bd][3]) { dark = true; break; }
            var n = dark ? Math.max(1, Math.round((btm - top) / p)) : Math.floor((btm - top) / p);
            if (n < 1) continue;
            segs.push({ t: top, b: btm, q: dark ? (btm - top) / n : p, n: n, base: base });
            base += n;
        }
        var kMin = Math.ceil((p / 2 - x0) / p - 1e-6);
        var kMax = Math.floor((VW - p / 2 - x0) / p + 1e-6);
        var key = [VW, x0.toFixed(2), p.toFixed(3), segs.map(function (g) { return g.t + ':' + g.n + ':' + g.q.toFixed(3); }).join()].join('|');

        if (canvas) canvas.style.display = shownCanvas ? 'block' : 'none';
        return { x0: x0, p: p, kMin: kMin, kMax: kMax, segs: segs, key: key, docH: docH };
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

    // The cell at a point of the page in a layout, or -1 if none is there.
    var cellOf = function (g, x, y) {
        var k = Math.round((x - g.x0) / g.p);
        if (k < g.kMin || k > g.kMax || Math.abs(g.x0 + k * g.p - x) > 0.25) return -1;
        for (var s = 0; s < g.segs.length; s++) {
            var seg = g.segs[s];
            if (y < seg.t || y > seg.b) continue;
            var j = Math.round((y - seg.t) / seg.q - 0.5);
            if (j >= 0 && j < seg.n && Math.abs(seg.t + (j + 0.5) * seg.q - y) <= 0.25) return (seg.base + j) * 4096 + (k + 2048);
        }
        return -1;
    };

    var refreshTimer = 0;
    var refresh = function () {
        refreshTimer = 0;
        if (!on) return;
        var next = measure();
        quiet.clear();
        // Every lit diamond keeps its energy, with its new distance factor.
        // When the layout has changed, one whose cell is still there keeps
        // its place in the field; one whose cell has gone settles where it
        // is, so nothing blinks out.
        var moved = !geo || next.key === geo.key ? null : new Map();
        live.forEach(function (d, key) {
            var v = quietAt(d.x, d.y);
            d.ivory = v >= 2 ? 1 : 0;
            d.q = v - 2 * d.ivory;
            if (!moved) return;
            var k = key >= 0 ? cellOf(next, d.x, d.y) : -1;
            if (k >= 0 && !moved.has(k)) moved.set(k, d);
            else moved.set(-(++orphan), d);
        });
        if (moved) live = moved;
        geo = next;
        if (live.size) kick();
    };
    var later = function (ms) {
        if (!on) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, ms || 160);
    };

    // ── The field ──────────────────────────────────────────────────────

    // Energise every cell within reach of the pointer (document
    // coordinates), as strongly as the pointer is moving.
    var reachCells = function (X, Y, strength) {
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
                    var pull = Math.exp(-(dx * dx + dy * dy) / r2) * strength;
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
    // energy (the exact solution, so any frame time is stable). A diamond
    // the pointer did not reach this frame goes toward nothing. Returns
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
            if (b.bottom < -m - MARGIN || b.top > VH + m + MARGIN) continue;
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

    // ── The canvas ─────────────────────────────────────────────────────

    // Sized to the window plus MARGIN above and below, never taller than
    // the page; its pixels are allocated only while it is showing.
    var fit = function () {
        var d = Math.min(window.devicePixelRatio || 1, 2);
        var h = Math.min(VH + 2 * MARGIN, Math.max(VH, Math.floor(geo.docH)));
        if (VW === CW && h === CH && d === dpr && canvas.width) return;
        CW = VW; CH = h; dpr = d;
        canvas.width = Math.round(CW * dpr);
        canvas.height = Math.round(CH * dpr);
        canvas.style.width = CW + 'px';
        canvas.style.height = CH + 'px';
    };
    // Laid on the page around the window, in whole pixels.
    var place = function (sy) {
        var t = Math.round(sy) - MARGIN;
        var most = Math.max(0, Math.floor(geo.docH) - CH);
        t = t < 0 ? 0 : t > most ? most : t;
        if (t !== ctop) {
            ctop = t;
            canvas.style.transform = 'translate3d(0,' + t + 'px,0)';
        }
    };
    var wipe = function () {
        if (!ctx || !canvas.width) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    var showCanvas = function () {
        if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
        fit();
        if (!shownCanvas) { shownCanvas = true; canvas.style.display = 'block'; }
    };
    var hideCanvas = function () {
        wipe();
        if (shownCanvas) { shownCanvas = false; canvas.style.display = 'none'; }
        if (!releaseTimer && canvas && canvas.width) {
            releaseTimer = setTimeout(function () {
                releaseTimer = 0;
                if (shownCanvas || !canvas) return;
                canvas.width = 0; canvas.height = 0;
                CW = CH = 0;
            }, RELEASE);
        }
    };

    var draw = function (sx, sy) {
        wipe();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var c, lv;
        for (c = 0; c < 2; c++) for (lv = 0; lv <= LEVELS; lv++) lists[c][lv].length = 0;
        var n = 0;
        live.forEach(function (d) {
            if (d.e <= 0.02) return;
            var x = d.x, y = d.y - ctop;
            if (x < -8 || y < -8 || x > CW + 8 || y > CH + 8) return;
            // How near the type it is: this scales both its size and its strength.
            var f = d.q;
            if (dynNow.length) f *= dynQuiet(d.x - sx, d.y - sy);
            var e = d.e > 1 ? 1 : d.e;
            var a = Math.pow(e, INK_CURVE) * f;
            if (a < 0.04) return;
            var level = Math.round(a * LEVELS);
            if (!level) return;
            drawX[n] = (Math.round(x * dpr - 0.5) + 0.5) / dpr;
            drawY[n] = (Math.round(y * dpr - 0.5) + 0.5) / dpr;
            drawH[n] = HALF * f * (BUD + (PEAK - BUD) * e);
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
                    var i = list[k], dxp = drawX[i], dyp = drawY[i], h = drawH[i];
                    ctx.moveTo(dxp, dyp - h);
                    ctx.lineTo(dxp + h, dyp);
                    ctx.lineTo(dxp, dyp + h);
                    ctx.lineTo(dxp - h, dyp);
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
        var sx = window.scrollX, sy = window.scrollY;

        // How briskly the pointer is moving, eased: the field's strength.
        var goal = 0;
        if (present && !scrolling && !document.documentElement.classList.contains('menu-open')) {
            goal = Math.min(1, Math.sqrt(travel / dt / BRISK));
        }
        travel = 0;
        act += (goal - act) * (1 - Math.exp(-dt / (goal > act ? WAKE : SLEEP)));
        if (act < 0.01 && !goal) act = 0;

        if (act > 0) reachCells(px + sx, py + sy, act);
        var busy = stepAll(dt) || act > 0;
        if (live.size) {
            showCanvas();
            place(sy);
            placeDyn();
            draw(sx, sy);
        } else if (shownCanvas) {
            hideCanvas();
        }
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
        act = 0; travel = 0;
        if (canvas) hideCanvas();
    };

    // ── Listening ──────────────────────────────────────────────────────

    var onMove = function (e) {
        if (e.pointerType === 'touch') return;
        var x = e.clientX, y = e.clientY;
        if (present) travel += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
        px = x; py = y;
        present = true;
        if (travel > 0) kick();
    };
    var onOut = function (e) {
        if (!e.relatedTarget) { present = false; kick(); }
    };
    var onBlur = function () { present = false; kick(); };
    // The page moving under a still pointer is not the pointer moving:
    // whatever is lit settles where it is on the paper, and nothing new
    // is lit until the scrolling stops.
    var onScroll = function () {
        scrolling = true;
        act = 0; travel = 0;
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () { scrollTimer = 0; scrolling = false; }, 140);
        if (live.size) kick();
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
            // On the page, over the paper and the bands, under the header,
            // the menu and anything else the page lifts above it. Shown
            // only while a diamond is.
            canvas.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;display:none;' +
                'z-index:0;pointer-events:none;margin:0;padding:0;border:0;transform:translate3d(0,0,0)';
            canvas.width = 0; canvas.height = 0;
        }
        document.body.appendChild(canvas);
        on = true;
        shownCanvas = false; ctop = -1; CW = CH = 0;
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
        if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = 0; }
        if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
        scrolling = false;
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
        if (canvas) {
            canvas.width = 0; canvas.height = 0;
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        }
        CW = CH = 0;
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
