// Shared panel and preferences; the browser and CommonJS use the same validation.
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
  const TEXT_SCALES = [1, 1.25, 1.5, 1.75, 2];
  const sessions = new WeakMap();
  const listeners = new Set();
  let active;

  function normalise(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      contrast: source.contrast === true,
      bigCursor: source.bigCursor === true,
      palette: source.palette === "cvd" ? "cvd" : "standard",
      textScale: TEXT_SCALES.includes(source.textScale) ? source.textScale : 1
    };
  }

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
    if (sessions.has(win)) {
      active = sessions.get(win);
      return active.preferences;
    }
    const doc = win.document;
    let storage;
    try { storage = win.localStorage; } catch (_) { /* Browser may deny access. */ }
    const preferences = createPreferences(storage);
    let panel, toggle;

    function syncControls() {
      if (!panel) return;
      const state = preferences.get();
      panel.querySelectorAll("input[data-key]").forEach(input => {
        const key = input.dataset.key;
        input.checked = input.type === "checkbox" ? state[key] : String(state[key]) === input.value;
      });
    }

    function apply(key) {
      const state = preferences.get();
      const html = doc.documentElement;
      html.classList.toggle("accessibility-contrast", state.contrast);
      html.classList.toggle("accessibility-big-cursor", state.bigCursor);
      html.dataset.palette = state.palette;
      html.style.setProperty("--text-scale", state.textScale);
      syncControls();
      win.dispatchEvent(new win.CustomEvent("fire:accessibilitychange", { detail: { ...state } }));
      if (key) listeners.forEach(listener => listener({ ...state }, key));
    }

    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      (open ? panel.querySelector(".accessibility-close") : toggle).focus();
    }

    function mount() {
      if (panel || !doc.body) return;
      toggle = doc.createElement("button");
      toggle.id = "accessibility-toggle";
      toggle.type = "button";
      toggle.className = "accessibility-toggle";
      toggle.textContent = "Accessibility";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", "accessibility-panel");
      toggle.setAttribute("aria-haspopup", "dialog");
      toggle.setAttribute("aria-keyshortcuts", "Alt+A");

      panel = doc.createElement("section");
      panel.id = "accessibility-panel";
      panel.className = "accessibility-panel";
      panel.hidden = true;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-labelledby", "accessibility-title");
      panel.innerHTML = `
        <div class="accessibility-header">
          <h2 id="accessibility-title">Accessibility</h2>
          <button type="button" class="accessibility-close" aria-label="Close accessibility settings">✕</button>
        </div>
        <div class="accessibility-body">
          <fieldset><legend>Text size</legend><div class="accessibility-segmented">
            ${TEXT_SCALES.map(scale => `<label><input type="radio" name="accessibility-text-scale" data-key="textScale" value="${scale}"><span>${scale * 100}%</span></label>`).join("")}
          </div></fieldset>
          <fieldset><legend>Colors</legend>
            <label class="accessibility-option"><input type="radio" name="accessibility-palette" data-key="palette" value="standard"><span>Standard palette</span></label>
            <label class="accessibility-option"><input type="radio" name="accessibility-palette" data-key="palette" value="cvd"><span>Colorblind-friendly palette<span class="accessibility-hint">Category colors change while gradients keep their hues.</span></span></label>
            <label class="accessibility-option"><input type="checkbox" data-key="contrast"><span>High contrast</span></label>
          </fieldset>
          <fieldset><legend>Mouse</legend>
            <label class="accessibility-option"><input type="checkbox" data-key="bigCursor"><span>Large pointer<span class="accessibility-hint">Show a blue arrow over interactive controls.</span></span></label>
          </fieldset>
        </div>
        <div class="accessibility-footer">
          <span class="accessibility-hint">Shortcut (Alt + A)</span>
          <button type="button" class="accessibility-reset">Reset settings</button>
          <span class="sr-only accessibility-feedback" role="status"></span>
        </div>`;
      doc.body.prepend(toggle);
      doc.body.append(panel);
      syncControls();
      toggle.addEventListener("click", () => setOpen(panel.hidden));
      panel.querySelector(".accessibility-close").addEventListener("click", () => setOpen(false));
      panel.addEventListener("change", event => {
        const input = event.target;
        if (!input.matches("input[data-key]")) return;
        const key = input.dataset.key;
        const value = input.type === "checkbox" ? input.checked
          : key === "textScale" ? Number(input.value) : input.value;
        preferences.update({ [key]: value });
        apply(key);
      });
      panel.querySelector(".accessibility-reset").addEventListener("click", () => {
        preferences.reset();
        apply("reset");
        panel.querySelector(".accessibility-feedback").textContent = "Settings reset.";
      });
      doc.addEventListener("click", event => {
        if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
      });
      // Capture Escape before the map can use it to leave the close-up view.
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

    active = { preferences, apply, mount };
    sessions.set(win, active);
    // Apply preferences before the first chart render, even when loaded in <head>.
    apply();
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
    return preferences;
  }

  function init() { active?.mount(); }
  function set(key, value) {
    if (!active || !Object.hasOwn(DEFAULTS, key)) return;
    active.preferences.update({ [key]: value });
    active.apply(key);
  }
  function reset() {
    if (!active) return;
    active.preferences.reset();
    active.apply("reset");
  }
  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    DEFAULTS, STORAGE_KEY, normalise, createPreferences, initialise,
    init, set, reset, onChange,
    get settings() { return active ? active.preferences.get() : { ...DEFAULTS }; }
  };
});
