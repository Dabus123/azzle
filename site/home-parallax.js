(function () {
  const bg = document.getElementById("parallax-bg");
  if (!bg) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce.matches) return;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------
  // 1. Build the SVG filter chain once: turbulence -> displacement
  //    warp -> RGB channel split -> per-channel offset -> screen blend
  //    (chromatic aberration). One filter, applied once to the whole
  //    bg container — cheap enough to run every frame.
  // ---------------------------------------------------------------
  const SVG_NS = "http://www.w3.org/2000/svg";
  const FILTER_ID = "px-insane-filter";

  function buildFilter() {
    if (document.getElementById(FILTER_ID)) return document.getElementById(FILTER_ID);

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.style.pointerEvents = "none";

    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", FILTER_ID);
    filter.setAttribute("x", "-20%");
    filter.setAttribute("y", "-20%");
    filter.setAttribute("width", "140%");
    filter.setAttribute("height", "140%");
    filter.setAttribute("color-interpolation-filters", "sRGB");

    const turbulence = document.createElementNS(SVG_NS, "feTurbulence");
    turbulence.setAttribute("type", "fractalNoise");
    turbulence.setAttribute("baseFrequency", "0.008 0.012");
    turbulence.setAttribute("numOctaves", "2");
    turbulence.setAttribute("seed", "7");
    turbulence.setAttribute("result", "noise");

    const displace = document.createElementNS(SVG_NS, "feDisplacementMap");
    displace.setAttribute("in", "SourceGraphic");
    displace.setAttribute("in2", "noise");
    displace.setAttribute("scale", "0");
    displace.setAttribute("xChannelSelector", "R");
    displace.setAttribute("yChannelSelector", "G");
    displace.setAttribute("result", "displaced");

    // isolate R / G / B from the displaced image
    const matR = document.createElementNS(SVG_NS, "feColorMatrix");
    matR.setAttribute("in", "displaced");
    matR.setAttribute("type", "matrix");
    matR.setAttribute("values", "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0");
    matR.setAttribute("result", "rChan");

    const matB = document.createElementNS(SVG_NS, "feColorMatrix");
    matB.setAttribute("in", "displaced");
    matB.setAttribute("type", "matrix");
    matB.setAttribute("values", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0");
    matB.setAttribute("result", "bChan");

    const offR = document.createElementNS(SVG_NS, "feOffset");
    offR.setAttribute("in", "rChan");
    offR.setAttribute("dx", "0");
    offR.setAttribute("dy", "0");
    offR.setAttribute("result", "rOff");

    const offB = document.createElementNS(SVG_NS, "feOffset");
    offB.setAttribute("in", "bChan");
    offB.setAttribute("dx", "0");
    offB.setAttribute("dy", "0");
    offB.setAttribute("result", "bOff");

    const blend1 = document.createElementNS(SVG_NS, "feBlend");
    blend1.setAttribute("in", "rOff");
    blend1.setAttribute("in2", "displaced");
    blend1.setAttribute("mode", "screen");
    blend1.setAttribute("result", "rg");

    const blend2 = document.createElementNS(SVG_NS, "feBlend");
    blend2.setAttribute("in", "rg");
    blend2.setAttribute("in2", "bOff");
    blend2.setAttribute("mode", "screen");

    filter.append(turbulence, displace, matR, matB, offR, offB, blend1, blend2);
    svg.appendChild(filter);
    document.body.appendChild(svg);

    return filter;
  }

  const filterEl = buildFilter();
  const turbulenceNode = filterEl.querySelector("feTurbulence");
  const displaceNode = filterEl.querySelector("feDisplacementMap");
  const offRNode = filterEl.querySelectorAll("feOffset")[0];
  const offBNode = filterEl.querySelectorAll("feOffset")[1];

  bg.style.filter = `url(#${FILTER_ID})`;

  // ---------------------------------------------------------------
  // 2. Layer + depth setup (same structure as before, extended
  //    with 3D rotation targets).
  // ---------------------------------------------------------------
  bg.style.perspective = bg.style.perspective || "1400px";

  const bgLayers = Array.from(bg.querySelectorAll("[data-parallax-y]")).map((el, i) => {
    el.style.transformStyle = "preserve-3d";
    el.style.willChange = "transform";
    return {
      el,
      speed: parseFloat(el.dataset.parallaxY) || 0.1,
      depthIndex: i,
      cur: { y: 0, rotX: 0, rotY: 0 },
      tgt: { y: 0, rotX: 0, rotY: 0 },
    };
  });

  const track = bg.querySelector(".px-track");
  const ball = bg.querySelector(".px-ball");
  const ballRig = {
    track,
    ball,
    phase: Math.random() * Math.PI * 2,
    curBallX: 0,
    curTilt: 0,
    curRoll: 0,
    trackHalf: 0,
  };

  function measureBallRig() {
    if (!track || !ball) return;
    const trackW = track.offsetWidth;
    const ballW = ball.offsetWidth;
    ballRig.trackHalf = Math.max(24, trackW * 0.5 - ballW * 0.42);
  }

  measureBallRig();
  window.addEventListener("resize", measureBallRig, { passive: true });

  const depthEls = [];

  document.querySelectorAll(".rd-head, .sec, footer").forEach((el, i) => {
    el.dataset.parallaxDepth = String(0.03 + (i % 5) * 0.012);
    depthEls.push({
      el,
      depth: parseFloat(el.dataset.parallaxDepth),
      cur: { y: 0, rot: 0 },
      tgt: { y: 0, rot: 0 },
    });
  });

  document.querySelectorAll(".bd, .stack-wrap, .rules").forEach((el) => {
    el.dataset.parallaxDepth = "0.085";
    depthEls.push({ el, depth: 0.085, cur: { y: 0, rot: 0 }, tgt: { y: 0, rot: 0 } });
  });

  document.querySelectorAll(".sec").forEach((el, i) => {
    el.classList.add("px-reveal");
    el.style.setProperty("--px-delay", `${(i % 6) * 60}ms`);
  });

  // ---------------------------------------------------------------
  // 3. Pointer state (drives rotateY tilt + aberration center bias)
  // ---------------------------------------------------------------
  let pointerX = 0, pointerY = 0, pointerActive = false;

  window.addEventListener(
    "pointermove",
    (e) => {
      pointerActive = true;
      pointerX = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
      pointerY = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
    },
    { passive: true }
  );

  window.addEventListener(
    "pointerleave",
    () => {
      pointerActive = false;
      pointerX = 0;
      pointerY = 0;
    },
    { passive: true }
  );

  // ---------------------------------------------------------------
  // 4. Scroll velocity — drives displacement scale + aberration dx
  // ---------------------------------------------------------------
  let lastScrollY = window.scrollY;
  let lastTime = performance.now();
  let velocity = 0;
  let smoothVelocity = 0;
  let ambientClock = 0;

  let running = true;
  let rafId = 0;
  let filterFrameSkip = 0;

  function updateTargets() {
    const sy = window.scrollY;
    const vh = window.innerHeight;
    const center = vh * 0.5;

    for (const layer of bgLayers) {
      layer.tgt.y = sy * layer.speed;
      // deeper layers tilt more; pointer drives rotateY, scroll speed drives rotateX
      const depthFactor = 1 + layer.depthIndex * 0.6;
      layer.tgt.rotY = pointerActive ? pointerX * 6 * depthFactor : 0;
      layer.tgt.rotX = clamp(-smoothVelocity * 0.15 * depthFactor, -14, 14);
    }

    for (const d of depthEls) {
      const rect = d.el.getBoundingClientRect();
      const mid = rect.top + rect.height * 0.5;
      const offset = (mid - center) * d.depth;
      d.tgt.y = offset;
      d.tgt.rot = clamp(offset * 0.02, -3, 3);
    }
  }

  function updateBallRig(dt) {
    const { track: trackEl, ball: ballEl } = ballRig;
    if (!trackEl || !ballEl) return;

    const MAX_TILT = 17;
    const speed = 0.00052;
    ballRig.phase += dt * speed;

    const t = Math.sin(ballRig.phase);
    const vel = Math.cos(ballRig.phase);
    const tgtBallX = t * ballRig.trackHalf;
    // Tilt ahead of the ball so the high edge catches it before it rolls off.
    const tgtTilt = -t * MAX_TILT * 0.62 - vel * MAX_TILT * 0.55;

    const rigSmooth = 1 - Math.pow(0.001, dt / 1000);
    const tiltSmooth = 1 - Math.pow(0.00001, dt / 1000);
    const prevBallX = ballRig.curBallX;
    ballRig.curBallX = lerp(ballRig.curBallX, tgtBallX, rigSmooth);
    ballRig.curTilt = lerp(ballRig.curTilt, tgtTilt, tiltSmooth);
    ballRig.curRoll += (ballRig.curBallX - prevBallX) * 0.55;

    trackEl.style.transform = `rotate(${ballRig.curTilt.toFixed(2)}deg)`;
    ballEl.style.transform =
      `translateX(${ballRig.curBallX.toFixed(2)}px) rotate(${ballRig.curRoll.toFixed(2)}deg)`;
  }

  function render(dt) {
    const smooth = 1 - Math.pow(0.001, dt / 1000);

    for (const layer of bgLayers) {
      layer.cur.y = lerp(layer.cur.y, layer.tgt.y, smooth);
      layer.cur.rotX = lerp(layer.cur.rotX, layer.tgt.rotX, smooth);
      layer.cur.rotY = lerp(layer.cur.rotY, layer.tgt.rotY, smooth);

      layer.el.style.transform =
        `translate3d(0, ${layer.cur.y}px, 0) rotateX(${layer.cur.rotX}deg) rotateY(${layer.cur.rotY}deg)`;
    }

    for (const d of depthEls) {
      d.cur.y = lerp(d.cur.y, d.tgt.y, smooth);
      d.cur.rot = lerp(d.cur.rot, d.tgt.rot, smooth);
      d.el.style.setProperty("--px-y", `${d.cur.y}px`);
      d.el.style.setProperty("--px-rot", `${d.cur.rot}deg`);
    }
  }

  // Filter attribute updates are the expensive part (they force the
  // browser to recompute the whole filter region) — update at a
  // capped rate instead of every single frame.
  function renderFilter(dt) {
    filterFrameSkip += dt;
    if (filterFrameSkip < 32) return; // ~30fps cap for the filter chain
    filterFrameSkip = 0;

    ambientClock += 0.004;
    const ambientFreq = 0.006 + Math.sin(ambientClock) * 0.002;
    turbulenceNode.setAttribute("baseFrequency", `${ambientFreq.toFixed(4)} ${(ambientFreq * 1.4).toFixed(4)}`);

    const warpScale = clamp(smoothVelocity * 0.12, 0, 34);
    displaceNode.setAttribute("scale", warpScale.toFixed(2));

    const aberration = clamp(1 + smoothVelocity * 0.09, 1, 22);
    offRNode.setAttribute("dx", (-aberration).toFixed(2));
    offBNode.setAttribute("dx", aberration.toFixed(2));
  }

  function frame(now) {
    if (!running) return;

    const dt = Math.min(now - lastTime, 48);
    lastTime = now;

    const sy = window.scrollY;
    const rawVelocity = Math.abs(sy - lastScrollY) / Math.max(dt, 1) * 16.6; // normalize to px/frame-ish
    lastScrollY = sy;
    velocity = rawVelocity;
    smoothVelocity = lerp(smoothVelocity, velocity, 0.15);

    updateTargets();
    updateBallRig(dt);
    render(dt);
    renderFilter(dt);

    rafId = requestAnimationFrame(frame);
  }

  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add("px-in");
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );

  document.querySelectorAll(".sec.px-reveal").forEach((el) => reveal.observe(el));

  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  });

  rafId = requestAnimationFrame(frame);
})();