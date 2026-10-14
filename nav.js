// The menu on narrow screens.
//
// Below 900px the header is the masthead and a Menu button (see "The
// menu" in pragmatic.css). The button opens the pages full screen. While
// the menu is open, focus stays inside it, everything behind it is set
// aside (inert) and holds still, and Escape, Close, any link in it, or a
// window widened past the breakpoint closes it. Closing with Escape or
// Close puts focus back on the Menu button.
//
// Without scripts the stylesheet shows the pages in a row instead, so the
// header works the same with or without this file.
(function () {
    var button = document.querySelector('header .menu-btn[aria-controls]');
    var menu = button && document.getElementById(button.getAttribute('aria-controls'));
    if (!menu) return;

    var closeButton = menu.querySelector('.menu-close');
    var root = document.documentElement;
    var narrow = window.matchMedia('(max-width: 899.98px)');
    var isOpen = false;
    var setAside = [];   // what was made inert while the menu is open

    var visible = function (el) {
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    };
    var focusables = function () {
        return Array.prototype.filter.call(
            menu.querySelectorAll('a[href], button:not([disabled])'), visible);
    };
    var focus = function (el) {
        if (!el) return;
        el.focus({ preventScroll: true });
        // Safari can refuse focus until the menu's new style has applied.
        if (document.activeElement !== el) {
            requestAnimationFrame(function () { el.focus({ preventScroll: true }); });
        }
    };

    // Everything outside the menu, at every level up to the body, is made
    // inert: the masthead and button beside it, the page, the footer.
    var setOutsideInert = function (on) {
        if (on) {
            for (var el = menu; el && el.parentElement && el !== document.body; el = el.parentElement) {
                Array.prototype.forEach.call(el.parentElement.children, function (sib) {
                    if (sib === el || sib.inert || sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') return;
                    sib.inert = true;
                    setAside.push(sib);
                });
            }
        } else {
            setAside.forEach(function (sib) { sib.inert = false; });
            setAside = [];
        }
    };

    // Opened from the keyboard, focus goes to the first page. Opened by a
    // tap or a click, it goes to the menu itself, so no page looks chosen;
    // the next Tab reaches the first link.
    var open = function (fromKeyboard) {
        if (isOpen) return;
        isOpen = true;
        button.setAttribute('aria-expanded', 'true');
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-modal', 'true');
        menu.setAttribute('aria-label', 'Menu');
        menu.setAttribute('tabindex', '-1');
        root.classList.add('menu-open');
        menu.classList.add('is-open');
        setOutsideInert(true);
        focus(fromKeyboard ? (menu.querySelector('nav a') || closeButton) : menu);
    };

    var close = function (returnFocus) {
        if (!isOpen) return;
        isOpen = false;
        button.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        root.classList.remove('menu-open');
        menu.removeAttribute('role');
        menu.removeAttribute('aria-modal');
        menu.removeAttribute('aria-label');
        menu.removeAttribute('tabindex');
        setOutsideInert(false);
        if (returnFocus) focus(button);
    };

    // A click from Enter or Space has no pointer behind it (detail 0).
    button.addEventListener('click', function (e) { open(e.detail === 0); });
    if (closeButton) closeButton.addEventListener('click', function () { close(true); });

    // A link closes the menu: the page it opens starts with the menu shut,
    // and a link that stays on this page (an email address) leaves focus
    // on the button.
    menu.addEventListener('click', function (e) {
        if (isOpen && e.target.closest && e.target.closest('a[href]')) close(true);
    });

    document.addEventListener('keydown', function (e) {
        if (!isOpen) return;
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            close(true);
            return;
        }
        if (e.key !== 'Tab') return;
        // Focus goes round inside the menu.
        var items = focusables();
        if (!items.length) return;
        var first = items[0], last = items[items.length - 1];
        var active = document.activeElement;
        if (e.shiftKey && (active === first || active === menu || !menu.contains(active))) {
            e.preventDefault();
            focus(last);
        } else if (!e.shiftKey && (active === last || !menu.contains(active))) {
            e.preventDefault();
            focus(first);
        }
    });

    // Widened past the breakpoint, the header is a row again. Focus on a
    // page link stays put; focus on Close, which is gone, goes to the
    // masthead.
    var onWidth = function () {
        if (narrow.matches || !isOpen) return;
        var active = document.activeElement;
        close(false);
        if (active && menu.contains(active) && !visible(active)) {
            focus(document.querySelector('header .masthead'));
        }
    };
    if (narrow.addEventListener) narrow.addEventListener('change', onWidth);
    else if (narrow.addListener) narrow.addListener(onWidth);

    // Coming back to this page from the browser's history, the menu is shut.
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) close(false);
    });
})();
