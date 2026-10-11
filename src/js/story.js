/* Narrative hooks: draw figures and wire "show in the lab" buttons. */
(function (P) {
  'use strict';
  P.initStory = function () {
    P.drawFigures();
    document.querySelectorAll('.showme').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.fault === 'noise') {
          var f = P.state.faults;
          f.noise = 62; f.noiseLane = 0;
          P.renderFaults(); P.emit('fault');
        }
        document.getElementById('lab').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        P.goStage(+b.dataset.stage);
        if (!P.state.playing) P.setPlaying(true);
      });
    });
  };
})(globalThis.PCS = globalThis.PCS || {});
