/* Statistical stand-in for RS(544,514) decoding. Each tick represents a batch of
   codewords; per-lane symbol error rates set how many symbol errors land in each
   codeword. t = 15 symbols are correctable. No Reed-Solomon math is done here. */
(function (P) {
  'use strict';

  P.RS_N = 544;
  P.RS_K = 514;
  P.RS_T = 15;
  P.SYM_PER_LANE = P.RS_N / P.N_PCS;  // 68 symbols of each codeword per PCS lane (illustrative)
  P.CW_PER_SEC = 212.5e9 / (P.RS_N * 10); // ~39 M codewords/s across the PCS
  P.BASE_SER = 2e-7;

  var LF = [0];
  for (var i = 1; i <= 80; i++) LF[i] = LF[i - 1] + Math.log(i);
  function pmf(k, lam) { return lam <= 0 ? (k === 0 ? 1 : 0) : Math.exp(k * Math.log(lam) - lam - LF[k]); }

  // Seeded PRNG (mulberry32) so tests are repeatable.
  P.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  P.poisson = function (mean, rnd) {
    if (mean <= 0) return 0;
    if (mean > 40) {
      var u = Math.max(rnd(), 1e-12), v = rnd();
      var z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.max(0, Math.round(mean + z * Math.sqrt(mean)));
    }
    var L = Math.exp(-mean), k = 0, p = 1;
    do { k++; p *= rnd(); } while (p > L);
    return k - 1;
  };

  // Noise slider 0..100 -> extra SER on the noisy lane(s). 0 adds nothing.
  P.noiseToSer = function (n) { return n <= 0 ? 0 : 1e-6 * Math.pow(10, n * 4.7 / 100); };
  P.CW_PER_TICK = Math.round(P.CW_PER_SEC / 1000); // one tick = 1 ms of link time

  // Expected per-codeword outcome for per-PCS-lane SER array.
  P.fecExpect = function (serByLane) {
    var lam = 0;
    serByLane.forEach(function (s) { lam += Math.min(s, 1) * P.SYM_PER_LANE; });
    var bins = [], pc = 0, ec = 0;
    for (var k = 0; k <= P.RS_T; k++) { bins[k] = pmf(k, lam); if (k >= 1) { pc += bins[k]; ec += k * bins[k]; } }
    var pu = 0, eu = 0;
    for (k = P.RS_T + 1; k <= 80; k++) { var q = pmf(k, lam); pu += q; eu += k * q; }
    return { lam: lam, bins: bins, pCorr: pc, pUncorr: pu, symCorr: ec, symUncorr: eu };
  };

  // Sample one batch of `n` codewords. Returns counter deltas.
  P.fecTick = function (serByLane, n, rnd) {
    var e = P.fecExpect(serByLane);
    var hist = [], corr = 0, sym = 0;
    for (var k = 0; k <= P.RS_T; k++) {
      hist[k] = k === 0 ? 0 : P.poisson(n * e.bins[k], rnd);
      if (k) { corr += hist[k]; sym += k * hist[k]; }
    }
    var unc = P.poisson(n * e.pUncorr, rnd);
    hist[P.RS_T + 1] = unc;
    sym += Math.round(unc * (e.pUncorr > 0 ? e.symUncorr / e.pUncorr : P.RS_T + 1));
    hist[0] = Math.max(0, n - corr - unc);
    // Split symbol errors across lanes in proportion to each lane's SER.
    var tot = serByLane.reduce(function (a, b) { return a + b; }, 0);
    var perLane = serByLane.map(function (s) {
      if (!tot) return 0;
      var share = sym * s / tot, f = Math.floor(share);
      return f + (rnd() < share - f ? 1 : 0);
    });
    return { codewords: n, corrected: corr, uncorrectable: unc, symbolErrors: sym,
             perLane: perLane, hist: hist, lam: e.lam };
  };

  // Deterministic hash in [0,1) used to place visual error marks.
  P.hash = function (a, b) {
    var h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x632BE5AB, 0xC2B2AE35);
    h ^= h >>> 13; h = Math.imul(h, 0x27D4EB2F); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
})(globalThis.PCS = globalThis.PCS || {});
