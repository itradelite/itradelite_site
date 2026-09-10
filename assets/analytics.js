// Google Analytics 4 loader — reads window.ITL_GA_MEASUREMENT_ID (set in
// analytics-config.js, loaded before this file on every page). Does
// nothing at all unless that value looks like a real GA4 Measurement ID
// ("G-" followed by letters/digits), so the default (empty string) means
// this file is a no-op: no external script, no cookies, no requests to
// Google. See analytics-config.js for how to turn tracking on.
(function () {
  var id = window.ITL_GA_MEASUREMENT_ID;
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return;

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("js", new Date());
  // anonymize_ip is GA4's default behavior already, set explicitly for clarity.
  gtag("config", id, { anonymize_ip: true });
})();
