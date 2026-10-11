/* Toolbar, lane chips, stage rail, stage detail and keyboard shortcuts. */
(function (P) {
  'use strict';
  var S = P.state, $ = function (id) { return document.getElementById(id); };

  P.setWidth = function (w) { S.width = w; P.rebuild(true); };
  P.setPreset = function (p) { S.preset = p; P.rebuild(true); };

  P.selectLane = function (p) {
    S.selected = S.selected === p ? -1 : p;
    P.emit('select');
  };

  P.setPlaying = function (on) {
    S.playing = on;
    var b = $('btn-play');
    b.textContent = on ? 'Pause' : 'Resume';
    b.setAttribute('aria-pressed', String(on));
    P.emit('play');
  };

  P.step = function () {
    if (S.playing) P.setPlaying(false);
    P.lensStep && P.lensStep();
    S.stepTo = (S.stepTo != null ? S.stepTo : S.u) + P.GAP;
    P.fecPulse(P.tick());
  };

  function syncToolbar() {
    document.querySelectorAll('[data-width]').forEach(function (b) {
      b.setAttribute('aria-checked', String(+b.dataset.width === S.width));
      b.tabIndex = +b.dataset.width === S.width ? 0 : -1;
    });
    document.querySelectorAll('[data-preset]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.preset === S.preset));
      b.tabIndex = b.dataset.preset === S.preset ? 0 : -1;
    });
    document.querySelectorAll('.chip[data-lane]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.lane === S.selected));
    });
    var w = P.WIDTHS[S.width], k = P.N_PCS / S.width;
    $('lab-summary').textContent = S.width + ' SerDes lanes × ' + w.gbps + ' Gb/s ' + w.mod +
      ' (' + w.baud + ' GBd) · ' + (k === 1 ? 'one PCS lane per SerDes lane' : k + ' PCS lanes bit-multiplexed per SerDes lane') +
      ' · align_status ' + (S.align ? 'true' : 'false');
  }
  P.syncToolbar = syncToolbar;

  // Arrow keys move between radio buttons in a segmented control.
  function radioKeys(group, attr, apply) {
    group.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
      var btns = Array.prototype.slice.call(group.querySelectorAll('[' + attr + ']'));
      var i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var j = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length;
      btns[j].focus(); apply(btns[j]);
    });
  }

  P.goStage = function (n, fly) {
    var st = P.STAGES[n - 1];
    S.stage = n;
    var d = $('stage-detail');
    d.innerHTML = '<div class="sd-head"><span class="sd-num">' + st.n + '</span><span class="sd-side ' + st.side.toLowerCase() + '">' +
      st.side + '</span><h3>' + st.title + '</h3></div><div class="sd-body">' + st.body +
      '<p class="sd-watch"><b>In the scene:</b> ' + st.watch + '</p>' +
      (st.lens ? '<p class="sd-lens">See it at bit scale: ' + st.lens.map(function (m) {
        return '<button type="button" class="linkbtn" data-open-lens="' + m + '">' + P.LENS_MODES[m].title + '</button>';
      }).join(' · ') + '</p>' : '') + '</div><div class="sd-nav">' +
      '<button type="button" class="btn" id="sd-prev"' + (n === 1 ? ' disabled' : '') + '>← Previous stage</button>' +
      '<button type="button" class="btn" id="sd-next"' + (n === 9 ? ' disabled' : '') + '>Next stage →</button></div>';
    d.querySelectorAll('[data-open-lens]').forEach(function (b) {
      b.onclick = function () { P.setLens(b.dataset.openLens); $('lens').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
    });
    $('sd-prev').onclick = function () { P.goStage(n - 1, true); };
    $('sd-next').onclick = function () { P.goStage(n + 1, true); };
    document.querySelectorAll('.rail button').forEach(function (b) {
      b.setAttribute('aria-current', +b.dataset.stage === n ? 'step' : 'false');
    });
    var btn = document.querySelector('.rail button[data-stage="' + n + '"]');
    if (btn) { railLock = performance.now(); btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
    if (fly !== false) P.flyTo(P.framePose(st.span[0], st.span[1], 1.2));
    P.emit('stage');
  };

  var railLock = 0;
  function buildRail() {
    var rail = $('rail');
    rail.innerHTML = P.STAGES.map(function (st) {
      return '<button type="button" data-stage="' + st.n + '"><span class="rn">' + st.n + '</span><span class="rs ' +
        st.side.toLowerCase() + '">' + st.side + '</span><span class="rt">' + st.title + '</span></button>';
    }).join('');
    rail.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-stage]');
      if (b) P.goStage(+b.dataset.stage);
    });
    // On narrow screens the rail scrolls sideways; scrolling it pans along the link.
    rail.addEventListener('scroll', function () {
      if (performance.now() - railLock < 900) return;
      var max = rail.scrollWidth - rail.clientWidth;
      if (max <= 0) return;
      P.panTo(4 + (rail.scrollLeft / max) * 108);
    }, { passive: true });
  }

  P.initControls = function () {
    buildRail();
    var mi = $('msg-input');
    mi.value = P.PAYLOAD_DEFAULT.trim();
    mi.placeholder = P.PAYLOAD_SOURCE;
    mi.title = P.PAYLOAD_SOURCE;
    mi.addEventListener('input', function () { P.setPayload(mi.value ? mi.value + ' ' : ''); P.emit('payload'); });
    $('btn-play').onclick = function () { P.setPlaying(!S.playing); };
    $('btn-step').onclick = P.step;
    $('sel-speed').onchange = function (e) { S.speed = +e.target.value; };
    document.querySelectorAll('[data-width]').forEach(function (b) { b.onclick = function () { P.setWidth(+b.dataset.width); }; });
    document.querySelectorAll('[data-preset]').forEach(function (b) { b.onclick = function () { P.setPreset(b.dataset.preset); }; });
    radioKeys(document.querySelector('[aria-labelledby="w-label"]'), 'data-width', function (b) { P.setWidth(+b.dataset.width); });
    radioKeys(document.querySelector('[aria-labelledby="m-label"]'), 'data-preset', function (b) { P.setPreset(b.dataset.preset); });
    document.querySelectorAll('.chip[data-lane]').forEach(function (b) {
      b.onclick = function () { var p = +b.dataset.lane; if (p < 0) { S.selected = -1; P.emit('select'); } else P.selectLane(p); };
    });
    $('btn-overview').onclick = function () { S.stage = null; P.emit('stage'); P.flyTo(P.framePose(-2, 118, 0.6)); };
    $('btn-explore').onclick = function () { P.setExplore(!P.g.explore); };
    P.on(function (what) {
      if (what === 'explore') {
        $('btn-explore').setAttribute('aria-pressed', String(P.g.explore));
        $('vp-help').textContent = P.g.explore
          ? (matchMedia('(pointer: coarse)').matches ? 'Drag to pan · pinch to zoom and rotate' : 'Drag to pan · right-drag to rotate · Ctrl + scroll to zoom')
          : 'Camera locked so the page scrolls · use the stage rail, or turn on Drag to explore';
      }
    });

    var vp = $('viewport');
    vp.tabIndex = 0;
    vp.setAttribute('aria-label', '3D lane diagram. Arrow keys pan, plus and minus zoom, Enter inspects the block nearest the centre.');
    vp.addEventListener('keydown', function (e) {
      var c = P.g.controls, cam = P.g.camera;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        var dx = e.key === 'ArrowLeft' ? -3 : 3; c.target.x += dx; cam.position.x += dx; e.preventDefault();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        var dy = e.key === 'ArrowUp' ? 1 : -1; c.target.y += dy; cam.position.y += dy; e.preventDefault();
      } else if (e.key === 'Enter' && e.target === vp) { P.inspectCenter(); e.preventDefault(); }
      else if (e.key === '+' || e.key === '=') { P.dolly(0.85); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { P.dolly(1.18); e.preventDefault(); }
    });

    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'p' || e.key === 'P') { P.setPlaying(!S.playing); }
      else if (e.key === '.') { P.step(); }
      else if (/^[0-7]$/.test(e.key)) { P.selectLane(+e.key); }
      else if (e.key === 'Escape' && P.inspectorOpen && P.inspectorOpen()) { P.closeInspector(); }
      else if (e.key === 'Escape' && S.selected >= 0) { S.selected = -1; P.emit('select'); }
      else return;
      e.preventDefault();
    });
  };
})(globalThis.PCS = globalThis.PCS || {});
