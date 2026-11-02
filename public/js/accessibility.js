(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.FireAccessibility = api;
    api.initialise(root);
  }
})(typeof window === "undefined" ? null : window, function () {
  "use strict";

  const STORAGE_KEY = "fire-accessibility";
  const DEFAULTS = Object.freeze({ contrast: false, bigCursor: false, palette: "standard", textScale: 1 });

  function normalise(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      contrast: source.contrast === true,
      bigCursor: source.bigCursor === true,
      palette: source.palette === "cvd" ? "cvd" : "standard",
      textScale: [1, 1.25, 1.5].includes(source.textScale) ? source.textScale : 1
    };
  }

  // Storage is optional: the in-memory state always remains usable.
  function createPreferences(storage) {
    let state = { ...DEFAULTS };
    try { state = normalise(JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null")); } catch (_) { /* Use defaults. */ }
    function save(next) {
      state = normalise(next);
      try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* Keep session settings. */ }
      return { ...state };
    }
    return {
      get: () => ({ ...state }),
      update: patch => save({ ...state, ...patch }),
      reset: () => save(DEFAULTS)
    };
  }

  function initialise(win) {
    const doc = win.document;
    let storage;
    try { storage = win.localStorage; } catch (_) { /* Browser may deny access. */ }
    const preferences = createPreferences(storage);
    const html = doc.documentElement;
    function apply() {
      const state = preferences.get();
      html.classList.toggle("accessibility-contrast", state.contrast);
      html.classList.toggle("accessibility-big-cursor", state.bigCursor);
      html.dataset.palette = state.palette;
      html.style.setProperty("--text-scale", state.textScale);
      win.dispatchEvent(new win.CustomEvent("fire:accessibilitychange", { detail: state }));
    }
    // This script runs in the head, before the first map render.
    apply();

    function mount() {
      const toggle = doc.getElementById("accessibility-toggle");
      const panel = doc.getElementById("accessibility-panel");
      const close = doc.getElementById("accessibility-close");
      const reset = doc.getElementById("accessibility-reset");
      const feedback = doc.getElementById("accessibility-feedback");
      function syncControls() {
        const state = preferences.get();
        panel.querySelectorAll("input").forEach(input => {
          input.checked = input.type === "checkbox" ? state[input.name] : String(state[input.name]) === input.value;
        });
      }
      function setOpen(open) {
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        (open ? close : toggle).focus();
      }
      syncControls();
      toggle.addEventListener("click", () => setOpen(panel.hidden));
      close.addEventListener("click", () => setOpen(false));
      panel.addEventListener("change", event => {
        const input = event.target;
        if (!input.matches("input")) return;
        const value = input.type === "checkbox" ? input.checked
          : input.name === "textScale" ? Number(input.value) : input.value;
        preferences.update({ [input.name]: value });
        apply();
        syncControls();
      });
      reset.addEventListener("click", () => {
        preferences.reset();
        apply();
        syncControls();
        feedback.textContent = "Réglages réinitialisés.";
      });
      // Click runs after the browser's pointer focus, so restored focus is retained.
      doc.addEventListener("click", event => {
        if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
      });
      // Capture Escape before the map's window handler can return to the overview.
      doc.addEventListener("keydown", event => {
        if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "a") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setOpen(panel.hidden);
        } else if (event.key === "Escape" && !panel.hidden) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setOpen(false);
        }
      }, true);
    }
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
    return preferences;
  }

  return { DEFAULTS, STORAGE_KEY, normalise, createPreferences, initialise };
});
