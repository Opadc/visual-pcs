/* Static scene: stage boxes, lane tracks, SerDes cables, lock rings, deskew bars. */
(function (P) {
  'use strict';
  var T = window.THREE, G = P.g;
  var LANE_H = 8 * P.LANE_SP + 0.8, AGG_H = 2.6, DEPTH = 2.6;

  function disposeGroup(g) {
    g.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    G.scene.remove(g);
  }

  P.buildBoxes = function () {
    if (G.boxGroup) disposeGroup(G.boxGroup);
    var grp = G.boxGroup = new T.Group();
    G.boxes = [];
    P.BOXES.forEach(function (b) {
      var w = b.x[1] - b.x[0], h = b.lane ? LANE_H : AGG_H;
      var geo = new T.BoxGeometry(w, h, DEPTH);
      var mat = new T.MeshBasicMaterial({ color: G.col.box, transparent: true, opacity: b.lane ? 0.32 : 0.5, depthWrite: false });
      var mesh = new T.Mesh(geo, mat);
      mesh.position.set((b.x[0] + b.x[1]) / 2, 0, 0);
      mesh.renderOrder = 2;
      var edges = new T.LineSegments(new T.EdgesGeometry(geo),
        new T.LineBasicMaterial({ color: G.col.edge, transparent: true, opacity: 0.9 }));
      mesh.add(edges);
      grp.add(mesh);
      G.boxes.push({ def: b, mesh: mesh, edges: edges, h: h });
    });
    // Ground grid and the TX | link | RX dividers.
    var gy = -LANE_H / 2 - 1.2;
    var grid = new T.GridHelper(130, 65, G.col.rule, G.col.rule);
    grid.position.set(58, gy, 0);
    grid.material.transparent = true; grid.material.opacity = 0.35;
    grid.scale.set(1, 1, 0.12);
    grp.add(grid);
    [P.X.muxIn - 0.5, P.X.demux[0] - 0.5].forEach(function (x) {
      var g = new T.BufferGeometry().setFromPoints([new T.Vector3(x, gy, 0), new T.Vector3(x, LANE_H / 2 + 2.4, 0)]);
      grp.add(new T.Line(g, new T.LineDashedMaterial({ color: G.col.muted, dashSize: 0.4, gapSize: 0.3 })));
      grp.children[grp.children.length - 1].computeLineDistances();
    });
    G.scene.add(grp);
  };

  function sampleLane(link, lane, x0, x1, step) {
    var pts = [];
    for (var x = x0; x <= x1 + 1e-6; x += step) pts.push(new T.Vector3(x, P.yPath(link, lane, x), P.zPath(link, lane, x)));
    return pts;
  }

  P.buildLinkScene = function () {
    var link = P.state.link;
    if (G.linkGroup) disposeGroup(G.linkGroup);
    var grp = G.linkGroup = new T.Group();
    G.tracks = []; G.rings = []; G.bars = []; G.cables = [];
    var X = P.X;

    link.lanes.forEach(function (lane) {
      var pts = sampleLane(link, lane, X.lanesStart, X.lanesEnd, 0.25);
      var line = new T.Line(new T.BufferGeometry().setFromPoints(pts),
        new T.LineBasicMaterial({ color: G.col.lanes[lane.pcs], transparent: true, opacity: 0.5 }));
      grp.add(line);
      var tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 360, 0.09, 6, false),
        new T.MeshBasicMaterial({ color: G.col.lanes[lane.pcs], transparent: true, opacity: 0.85 }));
      tube.visible = false;
      grp.add(tube);
      G.tracks[lane.pcs] = { line: line, tube: tube };

      // Lock ring around the lane at the alignment-lock point.
      var ring = new T.Mesh(new T.TorusGeometry(0.42, 0.07, 8, 28),
        new T.MeshBasicMaterial({ color: G.col.good }));
      ring.rotation.y = Math.PI / 2;
      ring.position.set(X.amLock, P.yPcs(lane.rxPma), 0);
      grp.add(ring);
      G.rings[lane.pcs] = ring;

      // Deskew fill: how much this lane is held back to line up with the slowest.
      var D = 0;
      link.lanes.forEach(function (l) { if (!l.deskewFail) D = Math.max(D, l.relSkewNs); });
      var hold = lane.deskewFail ? 1 : (D - lane.relSkewNs) / P.DESKEW_CAP_NS;
      var bw = Math.max(0.05, Math.min(hold, 1)) * (X.deskew[1] - X.deskew[0] - 0.4);
      var bar = new T.Mesh(new T.BoxGeometry(bw, 0.22, 0.5),
        new T.MeshBasicMaterial({ color: lane.deskewFail ? G.col.bad : G.col.lanes[lane.pcs], transparent: true, opacity: 0.45 }));
      bar.position.set(X.deskew[0] + 0.2 + bw / 2, P.yPcs(lane.rxPma) - 0.42, 0.9);
      grp.add(bar);
      G.bars[lane.pcs] = bar;
    });

    // Physical SerDes lanes: a neutral sheath around the PCS lanes they carry.
    for (var s = 0; s < link.width; s++) {
      var pts = [];
      for (var x = X.mux[1] - 0.5; x <= X.demux[0] + 0.5; x += 0.25) pts.push(new T.Vector3(x, P.cableY(link, s, x), 0));
      var r = link.width === 8 ? 0.36 : link.width === 4 ? 0.5 : 0.62;
      var cable = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 160, r, 14, false),
        new T.MeshBasicMaterial({ color: G.col.ink, transparent: true, opacity: 0.08, depthWrite: false }));
      grp.add(cable);
      G.cables[s] = cable;
    }
    G.scene.add(grp);
    P.styleLinkScene();
  };

  var LOCK_COL = { locked: 'good', checking: 'warn', searching: 'warn', nolock: 'bad' };
  P.styleLinkScene = function () {
    var S = P.state, sel = S.selected;
    if (!G.tracks) return;
    S.link.lanes.forEach(function (lane) {
      var t = G.tracks[lane.pcs], on = sel < 0 || sel === lane.pcs;
      t.line.material.opacity = on ? 0.55 : 0.12;
      t.tube.visible = sel === lane.pcs;
      G.rings[lane.pcs].material.color.copy(G.col[LOCK_COL[P.lockView(S.lock[lane.pcs])]]);
      G.rings[lane.pcs].scale.setScalar(on ? 1 : 0.7);
      G.bars[lane.pcs].material.opacity = on ? 0.5 : 0.12;
    });
    G.cables.forEach(function (c, s) {
      var carries = sel < 0 || S.link.lanes[sel].serdes === s;
      var noisy = S.faults.noise > 0 && (S.faults.noiseLane < 0 || S.faults.noiseLane === s);
      var dead = S.faults.los && S.faults.losLane === s;
      c.material.color.copy(dead ? G.col.bad : noisy ? G.col.warn : G.col.ink);
      c.material.opacity = (carries ? 0.12 : 0.04) + (dead || noisy ? 0.08 : 0);
    });
  };

  P.recolorStatic = function () {
    G.scene.background.copy(G.col.paper);
    if (G.boxes) G.boxes.forEach(function (b) {
      b.mesh.material.color.copy(G.col.box);
      b.edges.material.color.copy(G.col.edge);
    });
    P.buildBoxes();
    P.buildLinkScene();
  };
})(globalThis.PCS = globalThis.PCS || {});
