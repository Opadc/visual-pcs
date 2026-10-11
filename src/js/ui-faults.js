/* Fault lab controls. */
(function (P) {
  'use strict';
  var S = P.state, F = S.faults, $ = function (id) { return document.getElementById(id); };

  function opts(n, sel, prefix, extra) {
    var h = extra || '';
    for (var i = 0; i < n; i++) h += '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + prefix + ' ' + i + '</option>';
    return h;
  }

  P.renderFaults = function () {
    var w = S.width;
    $('faults').innerHTML =
      '<fieldset class="fault"><legend>Lane skew</legend>' +
        '<div class="frow"><label for="f-skew-lane">Delay</label><select id="f-skew-lane">' + opts(w, F.skewLane, 'SerDes') + '</select>' +
        '<output id="f-skew-out" for="f-skew">' + F.skewNs + ' ns</output></div>' +
        '<div class="rangewrap"><input type="range" id="f-skew" min="0" max="250" step="5" value="' + F.skewNs + '" aria-describedby="f-skew-help">' +
        '<span class="cap" style="left:' + (P.DESKEW_CAP_NS / 250 * 100) + '%" aria-hidden="true">180 ns budget</span></div>' +
        '<p class="fhelp" id="f-skew-help">All PCS lanes on that SerDes lane arrive late together. Deskew absorbs it up to the budget.</p>' +
      '</fieldset>' +
      '<fieldset class="fault"><legend>Alignment marker loss</legend>' +
        '<div class="frow"><label class="check"><input type="checkbox" id="f-am"' + (F.amLoss ? ' checked' : '') + '> Corrupt AMs on</label>' +
        '<select id="f-am-lane" aria-label="PCS lane with corrupted AMs">' + opts(8, F.amLane, 'PCS') + '</select></div>' +
        '<p class="fhelp">After ' + P.AM_LOSS_COUNT + ' bad AMs in a row (illustrative count) that lane drops lock, and align_status with it.</p>' +
      '</fieldset>' +
      '<fieldset class="fault"><legend>Loss of signal</legend>' +
        '<div class="frow"><label class="check"><input type="checkbox" id="f-los"' + (F.los ? ' checked' : '') + '> Kill</label>' +
        '<select id="f-los-lane" aria-label="SerDes lane to kill">' + opts(w, F.losLane, 'SerDes') + '</select></div>' +
        '<p class="fhelp">Every PCS lane carried by that SerDes lane loses lock at once.</p>' +
      '</fieldset>' +
      '<fieldset class="fault"><legend>Channel noise</legend>' +
        '<div class="frow"><label for="f-noise-lane">On</label><select id="f-noise-lane">' + opts(w, F.noiseLane, 'SerDes', '<option value="-1"' + (F.noiseLane < 0 ? ' selected' : '') + '>all lanes</option>') + '</select>' +
        '<output id="f-noise-out" for="f-noise"></output></div>' +
        '<input type="range" id="f-noise" min="0" max="100" step="1" value="' + F.noise + '" aria-describedby="f-noise-help">' +
        '<p class="fhelp" id="f-noise-help">Raises the symbol error rate. Watch corrected codewords climb, then uncorrectable ones once codewords pass 15 bad symbols.</p>' +
      '</fieldset>' +
      '<fieldset class="fault"><legend>Board lane swap</legend>' +
        '<label class="check"><input type="checkbox" id="f-swap"' + (F.swap ? ' checked' : '') + '> Swap SerDes 0 and 1 in the channel</label>' +
        '<p class="fhelp">Harmless: the PCS re-locks and reorders, and the RX PMA lane order changes.</p>' +
      '</fieldset>' +
      '<div class="factions"><button type="button" class="btn" id="f-clear">Clear faults</button>' +
        '<button type="button" class="btn" id="f-relock">Re-lock link</button>' +
        '<button type="button" class="btn" id="f-reset">Reset counters</button></div>';
    bind();
    noiseOut();
  };

  function noiseOut() {
    var s = P.noiseToSer(F.noise);
    $('f-noise-out').textContent = F.noise ? 'SER +' + s.toExponential(1) : 'off';
  }

  function bind() {
    $('f-skew').oninput = function (e) { F.skewNs = +e.target.value; $('f-skew-out').textContent = F.skewNs + ' ns'; P.refreshSkew(); };
    $('f-skew-lane').onchange = function (e) { F.skewLane = +e.target.value; P.refreshSkew(); };
    $('f-am').onchange = function (e) { F.amLoss = e.target.checked; P.emit('fault'); };
    $('f-am-lane').onchange = function (e) { F.amLane = +e.target.value; P.emit('fault'); };
    $('f-los').onchange = function (e) { F.los = e.target.checked; P.emit('fault'); };
    $('f-los-lane').onchange = function (e) { F.losLane = +e.target.value; P.emit('fault'); };
    $('f-noise').oninput = function (e) { F.noise = +e.target.value; noiseOut(); P.emit('fault'); };
    $('f-noise-lane').onchange = function (e) { F.noiseLane = +e.target.value; P.emit('fault'); };
    $('f-swap').onchange = function (e) { F.swap = e.target.checked; P.rebuild(true); };
    $('f-clear').onclick = function () {
      var swapped = F.swap;
      F.skewNs = 0; F.amLoss = false; F.los = false; F.noise = 0; F.noiseLane = -1; F.swap = false;
      P.renderFaults();
      if (swapped) P.rebuild(true); else { P.refreshSkew(); P.emit('fault'); }
    };
    $('f-relock').onclick = function () { P.rebuild(true); };
    $('f-reset').onclick = P.resetCounters;
  }
})(globalThis.PCS = globalThis.PCS || {});
