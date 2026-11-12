(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KesKlipSfx = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SFX_LIBRARY = Object.freeze([
    { id: 'hit', name: 'Vuruş', description: 'Sert darbe', file: 'hit.wav', duration: 0.45 },
    { id: 'slash', name: 'Kesme', description: 'Hızlı kesik', file: 'slash.wav', duration: 0.24 },
    { id: 'whoosh', name: 'Rüzgâr', description: 'Kısa süpürme', file: 'whoosh.wav', duration: 0.5 },
    { id: 'pop', name: 'Pop', description: 'Yumuşak tık', file: 'pop.wav', duration: 0.18 },
    { id: 'ding', name: 'Ding', description: 'Parlak çınlama', file: 'ding.wav', duration: 0.9 },
    { id: 'boom', name: 'Boom', description: 'Derin patlama', file: 'boom.wav', duration: 0.8 },
  ]);

  const SFX_IDS = Object.freeze(SFX_LIBRARY.map((entry) => entry.id));

  function getSfx(id) {
    return SFX_LIBRARY.find((entry) => entry.id === id) || null;
  }

  return {
    SFX_LIBRARY,
    SFX_IDS,
    getSfx,
  };
});
