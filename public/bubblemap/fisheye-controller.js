// Contrôle les deux attentes et les animations ; app.js assure le rendu géographique.
function createFisheyeController({ render, settings, reducedMotion = false, clock = globalThis }) {
  let enabled = true;
  let phase = "repos";
  let anchor = null;
  let lastPointer = null;
  let focus = null;
  const values = { intensity: 0, closeupProgress: 0, waitProgress: 0 };
  let dwellTimer = null;
  let waitStarted = null;
  let animationFrame = null;
  let animation = null;

  function emit() {
    render(focus, values.intensity, { ...values, phase, reducedMotion });
  }

  function cancelDwell() {
    if (dwellTimer !== null) clock.clearTimeout(dwellTimer);
    dwellTimer = null;
    waitStarted = null;
  }

  function cancelAnimation() {
    if (animationFrame !== null) clock.cancelAnimationFrame(animationFrame);
    animationFrame = null;
    animation = null;
  }

  function finishAnimation() {
    const finished = animation;
    cancelAnimation();
    Object.assign(values, finished.target);
    emit();
    finished.onEnd?.();
  }

  function animateTo(target, duration, onEnd) {
    cancelAnimation();
    animation = {
      from: { ...values }, target: { ...values, ...target },
      start: clock.performance.now(), duration, onEnd
    };
    if (reducedMotion || Object.keys(values).every(key => values[key] === animation.target[key])) {
      finishAnimation();
      return;
    }

    function tick(now) {
      animationFrame = null;
      const progress = Math.min(1, (now - animation.start) / animation.duration);
      if (progress === 1) {
        finishAnimation();
        return;
      }
      const eased = progress * progress * (3 - 2 * progress);
      for (const key of Object.keys(values)) {
        values[key] = animation.from[key] + (animation.target[key] - animation.from[key]) * eased;
      }
      emit();
      animationFrame = clock.requestAnimationFrame(tick);
    }

    animationFrame = clock.requestAnimationFrame(tick);
  }

  function animateCountdown() {
    if (reducedMotion || waitStarted === null) return;
    function tick(now) {
      animationFrame = null;
      values.waitProgress = Math.min(1, (now - waitStarted) / settings.closeupDelay);
      emit();
      if (values.waitProgress < 1) animationFrame = clock.requestAnimationFrame(tick);
    }
    animationFrame = clock.requestAnimationFrame(tick);
  }

  function beginCloseup() {
    cancelDwell();
    cancelAnimation();
    values.waitProgress = 0;
    phase = "rapprochement";
    emit();
    animateTo({ intensity: 0, closeupProgress: 1 }, settings.closeupDuration, () => {
      phase = "vue-rapprochée";
      emit();
    });
  }

  function waitForCloseup() {
    phase = "attente-rapprochement";
    waitStarted = clock.performance.now();
    values.waitProgress = 0;
    emit();
    dwellTimer = clock.setTimeout(beginCloseup, settings.closeupDelay);
    animateCountdown();
  }

  function isCloseupLocked() {
    return ["rapprochement", "vue-rapprochée", "retour-carte"].includes(phase);
  }

  function closeLens() {
    phase = "retour";
    values.waitProgress = 0;
    animateTo({ intensity: 0 }, settings.closeDuration, () => {
      focus = null;
      phase = anchor ? "attente" : "repos";
      emit();
    });
  }

  function move(point) {
    const physicallyMoved = !lastPointer || point.clientX !== lastPointer.clientX || point.clientY !== lastPointer.clientY;
    lastPointer = { ...point };
    if (!enabled || isCloseupLocked() || (!physicallyMoved && !point.entered)) return;
    // La tolérance se mesure depuis l'ancrage, en pixels écran, même à largeur réduite.
    if (anchor && Math.hypot(point.clientX - anchor.clientX, point.clientY - anchor.clientY) <= settings.movementTolerance) return;

    cancelDwell();
    anchor = { ...point };
    if (values.intensity > 0 || animationFrame !== null) closeLens();
    else phase = "attente";

    dwellTimer = clock.setTimeout(() => {
      dwellTimer = null;
      if (!enabled || !anchor) return;
      focus = { x: anchor.x, y: anchor.y };
      phase = "ouverture";
      animateTo({ intensity: 1 }, settings.openDuration, waitForCloseup);
    }, settings.dwellDelay);
  }

  function leave() {
    if (isCloseupLocked()) return;
    cancelDwell();
    anchor = null;
    closeLens();
  }

  function reset() {
    cancelDwell();
    cancelAnimation();
    anchor = null;
    focus = null;
    Object.assign(values, { intensity: 0, closeupProgress: 0, waitProgress: 0 });
    phase = "repos";
    emit();
  }

  function returnToOverview() {
    if (phase === "repos" || phase === "retour-carte") return false;
    cancelDwell();
    anchor = null;
    phase = "retour-carte";
    values.waitProgress = 0;
    emit();
    animateTo({ intensity: 0, closeupProgress: 0 }, settings.overviewDuration, () => {
      focus = null;
      phase = "repos";
      emit();
    });
    return true;
  }

  return {
    move, leave, reset, returnToOverview,
    setEnabled(value) { enabled = value; reset(); },
    setReducedMotion(value) {
      reducedMotion = value;
      if (reducedMotion && animation) finishAnimation();
      else if (phase === "attente-rapprochement") {
        cancelAnimation();
        if (reducedMotion) { values.waitProgress = 0; emit(); }
        else animateCountdown();
      }
    },
    getState() { return { enabled, phase, ...values }; }
  };
}

// Transformation limitée au cadre initial ; le même calcul sert au rendu et aux tests.
function getCloseupTransform(focus, progress, width, height, targetScale) {
  if (!focus || progress === 0) return { k: 1, x: 0, y: 0 };
  const targetX = Math.max(width * (1 - targetScale), Math.min(0, width / 2 - targetScale * focus.x));
  const targetY = Math.max(height * (1 - targetScale), Math.min(0, height / 2 - targetScale * focus.y));
  return { k: 1 + (targetScale - 1) * progress, x: targetX * progress, y: targetY * progress };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createFisheyeController, getCloseupTransform };
}
