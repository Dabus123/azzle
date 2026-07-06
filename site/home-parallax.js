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

  // ---------------------------------------------------------------
  // Dot-grid glow canvas — dots brighten near pointer + scroll pulses
  // ---------------------------------------------------------------
  const dotCanvas = document.getElementById("px-dot-canvas");
  const GRID = 24;
  let dotCtx = null;
  let dotW = 0;
  let dotH = 0;
  let dotDpr = 1;
  let scrollGlowCenters = [];
  let dotFrameSkip = 0;

  function seedScrollGlows() {
    scrollGlowCenters = Array.from({ length: 5 }, (_, i) => ({
      x: (i + 1) / 6,
      y: Math.random(),
      phase: Math.random() * Math.PI * 2,
      radius: 140 + Math.random() * 90,
    }));
  }

  function resizeDotCanvas() {
    if (!dotCanvas) return;
    dotDpr = Math.min(window.devicePixelRatio || 1, 2);
    dotW = window.innerWidth;
    dotH = window.innerHeight;
    dotCanvas.width = Math.round(dotW * dotDpr);
    dotCanvas.height = Math.round(dotH * dotDpr);
    dotCanvas.style.width = `${dotW}px`;
    dotCanvas.style.height = `${dotH}px`;
    dotCtx = dotCanvas.getContext("2d");
    if (dotCtx) dotCtx.setTransform(dotDpr, 0, 0, dotDpr, 0, 0);
  }

  function renderDotGlow() {
    if (!dotCtx || !dotCanvas) return;

    dotCtx.clearRect(0, 0, dotW, dotH);

    const mx = pointerActive ? (pointerX * 0.5 + 0.5) * dotW : dotW * 0.5;
    const my = pointerActive ? (pointerY * 0.5 + 0.5) * dotH : dotH * 0.42;
    const pointerRadius = pointerActive ? 220 : 0;
    const scrollNorm = scrollProgress();
    const velBoost = clamp(smoothVelocity * 0.08, 0, 1.4);
    const parallaxY = scrollY * 0.06;
    const startCol = Math.floor(-GRID / 2);
    const endCol = Math.ceil((dotW + GRID) / GRID);
    const startRow = Math.floor((-parallaxY - GRID) / GRID);
    const endRow = Math.ceil((dotH - parallaxY + GRID) / GRID);

    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const x = col * GRID;
        const y = row * GRID + parallaxY;

        let glow = 0.05;

        if (pointerRadius > 0) {
          const dx = x - mx;
          const dy = y - my;
          const dist = Math.sqrt(dx * dx + dy * dy);
          glow += Math.max(0, 1 - dist / pointerRadius) * 0.62;
        } else {
          const idlePulse = 0.5 + 0.5 * Math.sin((x + y) * 0.04 + scrollNorm * 5);
          glow += idlePulse * 0.04;
        }

        for (const center of scrollGlowCenters) {
          const cx = center.x * dotW;
          const cy = ((center.y + scrollNorm * 0.85 + Math.sin(center.phase + scrollNorm * 6) * 0.06) % 1) * dotH;
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const pulse = 0.5 + 0.5 * Math.sin(center.phase + scrollNorm * 8);
          glow += Math.max(0, 1 - dist / center.radius) * (0.18 + velBoost * 0.22) * pulse;
        }

        const scrollWave = Math.sin((y + scrollY * 0.18) * 0.012 + scrollNorm * 4) * 0.5 + 0.5;
        glow += scrollWave * velBoost * 0.12;

        if (glow < 0.06) continue;

        const alpha = clamp(glow, 0, 0.92);
        const radius = 0.9 + alpha * 2.4;

        if (alpha > 0.28) {
          dotCtx.beginPath();
          dotCtx.arc(x, y, radius * 3.2, 0, Math.PI * 2);
          const halo = dotCtx.createRadialGradient(x, y, 0, x, y, radius * 3.2);
          halo.addColorStop(0, `rgba(220,255,40,${(alpha * 0.22).toFixed(3)})`);
          halo.addColorStop(0.45, `rgba(200,255,30,${(alpha * 0.08).toFixed(3)})`);
          halo.addColorStop(1, "rgba(200,255,30,0)");
          dotCtx.fillStyle = halo;
          dotCtx.fill();
        }

        dotCtx.beginPath();
        dotCtx.arc(x, y, radius, 0, Math.PI * 2);
        dotCtx.fillStyle = `rgba(235,255,120,${alpha.toFixed(3)})`;
        dotCtx.fill();
      }
    }
  }

  seedScrollGlows();
  resizeDotCanvas();
  window.addEventListener("resize", resizeDotCanvas, { passive: true });

  const ballRig = {
    track,
    ball,
    phase: Math.random() * Math.PI * 2,
    rollDir: 1,
    trackHalf: 0,
    curBallX: 0,
    curTilt: 0,
    curRoll: 0,
    ballVel: 0,
    smoothScrollNorm: 0,
    smoothStoryTilt: 0,
    smoothStoryBall: 0,
  };

  // Scroll narrative: tilt + ball position keyed to page depth (0 = top, 1 = bottom).
  const STORY_KEYFRAMES = [
    { p: 0, tilt: -7, ball: -0.48 },
    { p: 0.08, tilt: -2, ball: -0.12 },
    { p: 0.2, tilt: 4, ball: 0.18 },
    { p: 0.34, tilt: 11, ball: 0.48 },
    { p: 0.48, tilt: 17, ball: 0.72 },
    { p: 0.58, tilt: 14, ball: 0.58 },
    { p: 0.7, tilt: 3, ball: 0.1 },
    { p: 0.82, tilt: -9, ball: -0.42 },
    { p: 0.92, tilt: -14, ball: -0.68 },
    { p: 1, tilt: -8, ball: -0.38 },
  ];

  function smoothstep(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function sampleStory(norm) {
    const p = clamp(norm, 0, 1);
    let i = 0;
    while (i < STORY_KEYFRAMES.length - 2 && STORY_KEYFRAMES[i + 1].p < p) i += 1;
    const a = STORY_KEYFRAMES[i];
    const b = STORY_KEYFRAMES[i + 1];
    const span = Math.max(b.p - a.p, 0.0001);
    const t = smoothstep((p - a.p) / span);
    return {
      tilt: lerp(a.tilt, b.tilt, t),
      ball: lerp(a.ball, b.ball, t),
    };
  }

  function scrollProgress() {
    const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    return window.scrollY / maxScroll;
  }

  let lastScrollY = window.scrollY;
  let lastTime = performance.now();
  let velocity = 0;
  let smoothVelocity = 0;
  let smoothSignedVelocity = 0;
  let scrollY = window.scrollY;

  function measureBallRig() {
    if (!track || !ball) return;
    const trackW = track.offsetWidth;
    const ballW = ball.offsetWidth;
    ballRig.trackHalf = Math.max(24, trackW * 0.5 - ballW * 0.42);
  }

  measureBallRig();
  const bootStory = sampleStory(scrollProgress());
  ballRig.smoothScrollNorm = scrollProgress();
  ballRig.smoothStoryTilt = bootStory.tilt;
  ballRig.smoothStoryBall = bootStory.ball;
  ballRig.curTilt = bootStory.tilt;
  ballRig.curBallX = bootStory.ball * ballRig.trackHalf;
  window.addEventListener("resize", measureBallRig, { passive: true });

  const depthEls = [];

  document.querySelectorAll(".rd-head, .sec").forEach((el, i) => {
    if (el.id === "developer-docs") return;
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
      const depthFactor = 1 + layer.depthIndex * 0.6;
      const isBallRig = layer.el.classList.contains("px-ball-rig");
      layer.tgt.rotY = pointerActive ? pointerX * 6 * depthFactor : 0;
      layer.tgt.rotX = isBallRig
        ? 0
        : clamp(-smoothVelocity * 0.15 * depthFactor, -14, 14);
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

    const half = ballRig.trackHalf;
    const normSmooth = 1 - Math.pow(0.0012, dt / 1000);
    const motionSmooth = 1 - Math.pow(0.0025, dt / 1000);

    ballRig.smoothScrollNorm = lerp(ballRig.smoothScrollNorm, scrollProgress(), normSmooth);
    const story = sampleStory(ballRig.smoothScrollNorm);

    const velNudge = clamp(-smoothSignedVelocity * 0.055, -3.5, 3.5);
    const velBallNudge = clamp(-smoothSignedVelocity * 0.0011, -0.1, 0.1) * half;

    ballRig.smoothStoryTilt = lerp(ballRig.smoothStoryTilt, story.tilt, motionSmooth);
    ballRig.smoothStoryBall = lerp(ballRig.smoothStoryBall, story.ball, motionSmooth);

    const scrolling = Math.abs(smoothSignedVelocity) > 0.8;
    let ambientTilt = 0;
    let ambientBall = 0;
    if (!scrolling) {
      ballRig.phase += dt * 0.00042 * ballRig.rollDir;
      const t = Math.sin(ballRig.phase);
      const phaseVel = Math.cos(ballRig.phase) * ballRig.rollDir;
      ambientTilt = -t * 3.2 - phaseVel * 2.4;
      ambientBall = t * half * 0.1;
      if (Math.abs(t) > 0.985) ballRig.rollDir = t > 0 ? -1 : 1;
    }

    const tgtTilt = ballRig.smoothStoryTilt + velNudge + ambientTilt;
    const tgtBallX = ballRig.smoothStoryBall * half + velBallNudge + ambientBall;

    const prevBallX = ballRig.curBallX;
    ballRig.curTilt = lerp(ballRig.curTilt, tgtTilt, motionSmooth);
    ballRig.curBallX = lerp(ballRig.curBallX, clamp(tgtBallX, -half, half), motionSmooth);
    ballRig.ballVel = (ballRig.curBallX - prevBallX) / Math.max(dt, 1);
    ballRig.curRoll += ballRig.ballVel * dt * 0.5;

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
    const scrollDelta = sy - lastScrollY;
    const rawVelocity = Math.abs(scrollDelta) / Math.max(dt, 1) * 16.6; // normalize to px/frame-ish
    const rawSignedVelocity = scrollDelta / Math.max(dt, 1) * 16.6;
    lastScrollY = sy;
    scrollY = sy;
    velocity = rawVelocity;
    smoothVelocity = lerp(smoothVelocity, velocity, 0.12);
    smoothSignedVelocity = lerp(smoothSignedVelocity, rawSignedVelocity, 0.1);

    updateTargets();
    render(dt);
    updateBallRig(dt);
    renderFilter(dt);

    dotFrameSkip += dt;
    if (dotFrameSkip >= 24) {
      dotFrameSkip = 0;
      renderDotGlow();
    }

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