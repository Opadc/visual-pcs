/* Moving data: one InstancedMesh for every cube in the scene, rebuilt each frame. */
(function (P) {
  'use strict';
  var T = window.THREE, G = P.g;
  var MAX = 1400;
  var m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3();
  var c = new T.Color(), tmp = new T.Color();
  var count = 0, msgBuf = P.messageBytes(256);

  // Stages where message is readable as ASCII (before/after FEC)
  var ASCII_TX_END = P.X.mux[0];           // through pre-FEC distributor
  var ASCII_RX_START = P.X.reorder[1];     // after post-FEC interleave
  var HEX_TX_START = 24.5;                 // pre-FEC distribution begins
  var HEX_RX_END = 83.5;                   // post-FEC interleave ends

  function msgCharAt(u, slot) {
    // Approximate which message byte is at this position
    var byteIdx = Math.floor((u - P.X.lanesStart) / P.GAP) % msgBuf.length;
    return String.fromCharCode(msgBuf[byteIdx] || 32); // space if undefined
  }

  function symHexAt(u) {
    // 10-bit symbol as hex, for abstract representation in FEC zone
    var idx = Math.floor((u - HEX_TX_START) * 10 / P.GAP) % 1024;
    return (idx & 0x3FF).toString(16).toUpperCase().padStart(3, '0');
  }

  P.initPackets = function () {
    var geo = new T.BoxGeometry(1, 1, 1);
    var mat = new T.MeshLambertMaterial({ color: 0xffffff });
    G.inst = new T.InstancedMesh(geo, mat, MAX);
    G.inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    G.inst.setColorAt(0, new T.Color());
    G.inst.frustumCulled = false;
    G.scene.add(G.inst);
  };

  function put(x, y, z, sx, sy, sz, col) {
    if (count >= MAX) return;
    v.set(x, y, z); sc.set(sx, sy, sz);
    m4.compose(v, q, sc);
    G.inst.setMatrixAt(count, m4);
    G.inst.setColorAt(count, col);
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
      var showAscii = (S.u < HEX_TX_START || S.u > HEX_RX_END) && (x < HEX_TX_START || x > HEX_RX_END);
      var showHex = S.u >= HEX_TX_START && S.u <= HEX_RX_END && x >= HEX_TX_START && x <= HEX_RX_END;
      for (var n = Math.max(nLo, 0); n <= nHi; n++) {
        var u = X.lanesStart + S.u - n * P.GAP;
        var x = P.warp(u, segs);
        if (x < X.lanesStart || x > X.lanesEnd) continue;
        var dx = P.warp(u + 0.05, segs) - x;
        var comp = Math.min(Math.max(dx / 0.05, 0.12), 1);
        var y = P.yPath(link, lane, x), z = P.zPath(link, lane, x);
        var isAm = n % P.AM_PERIOD === 0;
        c.copy(G.col.lanes[p]);
        var len = 0.62 * comp, h = 0.42, d = 0.42;
        var label = '';
        if (isAm) { c.lerp(G.col.paper, 0.45); len = Math.max(0.18, 0.26 * comp); h = 1.05; d = 0.9; label = 'AM'; }
        else if (showAscii) label = msgCharAt(u, p);
        else if (showHex) { c.lerp(G.col.paper, 0.3); label = symHexAt(u); }
        if (dead && x > X.noiseAt && x < X.amLock + 0.5) {
          c.copy(G.col.muted); y += (P.hash(n, p) - 0.5) * 0.5; h *= 0.6;
        } else if (amBad && isAm && x > X.mux[0]) {
          c.copy(G.col.bad); h = 0.75;
        } else if (noisy && !isAm && x > X.noiseAt && x < X.lanesEnd && P.hash(n, p * 7 + 3) < pVis) {
          c.copy(G.col.bad); h = 0.55; d = 0.55;
        }
        if (!S.align && x > X.deskew[1]) c.lerp(G.col.paper, 0.6);
        put(x, y, z, len, h, d, dim(c, on));
      }
    });
  }

  // Aggregate (single-stream) segments before distribution and after reorder.
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

  function drawAggregate() {
    var S = P.state, last = S.lastTick, uncFrac = last && last.codewords ? last.uncorrectable / last.codewords : 0;
    SEGS.forEach(function (sg) {
      var gap = GAPS[sg.kind], sz = SIZE[sg.kind];
      var rows = sg.kind === 'row' ? [0, 1] : [null];
      rows.forEach(function (row) {
        var off = row === 1 ? gap / 2 : 0;
        var hi = Math.floor((S.u - sg.x[0] - off) / gap), lo = Math.ceil((S.u - sg.x[1] - off) / gap);
        for (var n = lo; n <= hi; n++) {
          var pos = S.u - off - n * gap;               // every cube moves at the same speed
          if (pos < sg.x[0] || pos > sg.x[1]) continue;
          var y = row === null ? 0 : (row === 0 ? 0.42 : -0.42), sx = sz[0], sy = sz[1], sz2 = sz[2];
          var col = c;
          if (sg.kind === 'mii') col.copy(G.col.muted);
          else if (sg.kind === 'row') col.copy(row === 0 ? G.col.cwA : G.col.cwB);
          else col.copy(sg.scr ? G.col.edge : G.col.ink);
          if (sg.kind === 'row' && ((n % 18) + 18) % 18 >= 16 && sg.side === 'tx' && pos > 28.75) col.lerp(G.col.ink, 0.5);
          var isAm = (sg.am === 'in' && ((n % 5) + 5) % 5 === 0 && pos > 21.5) || (sg.am === 'out' && ((n % 5) + 5) % 5 === 0 && pos < 95.5);
          if (isAm) { col.copy(G.col.am); sy = 1.6; sx = 1.0; }
          if (sg.side === 'rx' && !S.align) {
            if (sg.kind !== 'mii') continue;
            col.copy(G.col.bad); sy *= 0.7;
          } else if (sg.side === 'rx' && uncFrac > 0 && !isAm && pos > 91 && P.hash(n, 911) < Math.min(0.6, uncFrac * 40)) {
            col.copy(G.col.bad);
          } else if (sg.kind === 'mii' && sg.side === 'tx' && P.hash(n, 5) < 0.12) {
            col.lerp(G.col.paper, 0.6);                      // idle between frames
          }
          put(pos, y, 0, sx, sy, sz2, dim(col, P.state.selected < 0, 0.45));
        }
      });
    });
  }

  // Stages where message is readable as ASCII (before/after FEC)
  var ASCII_TX_END = P.X.mux[0];           // through pre-FEC distributor
  var ASCII_RX_START = P.X.reorder[1];     // after post-FEC interleave

  function msgCharAt(u, slot) {
    // Approximate which message byte is at this position
    var byteIdx = Math.floor((u - P.X.lanesStart) / P.GAP) % msgBuf.length;
    return String.fromCharCode(msgBuf[byteIdx] || 32); // space if undefined
  }

  P.drawPackets = function () {
    count = 0;
    drawAggregate();
    drawLanes();
    G.inst.count = count;
    G.inst.instanceMatrix.needsUpdate = true;
    if (G.inst.instanceColor) G.inst.instanceColor.needsUpdate = true;
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
