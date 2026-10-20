/* Pure model of the 200GBASE-R lane picture: PCS-to-SerDes mapping, RX demux
   order, skew/deskew timing and AM lock. No DOM, no Three.js, so node tests can
   load it directly. Everything hangs off globalThis.PCS. */
(function (P) {
  'use strict';

  P.N_PCS = 8;                 // 200GBASE-R PCS lanes
  P.DESKEW_CAP_NS = 180;       // skew budget at the PCS receive input (IEEE 802.3 Table 116-7)
  P.AM_LOSS_COUNT = 5;         // consecutive bad AMs before lock is dropped (amp_bad_count = 5, Figure 119-12)
  P.AM_ACQUIRE_COUNT = 2;      // a marker, then the next naming the same PCS lane (FIND_1ST, COMP_2ND)
  // Scene lane cubes are 4 PCS-lane symbols (40 bits); a codeword pair is 136
  // symbols per lane, so 34 cubes. The first 3 cubes (12 symbols, 120 bits) of
  // an AM pair are that lane's alignment marker. The scene inserts an AM group
  // every AM_PAIRS codeword pairs; the standard does it every 2048.
  P.UNITS_PER_PAIR = 34;
  P.AM_UNITS = 3;
  P.AM_PAIRS = 1;
  P.AM_PERIOD = P.UNITS_PER_PAIR * P.AM_PAIRS;   // lane cubes from one AM to the next
  P.GAP = 1.0;                 // track length of one lane cube (4 symbols); a codeword pair is 34 units at every stage

  P.WIDTHS = {
    8: { lanes: 8, mod: 'NRZ', baud: 26.5625, gbps: 26.5625, ex: '200GAUI-8' },
    4: { lanes: 4, mod: 'PAM4', baud: 26.5625, gbps: 53.125,
         ex: '200GAUI-4, 200GBASE-SR4 / DR4 / FR4 / LR4 / CR4 / KR4' },
    2: { lanes: 2, mod: 'PAM4', baud: 53.125, gbps: 106.25, ex: '200GAUI-2, 200GBASE-CR2 / KR2' }
  };

  P.PRESETS = {
    grouped: 'Grouped',
    interleaved: 'Interleaved',
    remapped: 'Remapped'
  };

  // One example of an arbitrary fixed assignment (e.g. a gearbox mux table or
  // board-level swizzle). Position i in the mux order carries PCS lane REMAP[i].
  P.REMAP_ORDER = [5, 2, 7, 0, 3, 6, 1, 4];

  // Small intrinsic skew per physical lane, so deskew always has work to do.
  P.BASE_SKEW_NS = [6, 14, 3, 11, 9, 2, 15, 7];

  // Visual layout along x (TX on the left, RX on the right).
  P.X = {
    lanesStart: 32.5, muxIn: 44, mux: [44.5, 48.5], chan: [49.5, 66.5],
    swap: [56, 60], demux: [67.5, 70.5], amLock: 72.5, deskew: [74.5, 78.5],
    reorder: [79.5, 83.5], lanesEnd: 84.5, noiseAt: 54
  };
  P.LANE_SP = 1.4;
  P.nsToUnits = function (ns) { return ns * 6 / 250; };

  P.yPcs = function (i) { return (3.5 - i) * P.LANE_SP; };
  P.ySerdes = function (j, width) {
    var sp = (P.N_PCS * P.LANE_SP) / width;
    return ((width - 1) / 2 - j) * sp;
  };

  // PCS lane -> TX SerDes lane and its bit slot within the multiplex.
  P.mapLanes = function (width, preset) {
    var k = P.N_PCS / width, out = [];
    for (var p = 0; p < P.N_PCS; p++) {
      var serdes, slot;
      if (preset === 'interleaved') { serdes = p % width; slot = Math.floor(p / width); }
      else if (preset === 'remapped') {
        var i = P.REMAP_ORDER.indexOf(p);
        serdes = Math.floor(i / k); slot = i % k;
      } else { serdes = Math.floor(p / k); slot = p % k; }
      out.push({ pcs: p, txPma: p, serdes: serdes, slot: slot });
    }
    return out;
  };

  // Full TX -> RX picture for one configuration.
  // cfg: { width, preset, swap, rot: [per RX SerDes demux rotation], skewNs: [per physical lane] }
  P.buildLink = function (cfg) {
    var width = cfg.width, k = P.N_PCS / width;
    var map = P.mapLanes(width, cfg.preset);
    var chan = [];
    for (var s = 0; s < width; s++) chan[s] = s;
    if (cfg.swap && width >= 2) { chan[0] = 1; chan[1] = 0; }
    var lanes = map.map(function (m) {
      var rx = chan[m.serdes];
      var rot = cfg.rot ? ((cfg.rot[rx] || 0) % k) : 0;
      return {
        pcs: m.pcs, txPma: m.txPma, serdes: m.serdes, slot: m.slot,
        rxSerdes: rx, rxPma: rx * k + (m.slot + rot) % k,
        skewNs: cfg.skewNs[m.serdes] || 0
      };
    });
    var minSk = Math.min.apply(null, lanes.map(function (l) { return l.skewNs; }));
    var spread = 0;
    lanes.forEach(function (l) {
      l.relSkewNs = l.skewNs - minSk;
      l.deskewFail = l.relSkewNs > P.DESKEW_CAP_NS;
      spread = Math.max(spread, l.relSkewNs);
    });
    var byRxPma = [];
    lanes.forEach(function (l) { byRxPma[l.rxPma] = l.pcs; });
    return { width: width, k: k, lanes: lanes, spreadNs: spread,
             deskewOk: spread <= P.DESKEW_CAP_NS, byRxPma: byRxPma };
  };

  P.lanesOnSerdes = function (link, s) {
    return link.lanes.filter(function (l) { return l.serdes === s; })
      .sort(function (a, b) { return a.slot - b.slot; });
  };

  // Delay segments: each spreads `delay` units of lag uniformly over [x0, x1].
  // u is distance travelled; the return value is the drawn x position.
  P.warp = function (u, segs) {
    var shift = 0;
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i], len = g.x1 - g.x0, uIn = g.x0 + shift;
      if (u <= uIn) return u - shift;
      if (u <= g.x1 + shift + g.delay) return g.x0 + (u - uIn) * len / (len + g.delay);
      shift += g.delay;
    }
    return u - shift;
  };

  P.unwarp = function (x, segs) {
    var shift = 0;
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i], len = g.x1 - g.x0;
      if (x <= g.x0) return x + shift;
      if (x <= g.x1) return g.x0 + shift + (x - g.x0) * (len + g.delay) / len;
      shift += g.delay;
    }
    return x + shift;
  };

  // Per-lane delay segments: mux phase, channel skew, demux phase removal, deskew.
  P.laneSegments = function (link, lane) {
    var X = P.X, phase = lane.slot * P.GAP / link.k;
    var d = P.nsToUnits(lane.relSkewNs);
    var D = 0;
    link.lanes.forEach(function (l) {
      if (!l.deskewFail) D = Math.max(D, P.nsToUnits(l.relSkewNs));
    });
    return [
      { x0: X.mux[0], x1: X.mux[1], delay: phase },
      { x0: X.chan[0], x1: X.chan[1], delay: d },
      { x0: X.demux[0], x1: X.demux[1], delay: -phase },
      { x0: X.deskew[0], x1: X.deskew[1], delay: lane.deskewFail ? 0 : D - d }
    ];
  };

  // AM lock state step for one lane. Returns the same object, updated.
  P.amLockStep = function (L, valid) {
    if (L.state === 'locked') {
      if (valid) L.bad = 0;
      else if (++L.bad >= P.AM_LOSS_COUNT) { L.state = 'searching'; L.good = 0; L.bad = 0; L.lost = true; }
    } else if (valid) {
      if (++L.good >= P.AM_ACQUIRE_COUNT) { L.state = 'locked'; L.bad = 0; L.lost = false; }
    } else { L.good = 0; L.lost = true; }
    return L;
  };

  P.lockView = function (L) {
    if (L.state === 'locked') return L.bad ? 'checking' : 'locked';
    return L.lost ? 'nolock' : 'searching';
  };
})(globalThis.PCS = globalThis.PCS || {});
