const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createFisheyeController, getCloseupTransform } = require("../public/bubblemap/fisheye-controller.js");

function setup(reducedMotion = false) {
  let now = 0;
  let id = 0;
  const jobs = new Map();
  const renders = [];
  const clock = {
    performance: { now: () => now },
    setTimeout(callback, delay) { jobs.set(++id, { at: now + delay, callback }); return id; },
    clearTimeout(key) { jobs.delete(key); },
    requestAnimationFrame(callback) { jobs.set(++id, { at: now + 16, callback }); return id; },
    cancelAnimationFrame(key) { jobs.delete(key); }
  };
  const controller = createFisheyeController({
    clock,
    reducedMotion,
    settings: {
      dwellDelay: 700, openDuration: 400, closeDuration: 200, movementTolerance: 8,
      closeupDelay: 1000, closeupDuration: 500, overviewDuration: 400
    },
    render: (focus, intensity, frame) => renders.push({ focus, intensity, ...frame })
  });
  function advance(milliseconds) {
    const end = now + milliseconds;
    while (true) {
      const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      jobs.delete(next[0]);
      now = next[1].at;
      next[1].callback(now);
    }
    now = end;
  }
  const point = (clientX = 100, x = 300) => ({ x, y: 250, clientX, clientY: 100 });
  return { controller, renders, advance, point, jobs };
}

test("700 ms d'attente, ouverture en 400 ms puis seconde attente d'une seconde", () => {
  const { controller, renders, advance, point, jobs } = setup();
  controller.move(point());
  advance(699);
  assert.equal(renders.length, 0);
  advance(1);
  assert.equal(controller.getState().phase, "ouverture");
  advance(200);
  assert.ok(controller.getState().intensity > 0 && controller.getState().intensity < 1);
  advance(200);
  assert.equal(controller.getState().intensity, 1);
  assert.equal(controller.getState().phase, "attente-rapprochement");
  assert.equal(controller.getState().closeupProgress, 0);
  advance(999);
  assert.equal(controller.getState().phase, "attente-rapprochement");
  assert.ok(controller.getState().waitProgress > 0.9);
  advance(1);
  assert.equal(controller.getState().phase, "rapprochement");
  advance(250);
  assert.ok(controller.getState().closeupProgress > 0 && controller.getState().closeupProgress < 1);
  assert.ok(controller.getState().intensity > 0 && controller.getState().intensity < 1);
  advance(262);
  assert.equal(controller.getState().phase, "vue-rapprochée");
  assert.equal(controller.getState().closeupProgress, 1);
  assert.equal(controller.getState().intensity, 0);
  assert.equal(jobs.size, 0);
});

test("tolérance écran et mouvements cumulés : le centre reste fixe", () => {
  const { controller, renders, advance, point } = setup(true);
  controller.move(point());
  advance(300);
  controller.move(point(104, 500));
  advance(400);
  assert.deepEqual(renders.at(-1).focus, { x: 300, y: 250 });
  controller.move(point(109, 600));
  assert.equal(controller.getState().intensity, 0);
  advance(699);
  assert.equal(controller.getState().intensity, 0);
  advance(1);
  assert.deepEqual(renders.at(-1).focus, { x: 600, y: 250 });
});

test("les déplacements continus repoussent l'ouverture", () => {
  const { controller, renders, advance, point } = setup();
  for (let step = 0; step < 20; step++) {
    controller.move(point(100 + step * 10));
    advance(100);
  }
  assert.equal(renders.length, 0);
});

test("interruption en cours d'ouverture : fermeture depuis l'intensité courante", () => {
  const { controller, renders, advance, point } = setup();
  controller.move(point());
  advance(900);
  const beforeMove = controller.getState().intensity;
  controller.move(point(150, 500));
  assert.equal(controller.getState().intensity, beforeMove);
  advance(96);
  assert.ok(controller.getState().intensity > 0 && controller.getState().intensity < beforeMove);
  assert.deepEqual(renders.at(-1).focus, { x: 300, y: 250 });
  advance(112);
  assert.equal(controller.getState().intensity, 0);
  advance(492);
  assert.equal(controller.getState().phase, "ouverture");
  advance(400);
  assert.deepEqual(renders.at(-1).focus, { x: 500, y: 250 });
});

test("sortie annule l'attente et ferme sans réouverture retardée", () => {
  const { controller, advance, point, jobs } = setup();
  controller.move(point());
  advance(300);
  controller.leave();
  advance(2000);
  assert.equal(controller.getState().phase, "repos");
  controller.move(point());
  advance(1100);
  controller.leave();
  advance(208);
  assert.equal(controller.getState().intensity, 0);
  assert.equal(jobs.size, 0);
});

test("désactivation et changement d'année annulent toutes les tâches", () => {
  const { controller, renders, advance, point, jobs } = setup();
  controller.move(point());
  advance(900);
  controller.setEnabled(false);
  assert.equal(renders.at(-1).focus, null);
  assert.equal(renders.at(-1).intensity, 0);
  assert.equal(renders.at(-1).closeupProgress, 0);
  assert.equal(jobs.size, 0);
  controller.move(point());
  advance(2000);
  assert.equal(jobs.size, 0);
  controller.setEnabled(true);
  advance(2000);
  assert.equal(controller.getState().phase, "repos");
  controller.move(point());
  advance(900);
  controller.reset();
  advance(2000);
  assert.equal(renders.at(-1).focus, null);
  assert.equal(renders.at(-1).intensity, 0);
  assert.equal(jobs.size, 0);
});

test("animations réduites : délai conservé, états finaux immédiats", () => {
  const { controller, advance, point, jobs } = setup(true);
  controller.move(point());
  advance(699);
  assert.equal(controller.getState().intensity, 0);
  advance(1);
  assert.equal(controller.getState().intensity, 1);
  controller.leave();
  assert.equal(controller.getState().intensity, 0);
  assert.equal(jobs.size, 0);
});

test("la préférence d'animation réduite peut changer pendant l'ouverture", () => {
  const { controller, advance, point, jobs } = setup();
  controller.move(point());
  advance(800);
  controller.setReducedMotion(true);
  assert.equal(controller.getState().intensity, 1);
  assert.equal(controller.getState().phase, "attente-rapprochement");
  assert.equal(jobs.size, 1);
});

test("mouvement pendant la seconde attente : annulation et nouveau point d'ancrage", () => {
  const { controller, advance, point, renders } = setup();
  controller.move(point());
  advance(1800);
  controller.move(point(105, 900));
  assert.equal(controller.getState().phase, "attente-rapprochement");
  assert.deepEqual(renders.at(-1).focus, { x: 300, y: 250 });
  controller.move(point(109, 500));
  advance(208);
  assert.equal(controller.getState().intensity, 0);
  advance(92);
  assert.equal(controller.getState().closeupProgress, 0);
  advance(800);
  assert.equal(controller.getState().phase, "attente-rapprochement");
  advance(1512);
  assert.equal(controller.getState().phase, "vue-rapprochée");
  assert.deepEqual(renders.at(-1).focus, { x: 500, y: 250 });
});

test("déplacement et sortie ne ferment plus le rapprochement commencé", () => {
  const { controller, advance, point, renders, jobs } = setup();
  controller.move(point());
  advance(2100);
  controller.move(point(900, 1000));
  controller.leave();
  advance(512);
  assert.equal(controller.getState().phase, "vue-rapprochée");
  assert.deepEqual(renders.at(-1).focus, { x: 300, y: 250 });
  controller.move(point(1000, 100));
  controller.leave();
  advance(3000);
  assert.equal(controller.getState().closeupProgress, 1);
  assert.equal(jobs.size, 0);
});

test("retour pendant le rapprochement : interpolation courante et aucune réouverture automatique", () => {
  const { controller, advance, point, jobs } = setup();
  controller.move(point());
  advance(2300);
  const progress = controller.getState().closeupProgress;
  const intensity = controller.getState().intensity;
  assert.equal(controller.returnToOverview(), true);
  assert.equal(controller.getState().closeupProgress, progress);
  assert.equal(controller.getState().intensity, intensity);
  controller.move(point(105));
  advance(400);
  assert.equal(controller.getState().phase, "repos");
  assert.equal(controller.getState().closeupProgress, 0);
  controller.move(point(105)); // Un événement de survol sans déplacement réel ne réarme pas le zoom.
  advance(3000);
  assert.equal(controller.getState().phase, "repos");
  assert.equal(jobs.size, 0);
  controller.move(point(106));
  advance(1100);
  assert.equal(controller.getState().phase, "attente-rapprochement");
});

test("retour depuis la vue finale et réentrée du curseur", () => {
  const { controller, advance, point } = setup();
  controller.move(point());
  advance(2612);
  controller.returnToOverview();
  advance(400);
  assert.equal(controller.getState().intensity, 0);
  assert.equal(controller.getState().closeupProgress, 0);
  controller.move({ ...point(), entered: true });
  advance(700);
  assert.equal(controller.getState().phase, "ouverture");
});

for (const elapsed of [500, 900, 1600, 2300, 2700]) {
  test(`réinitialisation ou désactivation après ${elapsed} ms : aucune tâche tardive`, () => {
    for (const disable of [false, true]) {
      const { controller, advance, point, jobs } = setup();
      controller.move(point());
      advance(elapsed);
      if (disable) controller.setEnabled(false);
      else controller.reset();
      advance(5000);
      assert.equal(controller.getState().phase, "repos");
      assert.equal(controller.getState().intensity, 0);
      assert.equal(controller.getState().closeupProgress, 0);
      assert.equal(jobs.size, 0);
    }
  });
}

test("réduction des animations : deux délais conservés, anneau statique et rapprochement immédiat", () => {
  const { controller, advance, point, jobs } = setup(true);
  controller.move(point());
  advance(700);
  assert.equal(controller.getState().phase, "attente-rapprochement");
  assert.equal(controller.getState().waitProgress, 0);
  assert.equal(jobs.size, 1);
  advance(999);
  assert.equal(controller.getState().closeupProgress, 0);
  advance(1);
  assert.equal(controller.getState().phase, "vue-rapprochée");
  assert.equal(controller.getState().closeupProgress, 1);
  controller.returnToOverview();
  assert.equal(controller.getState().phase, "repos");
  assert.equal(jobs.size, 0);
});

test("changement de préférence pendant le compte à rebours : son échéance est préservée", () => {
  const { controller, advance, point } = setup();
  controller.move(point());
  advance(1500);
  controller.setReducedMotion(true);
  advance(300);
  controller.setReducedMotion(false);
  advance(299);
  assert.equal(controller.getState().phase, "attente-rapprochement");
  advance(1);
  assert.equal(controller.getState().phase, "rapprochement");
  controller.setReducedMotion(true);
  assert.equal(controller.getState().phase, "vue-rapprochée");
});

test("transformation ×3 centrée et limitée aux bords à chaque étape", () => {
  const width = 1100, height = 700;
  const centralFocus = { x: 500, y: 300 };
  const view = getCloseupTransform(centralFocus, 1, width, height, 3);
  assert.equal(view.k, 3);
  assert.equal(view.k * centralFocus.x + view.x, width / 2);
  assert.equal(view.k * centralFocus.y + view.y, height / 2);
  for (const x of [0, 20, 500, 1080, 1100]) {
    for (const y of [0, 20, 300, 680, 700]) {
      for (const progress of [0, 0.1, 0.5, 1]) {
        const value = getCloseupTransform({ x, y }, progress, width, height, 3);
        assert.ok(value.x <= 0 && value.x + value.k * width >= width);
        assert.ok(value.y <= 0 && value.y + value.k * height >= height);
      }
    }
  }
});
