/**
 * Favicon tags: one single source for every page.
 *
 * Why it is split out: the pages in this app are template literals that each
 * write their own <head>, and previously only ONE page declared any icon at
 * all. As a result the favicon did not show up in browsers for nearly the whole
 * app, not because the files were missing, but because no page told the browser
 * where to look for them.
 *
 * Two things make the icon appear reliably:
 *
 *   1. `/favicon.ico` is available at the site root. Browsers request that
 *      address on their own, unprompted, and not every browser falls back to
 *      <link> when that address fails.
 *   2. The small sizes stay declared. Chrome picks the icon for a tab from
 *      size 16 or 32; shipping only 192 and 512 leaves some browsers with
 *      nothing that matches.
 *
 * The list below therefore holds 16, 32, 192 and 512, plus the touch icon
 * for iOS. These tags must not use backticks: every consumer is a template
 * literal, so a backtick would close it.
 */
export const FAVICON_LINKS = [
  '<link rel="icon" href="/favicon.ico" sizes="any">',
  '<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/assets/android-chrome-192x192.png">',
  '<link rel="icon" type="image/png" sizes="512x512" href="/assets/android-chrome-512x512.png">',
  '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">',
].join("");
