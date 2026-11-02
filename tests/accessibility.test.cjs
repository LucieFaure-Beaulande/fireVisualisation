const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULTS, STORAGE_KEY, createPreferences, initialise } = require("../public/js/accessibility.js");

function memoryStorage(initial) {
  const values = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("restaure les quatre réglages et conserve les autres lors d'un changement", () => {
  const saved = { contrast: true, bigCursor: true, palette: "cvd", textScale: 1.5 };
  const storage = memoryStorage(JSON.stringify(saved));
  const preferences = createPreferences(storage);
  assert.deepEqual(preferences.get(), saved);
  preferences.update({ textScale: 1.25 });
  assert.deepEqual(createPreferences(storage).get(), { ...saved, textScale: 1.25 });
  const snapshot = preferences.get();
  snapshot.palette = "standard";
  assert.equal(preferences.get().palette, "cvd");
});

test("réinitialise tous les réglages et mémorise les valeurs par défaut", () => {
  const storage = memoryStorage();
  const preferences = createPreferences(storage);
  preferences.update({ contrast: true, bigCursor: true, palette: "cvd", textScale: 1.5 });
  assert.deepEqual(preferences.reset(), DEFAULTS);
  assert.deepEqual(createPreferences(storage).get(), DEFAULTS);
});

test("ignore un stockage corrompu et normalise les valeurs non prises en charge", () => {
  for (const invalid of ["{invalid", "null", "[]", '"cvd"']) {
    assert.deepEqual(createPreferences(memoryStorage(invalid)).get(), DEFAULTS);
  }
  const preferences = createPreferences(memoryStorage(JSON.stringify({
    contrast: "true", bigCursor: false, palette: "unknown", textScale: 200, extra: true
  })));
  assert.deepEqual(preferences.get(), DEFAULTS);
  assert.deepEqual(preferences.update({ palette: "cvd", textScale: 1.25 }), { ...DEFAULTS, palette: "cvd", textScale: 1.25 });
});

test("reste utilisable en mémoire si la lecture ou l'écriture du stockage échoue", () => {
  const blocked = {
    getItem() { throw new Error("Storage denied"); },
    setItem() { throw new Error("Quota exceeded"); }
  };
  for (const storage of [undefined, blocked]) {
    const preferences = createPreferences(storage);
    assert.deepEqual(preferences.get(), DEFAULTS);
    preferences.update({ contrast: true, palette: "cvd", textScale: 1.5 });
    assert.deepEqual(preferences.get(), { ...DEFAULTS, contrast: true, palette: "cvd", textScale: 1.5 });
    assert.deepEqual(preferences.reset(), DEFAULTS);
  }
});

test("conserve les tailles de texte de main jusqu'à 200 %", () => {
  for (const textScale of [1, 1.25, 1.5, 1.75, 2]) {
    const storage = memoryStorage(JSON.stringify({ textScale }));
    const preferences = createPreferences(storage);
    assert.equal(preferences.get().textScale, textScale);
    assert.equal(createPreferences(storage).get().textScale, textScale);
  }
});

test("préserve l'API de main, les événements de la carte et une initialisation unique", () => {
  const api = require("../public/js/accessibility.js");
  const scheduled = [];
  const events = [];
  const doc = {
    readyState: "loading",
    documentElement: { classList: { toggle() {} }, dataset: {}, style: { setProperty() {} } },
    addEventListener: (...args) => scheduled.push(args)
  };
  const win = {
    document: doc, localStorage: memoryStorage(),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent: event => events.push(event)
  };
  const preferences = initialise(win);
  assert.equal(initialise(win), preferences);
  api.init();
  api.init();
  assert.equal(scheduled.length, 1);
  assert.equal(events.length, 1);
  const changes = [];
  const unsubscribe = api.onChange((settings, key) => changes.push({ settings, key }));
  api.set("textScale", 2);
  api.set("contrast", true);
  api.set("palette", "cvd");
  assert.deepEqual(api.settings, { ...DEFAULTS, textScale: 2, contrast: true, palette: "cvd" });
  const snapshot = api.settings;
  snapshot.textScale = 1;
  assert.equal(api.settings.textScale, 2);
  assert.deepEqual(changes.map(change => change.key), ["textScale", "contrast", "palette"]);
  assert.equal(events.at(-1).type, "fire:accessibilitychange");
  assert.deepEqual(events.at(-1).detail, api.settings);
  api.reset();
  assert.deepEqual(api.settings, DEFAULTS);
  assert.equal(changes.at(-1).key, "reset");
  unsubscribe();
  api.set("bigCursor", true);
  assert.equal(changes.length, 4);
});

test("applique les préférences avant le montage du panneau, même si localStorage est inaccessible", () => {
  const classes = new Set();
  const properties = new Map();
  const events = [];
  const document = {
    readyState: "loading",
    documentElement: {
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
      dataset: {},
      style: { setProperty: (name, value) => properties.set(name, value) }
    },
    addEventListener(name) { events.push(name); }
  };
  const win = {
    document,
    get localStorage() { throw new Error("Storage denied"); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent(event) { events.push(event); }
  };
  assert.deepEqual(initialise(win).get(), DEFAULTS);
  assert.equal(document.documentElement.dataset.palette, "standard");
  assert.equal(properties.get("--text-scale"), 1);
  assert.equal(events[0].type, "fire:accessibilitychange");
  assert.equal(events[1], "DOMContentLoaded");
});
