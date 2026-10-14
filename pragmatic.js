(function () {
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // A polite status line for screen readers, for short confirmations.
    var statusLine = null;
    var announce = function (msg) {
        if (!statusLine) {
            statusLine = document.createElement('p');
            statusLine.className = 'sr-only';
            statusLine.setAttribute('role', 'status');
            document.body.appendChild(statusLine);
        }
        statusLine.textContent = '';
        setTimeout(function () { statusLine.textContent = msg; }, 60);
    };

    // Rows that scroll sideways (long code, the phone nav) fade at each
    // edge where something is cut off. The row is measured again when it
    // resizes, when anything passed in "also" resizes (its content, which
    // grows when the web fonts arrive), and once the fonts are ready.
    var watchOverflow = function (el, onChange, also, prepare) {
        var update = function () {
            if (prepare) prepare();
            var over = el.scrollWidth - el.clientWidth > 1;
            el.classList.toggle('scrolls', over);
            el.classList.toggle('at-start', !over || el.scrollLeft <= 1);
            el.classList.toggle('at-end', !over || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
            if (onChange) onChange(over);
        };
        el.addEventListener('scroll', update, { passive: true });
        if ('ResizeObserver' in window) {
            var ro = new ResizeObserver(update);
            ro.observe(el);
            (also || []).forEach(function (x) { if (x) ro.observe(x); });
        } else {
            window.addEventListener('resize', update, { passive: true });
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
        update();
        return update;
    };

    // Code blocks: line numbers only for files of three lines or more (never
    // for a terminal), a Copy button on the file row, and a fade where a
    // long line runs past the edge.
    var NEAR_FIT = 40;   // px: a block that misses by less than this is fitted
    document.querySelectorAll('.atelier pre, .doc-code pre').forEach(function (pre) {
        var block = pre.closest('.code-snippet, .doc-code');
        var label = block && block.querySelector('.file');
        var name = label ? label.textContent.trim() : '';
        var source = pre.textContent.replace(/\s+$/, '');
        var lines = pre.innerHTML.replace(/\s+$/, '').split('\n');
        if (lines.length >= 3 && !/terminal/i.test(name)) {
            pre.innerHTML = lines.map(function (line) {
                return '<span class="code-line">' + (line === '' ? '&nbsp;' : line) + '</span>';
            }).join('');
        }

        if (label && navigator.clipboard && window.isSecureContext) {
            var btn = document.createElement('button');
            var timer = 0;
            btn.type = 'button';
            btn.className = 'code-copy';
            btn.textContent = 'Copy';
            btn.setAttribute('aria-label', 'Copy code, ' + name);
            btn.addEventListener('click', function () {
                navigator.clipboard.writeText(source).then(function () {
                    btn.textContent = 'Copied';
                    btn.classList.add('done');
                    announce('Copied to the clipboard');
                    clearTimeout(timer);
                    timer = setTimeout(function () {
                        btn.textContent = 'Copy';
                        btn.classList.remove('done');
                    }, 1800);
                }, function () {});
            });
            label.appendChild(btn);
        }

        // A block either fits or clearly scrolls. One that misses its box
        // by a sliver (a width between the breakpoints) is set a touch
        // smaller so it fits, instead of losing its last characters under
        // the fade. The atelier's block is as wide as its code, so the room
        // it has is its wrapper's.
        var wrap = pre.closest('.code-wrap');
        var fit = function () {
            pre.style.fontSize = '';
            if (!pre.getClientRects().length) return;
            var room = wrap ? wrap.clientWidth : pre.clientWidth;
            var need = pre.scrollWidth;
            if (need - room > 1 && need - room <= NEAR_FIT) {
                var size = parseFloat(getComputedStyle(pre).fontSize);
                pre.style.fontSize = (size * (room - 2) / need).toFixed(2) + 'px';
            }
        };

        // A block that scrolls can be reached and scrolled from the keyboard.
        watchOverflow(pre, function (over) {
            if (over) pre.setAttribute('tabindex', '0');
            else pre.removeAttribute('tabindex');
        }, [wrap], fit);
    });

    // Language tabs: real tabs, with the arrow keys, Home and End.
    document.querySelectorAll('[role="tablist"]').forEach(function (list) {
        var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
        var select = function (tab, focus) {
            tabs.forEach(function (t) {
                var on = t === tab;
                t.classList.toggle('active', on);
                t.setAttribute('aria-selected', on ? 'true' : 'false');
                t.tabIndex = on ? 0 : -1;
                var panel = document.getElementById(t.getAttribute('aria-controls'));
                if (panel) {
                    panel.classList.toggle('active', on);
                    panel.hidden = !on;
                }
            });
            if (focus) tab.focus();
        };
        tabs.forEach(function (tab, i) {
            tab.addEventListener('click', function () { select(tab, false); });
            tab.addEventListener('keydown', function (e) {
                var j = -1;
                if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
                else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
                else if (e.key === 'Home') j = 0;
                else if (e.key === 'End') j = tabs.length - 1;
                if (j < 0) return;
                e.preventDefault();
                select(tabs[j], true);
            });
        });
    });

    // Phone nav. On a phone the pages wrap onto two rows; between phone
    // and desktop they fit on one. If the row is ever wider than the
    // screen (a large text setting), it scrolls sideways, and the current
    // page, or a link that takes keyboard focus, is brought fully clear
    // of the faded edges. Only the row scrolls, never the page.
    var nav = document.querySelector('header nav');
    if (nav) {
        var FADE_L = 40, FADE_R = 72;
        var bring = function (a) {
            if (!a || nav.scrollWidth - nav.clientWidth <= 1) return;
            var n = nav.getBoundingClientRect(), r = a.getBoundingClientRect();
            if (r.right > n.right - FADE_R) nav.scrollLeft += r.right - (n.right - FADE_R);
            else if (r.left < n.left + FADE_L) nav.scrollLeft -= (n.left + FADE_L) - r.left;
        };
        var current = nav.querySelector('[aria-current]');
        var settle = function () { bring(current); };
        settle();
        watchOverflow(nav, null, [nav.firstElementChild, nav.lastElementChild]);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
        nav.addEventListener('focusin', function (e) {
            bring(e.target.closest ? e.target.closest('a') : null);
        });
    }

    // Home cover: Pragmatic Server's console shows the run refund-20417
    // as it ended, and this plays it back as a short film, on a loop.
    // Every frame is the finished page, at full ink: the playback only
    // moves over it, and a camera moves over the page.
    //
    // A loop, from its start:
    // - the two cards leave, and the camera goes in close on the top of
    //   the run, a few rows filling the frame, its top and foot out of
    //   focus;
    // - a playhead reads attempt 1's four steps at the run's own pace
    //   (compressed), the camera following it down, and warms as it
    //   reaches the crash, whose rule swells;
    // - the camera pulls out to the whole page, and as it settles the
    //   Anchoring and Evidence check cards come into their places over its
    //   edge, while attempt 2 starts and the four steps it read back from
    //   the journal glow (they were not run again); its reply, its end;
    //   then the chain's diamond and each timestamp service's diamond swell
    //   once, in the order they were written, and last the check's result,
    //   which is worked out as the page is viewed;
    // - the finished page holds, and the loop begins again.
    // On a narrow screen the cards come in over the top of the sheet, once
    // the steps have been read back. A page that has just opened starts on
    // the finished page, as written in the HTML, so nothing jumps.
    //
    // It holds where it is, like a paused film, while the pointer is over
    // the console or its caption, while the console is mostly off-screen
    // or the tab is hidden, and from the Pause button in the caption. The
    // button's word changes only when the visitor presses it. With reduced
    // motion it never plays.
    //
    // The camera, the cards and the soft focus move with the Web
    // Animations API on transform and opacity only, so they run on the
    // compositor; the camera rests, untransformed, on the whole page, so
    // the page is drawn at its own size while it holds.
    // Its own scope: the footer below declares names of its own.
    (function () {
        var replay = document.querySelector('.replay');
        if (!replay || !replay.querySelector('.pc-lens') || !Element.prototype.animate) return;
        var still = window.matchMedia('(prefers-reduced-motion: reduce)');
        var one = function (s) { return replay.querySelector(s); };
        var all = function (s) { return Array.prototype.slice.call(replay.querySelectorAll(s)); };

        var stage = one('.pc-stage');
        var lens = one('.pc-lens');
        var sheet = one('.pc-sheet');
        var tl = one('.tl');
        var head = one('.pc-head');
        var cap = one('.pc-cap');
        var toggle = one('.pc-toggle');
        var toggleWord = one('.pc-toggle .w');
        // 0-3 attempt 1's steps · 4 the crash · 5 attempt 2's start ·
        // 6 its reply · 7 its end
        var rows = all('.rows > li');
        var CRASH = 4, RESUME = 5;
        var chainMark = one('.chain');
        var result = one('.dl .res .dd');
        var ops = all('.op');
        var pulse = one('.pc-pulse');
        var anchorCard = one('.card.anchor');
        var checkCard = one('.card.check');
        var dof = all('.pc-dof i:not(.edge):not(.mist)');
        var edgeTop = one('.pc-dof .edge.top');
        var edgeFoot = one('.pc-dof .edge.foot');
        var edgeRight = one('.pc-dof .edge.right');
        var edgeVeil = one('.pc-dof .edge.veil');
        var mist = one('.pc-dof .mist');
        var cardsBox = one('.pc-cards');
        var reelBox = one('.pc-reel');
        var reel = one('.pc-reel video');
        var moved = rows.concat(chainMark, result, ops, pulse);

        // A one-off swell: restart the animation even if it ran before.
        var hit = function (el) {
            if (!el) return;
            el.classList.remove('hit');
            void el.offsetWidth;
            el.classList.add('hit');
        };

        // The playhead sits on one row at a time.
        var at = -1;
        var place = function (jump) {
            if (at < 0) return;
            if (jump) head.classList.add('is-jump');
            head.style.height = rows[at].offsetHeight + 'px';
            head.style.transform = 'translateY(' + rows[at].offsetTop + 'px)';
            head.classList.toggle('alarm', at === CRASH);
            if (jump) { void head.offsetWidth; head.classList.remove('is-jump'); }
        };
        var read = function (i) {
            at = i;
            place(!head.classList.contains('on'));
            head.classList.add('on');
            if (i === CRASH) hit(rows[i]);
        };
        var lift = function () { head.classList.remove('on'); at = -1; };

        // Attempt 2's start: the four steps it read back glow in turn.
        for (var g = 0; g < 4; g++) rows[g].style.setProperty('--gd', (g * 0.1) + 's');
        var readBack = function () {
            for (var i = 0; i < 4; i++) rows[i].classList.add('glow');
            rows[RESUME].classList.add('glow');
        };

        // Clear every passing effect: the page as it ended.
        var settle = function () {
            moved.forEach(function (el) { if (el) el.classList.remove('glow', 'hit'); });
        };

        // Curves. Every move leaves its start promptly and lands softly,
        // so it reads as brisk without ever snapping into place.
        var bezier = function (x1, y1, x2, y2) {
            var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
            var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
            var X = function (t) { return ((ax * t + bx) * t + cx) * t; };
            return function (x) {
                if (x <= 0) return 0;
                if (x >= 1) return 1;
                var lo = 0, hi = 1, t = x;
                for (var i = 0; i < 40; i++) {
                    if (X(t) < x) lo = t; else hi = t;
                    t = (lo + hi) / 2;
                }
                return ((ay * t + by) * t + cy) * t;
            };
        };
        var ZOOM_IN = bezier(0.4, 0, 0.15, 1);
        var ZOOM_OUT = bezier(0.4, 0, 0.15, 1);
        var FOLLOW = bezier(0.42, 0, 0.36, 1);
        var RISE = bezier(0.2, 0.75, 0.25, 1);
        var smooth = function (a, b, x) {
            x = Math.min(1, Math.max(0, (x - a) / (b - a)));
            return x * x * (3 - 2 * x);
        };

        // The loop, in milliseconds from its start: about 12.5 seconds,
        // brisk but never hurried. Comments give each row's time in the
        // journal (UTC, 14 Oct 2026).
        var LOOP = 12500;
        var T = {
            out: 0, outGap: 120, outD: 450,       // the check leaves, then the anchor
            zin: 300, zinD: 1300,                 // the camera goes in
            dofIn: 900, dofInD: 700,              // and the frame's top and foot go soft
            pulse: 1400,                          // the caption's diamond swells
            follow: 1600, followD: 2800,          // the camera follows the playhead down
            zout: 4750, zoutD: 1300,              // the camera pulls out
            dofOutD: 700,
            enter: 5550, enterGap: 130, enterD: 650,     // the anchor, then the check, come in
            enterNarrow: 6250,                    // on a narrow screen, once the steps are read back
            boot: 10100                           // a page that has just opened starts here
        };
        var PLAN = [
            [0,     function (late) { settle(); lift(); startCards(late); }],
            [T.zin, function (late) { startCamera(late); }],
            [T.dofIn, function (late) { startDof(late); startReel(late); }],
            [T.pulse, function () { hit(pulse); }],
            [1600,  function () { read(0); }],                      // 04:23:34.106 model call
            [2250,  function () { read(1); }],                      // 04:23:35.030 tool call
            [2750,  function () { read(2); }],                      // 04:23:35.197 model call
            [3350,  function () { read(3); }],                      // 04:23:36.110 tool call, then the process is killed
            [4000,  function () { read(CRASH); }],                  // attempt 1 has no end
            [4900,  function () { read(RESUME); }],                 // 04:24:47.548 attempt 2 starts
            [5300,  readBack],
            [6250,  function () { read(6); }],                      // 04:24:47.563 model call
            [6850,  function () { read(7); }],                      // 04:24:48.475 attempt 2 ends ok
            [7450,  function () { lift(); hit(chainMark); }],       // the chain verifies
            [7950,  function () { hit(ops[0]); }],                  // 04:24:53, DigiCert
            [8350,  function () { hit(ops[1]); }],                  // and Sectigo
            [8950,  function () { hit(result); }],                  // the check's result, as the page is viewed
            [LOOP,  null]                                           // and again
        ];

        // Where things are, in the stage's own pixels, measured from the
        // sheet's top left: the frame, the line the camera keeps the
        // playhead on (the middle of the frame above the caption), the
        // close-up's scale, and the rows it follows.
        var G = null;
        var measure = function () {
            var narrow = replay.clientWidth < 720;
            var cs = getComputedStyle(lens);
            var padT = parseFloat(cs.paddingTop) || 0;
            var padB = parseFloat(cs.paddingBottom) || 0;
            var padL = parseFloat(cs.paddingLeft) || 0;
            var W = lens.clientWidth - padL;
            var H = sheet.offsetHeight;
            var lr = lens.getBoundingClientRect();
            var k = lr.height / (lens.offsetHeight || 1) || 1;
            var top = -padT, bottom = H + padB;
            var capTop = Math.min(bottom, (cap.getBoundingClientRect().top - lr.top) / k - padT);
            // On a narrow screen the line sits a little higher, so the first
            // rows can be read close without the sheet's top coming into frame.
            var focus = top + (capTop - top) * (narrow ? 0.42 : 0.5);
            var mid = function (r) { return tl.offsetTop + r.offsetTop + r.offsetHeight / 2; };
            // Close enough that the times and hashes are out of frame to the
            // right, so no word is cut by the frame's edge; on a narrow
            // screen, where the rows have no times, a gentler close-up.
            var S = 1.32, tmL = 0, tmR = 0;
            var tm = one('.rows .tm'), hs = one('.rows .h');
            if (!narrow && tm && tm.getClientRects().length) {
                var sr = sheet.getBoundingClientRect();
                var ks = sr.width / (sheet.offsetWidth || 1) || 1;
                tmL = (tm.getBoundingClientRect().left - sr.left) / ks;
                tmR = (Math.max(tm.getBoundingClientRect().right, hs ? hs.getBoundingClientRect().right : 0) - sr.left) / ks;
                S = Math.min(2.1, Math.max(1.7, (W + 6) / tmL));
            }
            // The sheet's own top and foot never come into the close-up.
            var lo = (focus - top) / S, hi = (focus - bottom + S * H) / S;
            var keep = function (y) { return Math.min(hi, Math.max(lo, y)); };
            // The paper under the caption: from a little above it to the
            // foot of the frame.
            edgeFoot.style.height = (bottom - capTop + 28).toFixed(1) + 'px';
            // The mist, on a narrow screen: from the sheet's top to a little
            // below the cards.
            if (narrow) mist.style.height = (cardsBox.offsetTop + cardsBox.offsetHeight + 80).toFixed(1) + 'px';
            return {
                narrow: narrow,
                S: S,
                W: W,
                W0: sheet.offsetWidth,
                tmL: tmL,
                tmR: tmR,
                H: H,
                top: top,
                capTop: capTop,
                focus: focus,
                yStart: keep(mid(rows[0]) - rows[0].offsetHeight * 0.3),
                yCrash: keep(mid(rows[CRASH])),
                dy: narrow ? 34 : 28
            };
        };

        // Every move is one animation, sampled from the curves above.
        var films = {};
        var running = false;
        // Only transform and opacity are animated, so every move can run on
        // the compositor. A layer of the soft focus, hidden at rest, is
        // shown for as long as its animation lasts.
        var run = function (key, el, frames, dur, late) {
            if (films[key]) films[key].cancel();
            var a = el.animate(frames, { duration: dur, easing: 'linear', fill: 'none' });
            a.currentTime = Math.min(dur, late || 0);   // before its start, it waits
            if (!running) a.pause();
            var shown = el.closest('.pc-dof, .pc-reel');
            if (shown) el.style.visibility = 'visible';
            var done = function () {
                if (films[key] !== a) return;
                delete films[key];
                if (shown) el.style.visibility = '';
            };
            a.onfinish = done;
            a.oncancel = done;
            films[key] = a;
            return a;
        };

        // The camera: in to the top of the run, down with the playhead to
        // the crash, and out to the whole page. The scale moves evenly to
        // the eye (on a log scale) and the row it is on moves on a straight
        // line, so nothing swims.
        var camAt = function (t) {
            var u, yc, s;
            if (t <= T.zin || t >= T.zout + T.zoutD) return { s: 1, y: 0 };
            if (t < T.zin + T.zinD) { u = ZOOM_IN((t - T.zin) / T.zinD); yc = G.yStart; }
            else if (t < T.zout) {
                yc = G.yStart + (G.yCrash - G.yStart) * FOLLOW((t - T.follow) / T.followD);
                return { s: G.S, y: G.focus - G.S * yc };
            } else { u = 1 - ZOOM_OUT((t - T.zout) / T.zoutD); yc = G.yCrash; }
            s = Math.pow(G.S, u);
            return { s: s, y: yc + (G.focus - yc) * u - s * yc };
        };
        var cameraFrames = function () {
            var t0 = T.zin, t1 = T.zout + T.zoutD, D = t1 - t0, K = [];
            var add = function (t) {
                var c = camAt(t);
                K.push({ offset: Math.min(1, Math.max(0, (t - t0) / D)), transform: 'translate(0px, ' + c.y.toFixed(2) + 'px) scale(' + c.s.toFixed(5) + ')' });
            };
            var N = 48, i;
            for (i = 0; i <= N; i++) add(T.zin + i / N * T.zinD);
            for (i = 0; i <= N; i++) add(T.follow + i / N * T.followD);
            for (i = 0; i <= N; i++) add(T.zout + i / N * T.zoutD);
            return K;
        };
        var startCamera = function (late) {
            run('camera', sheet, cameraFrames(), T.zout + T.zoutD - T.zin, late);
            startEdges(late);
        };
        // Each soft edge of the frame is there from just before the sheet
        // runs past it, going in, until just after it is back inside,
        // coming out.
        // The veil is a wider fade at the right edge, there only while
        // the times and hashes are partly in frame, so they slide out of
        // the frame and back in through soft paper.
        var edges = [
            ['edgeTop', edgeTop, function (c) { return c.y < G.top + 1; }],
            ['edgeFoot', edgeFoot, function (c) { return c.y + c.s * G.H > G.capTop - 4; }],
            ['edgeRight', edgeRight, function (c) { return c.s * G.W0 > G.W + 1; }],
            ['edgeVeil', edgeVeil, function (c) { return G.tmL > 0 && c.s * G.tmR > G.W - 8 && c.s * G.tmL < G.W; }]
        ];
        var startEdges = function (late) {
            var t0 = T.zin, t1 = T.zout + T.zoutD + 400, D = t1 - t0;
            edges.forEach(function (e) {
                // When the sheet runs past this edge, as spans of time.
                var spans = [], t, on, from = null;
                for (t = t0; t <= t1; t += 10) {
                    on = e[2](camAt(t));
                    if (on && from == null) from = t;
                    if (!on && from != null) { spans.push([from, t]); from = null; }
                }
                if (from != null) spans.push([from, t1]);
                for (var i = spans.length - 1; i > 0; i--) {
                    if (spans[i][0] - spans[i - 1][1] < 700) { spans[i - 1][1] = spans[i][1]; spans.splice(i, 1); }
                }
                var K = [{ offset: 0, opacity: 0 }];
                var at = function (x) { return Math.min(1, Math.max(K[K.length - 1].offset, (x - t0) / D)); };
                spans.forEach(function (sp) {
                    K.push({ offset: at(sp[0] - 240), opacity: 0 });
                    K.push({ offset: at(sp[0]), opacity: 1 });
                    K.push({ offset: at(sp[1] + 60), opacity: 1 });
                    K.push({ offset: at(sp[1] + 360), opacity: 0 });
                });
                K.push({ offset: 1, opacity: 0 });
                if (e[1]) run(e[0], e[1], K, D, late);
            });
        };

        // The soft focus comes in as the camera arrives and goes as it
        // pulls out.
        var dofFrames = function () {
            var t0 = T.dofIn, t1 = T.zout + T.dofOutD, D = t1 - t0, K = [], N = 16, i, p;
            for (i = 0; i <= N; i++) { p = i / N; K.push({ offset: (p * T.dofInD) / D, opacity: smooth(0, 1, p) }); }
            for (i = 0; i <= N; i++) { p = i / N; K.push({ offset: (T.zout - t0 + p * T.dofOutD) / D, opacity: 1 - smooth(0, 1, p) }); }
            return K;
        };
        var startDof = function (late) {
            var K = dofFrames(), D = T.zout + T.dofOutD - T.dofIn;
            dof.forEach(function (el, i) { run('dof' + i, el, K, D, late); });
        };
        // Filmed footage, if the reel has any, plays for the close-up.
        var startReel = function (late) {
            if (!reel) return;
            run('reel', reelBox, dofFrames(), T.zout + T.dofOutD - T.dofIn, late);
            try { reel.currentTime = Math.max(0, (late || 0) / 1000); } catch (e) {}
            if (running) { var p = reel.play(); if (p && p.catch) p.catch(function () {}); }
        };

        // The cards: each leaves, sinking a little and fading, and comes
        // back, rising into its place, the reverse of how it left.
        var cardFrames = function (leave, enter) {
            var t1 = enter + T.enterD, D = t1 - leave, K = [], N = 20, i, p, e;
            var add = function (t, o, d) {
                K.push({ offset: Math.min(1, Math.max(0, (t - leave) / D)), opacity: o, transform: 'translateY(' + (G.dy * d).toFixed(2) + 'px) scale(' + (1 - 0.012 * d).toFixed(5) + ')' });
            };
            for (i = 0; i <= N; i++) { p = i / N; e = 1 - RISE(1 - p); add(leave + p * T.outD, 1 - smooth(0.25, 1, p), e); }
            for (i = 0; i <= N; i++) { p = i / N; e = 1 - RISE(p); add(enter + p * T.enterD, smooth(0, 0.75, p), e); }
            return { K: K, D: D };
        };
        var startCards = function (late) {
            var enter = G.narrow ? T.enterNarrow : T.enter;
            var c = cardFrames(T.out, enter + T.enterGap);
            run('check', checkCard, c.K, c.D, late);
            var a = cardFrames(T.out + T.outGap, enter);
            run('anchor', anchorCard, a.K, a.D, (late || 0) - T.outGap);
            if (G.narrow) {
                // The sheet clears as the cards leave, and mists over again
                // just before they come back.
                var D = c.D, o = function (t) { return (t - T.out) / D; };
                run('mist', mist, [
                    { offset: 0, opacity: 1 },
                    { offset: o(T.out + 250), opacity: 1 },
                    { offset: o(T.out + 850), opacity: 0 },
                    { offset: o(enter - 300), opacity: 0 },
                    { offset: o(enter + 200), opacity: 1 },
                    { offset: 1, opacity: 1 }
                ], D, late);
            } else if (films.mist) { films.mist.cancel(); delete films.mist; }
        };

        // When the page is laid out again (a resize, the type arriving),
        // each move in progress is measured again and carries on from the
        // same moment.
        var rebuild = function () {
            if (!live) return;
            var before = {};
            Object.keys(films).forEach(function (key) {
                before[key] = { t: films[key].currentTime, paused: films[key].playState === 'paused' };
            });
            G = measure();
            var camKeys = ['camera', 'edgeTop', 'edgeFoot', 'edgeRight', 'edgeVeil'];
            var tc = null;
            camKeys.forEach(function (key) { if (before[key] && tc == null) tc = before[key].t; });
            if (tc != null) {
                startCamera(tc);
                camKeys.forEach(function (key) {
                    if (!before[key] && films[key]) { films[key].cancel(); delete films[key]; }
                    else if (before[key] && before[key].paused && films[key]) films[key].pause();
                });
            }
            if (before.check || before.anchor || before.mist) {
                var t = before.check ? before.check.t : before.mist ? before.mist.t : (before.anchor.t + T.outGap);
                startCards(t);
                ['check', 'anchor', 'mist'].forEach(function (key) {
                    if (!before[key] && films[key]) { films[key].cancel(); delete films[key]; }
                    else if (before[key] && before[key].paused && films[key]) films[key].pause();
                });
            }
            place(true);
        };
        var pending = 0;
        if ('ResizeObserver' in window) {
            new ResizeObserver(function () {
                if (pending) return;
                pending = requestAnimationFrame(function () { pending = 0; rebuild(); });
            }).observe(lens);
            new ResizeObserver(function () { place(true); }).observe(tl);
        }

        // One timer at a time, on a clock that stops while held. Every
        // animation in the console stops and starts with it.
        var next = 0, t0 = 0, now = 0, timer = 0;
        var tick = function () {
            timer = 0;
            var clock = performance.now();
            now = clock - t0;
            while (next < PLAN.length && PLAN[next][0] <= now) {
                var fn = PLAN[next][1], late = now - PLAN[next][0];
                next += 1;
                if (fn) fn(late);
            }
            if (next >= PLAN.length) { next = 0; t0 += LOOP; now -= LOOP; tick(); return; }
            timer = setTimeout(tick, Math.max(0, PLAN[next][0] - now));
        };
        var everything = function () {
            return replay.getAnimations ? replay.getAnimations({ subtree: true }) : Object.keys(films).map(function (k) { return films[k]; });
        };
        var halt = function () {
            replay.classList.add('is-paused');
            if (!running) return;
            running = false;
            clearTimeout(timer);
            timer = 0;
            now = performance.now() - t0;
            everything().forEach(function (a) { if (a.playState === 'running') a.pause(); });
            if (reel) reel.pause();
        };
        var go = function () {
            replay.classList.remove('is-paused');
            if (running) return;
            running = true;
            t0 = performance.now() - now;
            everything().forEach(function (a) { if (a.playState === 'paused') a.play(); });
            if (reel && films.reel) { var p = reel.play(); if (p && p.catch) p.catch(function () {}); }
            tick();
        };

        var live = false, ready = false, seen = true, hovered = false, held = false;
        // The control says what pressing it will do, and only the visitor's
        // own choice changes it: the pointer, scrolling and a hidden tab
        // hold the playback quietly, so the word never changes under the
        // pointer as it reaches for it.
        var label = function () {
            var word = held ? 'Play' : 'Pause';
            toggleWord.textContent = word;
            toggle.setAttribute('aria-label', word + ' the console playback');
        };
        var sync = function () {
            if (live && ready && seen && !document.hidden && !hovered && !held) go(); else halt();
            label();
        };
        // It does what it says.
        toggle.addEventListener('click', function () { held = !held; hovered = false; sync(); });

        var start = function () {
            if (live || still.matches) return;
            live = true;
            G = measure();
            now = T.boot;
            next = 0;
            while (next < PLAN.length && PLAN[next][0] <= now) next += 1;
            at = -1;
            held = false;
            replay.classList.add('is-live', 'is-paused');
            sync();
        };
        var stop = function () {
            if (!live) return;
            halt();
            live = false;
            Object.keys(films).forEach(function (key) { films[key].cancel(); });
            all('.pc-dof i, .pc-reel').forEach(function (el) { el.style.visibility = ''; });
            films = {};
            settle();
            lift();
            replay.classList.remove('is-live', 'is-paused');
            label();
        };

        // A pointer over the console or its caption holds it, so it can be
        // read, and reaching for the control never sets it going again.
        replay.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') { hovered = true; sync(); } });
        replay.addEventListener('pointerleave', function () { if (hovered) { hovered = false; sync(); } });
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                var e = entries[entries.length - 1];
                seen = e.isIntersecting && e.intersectionRatio >= 0.3;
                sync();
            }, { threshold: [0, 0.3, 0.6] }).observe(stage);
        }
        document.addEventListener('visibilitychange', sync);
        var onStill = function () { if (still.matches) stop(); else if (ready) { start(); } };
        if (still.addEventListener) still.addEventListener('change', onStill);
        else if (still.addListener) still.addListener(onStill);

        // Play once the type has arrived (or a second has passed), so the
        // camera and the playhead measure the rows in their own face.
        var fontsIn = document.fonts && document.fonts.ready
            ? Promise.race([document.fonts.ready, new Promise(function (res) { setTimeout(res, 1000); })])
            : Promise.resolve();
        fontsIn.then(function () { ready = true; start(); sync(); });
    })();

    // Footer: back to top, the diamond grid, the mark's diamond and the
    // magnetic invitation. The pointer moments run only for a fine pointer
    // that can hover, never under reduced motion; there, and on touch, the
    // grid is drawn once and stays still.
    var footer = document.querySelector('.pf-colophon');
    if (footer) {
        var stillQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        var fineQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
        var canPlay = function () { return fineQuery.matches && !stillQuery.matches; };

        var toTop = footer.querySelector('.pfc-top');
        if (toTop) {
            toTop.addEventListener('click', function (e) {
                e.preventDefault();
                // Under reduced motion the stylesheet sets scroll-behavior:
                // auto, so 'auto' here is an instant jump.
                window.scrollTo({ top: 0, behavior: stillQuery.matches ? 'auto' : 'smooth' });
                var masthead = document.querySelector('header .masthead');
                if (masthead) masthead.focus({ preventScroll: true });
            });
        }

        var inner = footer.querySelector('.pfc-inner');
        var ctaBand = footer.querySelector('.pfc-cta');
        var baseBand = footer.querySelector('.pfc-base');
        var mark = footer.querySelector('.pfc-word .mark');
        var dm = mark && mark.querySelector('.dm');
        var cta = footer.querySelector('.pfc-cta-link');

        // The grid: a sparse field of 2.5px diamonds that rises out of the
        // ink toward the foot of the band. Its pitch divides the content's
        // width, so columns of diamonds fall on both content edges; its rows
        // are counted from the bottom bar's rule, which runs along one of
        // them (no diamond sits on the rule itself), so the bottom bar's
        // line sits halfway between two rows. A soft vertical mask takes
        // the field from nothing at the band's middle to full strength at
        // its last row, so the invitation and the top of the link columns
        // sit on plain ink and nothing is ever cut out of the field: only a
        // diamond that would fall right on a word is left out, where the
        // word covers its place. No diamond comes within about half a pitch
        // of the band's edges.
        var PITCH = 56;             // px; the pitch is the nearest even division of the content width
        var HALF = 1.25;            // half a resting diamond's width: 2.5px across
        var SWELL = 1.4;            // extra scale right under the pointer: 2.4x at the peak
        var REACH = 120;            // px; target scale is 1 + SWELL * exp(-d^2 / REACH^2)
        var BASE_A = 0.09;          // resting opacity at full strength
        var LIFT_A = 0.07;          // extra opacity at the peak of the swell
        var MAX_A = BASE_A + LIFT_A;
        var FADE_FROM = 0.5;        // the field starts from nothing at this fraction of the band's height
        var CLEAR = 3;              // px around a word where no diamond sits
        var OMEGA = 11;             // the spring, rad/s, critically damped: settles in about 0.4s, no wobble
        var LEVELS = 40;            // opacity steps, so diamonds are filled in a few batches
        var TEXT = '.pfc-line, .pfc-cta-link, .pfc-brand, .pfc-col, .pfc-copy, .pfc-top';

        // The mark and the magnet
        var TURN = 8;               // the diamond turns at most this far from its resting 45deg
        var MAGNET_REACH = 80;      // px from the invitation where the pull starts
        var MAGNET_MAX = 6;         // px the invitation may travel

        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext ? canvas.getContext('2d') : null;
        if (ctx) {
            canvas.className = 'pfc-grid';
            canvas.setAttribute('aria-hidden', 'true');
            footer.insertBefore(canvas, footer.firstChild);
        }

        var W = 0, H = 0, dpr = 1, N = 0, P = PITCH;
        var cx = [], cy = [], quiet = [], sc = [], vel = [];
        var geo = null, ink = '242,239,230', plan = '';
        var buckets = [];
        for (var b = 0; b <= LEVELS; b++) buckets.push([]);

        // The diamonds' colour is the footer's own (var(--ivory)).
        var readColour = function () {
            var m = getComputedStyle(footer).color.match(/[\d.]+/g);
            if (m && m.length >= 3) ink = m[0] + ',' + m[1] + ',' + m[2];
        };

        var shown = function (el) { return el && el.getClientRects().length > 0; };

        // The words in a block, one box per line of every text node, plus
        // the mark and the back-to-top diamond. Block boxes themselves are
        // left out, since they stretch across their whole grid cell; so is
        // any union of the lines, which would leave a rectangle of empty
        // field around a column of short words.
        var range = document.createRange();
        var typeRects = function (el, fr, out) {
            // The invitation may be leaning toward the pointer; measure it at rest.
            var ox = el === cta ? mx : 0, oy = el === cta ? my : 0;
            var add = function (q) {
                if (!q.width || !q.height) return;
                out.push([q.left - ox - fr.left, q.top - oy - fr.top, q.right - ox - fr.left, q.bottom - oy - fr.top]);
            };
            var walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (var n = walk.nextNode(); n; n = walk.nextNode()) {
                if (!/\S/.test(n.nodeValue)) continue;
                range.selectNodeContents(n);
                var rs = range.getClientRects();
                for (var k = 0; k < rs.length; k++) add(rs[k]);
            }
            el.querySelectorAll('svg').forEach(function (s) { add(s.getBoundingClientRect()); });
            if (el === toTop) add(el.getBoundingClientRect());
        };

        // Reads only: where the content, the rules and the words are.
        // A rule is [y, left, right].
        var measure = function (fr) {
            var m = { w: footer.clientWidth, h: footer.clientHeight, left: 0, width: 0, rules: [], zones: [] };
            if (shown(inner)) {
                var ir = inner.getBoundingClientRect();
                m.left = ir.left - fr.left;
                m.width = ir.width;
            }
            var rule = function (el, y) {
                var r = el.getBoundingClientRect();
                m.rules.push([y, r.left - fr.left, r.right - fr.left]);
            };
            if (shown(ctaBand)) rule(ctaBand, ctaBand.getBoundingClientRect().bottom - fr.top - 0.5);
            if (shown(baseBand)) rule(baseBand, baseBand.getBoundingClientRect().top - fr.top + 0.5);
            footer.querySelectorAll(TEXT).forEach(function (el) {
                if (shown(el)) typeRects(el, fr, m.zones);
            });
            return m;
        };

        var smooth = function (e0, e1, x) {
            var u = (x - e0) / (e1 - e0);
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            return u * u * (3 - 2 * u);
        };

        // Writes: the diamonds' places and how strong each one may be.
        var buildGrid = function (m) {
            // The pitch divides the content's width, so a column of
            // diamonds runs down both content edges.
            var p = PITCH;
            if (m.width > 0) p = m.width / Math.max(1, Math.round(m.width / PITCH));
            if (p < 44 || p > 72) p = PITCH;
            P = p;
            var edge = p * 0.45;    // the field keeps this far from the band's edges

            // Columns from the content's left edge.
            var k0 = Math.ceil((edge - m.left) / p - 1e-6);
            var k1 = Math.floor((W - edge - m.left) / p + 1e-6);

            // Rows step out by the pitch from the bottom bar's rule.
            var y0 = m.rules.length ? m.rules[m.rules.length - 1][0] : H - p / 2;
            var j0 = Math.ceil((edge - y0) / p - 1e-6);
            var j1 = Math.floor((H - edge - y0) / p + 1e-6);

            // The mask: nothing down to the band's middle, then a long, soft
            // rise to full strength at the last row. No edge is ever drawn.
            var f0 = H * FADE_FROM, f1 = Math.max(y0 + j1 * p, f0 + p);

            cx = []; cy = []; quiet = [];
            for (var j = j0; j <= j1; j++) {
                var y = y0 + j * p;
                var a = smooth(f0, f1, y);
                if (a < 0.02) continue;
                var sy = (Math.round(y * dpr - 0.5) + 0.5) / dpr;
                for (var k = k0; k <= k1; k++) {
                    var x = m.left + k * p;
                    var skip = false, z, r;
                    // No diamond sits on a rule; past the rule's ends, its row
                    // carries on in the margins.
                    for (z = 0; z < m.rules.length && !skip; z++) {
                        r = m.rules[z];
                        skip = Math.abs(y - r[0]) < 6 && x > r[1] - 6 && x < r[2] + 6;
                    }
                    // Nor right on a word, where the word covers its place.
                    for (z = 0; z < m.zones.length && !skip; z++) {
                        r = m.zones[z];
                        skip = x > r[0] - CLEAR && x < r[2] + CLEAR && y > r[1] - CLEAR && y < r[3] + CLEAR;
                    }
                    if (skip) continue;
                    var sx = (Math.round(x * dpr - 0.5) + 0.5) / dpr;
                    cx.push(sx); cy.push(sy); quiet.push(a);
                }
            }
            N = cx.length;
            sc = new Float32Array(N); vel = new Float32Array(N);
            for (var i = 0; i < N; i++) sc[i] = 1;
        };

        // Untransformed positions of the mark's centre and the invitation.
        var measureGeo = function (fr) {
            var m = shown(mark) ? mark.getBoundingClientRect() : null;
            var c = shown(cta) ? cta.getBoundingClientRect() : null;
            return {
                markX: m ? m.left + m.width / 2 - fr.left : 0,
                markY: m ? m.top + m.height / 2 - fr.top : 0,
                cta: c ? { l: c.left - mx - fr.left, t: c.top - my - fr.top, w: c.width, h: c.height } : null
            };
        };

        var draw = function () {
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            var lv, i, k;
            for (lv = 0; lv <= LEVELS; lv++) buckets[lv].length = 0;
            for (i = 0; i < N; i++) {
                var lift = (sc[i] - 1) / SWELL;
                var a = (BASE_A + LIFT_A * (lift < 0 ? 0 : lift > 1 ? 1 : lift)) * quiet[i];
                buckets[Math.round(a / MAX_A * LEVELS)].push(i);
            }
            for (lv = 1; lv <= LEVELS; lv++) {
                var list = buckets[lv];
                if (!list.length) continue;
                ctx.fillStyle = 'rgba(' + ink + ',' + (lv / LEVELS * MAX_A).toFixed(4) + ')';
                ctx.beginPath();
                for (k = 0; k < list.length; k++) {
                    i = list[k];
                    var x = cx[i], y = cy[i], h = HALF * sc[i];
                    ctx.moveTo(x, y - h);
                    ctx.lineTo(x + h, y);
                    ctx.lineTo(x, y + h);
                    ctx.lineTo(x - h, y);
                    ctx.closePath();
                }
                ctx.fill();
            }
        };

        // Reads first (sizes, columns, type), then writes (the canvas).
        var layout = function () {
            var fr = footer.getBoundingClientRect();
            var d = Math.min(window.devicePixelRatio || 1, 2);
            var m = ctx ? measure(fr) : null;
            geo = measureGeo(fr);
            if (!ctx) return;
            // On a phone the stylesheet hides the field: the type leaves no
            // room for more than a few stray rows of it.
            if (!shown(canvas)) { N = 0; plan = ''; return; }
            var key = [m.w, m.h, d, m.left, m.width, m.rules.join(), m.zones.join()].join('|');
            if (key === plan) return;
            plan = key;
            if (m.w !== W || m.h !== H || d !== dpr) {
                W = m.w; H = m.h; dpr = d;
                canvas.width = Math.round(W * dpr);
                canvas.height = Math.round(H * dpr);
            }
            buildGrid(m);
            draw();
        };

        var inside = false, visible = true;
        var px = 0, py = 0;         // pointer, viewport coordinates
        var turn = 0;               // the mark's diamond, degrees from rest (eased)
        var mx = 0, my = 0;         // the invitation's offset (eased)
        var raf = 0, last = 0;

        var ease = function (rate, dt) { return 1 - Math.pow(1 - rate, dt * 60); };

        // One step of a critically damped spring for every diamond toward
        // its target scale (the exact solution, so any frame time is stable).
        // Returns 0 when nothing changed, 1 when some diamond moved but all
        // have now settled, 2 while any is still on its way.
        var stepGrid = function (dt, tx, ty, on) {
            var r2 = REACH * REACH, cut2 = 9 * r2;
            var e = Math.exp(-OMEGA * dt);
            var state = 0;
            for (var i = 0; i < N; i++) {
                var target = 1;
                if (on) {
                    var dx = cx[i] - tx, dy = cy[i] - ty, d2 = dx * dx + dy * dy;
                    if (d2 < cut2) target += SWELL * Math.exp(-d2 / r2);
                    if (target < 1.001) target = 1;
                }
                var s = sc[i], v = vel[i];
                if (s === target && v === 0) continue;
                var x = s - target;
                var c = v + OMEGA * x;
                x = (x + c * dt) * e;
                v = (v - OMEGA * c * dt) * e;
                if (Math.abs(x) < 0.002 && Math.abs(v) < 0.01) { x = 0; v = 0; if (!state) state = 1; }
                else state = 2;
                sc[i] = target + x; vel[i] = v;
            }
            return state;
        };

        var frame = function (now) {
            raf = 0;
            if (!canPlay()) { rest(); return; }
            var dt = last ? Math.min(now - last, 50) / 1000 : 1 / 60;
            last = now;

            // read
            var fr = footer.getBoundingClientRect();
            if (!geo) geo = measureGeo(fr);
            var tx = px - fr.left, ty = py - fr.top;
            var on = inside && tx >= 0 && ty >= 0 && tx <= fr.width && ty <= fr.height;
            var busy = false;

            // 1 · the grid swells under the pointer and settles behind it
            var grid = N ? stepGrid(dt, tx, ty, on) : 0;
            if (grid === 2) busy = true;

            // 2 · the mark's diamond turns a corner toward the pointer: the
            // turn is sin(4 theta), so it is continuous all the way round and
            // never leaves +/-TURN
            var tTurn = 0;
            if (on && dm) {
                var ax = tx - geo.markX, ay = ty - geo.markY;
                var ad = Math.sqrt(ax * ax + ay * ay);
                tTurn = TURN * Math.sin(4 * Math.atan2(ay, ax)) * Math.min(1, ad / 80);
            }
            turn += (tTurn - turn) * ease(0.09, dt);
            if (Math.abs(tTurn - turn) < 0.05) turn = tTurn; else busy = true;

            // 3 · the invitation leans toward a pointer within reach
            var gx = 0, gy = 0;
            if (on && geo.cta) {
                var c = geo.cta;
                var ex = Math.max(c.l - tx, 0, tx - (c.l + c.w));
                var ey = Math.max(c.t - ty, 0, ty - (c.t + c.h));
                var d = Math.sqrt(ex * ex + ey * ey);
                if (d < MAGNET_REACH) {
                    var pull = 1 - d / MAGNET_REACH;
                    gx = (tx - (c.l + c.w / 2)) * 0.2 * pull;
                    gy = (ty - (c.t + c.h / 2)) * 0.2 * pull;
                    var len = Math.sqrt(gx * gx + gy * gy);
                    if (len > MAGNET_MAX) { gx *= MAGNET_MAX / len; gy *= MAGNET_MAX / len; }
                }
            }
            var km = ease(0.15, dt);
            mx += (gx - mx) * km;
            my += (gy - my) * km;
            if (Math.abs(gx - mx) < 0.05 && Math.abs(gy - my) < 0.05) { mx = gx; my = gy; } else busy = true;

            // write
            if (grid) draw();
            if (dm) dm.style.transform = turn ? 'translate(50px,50px) rotate(' + (45 + turn).toFixed(2) + 'deg) translate(-50px,-50px)' : '';
            if (cta) cta.style.transform = mx || my ? 'translate3d(' + mx.toFixed(2) + 'px,' + my.toFixed(2) + 'px,0)' : '';

            if (busy) raf = requestAnimationFrame(frame);
            else last = 0;
        };

        var kick = function () {
            if (!raf && visible && !document.hidden && canPlay()) raf = requestAnimationFrame(frame);
        };
        var halt = function () {
            if (raf) cancelAnimationFrame(raf);
            raf = 0; last = 0;
        };

        // Back to the still footer: every diamond at rest, the mark and
        // the invitation on their exact resting geometry.
        var rest = function () {
            halt();
            inside = false;
            window.removeEventListener('scroll', kick);
            for (var i = 0; i < N; i++) { sc[i] = 1; vel[i] = 0; }
            turn = 0; mx = 0; my = 0;
            if (dm) dm.style.transform = '';
            if (cta) cta.style.transform = '';
            draw();
        };

        var enter = function (e) {
            if (e.pointerType === 'touch' || !canPlay()) return;
            px = e.clientX; py = e.clientY;
            if (!inside) {
                inside = true;
                window.addEventListener('scroll', kick, { passive: true });
            }
            kick();
        };
        footer.addEventListener('pointerenter', enter, { passive: true });
        footer.addEventListener('pointermove', enter, { passive: true });
        footer.addEventListener('pointerleave', function () {
            if (!inside) return;
            inside = false;
            window.removeEventListener('scroll', kick);
            kick();
        }, { passive: true });

        readColour();
        layout();

        var relayout = function () { layout(); kick(); };
        if ('ResizeObserver' in window) {
            new ResizeObserver(relayout).observe(footer);
        } else {
            window.addEventListener('resize', relayout, { passive: true });
        }
        if (document.fonts) {
            if (document.fonts.ready) document.fonts.ready.then(relayout);
            if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', relayout);
        }
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                visible = entries[entries.length - 1].isIntersecting;
                if (visible) { layout(); kick(); } else halt();
            }).observe(footer);
        }
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) halt(); else kick();
        });

        [stillQuery, fineQuery].forEach(function (q) {
            var onChange = function () { if (!canPlay()) rest(); };
            if (q.addEventListener) q.addEventListener('change', onChange);
            else if (q.addListener) q.addListener(onChange);
        });
    }


    // Reveal on scroll, only for what starts below the fold. The cover, the
    // page covers and anything already on screen are never hidden, so the
    // headline is there from the first frame.
    if (reducedMotion) return;

    var selectors = [
        '.spread .statement',
        '.index-title', '.index-row', '.running-head', '.look',
        '.atelier .at-title', '.at-copy', '.at-note', '.code-wrap',
        '.facing-lede', '.facing-body', '.facing-col',
        '.book-lede', '.book-entry', '.compare-col', '.edition', '.editions-note',
        '.tier', '.tiers-note',
        '.essay .measure > p', '.essay .pull', '.essay h3', '.thm',
        '.qa-item', '.news-item', '.news-empty',
        '.doc .measure > *', '.doc-code', '.doc-table', '.doc-note',
        '.finale > *'
    ];
    var fold = window.innerHeight;
    var els = Array.prototype.slice.call(document.querySelectorAll(selectors.join(',')))
        .filter(function (el) { return el.getBoundingClientRect().top > fold; });
    var perParent = new Map();
    els.forEach(function (el) {
        el.classList.add('reveal');
        var p = el.parentElement;
        var n = perParent.get(p) || 0;
        el.style.transitionDelay = Math.min(n * 110, 550) + 'ms';
        perParent.set(p, n + 1);
    });

    if (!('IntersectionObserver' in window)) {
        els.forEach(function (el) { el.classList.add('on'); });
        return;
    }
    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (e.isIntersecting) {
                e.target.classList.add('on');
                io.unobserve(e.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { io.observe(el); });
})();
