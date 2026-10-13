(function () {
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Code line numbers
    document.querySelectorAll('.atelier pre, .doc-code pre').forEach(function (pre) {
        pre.innerHTML = pre.innerHTML.split('\n').map(function (line) {
            return '<span class="code-line">' + (line === '' ? '&nbsp;' : line) + '</span>';
        }).join('');
    });

    // Language tabs
    document.querySelectorAll('.lang-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            var lang = tab.dataset.lang;
            document.querySelectorAll('.lang-tab').forEach(function (t) {
                t.classList.toggle('active', t === tab);
            });
            document.querySelectorAll('.code-snippet').forEach(function (s) {
                s.classList.toggle('active', s.dataset.lang === lang);
            });
        });
    });

    // Hero journal: the runtime playing itself
    var journal = document.querySelector('.cj-lines');
    if (journal) {
        var SCRIPT = [
            { t: 'run agent-42 · begin', hl: false, pause: 0 },
            { t: 'step 01 · oracle("plan") · journaled', hl: false, pause: 0 },
            { t: 'step 02 · oracle("probe 0") · journaled', hl: false, pause: 0 },
            { t: 'step 03 · oracle("probe 1") · journaled', hl: false, pause: 0 },
            { t: 'step 04 · oracle("probe 2") · journaled', hl: false, pause: 300 },
            { t: '× process crashed', hl: true, pause: 1100 },
            { t: 'supervisor · restore from journal', hl: false, pause: 0 },
            { t: 'resume at step 04 · no re-sampling', hl: true, pause: 300 },
            { t: 'step 05 · oracle("probe 3") · journaled', hl: false, pause: 0 },
            { t: 'step 06 · effect("publish") · write-ahead', hl: false, pause: 0 },
            { t: 'run complete · report(4 findings)', hl: false, pause: 300 },
            { t: 'replay · trace reproduced exactly', hl: true, pause: 0 }
        ];

        var makeLine = function (entry) {
            var line = document.createElement('div');
            line.className = 'cj-line' + (entry.hl ? ' hl' : '');
            var d = document.createElement('span');
            d.className = 'cj-d';
            var t = document.createElement('span');
            t.className = 'cj-t';
            t.textContent = entry.t;
            line.appendChild(d);
            line.appendChild(t);
            return line;
        };

        if (reducedMotion) {
            SCRIPT.forEach(function (entry) {
                var line = makeLine(entry);
                line.classList.add('on');
                journal.appendChild(line);
            });
        } else {
            var STEP = 780;
            var i = 0;
            var tick = function () {
                if (i >= SCRIPT.length) {
                    // hold the finished run, then start over
                    setTimeout(function () {
                        journal.innerHTML = '';
                        i = 0;
                        setTimeout(tick, 500);
                    }, 3400);
                    return;
                }
                var entry = SCRIPT[i];
                var line = makeLine(entry);
                journal.appendChild(line);
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () { line.classList.add('on'); });
                });
                i += 1;
                setTimeout(tick, STEP + entry.pause);
            };
            setTimeout(tick, 900);
        }
    }

    // Reveal on scroll
    if (reducedMotion) return;

    var selectors = [
        '.cover-copy > *', '.cover-journal', '.page-cover > *', '.spread .statement',
        '.index-title', '.index-row', '.running-head', '.look',
        '.atelier h2', '.at-copy', '.at-note', '.code-wrap',
        '.facing-lede', '.facing-body', '.facing-col',
        '.book-lede', '.book-entry', '.edition', '.editions-note',
        '.tier', '.tiers-note',
        '.essay .measure > p', '.essay .pull', '.essay h3', '.thm',
        '.qa-item', '.news-item', '.news-empty',
        '.doc-sub', '.doc .measure > *', '.doc-code', '.doc-table', '.doc-note',
        '.article > *', '.finale > *'
    ];
    var els = Array.prototype.slice.call(document.querySelectorAll(selectors.join(',')));
    var perParent = new Map();
    els.forEach(function (el) {
        el.classList.add('reveal');
        var p = el.parentElement;
        var n = perParent.get(p) || 0;
        el.style.transitionDelay = Math.min(n * 110, 550) + 'ms';
        perParent.set(p, n + 1);
    });

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
