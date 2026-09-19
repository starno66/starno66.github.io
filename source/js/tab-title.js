/*!
 * tab-title.js
 *
 * Rewrites the text of the browser tab, so the site greets you while you are
 * looking at it and asks you back once you have wandered off to another tab.
 *
 * The greeting intentionally replaces every page's title, including the
 * `<page name> | starno` that Hexo renders for posts.
 *
 * Two signals feed the same idempotent `apply()`:
 *   - `visibilitychange` covers switching to another tab and minimising the
 *     window, and is the only one of the two that fires when a background tab
 *     is brought back to the front;
 *   - `focus`/`blur` additionally cover the window losing focus while the tab
 *     itself stays visible.
 *
 * Butterfly can navigate with pjax, which swaps `document.title` in place
 * without reloading the page, so the text is re-applied after `pjax:complete`
 * (and after `pageshow`, which is what fires when a page is restored from the
 * back/forward cache).
 *
 * Everything is wrapped in a closure, so nothing leaks onto `window`.
 */
(function () {
  'use strict';

  var GREETING = '来了就别走啦(*ˊᗜˋ*)';
  var PLEA = '(இ﹏இ)回来好不好';

  // Seeded from the document rather than assumed, so a tab that is opened in
  // the background shows the plea straight away instead of briefly claiming the
  // visitor is looking at it.
  var looking = !document.hidden;

  function apply() {
    document.title = looking ? GREETING : PLEA;
  }

  document.addEventListener('visibilitychange', function () {
    looking = !document.hidden;
    apply();
  });

  window.addEventListener('focus', function () {
    looking = true;
    apply();
  });

  window.addEventListener('blur', function () {
    looking = false;
    apply();
  });

  document.addEventListener('pjax:complete', function () {
    looking = !document.hidden;
    apply();
  });

  window.addEventListener('pageshow', function () {
    looking = !document.hidden;
    apply();
  });

  apply();
})();
