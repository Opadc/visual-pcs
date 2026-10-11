/* App state and the simulation clock: AM arrival events drive lock/deskew,
   periodic ticks drive the FEC counters. */
(function (P) {
  'use strict';

  function freshLock(state) { return { state: state, good: 0, bad: 0, lost: false }; }

  var S = P.state = {
    playing: true, speed: 1, u: 320,
    width: 4, preset: 'grouped',
    selected: -1, stage: null,
    faults: { skewLane: 1, skewNs: 0, amLane: 3, amLoss: false, losLane: 0, los: false,
              noiseLane: -1, noise: 0, swap: false },
    rot: [0, 0, 0, 0, 0, 0, 0, 0],
    lock: [], lastAm: [], deskewSeen: true, align: true,
    c: null, simMs: 0, link: null
  };
  for (var i = 0; i < P.N_PCS; i++) { S.lock.push(freshLock('locked')); S.lastAm.push(-1); }

  var listeners = [];
  P.on = function (fn) { listeners.push(fn); };
  P.emit = function (what) { listeners.forEach(function (fn) { fn(what); }); };

  P.resetCounters = function () {
    S.c = { corrected: 0, uncorrectable: 0, symbolErrors: 0, codewords: 0,
            symLane: [0, 0, 0, 0, 0, 0, 0, 0], hist: new Array(P.RS_T + 2).fill(0) };
    S.simMs = 0; S.recentUnc = 0;
    P.emit('tick');
  };
  P.resetCounters();

  P.skewArray = function () {
    var f = S.faults;
    return P.BASE_SKEW_NS.slice(0, S.width).map(function (b, s) {
      return b + (s === f.skewLane ? f.skewNs : 0);
    });
  };

  P.rebuild = function (relock) {
    if (S.faults.skewLane >= S.width) S.faults.skewLane = S.width - 1;
    if (S.faults.losLane >= S.width) S.faults.losLane = 0;
    if (S.faults.noiseLane >= S.width) S.faults.noiseLane = -1;
    if (relock) {
      // A new demux start-up phase on each RX SerDes lane: the PMA lane order
      // can come up differently every time; only the AMs tell the PCS lanes apart.
      var k = P.N_PCS / S.width;
      S.rot = S.rot.map(function () { return Math.floor(Math.random() * k); });
      S.lock = S.lock.map(function () { return freshLock('searching'); });
      S.deskewSeen = false;
    }
    S.link = P.buildLink({ width: S.width, preset: S.preset, swap: S.faults.swap,
                           rot: S.rot, skewNs: P.skewArray() });
    S.segs = S.link.lanes.map(function (l) { return P.laneSegments(S.link, l); });
    S.lastAm = S.link.lanes.map(function (l, p) { return amIndexAt(p); });
    updateAlign();
    P.emit('link');
  };

  // Faults that only change skew keep the current lock state.
  P.refreshSkew = function () {
    var keep = S.lastAm.slice();
    S.link = P.buildLink({ width: S.width, preset: S.preset, swap: S.faults.swap,
                           rot: S.rot, skewNs: P.skewArray() });
    S.segs = S.link.lanes.map(function (l) { return P.laneSegments(S.link, l); });
    S.lastAm = keep;
    P.emit('link');
  };

  P.serByLane = function () {
    var f = S.faults, extra = P.noiseToSer(f.noise);
    return S.link.lanes.map(function (l) {
      var s = P.BASE_SER;
      if (f.noise > 0 && (f.noiseLane < 0 || l.serdes === f.noiseLane)) s += extra;
      return s;
    });
  };

  P.amValid = function (p) {
    var f = S.faults, l = S.link.lanes[p];
    if (f.amLoss && f.amLane === p) return false;
    if (f.los && l.serdes === f.losLane) return false;
    return true;
  };

  // Sequence index n of the newest data unit on PCS lane p that has passed x.
  P.seqAt = function (p, x) {
    var U = P.unwarp(x, S.segs[p]);
    return Math.floor((S.u - U) / P.GAP);
  };
  function amIndexAt(p) { return Math.floor(P.seqAt(p, P.X.amLock) / P.AM_PERIOD); }

  function updateAlign() {
    var all = S.lock.every(function (L) { return L.state === 'locked'; });
    var was = S.align;
    S.align = all && S.deskewSeen;
    if (was !== S.align) P.emit('align');
  }

  // Called every frame: process AMs that reached the RX lock point.
  P.processAms = function () {
    var changed = false;
    for (var p = 0; p < P.N_PCS; p++) {
      var idx = amIndexAt(p);
      if (idx <= S.lastAm[p]) continue;
      var n = Math.min(idx - S.lastAm[p], 3);
      S.lastAm[p] = idx;
      for (var j = 0; j < n; j++) {
        var before = P.lockView(S.lock[p]);
        P.amLockStep(S.lock[p], P.amValid(p));
        if (P.lockView(S.lock[p]) !== before) changed = true;
      }
      if (S.deskewSeen !== S.link.deskewOk) { S.deskewSeen = S.link.deskewOk; changed = true; }
    }
    if (changed) { updateAlign(); P.emit('lock'); }
  };

  var rnd = P.rng(2024);
  P.tick = function () {
    S.simMs += 1;
    if (!S.align) { P.emit('tick'); return null; }
    var d = P.fecTick(P.serByLane(), P.CW_PER_TICK, rnd), c = S.c;
    c.corrected += d.corrected; c.uncorrectable += d.uncorrectable;
    c.symbolErrors += d.symbolErrors; c.codewords += d.codewords;
    d.perLane.forEach(function (v, i) { c.symLane[i] += v; });
    d.hist.forEach(function (v, i) { c.hist[i] += v; });
    S.lastTick = d;
    S.recentUnc = (S.recentUnc || 0) * 0.95 + d.uncorrectable;   // ~2 s window at 1x
    P.emit('tick');
    return d;
  };
})(globalThis.PCS = globalThis.PCS || {});
