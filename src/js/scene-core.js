/* Renderer, camera, controls, theme colours and camera moves. */
(function (P) {
  'use strict';
  var T = window.THREE;
  var G = P.g = {};

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  P.css = css;

  P.readTheme = function () {
    var th = {
      paper: css('--scene-bg'), ink: css('--ink'), muted: css('--muted'), rule: css('--rule'),
      box: css('--scene-box'), edge: css('--scene-edge'), am: css('--am'), bad: css('--bad'),
      good: css('--good'), warn: css('--warn'), cwA: css('--cw-a'), cwB: css('--cw-b'),
      lanes: []
    };
    for (var i = 0; i < P.N_PCS; i++) th.lanes.push(css('--lane-' + i));
    G.theme = th;
    G.col = {};
    Object.keys(th).forEach(function (k) {
      if (k !== 'lanes') G.col[k] = new T.Color(th[k]);
    });
    G.col.lanes = th.lanes.map(function (c) { return new T.Color(c); });
    return th;
  };

  P.initScene = function (host) {
    P.readTheme();
    var r = G.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(r.domElement);
    r.domElement.setAttribute('aria-hidden', 'true');
    G.host = host;
    G.scene = new T.Scene();
    G.scene.background = G.col.paper.clone();
    G.camera = new T.PerspectiveCamera(32, 2, 0.5, 600);
    G.scene.add(new T.HemisphereLight(0xffffff, 0x8890a0, 0.95));
    var dl = new T.DirectionalLight(0xffffff, 0.45);
    dl.position.set(20, 40, 30);
    G.scene.add(dl);

    var c = G.controls = new T.OrbitControls(G.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.12;
    c.enableZoom = false;           // wheel zoom needs Ctrl/Cmd so the page still scrolls
    c.screenSpacePanning = true;
    c.minPolarAngle = 0.35; c.maxPolarAngle = 2.3;
    c.minAzimuthAngle = -1.1; c.maxAzimuthAngle = 1.1;
    c.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
    P.setExplore(!window.matchMedia('(pointer: coarse)').matches);

    r.domElement.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) { P.hint('Hold Ctrl (⌘ on Mac) and scroll to zoom'); return; }
      e.preventDefault();
      P.dolly(e.deltaY > 0 ? 1.12 : 0.89);
    }, { passive: false });

    new ResizeObserver(P.resize).observe(host);
    P.resize();
  };

  P.setExplore = function (on) {
    G.explore = on;
    G.controls.enabled = on;
    // Pinch zoom on touch screens; desktop wheel zoom goes through the Ctrl/Cmd handler.
    G.controls.enableZoom = on && window.matchMedia('(pointer: coarse)').matches;
    G.controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
    G.renderer.domElement.style.touchAction = on ? 'none' : 'pan-y';
    P.emit && P.emit('explore');
  };

  P.dolly = function (f) {
    var c = G.controls, cam = G.camera;
    var off = cam.position.clone().sub(c.target);
    var len = Math.min(Math.max(off.length() * f, 8), 260);
    cam.position.copy(c.target).add(off.setLength(len));
  };

  P.resize = function () {
    var w = G.host.clientWidth, h = G.host.clientHeight;
    if (!w || !h) return;
    G.renderer.setSize(w, h, false);
    G.camera.aspect = w / h;
    G.camera.updateProjectionMatrix();
    G.w = w; G.h = h;
  };

  // Camera pose that fits [x0, x1] horizontally and the lane stack vertically.
  P.framePose = function (x0, x1, tilt) {
    var cam = G.camera, span = x1 - x0, cx = (x0 + x1) / 2;
    var vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect);
    var d = Math.max(span * 0.52 / Math.tan(hf / 2), 15 / Math.tan(vf / 2));
    var t = tilt == null ? 1 : tilt;
    return {
      pos: new T.Vector3(cx + d * 0.16 * t, d * 0.22 * t, d * (1 - 0.03 * t)),
      target: new T.Vector3(cx, -0.6, 0)
    };
  };

  var tween = null;
  P.flyTo = function (pose, ms) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var c = G.controls, cam = G.camera;
    if (reduce || ms === 0) { cam.position.copy(pose.pos); c.target.copy(pose.target); return; }
    tween = { t0: performance.now(), ms: ms || 700,
              p0: cam.position.clone(), q0: c.target.clone(), p1: pose.pos, q1: pose.target };
  };
  P.panTo = function (cx) {
    var c = G.controls, dx = cx - c.target.x;
    tween = null;
    c.target.x += dx; G.camera.position.x += dx;
  };

  P.updateCamera = function (now) {
    if (tween) {
      var k = Math.min((now - tween.t0) / tween.ms, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      G.camera.position.lerpVectors(tween.p0, tween.p1, e);
      G.controls.target.lerpVectors(tween.q0, tween.q1, e);
      if (k >= 1) tween = null;
    }
    G.controls.update();
  };

  var hintTimer = 0;
  P.hint = function (msg) {
    var el = document.getElementById('lab-hint');
    if (!el) return;
    el.textContent = msg; el.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { el.hidden = true; }, 1600);
  };
})(globalThis.PCS = globalThis.PCS || {});
