/* Moving data: one InstancedMesh for every cube in the scene, rebuilt each frame.
   Each instance also gets an identity record so a click can say what it carries. */
(function (P) {
  'use strict';
  var T = window.THREE, G = P.g;
  var MAX = 1400;
  var m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3();
  var c = new T.Color(), tmp = new T.Color();
  var count = 0;
  var meta = new Array(MAX), boxes = new Float32Array(MAX * 6);

  P.initPackets = function () {
    var geo = new T.BoxGeometry(1, 1, 1);
    var mat = new T.MeshLambertMaterial({ color: 0xffffff });
    G.inst = new T.InstancedMesh(geo, mat, MAX);
    G.inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    G.inst.setColorAt(0, new T.Color());
    G.inst.frustumCulled = false;
    G.scene.add(G.inst);
  };

  function put(x, y, z, sx, sy, sz, col, id) {
    if (count >= MAX) return;
    v.set(x, y, z); sc.set(sx, sy, sz);
    m4.compose(v, q, sc);
    G.inst.setMatrixAt(count, m4);
    G.inst.setColorAt(count, col);
    meta[count] = id;
    var o = count * 6;
    boxes[o] = x; boxes[o + 1] = y; boxes[o + 2] = z; boxes[o + 3] = sx; boxes[o + 4] = sy; boxes[o + 5] = sz;
    count++;
  }

  function dim(col, on, amt) {
    if (!on) col.lerp(G.col.paper, amt == null ? 0.82 : amt);
    return col;
  }

  // PCS-lane data units from symbol distribution to lane reorder.
  function drawLanes() {
    var S = P.state, link = S.link, X = P.X, f = S.faults;
    var extra = P.noiseToSer(f.noise);
    var pVis = extra > 0 ? Math.min(0.5, 0.04 + 0.08 * Math.log10(1 + extra * 1e6)) : 0;
    link.lanes.forEach(function (lane) {
      var p = lane.pcs, segs = S.segs[p], on = S.selected < 0 || S.selected === p;
      var nHi = Math.floor((X.lanesStart + S.u - P.unwarp(X.lanesStart, segs)) / P.GAP);
      var nLo = Math.ceil((X.lanesStart + S.u - P.unwarp(X.lanesEnd, segs)) / P.GAP);
      var noisy = f.noise > 0 && (f.noiseLane < 0 || f.noiseLane === lane.serdes);
      var dead = f.los && f.losLane === lane.serdes;
      var amBad = f.amLoss && f.amLane === p;
      for (var n = Math.max(nLo, 0); n <= nHi; n++) {
        var u = X.lanesStart + S.u - n * P.GAP;
        var x = P.warp(u, segs);
        if (x < X.lanesStart || x > X.lanesEnd) continue;
        var dx = P.warp(u + 0.05, segs) - x;            // local compression from mux/skew/deskew
        var comp = Math.min(Math.max(dx / 0.05, 0.12), 1);
        var y = P.yPath(link, lane, x), z = P.zPath(link, lane, x);
        var isAm = n % P.AM_PERIOD === 0;
        var state = '';
        c.copy(G.col.lanes[p]);
        var len = 0.62 * comp, h = 0.42, d = 0.42;
        if (isAm) { c.lerp(G.col.paper, 0.45); len = Math.max(0.18, 0.26 * comp); h = 1.05; d = 0.9; }
        if (dead && x > X.noiseAt && x < X.amLock + 0.5) {
          c.copy(G.col.muted); y += (P.hash(n, p) - 0.5) * 0.5; h *= 0.6; state = 'los';
        } else if (amBad && isAm && x > X.mux[0]) {
          c.copy(G.col.bad); h = 0.75; state = 'ambad';
        } else if (noisy && !isAm && x > X.noiseAt && x < X.lanesEnd && P.hash(n, p * 7 + 3) < pVis) {
          c.copy(G.col.bad); h = 0.55; d = 0.55; state = 'err';
        }
        if (!S.align && x > X.deskew[1]) c.lerp(G.col.paper, 0.6);
        put(x, y, z, len, h, d, dim(c, on), { fam: 'lane', p: p, n: n, x: x, state: state });
      }
    });
  }

  // Aggregate (single-stream) segments before distribution and after reorder.
  // Cubes in the same family share an index, so a cube keeps its identity
  // when it moves from one segment into the next (200GMII transfer n becomes
  // 66-bit block n).
  var SEGS = [
    { x: [0, 7.5], kind: 'mii', side: 'tx' },
    { x: [7.5, 12.5], kind: 'b66', side: 'tx' },
    { x: [12.5, 20.5], kind: 'b257', side: 'tx' },
    { x: [20.5, 25.5], kind: 'b257', side: 'tx', scr: true, am: 'in' },
    { x: [25.5, 31], kind: 'row', side: 'tx', scr: true },
    { x: [84.5, 89], kind: 'row', side: 'rx', scr: true },
    { x: [89, 95.5], kind: 'b257', side: 'rx', scr: true, am: 'out' },
    { x: [95.5, 104], kind: 'b257', side: 'rx' },
    { x: [104, 109], kind: 'b66', side: 'rx' },
    { x: [109, 116], kind: 'mii', side: 'rx' }
  ];
  var GAPS = { mii: 0.75, b66: 0.75, b257: 3.0, row: 1.25 };
  var SIZE = { mii: [0.42, 0.42, 0.42], b66: [0.62, 0.62, 1.1], b257: [2.4, 0.95, 1.2], row: [1.0, 0.36, 0.7] };
  var FAM = { mii: 'g66', b66: 'g66', b257: 'g257', row: 'row' };
  P.SEGS = SEGS;

  function mod(a, n) { return ((a % n) + n) % n; }
  P.isAggAm = function (sg, n, pos) {
    return (sg.am === 'in' && mod(n, 5) === 0 && pos > 21.5) || (sg.am === 'out' && mod(n, 5) === 0 && pos < 95.5);
  };

  function drawAggregate() {
    var S = P.state, last = S.lastTick, uncFrac = last && last.codewords ? last.uncorrectable / last.codewords : 0;
    SEGS.forEach(function (sg, si) {
      var gap = GAPS[sg.kind], sz = SIZE[sg.kind];
      var rows = sg.kind === 'row' ? [0, 1] : [null];
      rows.forEach(function (row) {
        var off = row === 1 ? gap / 2 : 0;
        var hi = Math.floor((S.u - sg.x[0] - off) / gap), lo = Math.ceil((S.u - sg.x[1] - off) / gap);
        for (var n = lo; n <= hi; n++) {
          var pos = S.u - off - n * gap;               // every cube moves at the same speed
          if (pos < sg.x[0] || pos > sg.x[1]) continue;
          var y = row === null ? 0 : (row === 0 ? 0.42 : -0.42), sx = sz[0], sy = sz[1], sz2 = sz[2];
          var col = c, state = '';
          var parity = sg.kind === 'row' && P.chunkId(mod(n, 1e9)).c === P.CHUNKS - 1;
          if (sg.kind === 'mii') col.copy(G.col.muted);
          else if (sg.kind === 'row') col.copy(row === 0 ? G.col.cwA : G.col.cwB);
          else col.copy(sg.scr ? G.col.edge : G.col.ink);
          if (parity && (sg.side === 'tx' ? pos > 28.75 : pos < 88)) col.lerp(G.col.ink, 0.5);
          var isAm = P.isAggAm(sg, n, pos);
          if (sg.side === 'rx' && !S.align) {
            if (sg.kind !== 'mii') continue;
            col.copy(G.col.bad); sy *= 0.7; state = 'lf';
          } else if (sg.side === 'rx' && uncFrac > 0 && !isAm && pos > 91 && P.hash(n, 911) < Math.min(0.6, uncFrac * 40)) {
            col.copy(G.col.bad); state = 'unc';
          }
          put(pos, y, 0, sx, sy, sz2, dim(col, P.state.selected < 0, 0.45),
            { fam: FAM[sg.kind], seg: si, n: n, row: row, x: pos, state: state });
          // AM groups are inserted between 257-bit blocks; they do not replace one.
          if (isAm) put(pos + gap / 2, y, 0, 0.32, 1.6, sz2, dim(c.copy(G.col.am), P.state.selected < 0, 0.45),
            { fam: 'amg', seg: si, n: n, x: pos + gap / 2, state: '' });
        }
      });
    });
  }

  P.drawPackets = function () {
    count = 0;
    drawAggregate();
    drawLanes();
    G.inst.count = count;
    G.inst.instanceMatrix.needsUpdate = true;
    if (G.inst.instanceColor) G.inst.instanceColor.needsUpdate = true;
  };

  // Picking support for the inspector.
  P.packetCount = function () { return count; };
  P.packetMeta = function (i) { return meta[i]; };
  P.packetBox = function (i) { var o = i * 6; return boxes.subarray(o, o + 6); };
  P.findPacket = function (key) {
    for (var i = 0; i < count; i++) if (P.packetKey(meta[i]) === key) return i;
    return -1;
  };
  P.packetKey = function (m) {
    if (!m) return '';
    return m.fam === 'lane' ? 'lane:' + m.p + ':' + m.n : m.fam + ':' + (m.row == null ? '' : m.row) + ':' + m.n;
  };

  // RS decode box flashes on corrected / uncorrectable codewords.
  var pulse = 0, pulseBad = false;
  P.fecPulse = function (d) {
    if (!d) return;
    if (d.uncorrectable > 0) { pulse = 1; pulseBad = true; }
    else if (d.corrected > 0) { pulse = Math.max(pulse, Math.min(1, 0.25 + Math.log10(1 + d.corrected) / 4)); pulseBad = false; }
  };
  P.updatePulse = function (dt) {
    pulse *= Math.exp(-dt * 4);
    if (!G.boxes) return;
    G.boxes.forEach(function (b) {
      if (!b.def.fec) return;
      tmp.copy(G.col.box).lerp(pulseBad ? G.col.bad : G.col.good, pulse * 0.8);
      b.mesh.material.color.copy(tmp);
    });
  };
})(globalThis.PCS = globalThis.PCS || {});
