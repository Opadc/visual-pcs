/* HTML labels projected from 3D anchors. Higher-priority labels win; a label
   that would overlap one already placed is hidden for that frame. */
(function (P) {
  'use strict';
  var T = window.THREE, G = P.g;
  var v = new T.Vector3();
  var items = [];

  P.initLabels = function (host) {
    G.labelHost = document.createElement('div');
    G.labelHost.className = 'scene-labels';
    G.labelHost.setAttribute('aria-hidden', 'true');
    host.appendChild(G.labelHost);
  };

  function setLabels(list) {
    var keep = {};
    list.forEach(function (d) { keep[d.id] = d; });
    items = items.filter(function (it) {
      if (keep[it.id]) return true;
      it.el.remove(); return false;
    });
    list.forEach(function (d) {
      var it = items.find(function (x) { return x.id === d.id; });
      if (!it) {
        it = { id: d.id, el: document.createElement('div') };
        G.labelHost.appendChild(it.el);
        items.push(it);
      }
      if (it.html !== d.html || it.cls !== d.cls) {
        it.el.innerHTML = d.html; it.el.className = 'lbl ' + (d.cls || '');
        it.html = d.html; it.cls = d.cls; it.w = 0;
      }
      it.pos = d.pos; it.pri = d.pri; it.anchor = d.anchor || 'c';
    });
    items.sort(function (a, b) { return b.pri - a.pri; });
  }

  P.buildLabels = function () {
    var S = P.state, link = S.link, X = P.X, L = [], sel = S.selected;
    var top = 4 * P.LANE_SP + 0.4;
    P.BOXES.forEach(function (b, i) {
      var y = b.lane ? top + 0.3 : 1.6;
      L.push({ id: 'box' + i, html: b.short || b.name, cls: 'lbl-box', pos: [(b.x[0] + b.x[1]) / 2, y, 0], pri: b.lane ? 3 : 2 });
    });
    P.STAGES.forEach(function (st) {
      L.push({ id: 'st' + st.n, html: '<b>' + st.n + '</b>', cls: 'lbl-stage' + (S.stage === st.n ? ' on' : ''),
               pos: [(st.span[0] + st.span[1]) / 2, top + 2.2, 0], pri: 4 });
    });
    link.lanes.forEach(function (l) {
      var p = l.pcs, on = sel < 0 || sel === p, cls = 'lbl-lane l' + p + (on ? '' : ' dim');
      L.push({ id: 'in' + p, html: 'PCS ' + p, cls: cls, pos: [X.lanesStart - 0.4, P.yPcs(p), 0], pri: 6, anchor: 'r' });
      L.push({ id: 'out' + p, html: 'PCS ' + p, cls: cls, pos: [X.lanesEnd + 0.2, P.yPcs(p), 0], pri: 5, anchor: 'l' });
    });
    for (var s = 0; s < link.width; s++) {
      var carried = P.lanesOnSerdes(link, s).map(function (l) { return l.pcs; });
      var on = sel < 0 || carried.indexOf(sel) >= 0;
      L.push({ id: 'sd' + s, html: 'SerDes ' + s + ' <span>' + carried.join(' · ') + '</span>',
               cls: 'lbl-serdes' + (on ? '' : ' dim'),
               pos: [52, P.ySerdes(s, link.width) + (link.width === 8 ? 0.55 : 0.75), 0], pri: 4 });
    }
    L.push({ id: 'align', html: 'align_status ' + (S.align ? 'true' : 'false'),
             cls: 'lbl-status ' + (S.align ? 'ok' : 'bad'), pos: [X.reorder[1] - 1, -top - 0.9, 0], pri: 7 });
    L.push({ id: 'cap', html: 'deskew buffer', cls: 'lbl-note', pos: [(X.deskew[0] + X.deskew[1]) / 2, -top - 0.9, 0], pri: 2 });
    [['TRANSMIT', 16], ['CHANNEL', 57], ['RECEIVE', 100]].forEach(function (z, i) {
      L.push({ id: 'zone' + i, html: z[0] + (i === 1 ? '' : ' →'), cls: 'lbl-zone', pos: [z[1], -top - 2.4, 0], pri: 3 });
    });
    if (sel >= 0) {
      var l = link.lanes[sel], k = link.k;
      var callouts = [
        [X.lanesStart + 4, P.yPcs(sel), 'PCS lane ' + sel + ' · TX PMA lane ' + l.txPma],
        [60, P.cableY(link, l.serdes, 60), 'SerDes ' + l.serdes + (k > 1 ? ', bit slot ' + (l.slot + 1) + ' of ' + k : '') +
          (l.rxSerdes !== l.serdes ? ' → arrives as RX SerDes ' + l.rxSerdes : '')],
        [X.demux[1] + 1.4, P.yPcs(l.rxPma), 'RX PMA lane ' + l.rxPma],
        [X.reorder[1], P.yPcs(sel), 'reordered → PCS ' + sel]
      ];
      callouts.forEach(function (cx, i) {
        L.push({ id: 'co' + i, html: cx[2], cls: 'lbl-callout l' + sel, pos: [cx[0], cx[1] - 0.7, 1.2], pri: 8 });
      });
    }
    setLabels(L);
  };

  P.updateLabels = function () {
    var cam = G.camera, W = G.w, H = G.h, placed = [];
    items.forEach(function (it) {
      v.set(it.pos[0], it.pos[1], it.pos[2]).project(cam);
      var show = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
      if (show) {
        if (!it.w) { it.w = it.el.offsetWidth || 40; it.h = it.el.offsetHeight || 16; }
        var sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
        var x0 = it.anchor === 'r' ? sx - it.w : it.anchor === 'l' ? sx : sx - it.w / 2;
        var r = { x0: x0 - 2, y0: sy - it.h / 2 - 1, x1: x0 + it.w + 2, y1: sy + it.h / 2 + 1 };
        show = r.x0 > -4 && r.x1 < W + 4 && !placed.some(function (q) {
          return r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0;
        });
        if (show) {
          placed.push(r);
          var t = 'translate(' + Math.round(x0) + 'px,' + Math.round(sy - it.h / 2) + 'px)';
          if (t !== it.t) { it.el.style.transform = t; it.t = t; }
        }
      }
      if (show !== it.shown) { it.el.style.visibility = show ? 'visible' : 'hidden'; it.shown = show; }
    });
  };
})(globalThis.PCS = globalThis.PCS || {});
