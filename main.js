(function(){
  /* ---- shared util ---- */
  function debounce(fn, ms){
    var h;
    return function(){ clearTimeout(h); var a=arguments; h=setTimeout(function(){fn.apply(null,a);},ms); };
  }
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = window.matchMedia('(max-width: 768px)').matches;

  /* ================================================
     1. ASCII SIDE RAIL ANIMATION
  ================================================ */
  var ramp  = " .:-=+*#%@";
  var cellW = 6, cellH = 10;

  function getRailColors(){
    var s = document.documentElement.style;
    var out = [];
    for(var i=1; i<=4; i++){
      var v = s.getPropertyValue('--rail-c'+i).trim();
      if(v) out.push(v);
    }
    if(out.length < 2) out = ['255,176,0','255,130,0','255,176,0'];
    return out;
  }

  function lerpColor(a, b, t){
    var ac = a.split(',').map(Number);
    var bc = b.split(',').map(Number);
    return 'rgb('+
      Math.round(ac[0]+(bc[0]-ac[0])*t)+','+
      Math.round(ac[1]+(bc[1]-ac[1])*t)+','+
      Math.round(ac[2]+(bc[2]-ac[2])*t)+')';
  }

  /* interpolate density v (0..1) across an arbitrary 2-4 colour stop list */
  function densityColor(v, colors){
    var n = colors.length;
    if(n === 1) return 'rgb('+colors[0]+')';
    var segLen = 1/(n-1);
    var idx = Math.min(n-2, Math.floor(v/segLen));
    var localT = (v - idx*segLen)/segLen;
    return lerpColor(colors[idx], colors[idx+1], localT);
  }

  function buildRail(canvas, seed){
    var ctx = canvas.getContext('2d');
    var cols=0, rows=0;
    var colors;

    function reloadColors(){
      colors = getRailColors();
    }

    function resize(){
      var rail = canvas.parentElement;
      canvas.width  = rail.clientWidth;
      canvas.height = window.innerHeight;
      cols = Math.ceil(canvas.width/cellW)+2;
      rows = Math.ceil(canvas.height/cellH)+2;
      ctx.font = '10px IBM Plex Mono';
      ctx.textBaseline = 'top';
    }

    resize();
    reloadColors();
    window.addEventListener('resize', debounce(resize, 200));

    /* allow palette changes to hot-reload rail colours */
    window.addEventListener('sk-palette', reloadColors);
    window.addEventListener('sk-mode', reloadColors);

    function frame(t){
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for(var y=0; y<rows; y++){
        for(var x=0; x<cols; x++){
          var v = Math.sin(x*0.18+t+seed)+Math.sin(y*0.13-t*1.3+seed)+
                  Math.sin((x+y)*0.09+t*0.6-seed)+
                  Math.sin(Math.sqrt(x*x*0.02+y*y*0.02)-t*0.8);
          v = (v+4)/8;
          v = Math.max(0, Math.min(1, v));
          var ch = ramp[Math.floor(v*(ramp.length-1))];
          ctx.fillStyle = densityColor(v, colors);
          ctx.fillText(ch, x*cellW, y*cellH);
        }
      }
    }

    return { frame: frame };
  }

  var left  = buildRail(document.getElementById('asciiLeft'),  0);
  var right = buildRail(document.getElementById('asciiRight'), 100);
  var railT=0, railLast=0, railFps=1000/12;

  /* ================================================
     2. PARTICLE NAME EFFECT
  ================================================ */
  var canvas = document.getElementById('nameCanvas');
  var banner = document.getElementById('bannerPanel');
  var ctx    = canvas.getContext('2d');

  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  var particles  = [];
  var mouse      = {x:-9999, y:-9999};
  var CHARS      = ".:+-=*#@&~<>{}[]|/\\";
  var NCHARS     = CHARS.length;
  var nameReady  = false;
  var nameStartT = 0;
  var logicalW   = 0, logicalH = 0;

  var STEP        = 6;
  /* Touch is a single stationary contact point — unlike a mouse cursor,
     which is usually passing through on its way somewhere else, a finger
     can rest still over the text for a while. The same repulsion
     constants that feel right for a moving mouse on desktop feel far
     more disruptive on mobile as a result, so touch gets a gentler
     radius/strength to match the desktop feel rather than exceed it. */
  var REPULSE_R   = isMobile ? 70  : 110;
  var REPULSE_STR = isMobile ? 3   : 5.5;

  /* Canvas height: read from the element's computed style so CSS drives it */
  function getCanvasH(){
    /* parse the CSS height that the stylesheet sets per breakpoint */
    var h = parseInt(window.getComputedStyle(canvas).height, 10);
    return (h && h > 0) ? h : 220;
  }

  var settled    = false;
  var SETTLE_VEL = 0.15;
  var SETTLE_CHECK_INTERVAL = 60;
  var frameCount = 0;

  /* particle colour — reads from CSS var so theme changes apply.
     In light mode, the raw accent (often a light/bright hue) washes out
     against a white panel, so darken it for legibility. */
  function getParticleColor(){
    var v = getComputedStyle(document.documentElement).getPropertyValue('--particle-color').trim();
    v = v || getComputedStyle(document.documentElement).getPropertyValue('--amber').trim() || '#ffb000';

    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if(!isLight) return v;

    var m = v.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if(!m) return v;
    var r = +m[1], g = +m[2], b = +m[3];

    /* compute luminance; if the colour is too light to read on white, darken it */
    var lum = 0.2126*r + 0.7152*g + 0.0722*b;
    if(lum > 150){
      var f = 150 / lum;
      r = Math.round(r*f); g = Math.round(g*f); b = Math.round(b*f);
    }
    return 'rgb('+r+','+g+','+b+')';
  }

  /* redraw the name when theme toggles, so light/dark colour swap applies */
  window.addEventListener('sk-mode', function(){ settled = false; });

  function resizeNameCanvas(){
    logicalH = getCanvasH();
    logicalW = banner.clientWidth - (isMobile ? 32 : 72);
    canvas.style.width  = logicalW + 'px';
    /* height is already set by CSS; just sync the backing store */
    canvas.width  = logicalW  * DPR;
    canvas.height = logicalH  * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    settled = false;
    buildParticles();
  }

  function buildParticles(){
    document.fonts.ready.then(function(){
      particles = [];
      var w = logicalW, h = logicalH;

      /* scale font to fit — important on mobile.
         Must respect BOTH width (long word "KHANDELWAL") and height
         (two stacked lines) — on mobile the canvas gets much shorter
         via CSS while staying nearly full viewport width, so a
         width-only cap badly overflows the box vertically. */
      var fontSize = Math.min(100, Math.floor(w / 9.5), Math.floor(h / 2.6));

      var off  = document.createElement('canvas');
      off.width = w; off.height = h;
      var octx = off.getContext('2d');
      octx.fillStyle  = '#fff';
      octx.textAlign  = 'center';
      octx.textBaseline = 'alphabetic';
      /* Use a guaranteed system font for this invisible mask, not the
         custom IBM Plex Mono web font. The mask is never shown to the
         user — it's purely a stencil for particle positions — so the
         exact typeface doesn't matter. iOS Safari has shown inconsistent
         behavior loading/applying custom web fonts inside an offscreen
         canvas (one never appended to the DOM) specifically for
         fillText, silently substituting a tiny fallback size and
         producing a near-empty, speckled mask instead of full letterforms
         (reproduced on-device: only 69/520 sample points were opaque,
         vs. thousands expected for solid bold text at this size). A
         system font avoids that failure mode entirely and is identical
         visually since it's invisible anyway. */
      octx.font       = 'bold ' + fontSize + 'px monospace';

      var line1Y = Math.round(h * 0.40);
      var line2Y = Math.round(h * 0.82);
      octx.fillText('SAARTHAK',   w/2, line1Y);
      octx.fillText('KHANDELWAL', w/2, line2Y);

      var img = octx.getImageData(0, 0, w, h);

      /* use a tighter step on mobile. NOTE: counterintuitively this must
         be SMALLER (denser), not larger, than desktop's STEP=6 — the
         mobile canvas is much shorter (110-140px vs 220px) so the text
         is rendered at a much smaller font size, and a coarse 8px grid
         was leaving only ~60-70 isolated particles total, which reads
         as scattered noise rather than letterforms (confirmed by
         simulating the exact draw at device-reported dimensions).
         A 3px step keeps the letters legible at small sizes. */
      var step = isMobile ? 3 : STEP;

      for(var y=0; y<h; y+=step){
        for(var x=0; x<w; x+=step){
          var idx = (y*w + x)*4;
          if(img.data[idx+3] > 100){
            particles.push({
              x:  x + (Math.random()-0.5)*w*0.5,
              y:  y + (Math.random()-0.5)*h*2.5,
              tx: x, ty: y,
              vx: 0, vy: 0,
              char: CHARS[Math.floor(Math.random()*NCHARS)],
              delay: (x/w)*1.2
            });
          }
        }
      }


      /* mobile uses a denser particle grid (step=3 vs desktop's 6) to stay
         legible at the smaller font size the short mobile canvas forces.
         At that density, full-size 6px glyphs overlap heavily and the
         random mix of symbol characters reads as cluttered/noisy texture
         rather than clean letter strokes. A smaller 4px glyph on mobile
         keeps the same particle count/legibility but with far less
         overlap noise (verified by rendering both side-by-side). */
      ctx.font         = (isMobile ? '500 4px ' : '500 6px ') + 'IBM Plex Mono';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      nameReady  = true;
      settled    = false;
      nameStartT = performance.now();
    });
  }

  resizeNameCanvas();

  window.addEventListener('resize', debounce(function(){
    isMobile = window.matchMedia('(max-width: 768px)').matches;
    resizeNameCanvas();
  }, 200));

  /* mouse repulsion */
  canvas.addEventListener('mousemove', function(e){
    var r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    settled = false;
  }, {passive:true});

  canvas.addEventListener('mouseleave', function(){
    mouse.x = -9999; mouse.y = -9999;
  });

  /* touch repulsion — same physics, one touch point */
  canvas.addEventListener('touchmove', function(e){
    e.preventDefault();
    var r = canvas.getBoundingClientRect();
    var t = e.touches[0];
    mouse.x = t.clientX - r.left;
    mouse.y = t.clientY - r.top;
    settled = false;
  }, {passive:false});

  canvas.addEventListener('touchend', function(){
    mouse.x = -9999; mouse.y = -9999;
  }, {passive:true});

  /* Mobile browsers often fire touchcancel instead of touchend when a
     touch sequence turns into a page scroll/swipe (very common right on
     this banner, since it sits at the top of a scrolling page). Without
     this, mouse.x/y could get stuck at the last touchmove position
     indefinitely, causing strong, persistent repulsion clumping around
     that stale point instead of the effect fading once the finger lifts
     or the gesture is taken over by the browser. */
  canvas.addEventListener('touchcancel', function(){
    mouse.x = -9999; mouse.y = -9999;
  }, {passive:true});

  /* re-read colour when theme changes */
  window.addEventListener('sk-palette', function(){
    settled = false; /* redraw with new colour */
  });

  function snapNameToTarget(){
    for(var i=0; i<particles.length; i++){
      var p = particles[i];
      p.x = p.tx; p.y = p.ty; p.vx = 0; p.vy = 0;
    }
  }

  function renderName(now){
    if(settled) return;

    var elapsed = (now - nameStartT) / 1000;
    var w = logicalW, h = logicalH;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle   = getParticleColor();
    ctx.globalAlpha = 0.9;

    var mx = mouse.x, my = mouse.y;
    var maxVel = 0;

    for(var i=0; i<particles.length; i++){
      var p = particles[i];

      p.vx += (p.tx - p.x) * 0.04;
      p.vy += (p.ty - p.y) * 0.04;

      var dx = p.x - mx, dy = p.y - my;
      var d  = Math.sqrt(dx*dx + dy*dy);
      if(d < REPULSE_R && d > 0){
        var force = (1 - d/REPULSE_R) * (1 - d/REPULSE_R) * REPULSE_STR;
        p.vx += (dx/d) * force;
        p.vy += (dy/d) * force;
      }

      p.vx *= 0.88; p.vy *= 0.88;
      p.x  += p.vx; p.y  += p.vy;

      var spd = Math.abs(p.vx) + Math.abs(p.vy);
      if(spd > maxVel) maxVel = spd;

      var age = Math.max(0, elapsed - p.delay);
      if(age < 0.8 || Math.random() < 0.0008){
        p.char = CHARS[Math.floor(Math.random()*NCHARS)];
      }

      ctx.fillText(p.char, p.x, p.y);
    }

    ctx.globalAlpha = 1;

    frameCount++;
    if(frameCount % SETTLE_CHECK_INTERVAL === 0 && elapsed > 2.0 && maxVel < SETTLE_VEL){
      settled = true;
    }
  }

  /* ================================================
     3. DARK / LIGHT MODE TOGGLE
  ================================================ */
  (function(){
    var STORAGE_KEY = 'sk-mode';
    var root   = document.documentElement;
    var switchBtn = document.getElementById('modeSwitch');
    var icon   = document.getElementById('modeIcon');
    if(!switchBtn || !icon) return;

    var MOON_PATH = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    var SUN_PATH =
      '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

    function render(mode){
      var isLight = mode === 'light';
      root.setAttribute('data-theme', isLight ? 'light' : 'dark');
      icon.innerHTML = isLight ? SUN_PATH : MOON_PATH;
      switchBtn.setAttribute('aria-pressed', isLight ? 'true' : 'false');
    }

    var saved = 'dark';
    try { saved = localStorage.getItem(STORAGE_KEY) || 'dark'; } catch(e){}
    render(saved);

    switchBtn.addEventListener('click', function(){
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      render(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch(e){}
      window.dispatchEvent(new CustomEvent('sk-mode'));
    });
  })();

  /* ================================================
     4. THEME EDITOR (popup)
  ================================================ */
  (function(){
    var sk = window._SK;
    if(!sk) return;

    var btn         = document.getElementById('themeBtn');
    var overlay     = document.getElementById('themeModalOverlay');
    var closeBtn    = document.getElementById('themeModalClose');
    var countToggle = document.getElementById('countToggle');
    var colorRows   = document.getElementById('colorRows');
    var applyBtn    = document.getElementById('themeApply');
    var resetBtn    = document.getElementById('themeReset');
    var randomBtn   = document.getElementById('themeRandom');
    if(!btn || !overlay) return;

    function randomHex(){
      var n = Math.floor(Math.random()*0xffffff);
      return '#' + ('000000' + n.toString(16)).slice(-6);
    }

    var DEFAULTS = sk.DEFAULT_COLORS;
    var draft = sk.getColors();

    function renderCount(){
      countToggle.querySelectorAll('button').forEach(function(b){
        b.classList.toggle('active', Number(b.getAttribute('data-count')) === draft.length);
      });
    }

    function renderRows(){
      colorRows.innerHTML = '';
      draft.forEach(function(hex, i){
        var row = document.createElement('div');
        row.className = 'color-row';

        var idxTag = document.createElement('span');
        idxTag.className = 'color-row-idx';
        idxTag.textContent = (i+1);

        var picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'color-picker';
        picker.value = hex;

        var hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.className = 'color-hex';
        hexInput.value = hex;
        hexInput.maxLength = 7;
        hexInput.spellcheck = false;

        picker.addEventListener('input', function(){
          draft[i] = picker.value;
          hexInput.value = picker.value;
        });

        hexInput.addEventListener('change', function(){
          var v = hexInput.value.trim();
          if(/^#?[0-9a-fA-F]{6}$/.test(v)){
            if(v[0] !== '#') v = '#'+v;
            draft[i] = v;
            picker.value = v;
            hexInput.value = v;
          } else {
            hexInput.value = draft[i];
          }
        });

        row.appendChild(idxTag);
        row.appendChild(picker);
        row.appendChild(hexInput);
        colorRows.appendChild(row);
      });
    }

    function setCount(n){
      if(n > draft.length){
        while(draft.length < n){ draft.push(DEFAULTS[draft.length % DEFAULTS.length]); }
      } else if(n < draft.length){
        draft = draft.slice(0, n);
      }
      renderCount();
      renderRows();
    }

    countToggle.addEventListener('click', function(e){
      var b = e.target.closest('button[data-count]');
      if(!b) return;
      setCount(Number(b.getAttribute('data-count')));
    });

    function openModal(){
      draft = sk.getColors();
      renderCount();
      renderRows();
      overlay.classList.add('open');
    }
    function closeModal(){
      overlay.classList.remove('open');
    }

    btn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
    });

    applyBtn.addEventListener('click', function(){
      sk.setColors(draft.slice());
      closeModal();
    });

    resetBtn.addEventListener('click', function(){
      draft = DEFAULTS.slice();
      renderCount();
      renderRows();
    });

    if(randomBtn){
      randomBtn.addEventListener('click', function(){
        draft = draft.map(function(){ return randomHex(); });
        renderRows();
      });
    }
  })();

  /* ================================================
     4. KONAMI CODE — FULL ASCII TAKEOVER
  ================================================ */
  (function(){
    var overlay = document.getElementById('asciiTakeover');
    var takeoverCanvas = document.getElementById('asciiTakeoverCanvas');
    if(!overlay || !takeoverCanvas) return;

    var busy = false;

    function renderAsciiFrame(srcCanvas){
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      var w = window.innerWidth, h = window.innerHeight;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);

      takeoverCanvas.width  = w * dpr;
      takeoverCanvas.height = h * dpr;
      takeoverCanvas.style.width  = w + 'px';
      takeoverCanvas.style.height = h + 'px';

      var tctx = takeoverCanvas.getContext('2d');
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tctx.fillStyle = isLight ? '#e9e7e1' : '#0b0a08';
      tctx.fillRect(0, 0, w, h);

      var cw = 4, ch = 6;
      var cols = Math.max(1, Math.ceil(w/cw));
      var rows = Math.max(1, Math.ceil(h/ch));

      /* shrinking a ~1920x1080 screenshot straight down to ~270x95 cells in
         one drawImage call lets the browser's smoothing wash out thin bright
         details (borders, small text strokes) into near-black. Step the
         downscale down by half repeatedly first — much better area-average
         — then do the final resize to the exact cell grid. */
      var stepCanvas = srcCanvas;
      var sw = srcCanvas.width, sh = srcCanvas.height;
      while(sw > cols * 2 && sh > rows * 2){
        var nw = Math.max(cols, Math.floor(sw/2));
        var nh = Math.max(rows, Math.floor(sh/2));
        var stepCtx2 = document.createElement('canvas');
        stepCtx2.width = nw; stepCtx2.height = nh;
        var sc2 = stepCtx2.getContext('2d');
        sc2.imageSmoothingEnabled = true;
        sc2.drawImage(stepCanvas, 0, 0, nw, nh);
        stepCanvas = stepCtx2;
        sw = nw; sh = nh;
      }

      var sample = document.createElement('canvas');
      sample.width = cols; sample.height = rows;
      var sctx = sample.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(stepCanvas, 0, 0, cols, rows);
      var data = sctx.getImageData(0, 0, cols, rows).data;

      tctx.font = 'bold 6px IBM Plex Mono';
      tctx.textBaseline = 'top';

      /* DARK MODE: the page/panel backgrounds are both very dark
         (#0b0a08 / #15120c, luminance ~0.04-0.07). Cells below BG_CUTOFF
         are background and left blank; everything brighter (text, glow,
         borders) gets boosted up so it reads clearly.

         LIGHT MODE: backgrounds are bright (~0.90-0.98 luminance) and
         text/borders are the dark outliers (text ~0.10, text-dim ~0.39).
         Box-downsampling a thin line of dark monospace text against a
         mostly-bright cell averages its luminance back up toward the
         background tone, so a plain luminance cutoff either keeps the
         whole background (cutoff too high) or drops washed-out text
         (cutoff too low). Instead, measure each cell's luminance relative
         to a known background reference (BG_REF, between the page and
         panel tones) — only cells meaningfully *darker* than that
         reference count as ink, regardless of how much the antialiasing
         softened them. */
      var GAMMA      = 0.6;
      var GAIN       = 1.9;
      var FLOOR_ADD  = 45;
      var BG_CUTOFF        = 0.10;   // dark mode: below this = background
      var LIGHT_BG_REF     = 0.92;   // light mode: reference background luminance
      var LIGHT_MIN_DEV    = 0.045;  // ignore deviations smaller than this (noise/antialiasing)
      var LIGHT_DEV_GAIN   = 3.2;    // amplify deviation from background into a 0..1 darkness value

      function boost(channel){
        return Math.max(0, Math.min(255, channel * GAIN + FLOOR_ADD));
      }
      function darken(channel){
        return Math.max(0, Math.min(255, channel * 0.45 - 15));
      }

      for(var y=0; y<rows; y++){
        for(var x=0; x<cols; x++){
          var idx = (y*cols + x) * 4;
          var r = data[idx], g = data[idx+1], b = data[idx+2];
          var lum = (0.299*r + 0.587*g + 0.114*b) / 255;

          if(isLight){
            var deviation = LIGHT_BG_REF - lum;
            if(deviation < LIGHT_MIN_DEV) continue; /* at or near background tone, leave blank */
            var darkness = Math.min(1, deviation * LIGHT_DEV_GAIN);
            var liftedL = Math.pow(darkness, GAMMA);
            var chL = ramp[Math.min(ramp.length-1, Math.floor(liftedL*(ramp.length-1)) + 1)];
            tctx.fillStyle = 'rgb('+darken(r)+','+darken(g)+','+darken(b)+')';
            tctx.fillText(chL, x*cw, y*ch);
          } else {
            if(lum < BG_CUTOFF) continue; /* background/panel tone, leave blank */
            var lifted = Math.pow(lum, GAMMA);
            var ch_ = ramp[Math.min(ramp.length-1, Math.floor(lifted*(ramp.length-1)) + 1)];
            tctx.fillStyle = 'rgb('+boost(r)+','+boost(g)+','+boost(b)+')';
            tctx.fillText(ch_, x*cw, y*ch);
          }
        }
      }
    }

    function triggerTakeover(){
      if(busy || typeof html2canvas === 'undefined') return;
      busy = true;

      /* html2canvas can't render backdrop-filter blur and tends to choke on
         fixed-position overlays (grain/scanlines/vignette) sitting above the
         content — both make the capture come out nearly blank. Temporarily
         strip them for the snapshot, then restore. */
      var styleTag = document.createElement('style');
      styleTag.id = 'sk-capture-override';
      styleTag.textContent =
        '.panel{ backdrop-filter:none !important; }' +
        '.scan-overlay, .vignette, body::after{ display:none !important; }';
      document.head.appendChild(styleTag);

      var hiddenEls = document.querySelectorAll('.scan-overlay, .vignette');
      hiddenEls.forEach(function(el){ el.style.display = 'none'; });

      function cleanup(){
        styleTag.remove();
        hiddenEls.forEach(function(el){ el.style.display = ''; });
      }

      var isLightCapture = document.documentElement.getAttribute('data-theme') === 'light';

      html2canvas(document.body, {
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: isLightCapture ? '#e9e7e1' : '#0b0a08',
        scale: 1,
        useCORS: true,
        logging: false,
        removeContainer: true
      }).then(function(srcCanvas){
        cleanup();
        renderAsciiFrame(srcCanvas);

        /* entrance: pop in bright + slightly oversized, then settle down to
           normal brightness/scale for a punchier reveal than a flat fade */
        overlay.classList.add('show', 'pop');
        requestAnimationFrame(function(){
          requestAnimationFrame(function(){
            overlay.classList.remove('pop');
          });
        });

        setTimeout(function(){
          overlay.classList.remove('show');
          setTimeout(function(){ busy = false; }, 900);
        }, 2600);
      }).catch(function(){
        cleanup();
        busy = false;
      });
    }

    var KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA'];
    var pos = 0;

    document.addEventListener('keydown', function(e){
      var expected = KONAMI[pos];
      if(e.code === expected){
        pos++;
        if(pos === KONAMI.length){
          pos = 0;
          triggerTakeover();
        }
      } else {
        pos = (e.code === KONAMI[0]) ? 1 : 0;
      }
    });
  })();

  /* ================================================
     5. UNIFIED RAF LOOP
  ================================================ */
  var rafId      = 0;

  function startLoop(){ if(!rafId) rafId = requestAnimationFrame(loop); }
  function stopLoop(){ if(rafId){ cancelAnimationFrame(rafId); rafId=0; } }

  document.addEventListener('visibilitychange', function(){
    if(!document.hidden){ settled = false; startLoop(); } else { stopLoop(); }
  });

  var nameObserver = new IntersectionObserver(function(entries){
    if(entries[0].isIntersecting) settled = false;
  }, {threshold:0});
  nameObserver.observe(canvas);

  function loop(now){
    rafId = 0;
    if(!railLast) railLast = now;
    if(now - railLast >= railFps){
      railLast = now; railT += 0.07;
      left.frame(railT); right.frame(railT);
    }
    if(!reduceMotion && nameReady) renderName(now);
    rafId = requestAnimationFrame(loop);
  }

  if(reduceMotion){
    left.frame(0); right.frame(0);
    /* still draw the name — just snap straight to its settled, final
       position instead of animating in. Without this, reduced-motion
       users (default ON for many iOS/in-app-webview users) saw a
       permanently blank name area, since renderName() was never called. */
    if(nameReady){ snapNameToTarget(); renderName(performance.now()); }
    else {
      var waitForName = setInterval(function(){
        if(nameReady){ clearInterval(waitForName); snapNameToTarget(); renderName(performance.now()); }
      }, 50);
    }
  } else {
    startLoop();
  }
})();

/* ================================================
   EXPANDABLE ACTIVITY DETAIL
================================================ */
(function(){
  var toggle = document.getElementById('calibrToggle');
  var detail = document.getElementById('calibrDetail');
  if(!toggle || !detail) return;

  toggle.addEventListener('click', function(){
    var isOpen = detail.classList.contains('open');
    if(isOpen){
      detail.classList.remove('open');
      detail.setAttribute('aria-hidden', 'true');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      detail.classList.add('open');
      detail.setAttribute('aria-hidden', 'false');
      toggle.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });
})();

/* QMSAN + Vesuvius expandable toggles */
(function(){
  [
    { toggleId: 'qmsanToggle', detailId: 'qmsanDetail' },
    { toggleId: 'vesuviusToggle', detailId: 'vesuviusDetail' }
  ].forEach(function(pair){
    var toggle = document.getElementById(pair.toggleId);
    var detail = document.getElementById(pair.detailId);
    if(!toggle || !detail) return;
    toggle.addEventListener('click', function(){
      var isOpen = detail.classList.contains('open');
      detail.classList.toggle('open', !isOpen);
      detail.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
      toggle.classList.toggle('open', !isOpen);
      toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });
  });
})();

/* Self-Driving-Car expandable toggle */
(function(){
  var toggle = document.getElementById('carToggle');
  var detail = document.getElementById('carDetail');
  if(!toggle || !detail) return;
  toggle.addEventListener('click', function(){
    var isOpen = detail.classList.contains('open');
    detail.classList.toggle('open', !isOpen);
    detail.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
    toggle.classList.toggle('open', !isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  });
})();
