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

  // Corrects up to 15 symbol errors: Berlekamp-Massey finds the error locator,
  // a Chien search its roots, Forney the error values. Symbol i sits at power
  // 543 - i. Returns { ok, errors: [{ i, e }], cw } with cw corrected, or
  // ok: false when the errors are beyond the code (the input is returned as is).
  P.rsDecode = function (cw) {
    var S = P.rsSyndromes(cw);
    if (S.every(function (s) { return s === 0; })) return { ok: true, errors: [], cw: cw.slice(), syn: S };
    var C = [1], B = [1], L = 0, m = 1, b = 1;
    for (var n = 0; n < NP; n++) {
      var d = S[n];
      for (var i = 1; i <= L; i++) d ^= mul(C[i] || 0, S[n - i]);
      if (d === 0) { m++; continue; }
      var coef = mul(d, EXP[1023 - LOG[b]]), T = C.slice();
      for (var j = 0; j < B.length; j++) C[j + m] = (C[j + m] || 0) ^ mul(coef, B[j]);
      if (2 * L <= n) { L = n + 1 - L; B = T; b = d; m = 1; } else m++;
    }
    if (L > NP / 2) return { ok: false, errors: [], cw: cw.slice(), syn: S };
    // Error evaluator Omega(x) = S(x) C(x) mod x^30.
    var Om = new Array(NP).fill(0);
    for (var a = 0; a < NP; a++) for (var c = 0; c <= L && c <= a; c++) Om[a] ^= mul(C[c] || 0, S[a - c]);
    var out = cw.slice(), errs = [];
    for (var pos = 0; pos < N; pos++) {
      var e = 543 - pos, xi = (1023 - e) % 1023, v = 0;   // root at X^-1 = a^-e
      for (var k = 0; k <= L; k++) v ^= mul(C[k] || 0, EXP[(xi * k) % 1023]);
      if (v) continue;
      var num = 0, den = 0;
      for (var t = 0; t < NP; t++) num ^= mul(Om[t], EXP[(xi * t) % 1023]);
      for (var u = 1; u <= L; u += 2) den ^= mul(C[u] || 0, EXP[(xi * (u - 1)) % 1023]);
      if (!den) return { ok: false, errors: [], cw: cw.slice(), syn: S };
      // First consecutive root a^0, so the magnitude is X * Omega(X^-1) / C'(X^-1).
      var mag = mul(mul(num, EXP[1023 - LOG[den]]), EXP[e]);
      errs.push({ i: pos, e: mag }); out[pos] ^= mag;
    }
    if (errs.length !== L) return { ok: false, errors: [], cw: cw.slice(), syn: S };
    return { ok: true, errors: errs, cw: out, syn: S };
  };
})(globalThis.PCS = globalThis.PCS || {});
