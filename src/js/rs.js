/* RS(544,514) over GF(2^10), the Clause 91 "KP4" code that Clause 119 reuses.
   Field polynomial x^10 + x^3 + 1; g(x) = (x - a^0)(x - a^1) ... (x - a^29).
   Symbol 0 of a codeword is its highest-degree coefficient (c_543, sent first),
   so the 30 parity symbols come last. Pure functions, no DOM. */
(function (P) {
  'use strict';
  var N = 544, K = 514, NP = N - K, POLY = 0x409;
  var EXP = new Array(2046), LOG = new Array(1024);
  (function () {
    var x = 1;
    for (var i = 0; i < 1023; i++) {
      EXP[i] = EXP[i + 1023] = x; LOG[x] = i;
      x <<= 1; if (x & 1024) x ^= POLY;
    }
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  P.gfMul = mul;
  P.gfExp = function (i) { return EXP[((i % 1023) + 1023) % 1023]; };

  // g(x) coefficients, highest degree first, without the leading 1.
  P.RS_GEN = (function () {
    var g = [1];
    for (var j = 0; j < NP; j++) {
      var n = new Array(g.length + 1).fill(0);
      for (var i = 0; i < g.length; i++) { n[i] ^= g[i]; n[i + 1] ^= mul(g[i], EXP[j]); }
      g = n;
    }
    return g.slice(1);
  })();

  // 514 message symbols -> 30 parity symbols: the remainder of m(x) x^30 / g(x).
  P.rsParity = function (msg) {
    var r = new Array(NP).fill(0), G = P.RS_GEN;
    for (var k = 0; k < K; k++) {
      var f = msg[k] ^ r[0];
      for (var j = 0; j < NP - 1; j++) r[j] = r[j + 1] ^ mul(f, G[j]);
      r[NP - 1] = mul(f, G[NP - 1]);
    }
    return r;
  };

  // S_j = c(a^j), j = 0..29. All zero for a valid codeword.
  P.rsSyndromes = function (cw) {
    var out = [];
    for (var j = 0; j < NP; j++) {
      var s = 0, a = EXP[j];
      for (var i = 0; i < cw.length; i++) s = mul(s, a) ^ cw[i];
      out.push(s);
    }
    return out;
  };
})(globalThis.PCS = globalThis.PCS || {});
