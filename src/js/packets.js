/* Moving data: one InstancedMesh for every cube in the scene, rebuilt each frame.
   Each instance also gets an identity record so a click can say what it carries. */
(function (P) {
  'use strict';
  var T = window.THREE, G = P.g;
  var MAX = 2200;
  var m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3();
  var c = new T.Color(), tmp = new T.Color();
  var count = 0;
  var meta = new Array(MAX), boxes = new Float32Array(MAX * 6), hits = [];

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
    if (P.followed && P.followed()) {
      var part = P.followPart(id);
      if (part) {
        hits.push({ i: count, part: part.key, html: part.html, key: part.key, span: part.span, lane: id.fam === 'lane' ? id.p : -1, x: x });
        col.lerp(G.col.am, 0.55);
        sy *= 1.35; sz *= 1.25; z += 0.25;
      } else col.lerp(G.col.paper, 0.78);
    }
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

  function mod(a, n) { return ((a % n) + n) % n; }

  // A lane cube holding any RS parity symbol.
  function isParityUnit(p, n) {
    var u = mod(n, P.UNITS_PER_PAIR);
    for (var k = P.UNIT_SYM * u; k < P.UNIT_SYM * (u + 1); k++) if (P.laneSymbolId(p, k).i >= P.CW_K) return true;
    return false;
  }

  var LANE_TINT = 0.35;   // share of lane colour in a data cube
  // PCS-lane data units from symbol distribution to lane reorder. Cube n on a
  // lane is 4 PCS-lane symbols; the first 3 cubes of an AM pair are the marker.
  function drawLanes() {
    var S = P.state, link = S.link, X = P.X, f = S.faults;
    var extra = P.noiseToSer(f.noise);
    var pVis = extra > 0 ? Math.min(0.5, 0.04 + 0.08 * Math.log10(1 + extra * 1e6)) : 0;
    link.lanes.forEach(function (lane) {
      var p = lane.pcs, segs = S.segs[p], on = S.selected < 0 || S.selected === p;
      // Lane cube n sits at track position S.u - n, the same frame as the
      // aggregate stream, so pair q's lane cubes follow its codeword cubes.
      var nHi = Math.floor((S.u - P.unwarp(X.lanesStart, segs)) / P.GAP);
      var nLo = Math.ceil((S.u - P.unwarp(X.lanesEnd, segs)) / P.GAP);
      var noisy = f.noise > 0 && (f.noiseLane < 0 || f.noiseLane === lane.serdes);
      var dead = f.los && f.losLane === lane.serdes;
      var amBad = f.amLoss && f.amLane === p;
      for (var n = Math.max(nLo, 0); n <= nHi; n++) {
        var u = S.u - n * P.GAP;
        var x = P.warp(u, segs);
        if (x < X.lanesStart || x > X.lanesEnd) continue;
        var dx = P.warp(u + 0.05, segs) - x;            // local compression from mux/skew/deskew
        var comp = Math.min(Math.max(dx / 0.05, 0.12), 1);
        var y = P.yPath(link, lane, x), z = P.zPath(link, lane, x);
        var isAm = P.isAmUnit(n), parity = isParityUnit(p, n);
        var state = '';
        // As in the popups: a lane's marker in its full colour, data grey with a
        // lane tint (enough to tell lanes apart where they share a SerDes lane), parity darker.
        var len = 0.36 * comp, h = 0.42, d = 0.42;
        if (isAm) { c.copy(G.col.lanes[p]); len = 0.46 * comp; h = 0.9; d = 0.85; y += 0.24; }
        else {
          c.copy(G.col.edge).lerp(G.col.lanes[p], LANE_TINT);
          if (parity) c.lerp(G.col.ink, 0.45);
        }
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

  // Aggregate stream. Every stage moves at one speed and is drawn in slots of
  // its own unit; slot indices are absolute, so a block keeps its identity.
  //   66-bit slots: 4 per 257-bit slot; under the AM group they are idles
  //   257-bit slots: slots 0-3 of an AM pair hold the AM group
  //   codeword rows: 17 cubes per codeword, the last one is the 30 parity symbols
  // RX positions lag by the deskew delay, so a pair reassembles where its lanes arrive.
  // One codeword pair spans the same track length everywhere: 34 lane cubes,
  // 2 x 17 codeword cubes, 40 x 257-bit slots, 160 x 66-bit slots.
  var UPAIR = P.UNITS_PER_PAIR * P.GAP, U257 = UPAIR / P.PAIR_SLOTS, U66 = U257 / 4;
  // Boundaries sit at the middle of the box that does the change (content.js).
  var SEGS = [
    { x: [-2, 7], kind: 'mii', side: 'tx' },
    { x: [7, 12.5], kind: 'b66', side: 'tx' },
    { x: [12.5, 17.5], kind: 'b257', side: 'tx' },
    { x: [17.5, 21.5], kind: 'b257', side: 'tx', scr: true },
    { x: [21.5, 25.5], kind: 'b257', side: 'tx', scr: true, am: true },
    { x: [25.5, 31.75], kind: 'row', side: 'tx' },
    { x: [84.5, 92.5], kind: 'row', side: 'rx' },
    { x: [92.5, 95.5], kind: 'b257', side: 'rx', scr: true, am: true },
    { x: [95.5, 99.5], kind: 'b257', side: 'rx', scr: true },
    { x: [99.5, 104], kind: 'b257', side: 'rx' },
    { x: [104, 109], kind: 'b66', side: 'rx' },
    { x: [109, 118], kind: 'mii', side: 'rx' }
  ];
  P.ENC_X = 28.75;   // middle of RS encode: parity appears here
  P.DEC_X = 89.25;   // middle of RS decode: parity is dropped here
  P.SEGS = SEGS;
  P.U257 = U257; P.UPAIR = UPAIR;
  // Codeword cube c spans this fraction of its pair's track.
  var ROW_POS = P.ROW_CUBES.map(function (r) { return [r[0] / P.CW_N, r[1] / P.CW_N]; });

  // Total delay a lane accumulates by the end of deskew (equal on every deskewed lane).
  P.rxLag = function () {
    var segs = P.state.segs, best = 0;
    if (!segs) return 0;
    segs.forEach(function (sg) { best = Math.max(best, sg.reduce(function (a, g) { return a + g.delay; }, 0)); });
    return best;
  };

  function drawAggregate() {
    var S = P.state, last = S.lastTick, uncFrac = last && last.codewords ? last.uncorrectable / last.codewords : 0;
    var sel = S.selected < 0, lag = P.rxLag();
    SEGS.forEach(function (sg) {
      var rxDead = sg.side === 'rx' && !S.align;
      var U = sg.side === 'rx' ? S.u - lag : S.u;
      if (sg.kind === 'mii' || sg.kind === 'b66') {
        var lo = Math.ceil((U - sg.x[1]) / U66), hi = Math.floor((U - sg.x[0]) / U66);
        for (var t = lo; t <= hi; t++) {
          var pos = U - t * U66, sl = P.slot66(t), state = '';
          var mii = sg.kind === 'mii';
          // Idles hold the room the AM group will need. The TX MAC sends them;
          // rate matching deletes them before 64B/66B encode, so a gap travels on.
          if (sl.idle) {
            if (!(mii && sg.side === 'tx')) continue;
            put(pos, 0, 0, U66 * 0.7, 0.22, 0.42, dim(c.copy(G.col.rule), sel, 0.45),
              { fam: 'b66', seg: 'mii', t: t, x: pos, state: '' });
            continue;
          }
          c.copy(mii ? G.col.muted : G.col.ink);
          if (rxDead) { if (!mii) continue; c.copy(G.col.bad); state = 'lf'; }
          else if (sg.side === 'rx' && uncFrac > 0 && P.hash(t, 911) < Math.min(0.6, uncFrac * 40)) { c.copy(G.col.bad); state = 'unc'; }
          put(pos, 0, 0, U66 * 0.78, mii ? 0.32 : 0.5, mii ? 0.42 : 1.1, dim(c, sel, 0.45),
            { fam: 'b66', seg: sg.kind, t: t, x: pos, state: state });
        }
      } else if (sg.kind === 'b257') {
        if (rxDead) return;
        var lo2 = Math.ceil((U - sg.x[1]) / U257) - 3, hi2 = Math.floor((U - sg.x[0]) / U257) + 3;
        for (var s = lo2; s <= hi2; s++) {
          var pos2 = U - s * U257, sl2 = P.slot257(s);
          if (sl2.am) {
            // One cube for the whole 1028-bit group, spanning its 4 slots. Before
            // AM insertion the slots are an empty gap; at insertion the group drops
            // in from above. On RX the group is removed at AM removal.
            if (sl2.r !== 0 || !sg.am) continue;
            var ax = pos2 - 1.5 * U257;
            if (ax < sg.x[0] || ax > sg.x[1]) continue;
            var drop = sg.side === 'tx' ? Math.min(1, Math.max(0, (ax - sg.x[0]) / 1.4)) : 1;
            var lift = sg.side === 'rx' ? Math.min(1, Math.max(0, (ax - (sg.x[1] - 1.4)) / 1.4)) : 0;
            put(ax, 2.0 * (1 - drop) + 2.0 * lift, 0, 4 * U257 - 0.08, 1.25, 1.3, dim(c.copy(G.col.am), sel, 0.45),
              { fam: 'amg', q: sl2.q, s: s, x: ax, state: '' });
            continue;
          }
          if (pos2 < sg.x[0] || pos2 > sg.x[1]) continue;
          var st2 = '';
          c.copy(sg.scr ? G.col.edge : G.col.ink);
          if (sg.side === 'rx' && uncFrac > 0 && P.hash(s, 913) < Math.min(0.6, uncFrac * 40)) { c.copy(G.col.bad); st2 = 'unc'; }
          put(pos2, 0, 0, U257 * 0.86, 0.95, 1.2, dim(c, sel, 0.45), { fam: 'b257', s: s, scr: !!sg.scr, x: pos2, state: st2 });
        }
      } else if (sg.kind === 'row') {
        if (rxDead) return;
        var qlo = Math.floor((U - sg.x[1]) / UPAIR) - 1, qhi = Math.floor((U - sg.x[0]) / UPAIR) + 1;
        for (var q = qlo; q <= qhi; q++) {
          var base = U - q * UPAIR;                    // track position of the pair's first bit
          for (var ci = 0; ci < ROW_POS.length; ci++) {
            var par = ci === P.ROW_PARITY;
            var x0 = base - ROW_POS[ci][0] * UPAIR, x1 = base - ROW_POS[ci][1] * UPAIR, cx = (x0 + x1) / 2;
            if (cx < sg.x[0] || cx > sg.x[1]) continue;
            if (par && sg.side === 'tx' && cx < P.ENC_X) continue;   // parity exists only after the encoder
            if (par && sg.side === 'rx' && cx > P.DEC_X) continue;   // the decoder drops it
            var amCube = P.isAmPair(q) && ci < 2;                  // symbols 0-51 of each codeword hold am_mapped
            for (var w = 0; w < 2; w++) {
              c.copy(w ? G.col.cwB : G.col.cwA);
              if (par) c.lerp(G.col.ink, 0.55);
              else if (amCube) c.lerp(G.col.am, 0.6);
              put(cx, w ? -0.42 : 0.42, 0, Math.abs(x1 - x0) - 0.12, 0.36, 0.7, dim(c, sel, 0.45),
                { fam: 'row', q: q, w: w, c: ci, x: cx, state: '' });
            }
          }
        }
      }
    });
  }

  P.drawPackets = function () {
    count = 0; hits.length = 0;
    drawAggregate();
    drawLanes();
    G.inst.count = count;
    G.inst.instanceMatrix.needsUpdate = true;
    if (G.inst.instanceColor) G.inst.instanceColor.needsUpdate = true;
  };

  P.followHits = function () { return hits; };

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
    if (m.fam === 'lane') return 'lane:' + m.p + ':' + m.n;
    if (m.fam === 'b66') return 'b66:' + m.t;
    if (m.fam === 'b257') return 'b257:' + m.s;
    if (m.fam === 'amg') return 'amg:' + m.q;
    if (m.fam === 'row') return 'row:' + m.q + ':' + m.w + ':' + m.c;
    return m.fam;
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
