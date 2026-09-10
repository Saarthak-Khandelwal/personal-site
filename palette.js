(function(){
  /* apply saved dark/light mode immediately, before first paint */
  try {
    var savedMode = localStorage.getItem('sk-mode');
    if(savedMode === 'light'){
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch(e){}

  /* Default 3-stop amber gradient — matches the original look */
  var DEFAULT_COLORS = ['#ffb000', '#ff8200', '#ffb000'];

  function hexToRgbStr(hex){
    hex = String(hex).replace('#', '');
    if(hex.length === 3){
      hex = hex.split('').map(function(c){ return c + c; }).join('');
    }
    var r = parseInt(hex.substring(0, 2), 16) || 0;
    var g = parseInt(hex.substring(2, 4), 16) || 0;
    var b = parseInt(hex.substring(4, 6), 16) || 0;
    return r + ',' + g + ',' + b;
  }

  /* Generate a random hex that is bright enough to read against the
     dark panel background. We reject colours whose perceived luminance
     (standard Rec.709 coefficients) falls below MIN_LUM so the name
     particles are always legible regardless of the chosen palette.
     MAX_SAT stops washed-out near-white colours that lose contrast too. */
  var MIN_LUM = 80;  /* 0-255 scale; below this reads as near-black on dark bg */
  var MAX_LUM = 230; /* above this reads as near-white, loses the amber feel   */

  function randomHex(){
    var r, g, b, lum, attempts = 0;
    do {
      r = Math.floor(Math.random()*256);
      g = Math.floor(Math.random()*256);
      b = Math.floor(Math.random()*256);
      lum = 0.2126*r + 0.7152*g + 0.0722*b;
      attempts++;
    } while((lum < MIN_LUM || lum > MAX_LUM) && attempts < 40);
    var hex = ((r<<16)|(g<<8)|b).toString(16);
    return '#' + ('000000' + hex).slice(-6);
  }

  /* fresh random palette every page load — 2 to 4 colour stops */
  function randomPalette(){
    var count = 2 + Math.floor(Math.random()*3); /* 2, 3, or 4 */
    var colors = [];
    for(var i=0; i<count; i++){ colors.push(randomHex()); }
    return colors;
  }

  var activeColors = randomPalette();

  function applyPalette(colors){
    activeColors = colors.slice();
    var r = document.documentElement;

    for(var i = 1; i <= 4; i++){ r.style.removeProperty('--rail-c' + i); }
    activeColors.forEach(function(hex, i){
      r.style.setProperty('--rail-c' + (i + 1), hexToRgbStr(hex));
    });
    r.style.setProperty('--rail-color-count', activeColors.length);

    /* the name-particle effect shares the rail's first colour stop,
       but the rest of the UI chrome (labels, borders, links) stays
       amber regardless of the chosen theme */
    r.style.setProperty('--particle-color', 'rgb(' + hexToRgbStr(activeColors[0]) + ')');
  }

  applyPalette(activeColors);

  function setColors(colors){
    applyPalette(colors);
    window.dispatchEvent(new CustomEvent('sk-palette'));
  }

  /* expose to main.js + theme modal */
  window._SK = {
    DEFAULT_COLORS: DEFAULT_COLORS,
    getColors: function(){ return activeColors.slice(); },
    setColors: setColors,
    hexToRgbStr: hexToRgbStr
  };
})();
