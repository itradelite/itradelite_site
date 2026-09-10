// Google Analytics 4 measurement ID, shared by every page via analytics.js.
//
// This was already live on /today/ (hardcoded inline, GA4 property
// G-N8VCNFYX3B) before this file existed — that page was the only one
// being measured, so the homepage, Track Record, Strategy Decay and every
// other page had zero analytics. This file just centralizes that same ID
// so analytics.js can apply it site-wide instead of one page.
//
// To point the whole site at a different (or new) GA4 property: create it
// at https://analytics.google.com, copy its Measurement ID ("G-XXXXXXXXXX"),
// and paste it below — every page picks it up automatically.
// To turn tracking off everywhere: set this to "".
window.ITL_GA_MEASUREMENT_ID = "G-N8VCNFYX3B";
