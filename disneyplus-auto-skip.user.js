// ==UserScript==
// @name         Disney+ Auto Skip
// @namespace    local.fergu
// @version      3.5
// @description  Auto-clicks SKIP INTRO / RECAP / CREDITS and Up Next; enlarges captions
// @match        https://www.disneyplus.com/*
// @match        https://*.disneyplus.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const DEFAULTS = {
    skipIntro: true,
    skipRecap: true,
    skipCredits: true,
    autoNextEpisode: true,
    nextEpisodeWindow: 180, // fallback only, when no countdown can be read
    subtitleScale: 1.3,     // multiplier, not px: the renderer sizes cues from the
                            // video height, so em scales correctly in fullscreen.
                            // null to leave captions alone.
    autoFullscreen: true,   // fullscreen on your first real click/keypress
    fullscreenTarget: '#dplus-app-element', // must OUTLIVE episode changes, see below
    hideCursor: true,       // hide the pointer while watching
    cursorIdleMs: 2000,     // ...after this long without moving it
    toast: true,
    log: true,
  };

  const KEY = 'dplusAutoSkip.config';
  const cfg = Object.assign({}, DEFAULTS, (() => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  })());
  const saveCfg = () => localStorage.setItem(KEY, JSON.stringify(cfg));

  const log = (...a) => cfg.log && console.log('%c[auto-skip]', 'color:#0af;font-weight:bold', ...a);

  // ---------------------------------------------------------------- shadow DOM
  // Everything lives in open shadow roots, and the hosts themselves are not
  // reliably reachable from document.querySelector — walk for them.
  function deepAll(root, sel) {
    const found = [];
    const stack = [root];
    while (stack.length) {
      const r = stack.pop();
      for (const el of r.querySelectorAll('*')) {
        if (el.matches(sel)) found.push(el);
        if (el.shadowRoot) stack.push(el.shadowRoot);
      }
    }
    return found;
  }
  const deepOne = (root, sel) => deepAll(root, sel)[0] || null;

  // Walks up through shadow boundaries — getComputedStyle only reports an
  // element's own opacity, and these overlays are faded out by an ancestor.
  // checkOpacity is off for skip buttons: they fade in, and a strict opacity
  // test can reject the button during the transition.
  function visible(el, checkOpacity = true) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    let n = el;
    while (n && n !== document.documentElement) {
      if (n.nodeType === 1) {
        if (n.hasAttribute('hidden')) return false;
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        if (checkOpacity && parseFloat(s.opacity) < 0.1) return false;
      }
      n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode;
    }
    return true;
  }

  function click(el, label) {
    const r = el.getBoundingClientRect();
    const o = {
      bubbles: true, cancelable: true, composed: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse',
    };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
    log('clicked', label);
    toast(label);
  }

  let toastEl, toastTimer;
  function toast(msg) {
    if (!cfg.toast) return;
    const parent = document.fullscreenElement || document.body;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText =
        'position:fixed;left:24px;bottom:24px;z-index:2147483647;pointer-events:none;' +
        'font:600 13px/1.4 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.72);' +
        'padding:7px 13px;border-radius:6px;transition:opacity .25s';
    }
    if (toastEl.parentNode !== parent) parent.appendChild(toastEl);
    toastEl.textContent = '⏭  ' + msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 1600);
  }

  // ---------------------------------------------------------------- video
  function getVideo() {
    return deepAll(document, 'video')
      .find(v => v.src && v.duration > 0 && getComputedStyle(v).display !== 'none') || null;
  }

  // ---------------------------------------------------------------- rules
  const last = {};
  const cool = (k, ms) => {
    const now = Date.now();
    if (last[k] && now - last[k] < ms) return false;
    last[k] = now;
    return true;
  };

  const WANTED = () => [
    cfg.skipIntro && 'intro',
    cfg.skipRecap && 'recap',
    cfg.skipCredits && 'credits',
  ].filter(Boolean);

  // The button can sit inside a nested shadow root within skip-overlay, so this
  // must recurse — a flat shadowRoot.querySelectorAll misses it entirely.
  // It has no class, no aria-label and no testid; its text is the only hook.
  const skipButtons = () =>
    deepAll(document, 'skip-overlay')
      .filter(h => h.shadowRoot)
      .flatMap(h => deepAll(h.shadowRoot, 'button,[role="button"],[tabindex="0"]'));

  function handleSkip() {
    for (const btn of skipButtons()) {
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^skip\b/i.test(text)) continue;
      const kind = /recap/i.test(text) ? 'recap' : /credit/i.test(text) ? 'credits' : 'intro';
      if (!WANTED().includes(kind)) continue;
      if (!visible(btn, false)) continue;
      if (!cool('skip:' + kind, 3000)) continue;
      click(btn, text);
      return;
    }
  }

  // Only .countdown-text — do NOT fall back to [aria-live] generally, because in
  // up-next-lite-v1 that matches the button container, whose text is "PLAY NEXT".
  function countdownText(host) {
    const el = deepOne(host.shadowRoot, '.countdown-text');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  let lastCountdown = null;
  function noteCountdown(text) {
    if (text === lastCountdown) return;
    lastCountdown = text;
    if (text) log('countdown text:', JSON.stringify(text));
  }

  // Loose sanity check for overlays that are themselves the end-of-episode signal.
  function pastHalfway() {
    const v = getVideo();
    if (!v || !isFinite(v.duration) || !v.duration) return true; // no info: trust the overlay
    return v.ended || v.currentTime / v.duration > 0.5;
  }

  // Guards, in order of how much they're trusted:
  //   paused    -> never; the same tray is shown when you pause mid-episode
  //   ended     -> always
  //   ticking   -> the tray says the episode is over, believe it
  //   window    -> fallback if the countdown can't be read at all
  function autoNextAllowed(text) {
    const v = getVideo();
    if (!v) return false;
    if (v.ended) return true;
    if (v.paused) return false;
    if (/\d/.test(text)) return true;
    return isFinite(v.duration) && v.duration - v.currentTime <= cfg.nextEpisodeWindow;
  }

  function handleNextEpisode() {
    if (!cfg.autoNextEpisode) return;

    // Variant A: pivot-tray-overlay -> pivot-tray-tile -> div.tile-container[aria-label^="PLAY "]
    for (const host of deepAll(document, 'pivot-tray-overlay')) {
      if (!host.shadowRoot) continue;
      const tile = deepAll(host.shadowRoot, '.tile-container[role="button"]')
        .find(t => /^play\b/i.test(t.getAttribute('aria-label') || '') && visible(t));
      if (!tile) continue;
      const text = countdownText(host);
      noteCountdown(text);
      if (!autoNextAllowed(text)) continue;
      // Only auto-advance to an actual episode; recommendation tiles for other
      // titles have no episode-title metadata.
      if (!deepOne(host.shadowRoot, '.episode-title')) continue;
      if (!cool('next', 10000)) return;
      click(tile, 'Up Next');
      return;
    }

    // Variant B: up-next-lite-v1 — "UP NEXT / PLAY NEXT", no countdown in it.
    // Unlike the pivot tray, this overlay is hidden and empty while you are just
    // paused mid-episode; it only renders once the episode has actually ended.
    // Scoped to this shadow root, so it cannot collide with the identically
    // labelled PLAY NEXT button in the control bar.
    for (const host of deepAll(document, 'up-next-lite-v1')) {
      if (!host.shadowRoot || host.hasAttribute('hidden')) continue;
      const btn = deepOne(host.shadowRoot, '.up-next-lite-v1-overlay__button') ||
                  deepAll(host.shadowRoot, 'button,[role="button"]').find(el => visible(el, false));
      if (!btn || !visible(btn, false)) continue;
      if (!pastHalfway()) continue;
      if (!cool('next', 10000)) return;
      click(btn, 'Play Next');
      return;
    }
  }

  // NOTE: main-app-controls-overlay also exposes [aria-label="PLAY NEXT"]
  // (button.play-next.control). That is the permanent control-bar button, live for
  // the entire episode — clicking it would jump episodes instantly. Never match it.

  // ---------------------------------------------------------------- captions
  // Captions render as .hive-subtitle-renderer-* inside <timed-text-override-region>'s
  // shadow root, so the style must be injected there — a document stylesheet cannot
  // reach it. There are no native text tracks, so ::cue rules do nothing.
  // The renderer sets font-size inline (plain, not !important), so a stylesheet
  // !important wins and keeps winning as it recomputes per cue.
  let styleEl = null;
  function applySubtitleCss() {
    const s = cfg.subtitleScale;
    if (styleEl && styleEl.isConnected) {
      if (!s) { styleEl.remove(); styleEl = null; }
      return;
    }
    if (!s) return;
    const host = deepOne(document, 'timed-text-override-region');
    if (!host || !host.shadowRoot) return;
    styleEl = document.createElement('style');
    // em, so it inherits the renderer's video-relative size on the cue window.
    styleEl.textContent = `.hive-subtitle-renderer-cue{font-size:${s}em!important}`;
    host.shadowRoot.appendChild(styleEl);
    log('caption scale', s);
  }

  // ---------------------------------------------------------------- fullscreen
  // requestFullscreen needs user activation, and synthetic clicks (isTrusted
  // false) do not provide it — so this cannot fire from the timer. It rides the
  // transient activation from a real gesture (~5s), hence the delayed retry for
  // "clicked play, video hadn't started yet".
  //
  // Crucially we do NOT click Disney's own fullscreen button. That fullscreens an
  // inner player container, which the SPA destroys when loading the next episode
  // — and removing the fullscreen element makes the browser exit fullscreen. So
  // instead we fullscreen an app-level wrapper that outlives episode changes; the
  // player is swapped inside it and fullscreen is never dropped. That is what
  // makes it survive an unattended binge.
  let fsDoneFor = null;

  function fsTarget() {
    return document.querySelector(cfg.fullscreenTarget) ||
           deepOne(document, cfg.fullscreenTarget) ||
           document.documentElement; // also never removed
  }

  function tryFullscreen(why) {
    if (!cfg.autoFullscreen || document.fullscreenElement) return;
    const v = getVideo();
    if (!v) return log('fullscreen skipped: no video');
    if (v.paused) return;
    if (fsDoneFor === v.src) return; // don't fight a manual exit
    const t = fsTarget();
    if (!t.requestFullscreen) return log('fullscreen skipped: no API on', t.localName);
    // Only mark done on SUCCESS — marking up front meant one refusal disabled
    // fullscreen for the rest of the episode.
    t.requestFullscreen()
      .then(() => { fsDoneFor = v.src; log('fullscreen ok via', t.id ? '#' + t.id : t.localName, why || ''); })
      .catch(e => log('fullscreen refused:', e.message));
  }

  function onGesture(e) {
    if (!e.isTrusted) return; // our own dispatched clicks grant no activation
    tryFullscreen();
    setTimeout(tryFullscreen, 500); // still inside the activation window
  }
  addEventListener('pointerdown', onGesture, true);
  addEventListener('keydown', onGesture, true);

  // Manual toggle. Dispatching a synthetic 'f' would achieve nothing — the
  // player's own handler would hit the same activation check we do — but a real
  // keypress carries activation, so this always works. Clearing fsDoneFor lets
  // it re-enter even after a deliberate exit on the same episode.
  addEventListener('keydown', e => {
    if (!e.isTrusted || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key !== 'f' && e.key !== 'F') return;
    if (document.fullscreenElement) return void document.exitFullscreen();
    fsDoneFor = null;
    tryFullscreen('f key');
  }, true);
  addEventListener('fullscreenchange', () =>
    log(document.fullscreenElement
      ? 'entered fullscreen: ' + (document.fullscreenElement.id || document.fullscreenElement.localName)
      : 'left fullscreen'));

  // ---------------------------------------------------------------- cursor
  // Stylesheets cannot win here: components set cursor on their own elements
  // inside shadow roots, and a descendant selector from <html> stops at the
  // boundary. So stamp cursor:none inline with !important on every element,
  // which nothing in a stylesheet can outrank.
  //
  // Two sources of elements, because neither is sufficient alone:
  //   - a walk that actually descends into open shadow roots
  //   - composedPath() from mouse events, which also surfaces elements inside
  //     CLOSED shadow roots that no walk can ever reach
  let cursorSheet = null;
  function ensureCursorSheet() {
    if (cursorSheet && cursorSheet.isConnected) return;
    cursorSheet = document.createElement('style');
    // Cheap first line of defence; the inline stamping does the real work.
    cursorSheet.textContent = 'html.dp-nocursor,html.dp-nocursor *{cursor:none!important}';
    document.head.appendChild(cursorSheet);
  }

  function allElements() {
    const out = [];
    const stack = [document.documentElement];
    while (stack.length) {
      const el = stack.pop();
      out.push(el);
      if (el.shadowRoot) stack.push(...el.shadowRoot.children);
      stack.push(...el.children);
    }
    return out;
  }

  const stamped = [];
  const hovered = [];
  let cursorHidden = false;

  function trackHovered(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    for (const el of path) {
      if (el && el.nodeType === 1 && !hovered.includes(el)) hovered.push(el);
    }
    if (hovered.length > 500) hovered.splice(0, hovered.length - 500);
  }

  function applyCursorHidden(on) {
    document.documentElement.classList.toggle('dp-nocursor', on);
    for (const el of stamped.splice(0)) el.style.removeProperty('cursor');
    for (const el of hovered) el.style.removeProperty('cursor');
    cursorHidden = on;
    if (!on) return;
    const targets = allElements().concat(hovered);
    for (const el of targets) el.style.setProperty('cursor', 'none', 'important');
    stamped.push(...targets);
  }

  // Hide while fullscreen OR playing. Fullscreen alone is enough: a pointer
  // parked on a paused fullscreen video is exactly what you don't want.
  const shouldHide = () => {
    if (document.fullscreenElement) return true;
    const v = getVideo();
    return !!v && !v.paused;
  };

  let idleTimer;
  function onCursorActivity(e) {
    if (e) trackHovered(e);
    if (!cfg.hideCursor) return;
    if (cursorHidden) applyCursorHidden(false);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (shouldHide()) applyCursorHidden(true);
    }, cfg.cursorIdleMs);
  }
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel']) {
    addEventListener(ev, onCursorActivity, true);
  }
  idleTimer = setTimeout(() => {
    if (cfg.hideCursor && shouldHide()) applyCursorHidden(true);
  }, cfg.cursorIdleMs);

  // ---------------------------------------------------------------- loop
  let timer = null;
  function tick() {
    try {
      handleSkip();
      handleNextEpisode();
      applySubtitleCss();
      ensureCursorSheet();
      if (cursorHidden && !shouldHide()) {
        applyCursorHidden(false); // never leave it hidden once we've left the player
      } else if (cursorHidden && cool('restamp', 1500)) {
        // Episode changes rebuild the player, and the new elements have no inline
        // cursor — without this the pointer reappears until the next mouse move.
        applyCursorHidden(true);
      }
    } catch (e) {
      console.warn('[auto-skip]', e);
    }
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, 250);
    log('on', cfg);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    log('off');
  }
  start();

  window.__dplusAutoSkip = {
    version: '3.5',
    config: cfg,
    on: start,
    off: stop,
    set(k, v) {
      cfg[k] = v;
      saveCfg();
      if (styleEl) { styleEl.remove(); styleEl = null; } // rebuild on next tick
      if (!cfg.hideCursor && cursorHidden) applyCursorHidden(false);
      log('config', k, '=', v);
    },
    reset() { localStorage.removeItem(KEY); log('config reset — reload the page'); },
    status() {
      const v = getVideo();
      const host = deepAll(document, 'pivot-tray-overlay').find(h => h.shadowRoot);
      const text = host ? countdownText(host) : '';
      const lite = deepAll(document, 'up-next-lite-v1').find(h => h.shadowRoot);
      return {
        running: !!timer,
        video: v ? { paused: v.paused, ended: v.ended, left: Math.round(v.duration - v.currentTime) } : null,
        countdown: text,
        autoNextAllowed: autoNextAllowed(text),
        upNextLite: lite
          ? { hidden: lite.hasAttribute('hidden'), button: !!deepOne(lite.shadowRoot, '.up-next-lite-v1-overlay__button') }
          : null,
        pastHalfway: pastHalfway(),
        captions: { scale: cfg.subtitleScale, injected: !!(styleEl && styleEl.isConnected) },
        fullscreen: { active: !!document.fullscreenElement, doneForThisVideo: !!fsDoneFor },
        cursor: { hidden: cursorHidden, stamped: stamped.length, hovered: hovered.length },
        config: cfg,
      };
    },

    // Run while a skip button is on screen to see exactly which test rejects it.
    probe() {
      const hosts = deepAll(document, 'skip-overlay');
      console.log('skip-overlay hosts:', hosts.length);
      const btns = skipButtons();
      console.log('candidate elements inside them:', btns.length);
      if (!btns.length && hosts.length) {
        console.log('shadow HTML:', hosts.map(h => h.shadowRoot && h.shadowRoot.innerHTML));
      }
      console.table(btns.map(b => {
        const text = (b.textContent || '').replace(/\s+/g, ' ').trim();
        const r = b.getBoundingClientRect();
        return {
          tag: b.localName, text,
          matchesSkip: /^skip\b/i.test(text),
          rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
          visibleLoose: visible(b, false),
          visibleStrict: visible(b, true),
        };
      }));
      return btns;
    },
    // Force a click on whatever skip button is showing, bypassing every guard.
    force() {
      const b = skipButtons().find(x => /^skip\b/i.test((x.textContent || '').trim()));
      if (!b) return console.warn('[auto-skip] no skip button found right now');
      click(b, (b.textContent || '').trim() + ' (forced)');
      return b;
    },
  };
})();
