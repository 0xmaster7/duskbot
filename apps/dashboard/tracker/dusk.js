// first-party marketing analytics tracker
// ideas from Minilytics (MIT, Copyright (c) 2026 surendrapandar)
(function () {
  "use strict";
  function noop() {}
  function safe(fn) {
    return function () { try { return fn.apply(this, arguments); } catch (e) {} };
  }
  try {
    var w = window, d = document, n = navigator, loc = w.location;
    var queue = (w.dusk && w.dusk.q) || [];
    w.dusk = noop;
    var script = d.currentScript;
    var endpoint = (script && script.getAttribute("data-api")) || "/v1/t";
    var ignored = false;
    try {
      var ignore = new URLSearchParams(loc.search).get("dusk_ignore");
      if (ignore === "1") w.localStorage.setItem("dusk_ignore", "1");
      if (ignore === "0") w.localStorage.removeItem("dusk_ignore");
      ignored = w.localStorage.getItem("dusk_ignore") === "1";
    } catch (e) { ignored = ignore === "1"; }
    var local = /^(localhost|0\.0\.0\.0|\[::1\])$|^127\.|\.local$/i.test(loc.hostname) || loc.protocol === "file:";
    if (ignored || n.webdriver || n.globalPrivacyControl === true || n.doNotTrack === "1" ||
        (local && !(script && script.hasAttribute("data-allow-local"))) ||
        /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|python|curl|wget/i.test(n.userAgent)) return;

    function read(name) {
      try {
        var match = d.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
        return match ? match[1] : "";
      } catch (e) { return ""; }
    }
    var vid = read("dusk_vid"), sid = read("dusk_sid"), first = !sid;
    // nothing is stored until the service answers a page view with {persist: true}; where consent would be needed it
    // answers false and ids live only in this page
    var keep = null, asking = false, domain = "", parts = loc.hostname.split("."), domains = [];
    var suffix = "; path=/; SameSite=Lax" + (loc.protocol === "https:" ? "; Secure" : "");
    if (parts.length > 1 && !/^\d+$/.test(parts[parts.length - 1])) for (var i = parts.length - 2; i >= 0; i--) domains.push(parts.slice(i).join("."));
    function cookie(name, value, age, at) {
      try { d.cookie = name + "=" + value + suffix + "; max-age=" + age + (at ? "; domain=" + at : ""); } catch (e) {}
    }
    function remember(persist) {
      keep = persist;
      if (!persist) {
        ["dusk_vid", "dusk_sid"].forEach(function (name) {
          if (read(name)) [""].concat(domains).forEach(function (at) { cookie(name, "", 0, at); });
        });
        return;
      }
      if (!domain) domains.some(function (candidate) {
        cookie("dusk_test", 1, 60, candidate);
        if (read("dusk_test")) { cookie("dusk_test", "", 0, candidate); domain = candidate; }
        return domain;
      });
      cookie("dusk_vid", vid, 31536000, domain);
      cookie("dusk_sid", sid, 1800, domain);
    }
    function random(bytes) {
      var data = new Uint8Array(bytes), binary = "";
      w.crypto.getRandomValues(data);
      for (var j = 0; j < data.length; j++) binary += String.fromCharCode(data[j]);
      return w.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
    vid = vid || random(16);
    sid = sid || random(16);
    var pv, path, pagePath, depth = 0, engaged = 0, since = null;
    function cleanPath(value) {
      return value.split("/").map(function (segment) { return /@|%40/i.test(segment) ? ":id" : segment; }).join("/").slice(0, 200);
    }
    function send(event, extra) {
      if (keep) cookie("dusk_sid", sid, 1800, domain);
      var payload = { v: 1, e: event, vid: vid, sid: sid, pv: pv, h: loc.hostname, p: path };
      Object.keys(extra).forEach(function (key) { payload[key] = extra[key]; });
      var json = JSON.stringify(payload);
      if (keep === null && !asking && event === "pageview") {
        asking = true;
        try {
          return w.fetch(endpoint, { method: "POST", body: json, keepalive: true, credentials: "include", headers: { "content-type": "text/plain" } })
            .then(function (res) { return res.json(); })
            .then(function (answer) { remember(!!answer && answer.persist === true); }, function () { asking = false; });
        } catch (e) { asking = false; }
      }
      try { if (n.sendBeacon && n.sendBeacon(endpoint, new Blob([json], { type: "text/plain" }))) return; } catch (e) {}
      try { w.fetch(endpoint, { method: "POST", body: json, keepalive: true, headers: { "content-type": "text/plain" } }).catch(noop); } catch (e) {}
    }
    function measure() {
      var height = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0);
      if (height > 0) depth = Math.max(depth, Math.min(100, Math.max(0, Math.round((w.scrollY + w.innerHeight) / height * 100))));
    }
    function time() {
      var now = Date.now();
      if (since !== null) engaged += Math.max(0, now - since);
      since = d.visibilityState === "visible" ? now : null;
    }
    function leave(force) {
      if (!pv) return;
      measure();
      time();
      if (force === true || engaged > 0 || depth > 0) send("leave", { s: depth, t: Math.round(engaged) });
    }
    function pageview() {
      if (d.visibilityState === "prerender" || (pv && pagePath === loc.pathname)) return;
      leave(true);
      pagePath = loc.pathname;
      path = cleanPath(pagePath);
      pv = random(6);
      depth = engaged = 0;
      since = d.visibilityState === "visible" ? Date.now() : null;
      measure();
      var extra = { w: w.innerWidth }, utm = {}, params = new URLSearchParams(loc.search);
      "utm_source utm_medium utm_campaign utm_content utm_term ref via source".split(" ").forEach(function (key) {
        var value = params.get(key);
        if (value !== null && value.indexOf("@") < 0) utm[key] = value.slice(0, 100);
      });
      if (Object.keys(utm).length) extra.u = utm;
      if (first && d.referrer) {
        try { var host = new URL(d.referrer).hostname; if (host && host !== loc.hostname) extra.r = host; } catch (e) {}
      }
      first = false;
      send("pageview", extra);
    }
    var goal = safe(function (name, meta) {
      if (typeof name !== "string" || !/^[a-z0-9_]{1,40}$/.test(name) || !pv) return;
      var extra = { g: name }, clean = Object.create(null);
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        Object.keys(meta).some(function (key) {
          var value = meta[key];
          if (typeof value === "string") clean[key] = value.slice(0, 100);
          else if (typeof value === "number" && isFinite(value)) clean[key] = value;
          return Object.keys(clean).length === 5;
        });
      }
      if (Object.keys(clean).length) extra.m = clean;
      send("goal", extra);
    });
    function attributes(el) {
      var meta = Object.create(null);
      for (var k = 0; k < el.attributes.length; k++) {
        var attr = el.attributes[k];
        if (attr.name.indexOf("data-dusk-") === 0 && attr.name !== "data-dusk-goal") meta[attr.name.slice(10)] = attr.value;
      }
      return meta;
    }
    function start() {
      pageview();
      if (!pv) return;
      w.dusk = goal;
      for (var q = 0; q < queue.length; q++) goal.apply(null, queue[q]);
      queue = [];
    }
    d.addEventListener("visibilitychange", safe(function () {
      if (!pv) start();
      else if (d.visibilityState === "visible") time();
      else leave();
    }));
    w.addEventListener("pagehide", safe(leave));
    w.addEventListener("scroll", safe(measure), { passive: true });
    ["pushState", "replaceState"].forEach(function (method) {
      var original = w.history[method];
      w.history[method] = safe(function () { var result = original.apply(this, arguments); pageview(); return result; });
    });
    w.addEventListener("popstate", safe(pageview));
    d.addEventListener("click", safe(function (event) {
      var el = event.target;
      if (el && !el.closest) el = el.parentElement;
      if (!el || !el.closest) return;
      var tagged = el.closest("[data-dusk-goal]");
      if (tagged) { goal(tagged.getAttribute("data-dusk-goal"), attributes(tagged)); return; }
      var link = el.closest("a[href]");
      if (!link) return;
      var url = new URL(link.href, loc.href), host = url.hostname;
      if (!/^https?:$/.test(url.protocol)) return;
      var internal = host === loc.hostname || host.slice(-(loc.hostname.length + 1)) === "." + loc.hostname;
      if (internal && /^\/(app|signup)/.test(url.pathname)) goal("cta_click", { to: url.pathname, from: loc.pathname });
      else if (/\/download|\.(dmg|exe|msi|appimage|deb|rpm)$/i.test(url.pathname)) goal("download_click", { to: url.pathname });
      else if (!internal) goal("outbound", { host: host });
    }), true);
    d.addEventListener("submit", safe(function (event) {
      var form = event.target;
      if (!form || form.tagName !== "FORM") return;
      if (form.hasAttribute("data-dusk-goal")) { goal(form.getAttribute("data-dusk-goal"), attributes(form)); return; }
      var email = form.querySelector('input[type="email"]');
      if (/waitlist|\bwl-form\b/i.test([form.id, form.className, form.getAttribute("action"), form.getAttribute("name")].join(" ")) &&
          email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) goal("waitlist_join");
    }), true);
    start();
  } catch (e) {}
})();
