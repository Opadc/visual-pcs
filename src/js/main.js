/* Boot and frame loop. */
(function (P) {
  'use strict';
  var S = P.state, G = P.g;
  var VEL = 2.5;            // data units per second at 1x
  var TICK_MS = 100;        // FEC counter batch per 100 ms of wall time at 1x
  var visible = true, last = 0, acc = 0, diagAcc = 0, lastWidth = 0;

  function onEvent(what) {
    if (what === 'link') {
      P.buildLinkScene(); P.buildLabels(); P.renderMapping(); P.scopeNote();
      if (S.width !== lastWidth) { lastWidth = S.width; P.renderFaults(); P.sizeScope(); }
      P.syncToolbar(); P.renderDiag();
    } else if (what === 'lock' || what === 'align') {
      P.styleLinkScene(); P.buildLabels(); P.renderMapping(); P.syncToolbar(); P.renderDiag();
    } else if (what === 'select') {
      P.styleLinkScene(); P.buildLabels(); P.renderMapping(); P.syncToolbar(); P.renderDiag();
    } else if (what === 'fault') {
      P.styleLinkScene(); P.renderDiag();
    } else if (what === 'stage') {
      P.buildLabels();
    } else if (what === 'tick') {
      // Diagnostics are refreshed from the frame loop at a steady rate.
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min((now - (last || now)) / 1000, 0.1);
    last = now;
    if (S.playing) {
      S.u += dt * VEL * S.speed;
      S.stepTo = null;
      acc += dt * 1000 * S.speed;
      while (acc >= TICK_MS) { acc -= TICK_MS; P.fecPulse(P.tick()); }
    } else if (S.stepTo != null) {
      S.u = Math.min(S.stepTo, S.u + dt * VEL * 3);
      if (S.u >= S.stepTo) S.stepTo = null;
    }
    P.processAms();
    diagAcc += dt;
    if (diagAcc > 0.12) { diagAcc = 0; P.renderDiag(); }
    if (!visible || document.hidden) return;
    P.updatePulse(dt);
    P.drawPackets();
    P.updateCamera(now);
    P.updateInspector();
    G.renderer.render(G.scene, G.camera);
    P.updateLabels();
    P.drawScope();
  }

  function themeChanged() {
    requestAnimationFrame(function () {
      P.readTheme(); P.recolorStatic(); P.drawScope(); P.inspectorRecolor && P.inspectorRecolor();
    });
  }

  P.boot = function () {
    var vp = document.getElementById('viewport');
    P.initControls();
    P.initDiag();
    P.initScope();
    P.initStory();
    P.on(onEvent);
    try {
      P.initScene(vp);
    } catch (err) {
      vp.insertAdjacentHTML('beforeend', '<p class="noscript">This browser could not start WebGL, so the 3D view is unavailable. The mapping table, bit scope, fault lab and diagnostics below still work.</p>');
      G.failed = true;
    }
    if (!G.failed) {
      P.initLabels(vp);
      P.initPackets();
      P.buildBoxes();
      P.initInspector(vp);
    } else {
      P.buildLinkScene = P.styleLinkScene = P.buildLabels = P.recolorStatic = function () {};
    }
    P.rebuild(false);
    if (!G.failed) {
      var narrow = vp.clientWidth < 760;
      P.flyTo(narrow ? P.framePose(29, 72, 1) : P.framePose(-2, 118, 0.6), 0);
    }
    P.goStage(4, false);
    P.setExplore && !G.failed && P.emit('explore');

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
    new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { rootMargin: '120px' }).observe(vp);
    if (!G.failed) requestAnimationFrame(frame);
    else setInterval(function () { if (S.playing) { P.tick(); } P.processAms(); P.renderDiag(); P.drawScope(); S.u += 0.25 * S.speed; }, 100);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', P.boot);
  else P.boot();
})(globalThis.PCS = globalThis.PCS || {});
