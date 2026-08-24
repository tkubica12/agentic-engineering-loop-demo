/* =========================================================================
   slide-a11y.js — progressive-enhancement accessibility layer for slides mode

   The article runtime (assets/article.js) is vendored and must not be edited,
   so this small, dependency-free script rides on top of it. Load it AFTER
   article.js with a deferred script tag on the presentable documents.

   It only ever acts while slides mode is active (documentElement carries
   data-view="slides"); it does nothing, and never throws, when the runtime is
   absent or the reader stays in article view. It adds three things:

     1. keyboard focus follows the current slide, so a screen-reader or
        keyboard user lands on the slide that just appeared;
     2. a polite, visually-hidden live region announces a *useful* label —
        the slide's own title plus its position — on every change;
     3. one console.warn per slide whose content the runtime had to shrink
        below a readable zoom, so a validator or a human can catch it.
   ========================================================================= */

(function () {
  "use strict";

  var root = document.documentElement;
  var main = document.querySelector("main");
  /* No article to enhance: leave silently. */
  if (!main || typeof MutationObserver === "undefined") return;

  /* The runtime's last slide is the closing takeaway, and that element is a
     SIBLING of <main>, not a descendant of it. Watching only <main> therefore
     missed the final slide entirely: the live region kept announcing slide 14's
     title while slide 15 was on screen, and focus never moved. Observe and
     query the whole document container instead, which covers both. */
  var scope = document.querySelector(".doc") || document.body;

  /* Matches the runtime's MIN_ZOOM floor logic: below ~0.85 the body text is
     getting hard to read from the back of a room, so surface it once. */
  var LEGIBLE_ZOOM = 0.85;

  var live = null;
  var warned = Object.create(null);
  var lastAnnounced = null;

  function inSlides() {
    return root.getAttribute("data-view") === "slides";
  }

  function isTyping() {
    var a = document.activeElement;
    if (!a) return false;
    if (a.isContentEditable) return true;
    var tag = a.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function liveRegion() {
    if (live) return live;
    live = document.createElement("div");
    live.className = "slide-a11y-live";
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    live.setAttribute("role", "status");
    document.body.appendChild(live);
    return live;
  }

  /* Re-derive the ordered slide list exactly the way the runtime's buildSlides
     does, so position/total match what the reader sees without reaching into
     the runtime's private state. */
  function slideList() {
    var list = [];
    var chapters = main.querySelectorAll(".chapter");
    if (chapters.length) {
      Array.prototype.forEach.call(chapters, function (chapter) {
        if (chapter.querySelector(":scope > .chapter-label")) list.push(chapter);
        Array.prototype.forEach.call(
          chapter.querySelectorAll(":scope > .card"),
          function (card) { list.push(card); }
        );
      });
    } else {
      Array.prototype.forEach.call(main.querySelectorAll(".card"), function (card) {
        list.push(card);
      });
    }
    var takeaway = document.querySelector(".takeaway");
    if (takeaway) list.push(takeaway);
    return list;
  }

  /* The slide's own title, not just its number. A card exposes .card-title; a
     chapter exposes .chapter-label; the closing panel is the takeaway. The
     .card-title lookup is guarded to a card node because a chapter *contains*
     cards and would otherwise borrow a nested card's title.

     One chapter is special. The first divider is presented as the cover, so the
     screen shows the document's title and subtitle and hides the chapter label
     entirely. Announcing "Intent and contract" there would name something the
     slide does not show, so the cover announces what it does show. The cover is
     detected by the same condition the stylesheet uses: the document header is
     visible while this chapter is the current slide. */
  function coverHeading(node) {
    if (!node.classList.contains("chapter")) return null;
    var header = document.querySelector(".doc .doc-header");
    if (!header) return null;
    var visible;
    try {
      visible = getComputedStyle(header).display !== "none";
    } catch (e) {
      return null;
    }
    if (!visible) return null;
    var h1 = header.querySelector("h1");
    var subtitle = header.querySelector(".subtitle");
    var title = h1 && h1.textContent.trim();
    if (!title) return null;
    var sub = subtitle && subtitle.textContent.trim();
    return sub ? title + ". " + sub : title;
  }

  function slideTitle(node) {
    var cover = coverHeading(node);
    if (cover) return cover;
    var title = null;
    if (node.classList.contains("card")) title = node.querySelector(".card-title");
    if (!title) title = node.querySelector(":scope > .chapter-label") || node.querySelector(".chapter-label");
    if (title && title.textContent.trim()) return title.textContent.trim();
    if (node.classList.contains("takeaway")) return "Closing takeaway";
    var heading = node.querySelector(".chapter-title, h2, h3");
    if (heading && heading.textContent.trim()) return heading.textContent.trim();
    var text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text.length > 80 ? text.slice(0, 79).replace(/\s+\S*$/, "") + "\u2026" : text;
    return node.id || "Slide";
  }

  function position(node) {
    var list = slideList();
    var index = list.indexOf(node);
    if (index >= 0) return { index: index + 1, total: list.length };
    /* Fall back to the runtime's own progress readout ("N / M"). */
    var progress = document.querySelector(".slide-progress");
    var m = progress && progress.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) return { index: parseInt(m[1], 10), total: parseInt(m[2], 10) };
    return null;
  }

  /* The runtime writes --slide-zoom onto each child of the current card while
     fitting it. Reading it back tells us how far it had to shrink. */
  function currentZoom(node) {
    var kid = node.firstElementChild;
    if (!kid) return 1;
    var raw = kid.style.getPropertyValue("--slide-zoom");
    if (!raw) {
      try { raw = getComputedStyle(kid).getPropertyValue("--slide-zoom"); } catch (e) { raw = ""; }
    }
    var value = parseFloat(raw);
    return isNaN(value) ? 1 : value;
  }

  function warnIfCramped(node) {
    if (!node.classList.contains("card")) return;
    if (warned[node.id]) return;
    if (currentZoom(node) < LEGIBLE_ZOOM) {
      warned[node.id] = true;
      console.warn("slide-a11y: slide shrunk below a readable size: #" + node.id);
    }
  }

  function handle(node) {
    if (!node) return;
    if (node === lastAnnounced) {
      /* Same slide (e.g. a spurious mutation or an in-place hashchange): still
         keep focus honest but do not re-announce or re-warn. */
      return;
    }
    lastAnnounced = node;

    if (node.getAttribute("tabindex") === null) node.setAttribute("tabindex", "-1");

    if (!isTyping()) {
      try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
    }

    var label = slideTitle(node);
    var pos = position(node);
    liveRegion().textContent = pos
      ? "Slide " + pos.index + " of " + pos.total + ": " + label
      : label;

    /* Let the runtime's fit pass settle before reading the zoom back. */
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () { warnIfCramped(node); });
    } else {
      warnIfCramped(node);
    }
  }

  function currentSlide() {
    return scope.querySelector("[data-slide-current]");
  }

  function onChange() {
    if (!inSlides()) return;
    handle(currentSlide());
  }

  /* The runtime marks the active slide with data-slide-current. Slides are
     descendants of the document container, so observe that subtree for the one
     attribute; <main> alone would miss the closing takeaway beside it. */
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var target = records[i].target;
      if (target && target.hasAttribute && target.hasAttribute("data-slide-current")) {
        onChange();
        return;
      }
    }
  });
  observer.observe(scope, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-slide-current"]
  });

  /* A manual hash edit or an in-page anchor can move the slide without an
     attribute mutation we saw first; re-sync on those too. */
  window.addEventListener("hashchange", function () {
    if (inSlides()) onChange();
  });

  /* article.js may already have entered slides mode (?view=slides) before this
     deferred script ran, so the first slide's attribute was set before our
     observer existed. Announce it once on startup. */
  if (inSlides() && currentSlide()) onChange();
})();
