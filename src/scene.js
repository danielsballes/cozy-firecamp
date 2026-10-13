// 3D campfire scene: forest, starry sky, 10 seats, projection screen and characters.
// Everything is geometry generated in code (there are no models to download).
//
// WARNING: do not share a material between plain meshes and instanced meshes;
// in this version of three that breaks rendering. That is why vmat, imat and icmat exist.
import * as THREE from 'three';

export const MAX = 10;
export const PALETTE = ['#ff7a45', '#35b6a8', '#f3c95a', '#6f9ad6', '#d9739a', '#86c06c', '#a98bd6', '#c8ccd6', '#4fc0e8', '#b9d14a'];
/** Angle of each seat seen from above (0 = facing the screen). */
export function seatAngle(i) { return (-110 + i * (220 / 9)) * Math.PI / 180; }

export function createScene(canvas, app, callbacks) {
  callbacks = callbacks || {};
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });

  /* ---------- helpers ---------- */
  var PI = Math.PI;
  function C(h) { return new THREE.Color(h).convertSRGBToLinear(); }
  function xf(px, py, pz, rx, ry, rz, s) {
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    var sc = s === undefined ? new THREE.Vector3(1, 1, 1) : (typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s[0], s[1], s[2]));
    return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, sc);
  }
  /* Merges several pieces into one geometry with per-vertex color: one piece = one draw call. */
  function merge(parts) {
    var gs = [], n = 0, i, k;
    for (i = 0; i < parts.length; i++) {
      var g = parts[i].g.index ? parts[i].g.toNonIndexed() : parts[i].g.clone();
      if (parts[i].m) g.applyMatrix4(parts[i].m);
      n += g.attributes.position.count; gs.push(g);
    }
    var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), o = 0;
    for (i = 0; i < gs.length; i++) {
      var cnt = gs[i].attributes.position.count, c = C(parts[i].c === undefined ? 0xffffff : parts[i].c);
      pos.set(gs[i].attributes.position.array, o * 3);
      nor.set(gs[i].attributes.normal.array, o * 3);
      for (k = 0; k < cnt; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
      o += cnt; gs[i].dispose(); parts[i].g.dispose();
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }
  function flat(o) {
    var base = { flatShading: true, shininess: 0, specular: 0x000000 };
    for (var k in o) base[k] = o[k];
    return new THREE.MeshPhongMaterial(base);
  }
  var seed = 20261009;
  function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ss(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

  /* ---------- base scene ---------- */
  renderer.outputEncoding = THREE.sRGBEncoding;
  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(C(0x0d1730), 0.018);
  var camera = new THREE.PerspectiveCamera(55, 1, 0.3, 600);
  var vmat = flat({ vertexColors: true });   /* plain meshes */
  var imat = flat({ vertexColors: true });   /* instanced meshes */
  var icmat = flat({ vertexColors: true });  /* instanced with their own color */

  scene.add(new THREE.HemisphereLight(C(0x4a61a8), C(0x0a0f14), 1.2));
  var moonLight = new THREE.DirectionalLight(C(0x9db4ff), 0.8);
  moonLight.position.set(-40, 50, -30); scene.add(moonLight);
  var fireLight = new THREE.PointLight(C(0xffb070), 2.0, 40, 1.5);
  fireLight.position.set(0, 1.15, 0); scene.add(fireLight);

  /* Sky: gradient + stars that twinkle in the shader */
  var sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x02030a) }, mid: { value: new THREE.Color(0x0a1330) }, hor: { value: new THREE.Color(0x1d3060) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 hor; void main(){ float h = normalize(vP).y; vec3 c = mix(hor, mid, smoothstep(0.0, 0.3, h)); c = mix(c, top, smoothstep(0.22, 0.95, h)); c = mix(vec3(0.051,0.09,0.188), c, smoothstep(-0.03, 0.01, h)); gl_FragColor = vec4(c, 1.0); }'
  }));
  scene.add(sky);

  var starMat;
  (function () {
    var N1 = 1500, N2 = 1400, N = N1 + N2;
    var p = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N);
    var band = new THREE.Vector3(0.554, 0.831, -0.042).normalize();
    var u = new THREE.Vector3(1, 0, 0).cross(band).normalize(), w = band.clone().cross(u).normalize();
    var v = new THREE.Vector3(), i = 0, tries = 0;
    while (i < N && tries < N * 20) {
      tries++;
      if (i < N1) {
        var a = rnd() * PI * 2, y = rnd();
        var r0 = Math.sqrt(1 - y * y); v.set(Math.cos(a) * r0, y, Math.sin(a) * r0);
      } else {
        var b = rnd() * PI * 2, off = (rnd() + rnd() + rnd() - 1.5) * 0.16;
        v.copy(u).multiplyScalar(Math.cos(b)).addScaledVector(w, Math.sin(b)).addScaledVector(band, off).normalize();
        if (v.y < 0.03) continue;
      }
      var fade = ss(0.02, 0.3, v.y), big = i < N1, m = (big ? rr(0.45, 1) : rr(0.2, 0.5)) * fade;
      var warm = rnd();
      p[i * 3] = v.x * 330; p[i * 3 + 1] = v.y * 330; p[i * 3 + 2] = v.z * 330;
      col[i * 3] = m * (warm > 0.82 ? 1 : 0.82); col[i * 3 + 1] = m * 0.9; col[i * 3 + 2] = m * (warm > 0.82 ? 0.75 : 1);
      sz[i] = big ? (rnd() > 0.94 ? rr(3.2, 4.6) : rr(1.4, 2.8)) : rr(1, 1.7);
      ph[i] = rnd() * 10; i++;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
      vertexShader: 'attribute vec3 aColor; attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uPx; varying vec3 vC; varying float vA; void main(){ vC = aColor; vA = 0.7 + 0.3*sin(uTime*(0.5 + fract(aPhase)*1.9) + aPhase*6.2831); gl_PointSize = aSize*uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.08, d) * vA; gl_FragColor = vec4(vC, a); }'
    });
    var stars = new THREE.Points(g, starMat); stars.frustumCulled = false; scene.add(stars);
  })();

  /* Glow texture reused by the fire, moon, lanterns and bulbs */
  var glowTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(255,255,255,.5)');
    g.addColorStop(0.55, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  function glow(color, scale, opacity) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: opacity, fog: false }));
    s.scale.set(scale, scale, 1); return s;
  }

  /* Moon */
  (function () {
    var d = new THREE.Vector3(-0.57, 0.36, -0.74).normalize().multiplyScalar(340);
    var m = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 1), new THREE.MeshBasicMaterial({ color: C(0xe9edff), fog: false }));
    m.position.copy(d); scene.add(m);
    var gl = glow(0x8fa8ff, 110, 0.5); gl.position.copy(d); scene.add(gl);
  })();

  /* Background mountains: unlit silhouettes */
  (function () {
    var parts = [], n = 18;
    for (var i = 0; i < n; i++) {
      var a = i / n * PI * 2 + rr(-0.1, 0.1), r = rr(150, 185), h = rr(12, 30), w = rr(46, 80);
      parts.push({ g: new THREE.ConeGeometry(w, h, 5, 1, true), m: xf(Math.sin(a) * r, h / 2 - 3, Math.cos(a) * r, 0, rnd() * 3, 0), c: 0xffffff });
    }
    var m = new THREE.Mesh(merge(parts), new THREE.MeshBasicMaterial({ color: C(0x0a122a), fog: false }));
    scene.add(m);
  })();

  /* Terrain */
  function hgt(x, z) {
    var r = Math.hypot(x, z), k = ss(10, 28, r);
    return k * (Math.sin(x * 0.09 + 1.3) * Math.cos(z * 0.075) * 1.6 + Math.sin(x * 0.21 + z * 0.17) * 0.6 + (r - 10) * 0.035);
  }
  (function () {
    var g = new THREE.PlaneGeometry(300, 300, 56, 56); g.rotateX(-PI / 2);
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) { p.setY(i, hgt(p.getX(i), p.getZ(i))); }
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, flat({ color: C(0x2f5a3c) })));
    var gravel = new THREE.Mesh(new THREE.CircleGeometry(7.6, 30), flat({ color: C(0x7d776b) }));
    gravel.rotation.x = -PI / 2; gravel.position.y = 0.03; scene.add(gravel);
    var parts = [], n = 30;
    for (i = 0; i < n; i++) {
      var a = i / n * PI * 2, tone = [0x8f8a80, 0x7d786f, 0x9b958a][i % 3];
      parts.push({ g: box(1.45, 0.2, 0.55), m: xf(Math.sin(a) * 7.8, 0.09, Math.cos(a) * 7.8, 0, a, 0), c: tone });
    }
    scene.add(new THREE.Mesh(merge(parts), vmat));
  })();

  /* Campfire: stone ring, logs, flames, sparks */
  var flames = [], embers, fireGlow;
  (function () {
    var parts = [], n = 12, i;
    for (var row = 0; row < 2; row++) {
      for (i = 0; i < n; i++) {
        var a = (i + row * 0.5) / n * PI * 2, tone = [0x8b7f72, 0x776c61, 0x9a8d7e, 0x6b6158][(i + row) % 4];
        parts.push({ g: box(0.56, 0.24, 0.32), m: xf(Math.sin(a) * 1.08, 0.12 + row * 0.25, Math.cos(a) * 1.08, 0, a, 0), c: tone });
      }
    }
    var ash = new THREE.CircleGeometry(0.95, 10); ash.rotateX(-PI / 2);
    parts.push({ g: ash, m: xf(0, 0.06, 0), c: 0x1a1512 });
    for (i = 0; i < 5; i++) {
      var b = i / 5 * PI * 2;
      parts.push({ g: new THREE.CylinderGeometry(0.085, 0.1, 1.25, 5), m: xf(Math.sin(b) * 0.3, 0.5, Math.cos(b) * 0.3, 0.72, b, 0), c: 0x3b2416 });
    }
    scene.add(new THREE.Mesh(merge(parts), vmat));

    var defs = [[0, 0, 0.44, 1.55, 0xff4d14], [0.24, 0.1, 0.3, 1.1, 0xff6a1c], [-0.22, 0.14, 0.3, 1.25, 0xff5a18], [0.04, -0.24, 0.28, 1.0, 0xff7d24], [0, 0, 0.28, 1.2, 0xffa838], [0.03, 0.02, 0.16, 0.85, 0xffe39a]];
    for (i = 0; i < defs.length; i++) {
      var d = defs[i], g = new THREE.ConeGeometry(d[2], d[3], 5); g.translate(0, d[3] / 2, 0);
      var f = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: C(d[4]), fog: false }));
      f.position.set(d[0], 0.3, d[1]); scene.add(f); flames.push(f);
    }
    fireGlow = glow(0xff7a2a, 5, 0.36); fireGlow.position.set(0, 1.2, 0); scene.add(fireGlow);

    var N = 40, ep = new Float32Array(N * 3), eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: glowTex, color: C(0xffa040), size: 0.16, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    embers.frustumCulled = false; embers.userData.ph = [];
    for (i = 0; i < N; i++) embers.userData.ph.push([rnd() * 4, rnd() * PI * 2, rr(0.5, 1.2), rr(0.1, 0.5)]);
    scene.add(embers);
  })();

  /* Seats: 10 chairs in an arc, open towards the screen */
  var seats = [];
  (function () {
    for (var i = 0; i < MAX; i++) {
      var th = seatAngle(i), R = 5;
      var g = new THREE.Group(); g.position.set(Math.sin(th) * R, 0.03, Math.cos(th) * R); g.rotation.y = th + PI;
      scene.add(g); seats.push({ th: th, g: g });
    }
    var W = 0x35415a, parts = [
      { g: box(0.64, 0.05, 0.62), m: xf(0, 0.37, 0.02, -0.16, 0, 0), c: W },
      { g: box(0.13, 0.04, 0.74), m: xf(0.39, 0.58, 0.03), c: W }, { g: box(0.13, 0.04, 0.74), m: xf(-0.39, 0.58, 0.03), c: W },
      { g: box(0.09, 0.58, 0.09), m: xf(0.36, 0.29, 0.33), c: W }, { g: box(0.09, 0.58, 0.09), m: xf(-0.36, 0.29, 0.33), c: W },
      { g: box(0.09, 0.5, 0.09), m: xf(0.36, 0.22, -0.3, 0.25, 0, 0), c: W }, { g: box(0.09, 0.5, 0.09), m: xf(-0.36, 0.22, -0.3, 0.25, 0, 0), c: W },
      { g: box(0.38, 0.26, 0.1), m: xf(0, 0.56, -0.34, -0.32, 0, 0), c: 0xd9d2c0 }
    ];
    var slats = [[-0.22, 0.86], [0, 1.0], [0.22, 0.86]];
    for (var s = 0; s < 3; s++) {
      var m = xf(slats[s][0], 0.33, -0.3, -0.32, 0, 0).multiply(xf(0, slats[s][1] / 2, 0));
      parts.push({ g: box(0.2, slats[s][1], 0.045), m: m, c: W });
    }
    var chairs = new THREE.InstancedMesh(merge(parts), imat, MAX);
    for (i = 0; i < MAX; i++) { seats[i].g.updateMatrix(); chairs.setMatrixAt(i, seats[i].g.matrix); }
    chairs.frustumCulled = false; scene.add(chairs);

    /* Barrels as side tables, with a mug on top */
    var bp = [
      { g: new THREE.CylinderGeometry(0.3, 0.26, 0.56, 8), m: xf(0, 0.28, 0), c: 0x6b4226 },
      { g: new THREE.CylinderGeometry(0.315, 0.315, 0.05, 8), m: xf(0, 0.14, 0), c: 0x2b2420 },
      { g: new THREE.CylinderGeometry(0.315, 0.315, 0.05, 8), m: xf(0, 0.44, 0), c: 0x2b2420 },
      { g: new THREE.CylinderGeometry(0.06, 0.05, 0.11, 6), m: xf(0.08, 0.62, 0.05), c: 0xe8dcc6 }
    ];
    var idx = [0.5, 2.5, 6.5, 8.5], barrels = new THREE.InstancedMesh(merge(bp), imat, idx.length);
    for (i = 0; i < idx.length; i++) {
      var t2 = seatAngle(idx[i]);
      barrels.setMatrixAt(i, xf(Math.sin(t2) * 5.5, 0.03, Math.cos(t2) * 5.5, 0, t2, 0));
    }
    barrels.frustumCulled = false; scene.add(barrels);
  })();

  /* Texture for a <video>. It is refreshed by hand in the loop (about 15 times per second):
     the call's <video> elements are not on screen, so the browser doesn't report each new frame. */
  function videoTexture(el) {
    var t = new THREE.Texture(el);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.format = THREE.RGBFormat; t.encoding = THREE.sRGBEncoding;
    return t;
  }
  var VIDEO_REFRESH = 0.066;

  /* Projection screen for screen sharing */
  var FONT = '"Instrument Sans", system-ui, sans-serif';
  var scr = { canvas: document.createElement('canvas'), video: null, vtex: null, plane: null, a: 0, vt: 0 };
  (function () {
    scr.canvas.width = 1024; scr.canvas.height = 576; scr.ctx = scr.canvas.getContext('2d');
    scr.tex = new THREE.CanvasTexture(scr.canvas); scr.tex.encoding = THREE.sRGBEncoding;
    var z = -9.2, F = 0x1a1f2b, parts = [
      { g: box(0.1, 5.0, 0.1), m: xf(-3.4, 2.5, z), c: F }, { g: box(0.1, 5.0, 0.1), m: xf(3.4, 2.5, z), c: F },
      { g: box(6.9, 0.1, 0.1), m: xf(0, 4.95, z), c: F }, { g: box(6.9, 0.1, 0.1), m: xf(0, 1.05, z), c: F },
      { g: box(6.6, 3.8, 0.05), m: xf(0, 3.0, z - 0.04), c: 0x0c0f18 },
      { g: box(0.1, 0.1, 1.4), m: xf(-3.4, 0.06, z), c: F }, { g: box(0.1, 0.1, 1.4), m: xf(3.4, 0.06, z), c: F }
    ];
    scene.add(new THREE.Mesh(merge(parts), vmat));
    scr.plane = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.6), new THREE.MeshBasicMaterial({ map: scr.tex }));
    scr.plane.position.set(0, 3.0, z); scene.add(scr.plane);
  })();
  function drawEmptyScreen() {
    var x = scr.ctx, W = 1024, H = 576;
    x.fillStyle = '#0f1420'; x.fillRect(0, 0, W, H);
    x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillStyle = '#8791a8'; x.font = '600 40px ' + FONT;
    x.fillText('Nobody is sharing their screen', W / 2, H / 2 - 20);
    x.font = '400 26px ' + FONT; x.fillStyle = '#5d6780';
    x.fillText('Whatever someone shares is projected here', W / 2, H / 2 + 34);
    scr.tex.needsUpdate = true;
  }
  /* Projects a <video> on the screen, or leaves it empty if null is passed. */
  function setScreen(el) {
    el = el || null;
    if (el === scr.video) return;
    if (scr.vtex) { scr.vtex.dispose(); scr.vtex = null; }
    scr.video = el; scr.a = 0; scr.vt = 0;
    if (el) {
      scr.vtex = videoTexture(el);
      scr.plane.material.map = scr.vtex;
    } else {
      scr.plane.material.map = scr.tex; scr.plane.scale.set(1, 1, 1);
    }
    scr.plane.material.needsUpdate = true;
  }

  /* Lanterns, poles with a string of lights */
  (function () {
    var K = 0x14161c, lp = [
      { g: box(0.3, 0.04, 0.3), m: xf(0, 0.02, 0), c: K }, { g: box(0.3, 0.04, 0.3), m: xf(0, 0.6, 0), c: K },
      { g: box(0.035, 0.58, 0.035), m: xf(0.13, 0.31, 0.13), c: K }, { g: box(0.035, 0.58, 0.035), m: xf(-0.13, 0.31, 0.13), c: K },
      { g: box(0.035, 0.58, 0.035), m: xf(0.13, 0.31, -0.13), c: K }, { g: box(0.035, 0.58, 0.035), m: xf(-0.13, 0.31, -0.13), c: K },
      { g: new THREE.ConeGeometry(0.2, 0.14, 4), m: xf(0, 0.69, 0, 0, PI / 4, 0), c: K }
    ];
    var where = [[-1.5, 6.3, 0.95], [-0.85, 6.75, 1.25], [2.2, 6.1, 1.0], [-6.2, -3.6, 1.1], [6.3, -3.2, 1.0]];
    var fr = new THREE.InstancedMesh(merge(lp), imat, where.length);
    var core = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 6), new THREE.MeshBasicMaterial({ color: C(0xffe2a8), fog: false }), where.length);
    var gp = new Float32Array(where.length * 3);
    for (var i = 0; i < where.length; i++) {
      var w = where[i]; fr.setMatrixAt(i, xf(w[0], 0.03, w[1], 0, i * 0.7, 0, w[2])); core.setMatrixAt(i, xf(w[0], 0.03 + 0.24 * w[2], w[1], 0, 0, 0, w[2]));
      gp[i * 3] = w[0]; gp[i * 3 + 1] = 0.3 * w[2]; gp[i * 3 + 2] = w[1];
    }
    fr.frustumCulled = false; core.frustumCulled = false; scene.add(fr); scene.add(core);
    var gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    var halos = new THREE.Points(gg, new THREE.PointsMaterial({ map: glowTex, color: C(0xffb45a), size: 1.9, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halos.frustumCulled = false; scene.add(halos);

    var poles = [[-9.5, -2.5], [-5.6, -11], [5.6, -11], [9.5, -2.5]], pp = [], bulbs = [], wire = [];
    for (i = 0; i < poles.length; i++) pp.push({ g: box(0.12, 5.4, 0.12), m: xf(poles[i][0], 2.7, poles[i][1]), c: 0x3a2a1c });
    scene.add(new THREE.Mesh(merge(pp), vmat));
    for (i = 0; i < poles.length - 1; i++) {
      var a = poles[i], b = poles[i + 1], prev = null;
      for (var k = 0; k <= 14; k++) {
        var u = k / 14, x = a[0] + (b[0] - a[0]) * u, zz = a[1] + (b[1] - a[1]) * u, y = 5.3 - 1.0 * (1 - Math.pow(2 * u - 1, 2));
        if (prev) { wire.push(prev[0], prev[1], prev[2], x, y, zz); }
        prev = [x, y, zz];
        if (k > 0 && k < 14) bulbs.push(x, y - 0.07, zz);
      }
    }
    var wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wire), 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: C(0x1a1612) })));
    var bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bulbs), 3));
    var bl = new THREE.Points(bg, new THREE.PointsMaterial({ map: glowTex, color: C(0xffd596), size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    bl.frustumCulled = false; scene.add(bl);
  })();

  /* Forest: instanced pines and round trees, rocks and bushes in the clearing */
  (function () {
    var pine = merge([
      { g: new THREE.CylinderGeometry(0.16, 0.26, 1.8, 5, 1, true), m: xf(0, 0.9, 0), c: 0x4a3222 },
      { g: new THREE.ConeGeometry(1.75, 2.7, 6, 1, true), m: xf(0, 2.6, 0), c: 0x1f4d3a },
      { g: new THREE.ConeGeometry(1.35, 2.4, 6, 1, true), m: xf(0, 4.0, 0, 0, 0.5, 0), c: 0x275c41 },
      { g: new THREE.ConeGeometry(0.92, 2.1, 6, 1, true), m: xf(0, 5.3, 0, 0, 1.0, 0), c: 0x2f6b49 }
    ]);
    var NP = 150, pines = new THREE.InstancedMesh(pine, icmat, NP), col = new THREE.Color(), i, a, r, x, z, s;
    for (i = 0; i < NP; i++) {
      a = rnd() * PI * 2; r = 19 + 62 * Math.pow(rnd(), 1.5); x = Math.sin(a) * r; z = Math.cos(a) * r; s = rr(0.85, 1.6);
      pines.setMatrixAt(i, xf(x, hgt(x, z) - 0.25, z, 0, rnd() * 6, 0, [s, s * rr(0.9, 1.2), s]));
      var v = rr(0.72, 1.12); col.setRGB(v, v, v * rr(0.9, 1.1)); pines.setColorAt(i, col);
    }
    pines.frustumCulled = false; scene.add(pines);

    var round = merge([
      { g: new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5, 1, true), m: xf(0, 1.1, 0), c: 0x4a3222 },
      { g: new THREE.IcosahedronGeometry(1.7, 0), m: xf(0, 3.3, 0), c: 0x2a5a3a },
      { g: new THREE.IcosahedronGeometry(1.15, 0), m: xf(0.7, 4.4, 0.3, 0.4, 0.9, 0), c: 0x346b44 }
    ]);
    var NR = 30, rounds = new THREE.InstancedMesh(round, imat, NR);
    for (i = 0; i < NR; i++) {
      a = rnd() * PI * 2; r = 19 + 34 * rnd(); x = Math.sin(a) * r; z = Math.cos(a) * r; s = rr(0.9, 1.6);
      rounds.setMatrixAt(i, xf(x, hgt(x, z) - 0.25, z, 0, rnd() * 6, 0, s));
    }
    rounds.frustumCulled = false; scene.add(rounds);

    var NK = 16, rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), flat({ color: C(0x6f7480) }), NK);
    for (i = 0; i < NK; i++) {
      a = rnd() * PI * 2; r = rr(8.8, 17); x = Math.sin(a) * r; z = Math.cos(a) * r; s = rr(0.5, 1.5);
      rocks.setMatrixAt(i, xf(x, hgt(x, z) + 0.08 * s, z, rnd() * 3, rnd() * 3, 0, [s, s * 0.65, s * 0.9]));
    }
    rocks.frustumCulled = false; scene.add(rocks);

    var NB = 14, bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0), flat({ color: C(0x2d5d3c) }), NB);
    for (i = 0; i < NB; i++) {
      a = rnd() * PI * 2; r = rr(9.2, 17.5); x = Math.sin(a) * r; z = Math.cos(a) * r; s = rr(0.6, 1.3);
      bushes.setMatrixAt(i, xf(x, hgt(x, z) + 0.3 * s, z, 0, rnd() * 6, 0, [s, s * 0.8, s]));
    }
    bushes.frustumCulled = false; scene.add(bushes);
  })();

  /* Fireflies and shooting star */
  var flies, shoot;
  (function () {
    var N = 26, p = new Float32Array(N * 3), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    flies = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, color: C(0xd9ff8f), size: 0.28, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    flies.frustumCulled = false; flies.userData.b = [];
    for (var i = 0; i < N; i++) { var a = rnd() * PI * 2, r = rr(8.5, 20); flies.userData.b.push([Math.sin(a) * r, rr(0.6, 2.6), Math.cos(a) * r, rnd() * 10]); }
    scene.add(flies);
    var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    shoot = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    shoot.frustumCulled = false; shoot.userData = { t: -1, next: 6, a: new THREE.Vector3(), d: new THREE.Vector3() };
    scene.add(shoot);
  })();

  /* ---------- characters: full body; the head is a monitor with the video (camera on)
     or a head with a beanie that moves its mouth when talking (camera off) ---------- */
  var CREAM = 0xf1dcc0, DENIM = 0x3a4668, SHOE = 0x22252e;
  var charMat = flat({ vertexColors: true });
  var inkMat = new THREE.MeshBasicMaterial({ color: C(0x1c1512) });
  var barMat = new THREE.MeshBasicMaterial({ color: C(0xffd27a), fog: false });
  var barGeo = box(0.05, 0.2, 0.05);
  var monitorGeo = merge([
    { g: new THREE.CylinderGeometry(0.05, 0.07, 0.16, 6), m: xf(0, 0.07, 0), c: 0x6f7480 },
    { g: box(0.66, 0.52, 0.36), m: xf(0, 0.4, 0), c: 0xcfc7b6 },
    { g: box(0.42, 0.34, 0.16), m: xf(0, 0.4, -0.25), c: 0xaaa291 },
    { g: box(0.58, 0.44, 0.02), m: xf(0, 0.4, 0.175), c: 0x15171d },
    { g: box(0.04, 0.03, 0.02), m: xf(0.27, 0.165, 0.182), c: 0x58b98a }
  ]);
  var MONITOR_ASPECT = 0.54 / 0.405;
  var screenGeo = new THREE.PlaneGeometry(0.54, 0.405);
  var eyesGeo = merge([{ g: box(0.05, 0.065, 0.02), m: xf(0.085, 0, 0) }, { g: box(0.05, 0.065, 0.02), m: xf(-0.085, 0, 0) }]);
  var mouthGeo = box(0.13, 0.028, 0.02);
  var noSignal = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 4;
    var x = c.getContext('2d'); x.fillStyle = '#141b2d'; x.fillRect(0, 0, 4, 4);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  })();
  var chars = new Array(MAX).fill(null);
  var clock = 0, mode = 'overview', mySeat = -1;

  function shade(hex, k) { var c = new THREE.Color(hex); c.multiplyScalar(k); return c.getHex(); }
  function buildBody(col) {
    var parts = [
      { g: box(0.46, 0.2, 0.34), m: xf(0, 0.5, -0.08), c: DENIM },
      { g: new THREE.CylinderGeometry(0.24, 0.27, 0.58, 6), m: xf(0, 0.86, -0.14, -0.16, 0, 0, [1, 1, 0.78]), c: col },
      { g: box(0.32, 0.1, 0.2), m: xf(0, 1.15, -0.25, -0.3, 0, 0), c: shade(col, 0.8) }
    ];
    for (var k = -1; k <= 1; k += 2) {
      parts.push({ g: box(0.12, 0.36, 0.14), m: xf(k * 0.32, 0.89, -0.1, -0.3, 0, 0), c: col });
      parts.push({ g: box(0.11, 0.11, 0.36), m: xf(k * 0.37, 0.67, 0.08), c: col });
      parts.push({ g: box(0.11, 0.08, 0.12), m: xf(k * 0.37, 0.665, 0.3), c: CREAM });
      parts.push({ g: box(0.17, 0.15, 0.5), m: xf(k * 0.125, 0.5, 0.2), c: DENIM });
      parts.push({ g: box(0.14, 0.46, 0.14), m: xf(k * 0.125, 0.27, 0.44), c: DENIM });
      parts.push({ g: box(0.15, 0.09, 0.27), m: xf(k * 0.125, 0.05, 0.5), c: SHOE });
    }
    return merge(parts);
  }
  function buildFace(col) {
    return merge([
      { g: new THREE.CylinderGeometry(0.075, 0.085, 0.14, 6), m: xf(0, 0.06, 0), c: CREAM },
      { g: box(0.36, 0.38, 0.34), m: xf(0, 0.3, 0), c: CREAM },
      { g: box(0.04, 0.1, 0.08), m: xf(0.2, 0.29, 0), c: CREAM }, { g: box(0.04, 0.1, 0.08), m: xf(-0.2, 0.29, 0), c: CREAM },
      { g: box(0.06, 0.07, 0.05), m: xf(0, 0.27, 0.19), c: 0xe3c7a6 },
      { g: box(0.4, 0.16, 0.38), m: xf(0, 0.51, 0), c: col },
      { g: box(0.42, 0.07, 0.4), m: xf(0, 0.44, 0), c: shade(col, 0.75) },
      { g: new THREE.IcosahedronGeometry(0.075, 0), m: xf(0, 0.64, 0), c: shade(col, 0.75) }
    ]);
  }
  function addChar(s, o) {
    var seat = seats[s], col = PALETTE[s];
    var tcv = document.createElement('canvas'); tcv.width = 256; tcv.height = 64;
    var ttex = new THREE.CanvasTexture(tcv); ttex.encoding = THREE.sRGBEncoding;
    var bodyGeo = buildBody(col), faceGeo = buildFace(col);
    var grp = new THREE.Group();
    grp.add(new THREE.Mesh(bodyGeo, charMat));
    var head = new THREE.Group(); head.position.set(0, 1.24, -0.19); head.rotation.order = 'YXZ'; grp.add(head);

    var mon = new THREE.Group(); mon.add(new THREE.Mesh(monitorGeo, charMat));
    var scMat = new THREE.MeshBasicMaterial({ map: noSignal, fog: false });
    var sc = new THREE.Mesh(screenGeo, scMat); sc.position.set(0, 0.4, 0.192); mon.add(sc); head.add(mon);

    var face = new THREE.Group(); face.add(new THREE.Mesh(faceGeo, charMat));
    var eyes = new THREE.Mesh(eyesGeo, inkMat); eyes.position.set(0, 0.33, 0.176); face.add(eyes);
    var mouth = new THREE.Mesh(mouthGeo, inkMat); mouth.position.set(0, 0.175, 0.176); face.add(mouth); head.add(face);

    var bars = new THREE.Group(), bl = [];
    for (var b = 0; b < 3; b++) { var bm = new THREE.Mesh(barGeo, barMat); bm.position.x = (b - 1) * 0.1; bars.add(bm); bl.push(bm); }
    bars.position.set(0, 2.44, -0.19); bars.visible = false; grp.add(bars);

    var tagMat = new THREE.SpriteMaterial({ map: ttex, transparent: true, depthWrite: false, fog: false });
    var tag = new THREE.Sprite(tagMat); tag.scale.set(1.0, 0.25, 1); tag.position.set(0, 2.14, -0.19); grp.add(tag);

    grp.traverse(function (n) { n.frustumCulled = false; });
    grp.scale.setScalar(0.01); seat.g.add(grp);
    mon.visible = false; face.visible = true;
    chars[s] = {
      id: o.id, p: o, seat: s, col: col, group: grp, head: head, mon: mon, face: face, eyes: eyes, mouth: mouth, bars: bars, bl: bl, tag: tag,
      scMat: scMat, video: null, vtex: null, va: 0, vt: 0, tctx: tcv.getContext('2d'), ttex: ttex, own: [ttex, scMat, tagMat, bodyGeo, faceGeo],
      born: clock, blink: clock + rr(1.5, 4), blinking: false, sig: '', yaw: 0, pitch: 0, mS: 0, fS: 1
    };
  }
  function removeChar(s) {
    var ch = chars[s]; if (!ch) return;
    seats[s].g.remove(ch.group);
    if (ch.vtex) ch.vtex.dispose();
    for (var i = 0; i < ch.own.length; i++) ch.own[i].dispose();
    chars[s] = null;
  }
  /* Connects (or removes) the camera video on the character's monitor. */
  function setVideo(ch, el) {
    el = el || null;
    if (ch.video === el) return;
    if (ch.vtex) { ch.vtex.dispose(); ch.vtex = null; }
    ch.video = el; ch.va = 0; ch.vt = 0;
    if (el) { ch.vtex = videoTexture(el); ch.scMat.map = ch.vtex; }
    else ch.scMat.map = noSignal;
    ch.scMat.needsUpdate = true;
  }
  /* Crops the texture so the video fills the frame without stretching. */
  function fitTexture(tex, a, target) {
    if (a > target) { tex.repeat.set(target / a, 1); tex.offset.set((1 - target / a) / 2, 0); }
    else { tex.repeat.set(1, a / target); tex.offset.set(0, (1 - a / target) / 2); }
  }
  /* Name tag above the head */
  function drawTag(ch) {
    var x = ch.tctx, W = 256, H = 64, p = ch.p, r = 26;
    x.clearRect(0, 0, W, H);
    x.font = '600 28px ' + FONT; x.textAlign = 'center'; x.textBaseline = 'middle';
    var label = p.name + (p.isMe ? ' (you)' : ''), room = p.mic ? 212 : 172;
    while (label.length > 3 && x.measureText(label).width > room) label = label.slice(0, -2) + '…';
    var w = Math.min(W - 4, x.measureText(label).width + 40 + (p.mic ? 0 : 40)), x0 = (W - w) / 2;
    x.fillStyle = 'rgba(4,7,14,.78)';
    x.beginPath(); x.moveTo(x0 + r, 6); x.lineTo(x0 + w - r, 6); x.arc(x0 + w - r, 32, r, -PI / 2, PI / 2); x.lineTo(x0 + r, 58); x.arc(x0 + r, 32, r, PI / 2, PI * 1.5); x.fill();
    x.fillStyle = '#f4e8d2'; x.fillText(label, W / 2 - (p.mic ? 0 : 18), 33);
    if (!p.mic) {
      var cx = x0 + w - 28;
      x.fillStyle = '#ff6b5e'; x.beginPath(); x.arc(cx, 32, 15, 0, PI * 2); x.fill();
      x.strokeStyle = '#0d1220'; x.lineWidth = 3; x.lineCap = 'round';
      x.beginPath(); x.moveTo(cx, 23); x.lineTo(cx, 35); x.moveTo(cx - 8, 41); x.lineTo(cx + 8, 22); x.stroke();
    }
    ch.ttex.needsUpdate = true;
  }

  /* Receives the list of people already assigned to seats:
     [{ id, name, seat, isMe, mic, speaking, video }]  (video = camera <video> or null) */
  function setPeople(list) {
    var bySeat = new Array(MAX).fill(null), i;
    mySeat = -1;
    for (i = 0; i < list.length; i++) {
      var q = list[i];
      if (q.seat >= 0 && q.seat < MAX && !bySeat[q.seat]) { bySeat[q.seat] = q; if (q.isMe) mySeat = q.seat; }
    }
    if (mySeat < 0) mode = 'overview';
    for (i = 0; i < MAX; i++) {
      var ch = chars[i], w = bySeat[i];
      if (ch && (!w || ch.id !== w.id)) { removeChar(i); ch = null; }
      if (w && !ch) addChar(i, w);
      else if (w) ch.p = w;
      if (chars[i]) {
        var sig = w.name + '|' + w.mic + '|' + !!w.isMe;
        if (sig !== chars[i].sig) { chars[i].sig = sig; drawTag(chars[i]); }
        setVideo(chars[i], w.video);
        chars[i].group.visible = !(w.isMe && mode === 'seat');
      }
    }
  }

  /* ---------- camera: orbit with the mouse and view from the seat ---------- */
  var cam = { az: 0.46, pol: 1.5, rad: 13.2, yaw: 0, pitch: 0, fov: 55 };
  var camPos = new THREE.Vector3(), camLook = new THREE.Vector3(0, 2.6, -1.2), tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
  var ORBIT = new THREE.Vector3(0, 2.6, -1.2), touched = false, pointers = new Map(), pinch = 0, first = true;
  function baseFov() { return camera.aspect < 0.8 ? 70 : (camera.aspect < 1.2 ? 62 : 55); }
  function rotate(dx, dy) {
    if (mode === 'seat') { cam.yaw += dx * 0.004; cam.pitch = clamp(cam.pitch - dy * 0.003, -0.75, 0.5); }
    else { cam.az -= dx * 0.006; cam.pol = clamp(cam.pol - dy * 0.005, 0.6, 1.62); }
  }
  function zoom(d) {
    if (mode === 'seat') cam.fov = clamp(cam.fov + d * 4, 35, 82);
    else cam.rad = clamp(cam.rad + d, 5.5, 14.5);
  }
  function pdist() { var a = Array.from(pointers.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
  canvas.addEventListener('pointerdown', function (e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* no capture */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); touched = true; canvas.classList.add('drag');
    if (pointers.size === 2) pinch = pdist();
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = pointers.get(e.pointerId); if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) rotate(dx, dy);
    else if (pointers.size === 2) { var d = pdist(); zoom((pinch - d) * 0.03); pinch = d; }
  });
  function pup(e) { pointers.delete(e.pointerId); if (!pointers.size) canvas.classList.remove('drag'); }
  canvas.addEventListener('pointerup', pup); canvas.addEventListener('pointercancel', pup);
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); touched = true; zoom(clamp(e.deltaY, -120, 120) * 0.012); }, { passive: false });
  canvas.addEventListener('keydown', function (e) {
    var k = e.key, used = true;
    if (k === 'ArrowLeft') rotate(40, 0); else if (k === 'ArrowRight') rotate(-40, 0);
    else if (k === 'ArrowUp') rotate(0, 30); else if (k === 'ArrowDown') rotate(0, -30);
    else if (k === '+' || k === '=') zoom(-1); else if (k === '-') zoom(1); else used = false;
    if (used) { e.preventDefault(); touched = true; }
  });
  function updateCamera(dt) {
    var wantFov;
    if (mode === 'seat' && mySeat >= 0) {
      var s = seats[mySeat], yaw = s.g.rotation.y + cam.yaw, cp = Math.cos(cam.pitch);
      tPos.set(s.g.position.x, 1.62, s.g.position.z);
      tLook.set(tPos.x + Math.sin(yaw) * cp * 4, tPos.y - Math.sin(cam.pitch) * 4, tPos.z + Math.cos(yaw) * cp * 4);
      wantFov = cam.fov;
    } else {
      if (!touched && mySeat < 0 && !reduceMotion) cam.az += dt * 0.035;
      var sp = Math.sin(cam.pol);
      tPos.set(ORBIT.x + cam.rad * sp * Math.sin(cam.az), ORBIT.y + cam.rad * Math.cos(cam.pol), ORBIT.z + cam.rad * sp * Math.cos(cam.az));
      tLook.copy(ORBIT);
      wantFov = baseFov();
    }
    var k = (first || reduceMotion) ? 1 : 1 - Math.exp(-dt * 7); first = false;
    camPos.lerp(tPos, k); camLook.lerp(tLook, k);
    camera.position.copy(camPos); camera.lookAt(camLook);
    if (Math.abs(camera.fov - wantFov) > 0.05) { camera.fov += (wantFov - camera.fov) * k; camera.updateProjectionMatrix(); }
  }
  /* Switches between 'overview' and 'seat'. Returns the resulting view. */
  function setView(m) {
    mode = (m === 'seat' && mySeat >= 0) ? 'seat' : 'overview';
    if (mode === 'seat') { cam.yaw = 0; cam.pitch = -0.02; cam.fov = baseFov() + 12; }
    for (var i = 0; i < MAX; i++) if (chars[i]) chars[i].group.visible = !(chars[i].p.isMe && mode === 'seat');
    return mode;
  }

  /* ---------- loop ---------- */
  var eco = false;
  function resize() {
    var w = app.clientWidth || 1, h = app.clientHeight || 1, pr = Math.min(window.devicePixelRatio || 1, eco ? 1 : 1.5);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.fov = mode === 'seat' ? cam.fov : baseFov(); camera.updateProjectionMatrix();
    starMat.uniforms.uPx.value = pr * clamp(h / 760, 0.8, 1.4);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(app); else window.addEventListener('resize', resize);
  resize();
  function setSaver(v) { eco = !!v; resize(); }

  var fpsN = 0, fpsT = 0, lastT = 0, lastDraw = 0, tmp = new THREE.Vector3(), failed = false;
  function tick(now) {
    requestAnimationFrame(tick);
    if (document.hidden) { lastT = now; return; }
    if (eco && now - lastDraw < 32) return;
    var dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now; lastDraw = now; clock += dt;
    var t = clock, i;

    for (i = 0; i < flames.length; i++) {
      var f = flames[i], sy = 1 + 0.2 * Math.sin(t * 7 + i * 1.7) + 0.1 * Math.sin(t * 13.3 + i * 4.1);
      f.scale.set(1 + 0.08 * Math.sin(t * 9 + i), sy, 1 + 0.08 * Math.cos(t * 8 + i * 2));
      f.rotation.y = t * (0.5 + i * 0.22); f.rotation.z = 0.09 * Math.sin(t * 5 + i * 2.3);
    }
    var fl = 0.3 * Math.sin(t * 11) + 0.22 * Math.sin(t * 23.7 + 1) + 0.14 * Math.sin(t * 5.3);
    fireLight.intensity = 2.0 + fl; fireLight.position.x = 0.06 * Math.sin(t * 9); fireLight.position.z = 0.06 * Math.cos(t * 7);
    fireGlow.material.opacity = 0.34 + fl * 0.1;

    var ep = embers.geometry.attributes.position, ph = embers.userData.ph;
    for (i = 0; i < ph.length; i++) {
      var y = (t * ph[i][2] + ph[i][0]) % 4, a = ph[i][1] + y * 1.3;
      ep.setXYZ(i, Math.sin(a) * (ph[i][3] + y * 0.12), 0.6 + y, Math.cos(a) * (ph[i][3] + y * 0.12));
    }
    ep.needsUpdate = true;

    var fp = flies.geometry.attributes.position, fb = flies.userData.b;
    for (i = 0; i < fb.length; i++) {
      var q = fb[i];
      fp.setXYZ(i, q[0] + Math.sin(t * 0.4 + q[3]) * 1.2, q[1] + Math.sin(t * 0.7 + q[3] * 2) * 0.5, q[2] + Math.cos(t * 0.33 + q[3]) * 1.2);
    }
    fp.needsUpdate = true;
    flies.material.opacity = 0.55 + 0.35 * Math.sin(t * 1.7);
    starMat.uniforms.uTime.value = t;

    var sd = shoot.userData;
    if (sd.t < 0 && t > sd.next && !reduceMotion) {
      var sa = rnd() * PI * 2; sd.a.set(Math.sin(sa) * 220, rr(150, 230), Math.cos(sa) * 220);
      sd.d.set(rr(-1, 1), rr(-0.5, -0.2), rr(-1, 1)).normalize(); sd.t = 0;
    }
    if (sd.t >= 0) {
      sd.t += dt; var u = sd.t / 0.9, sp2 = shoot.geometry.attributes.position;
      tmp.copy(sd.a).addScaledVector(sd.d, u * 110); sp2.setXYZ(0, tmp.x, tmp.y, tmp.z);
      tmp.addScaledVector(sd.d, -26 * Math.sin(u * PI)); sp2.setXYZ(1, tmp.x, tmp.y, tmp.z);
      sp2.needsUpdate = true; shoot.material.opacity = Math.sin(clamp(u, 0, 1) * PI) * 0.9;
      if (u >= 1) { sd.t = -1; sd.next = t + rr(9, 20); shoot.material.opacity = 0; }
    }

    updateCamera(dt);

    /* the screen adapts to the shape of the shared screen */
    if (scr.video && scr.video.readyState >= 2 && scr.video.videoWidth) {
      var sa2 = scr.video.videoWidth / scr.video.videoHeight;
      if (sa2 !== scr.a) { scr.a = sa2; scr.plane.scale.set(Math.min(1, sa2 / (16 / 9)), Math.min(1, (16 / 9) / sa2), 1); }
      if (t - scr.vt >= VIDEO_REFRESH) { scr.vt = t; scr.vtex.needsUpdate = true; }
    }

    var spSeat = -1; for (i = 0; i < MAX; i++) if (spSeat < 0 && chars[i] && chars[i].p.speaking && chars[i].p.mic) spSeat = i;
    var k4 = reduceMotion ? 1 : 1 - Math.exp(-dt * 5), k10 = reduceMotion ? 1 : 1 - Math.exp(-dt * 10);
    for (i = 0; i < MAX; i++) {
      var ch = chars[i]; if (!ch) continue;
      var p = ch.p, age = t - ch.born, e = reduceMotion ? 1 : clamp(age / 0.6, 0, 1), c1 = 1.70158, c3 = c1 + 1;
      ch.group.scale.setScalar(Math.max(0.01, 1 + c3 * Math.pow(e - 1, 3) + c1 * Math.pow(e - 1, 2)));
      var hasVideo = !!ch.video, talk = !!(p.speaking && p.mic);
      if (!ch.blinking && t > ch.blink) { ch.blinking = true; ch.blink = t + 0.13; }
      else if (ch.blinking && t > ch.blink) { ch.blinking = false; ch.blink = t + rr(2, 5.5); }
      if (hasVideo && ch.video.readyState >= 2 && ch.video.videoWidth) {
        var va = ch.video.videoWidth / ch.video.videoHeight;
        if (va !== ch.va) { ch.va = va; fitTexture(ch.vtex, va, MONITOR_ASPECT); }
        if (t - ch.vt >= VIDEO_REFRESH) { ch.vt = t; ch.vtex.needsUpdate = true; }
      }

      /* switch between monitor and head */
      ch.mS += ((hasVideo ? 1 : 0) - ch.mS) * k10; ch.fS += ((hasVideo ? 0 : 1) - ch.fS) * k10;
      ch.mon.visible = ch.mS > 0.03; ch.mon.scale.setScalar(Math.max(ch.mS, 0.001));
      ch.face.visible = ch.fS > 0.03; ch.face.scale.setScalar(Math.max(ch.fS, 0.001));

      /* head gestures when talking */
      ch.eyes.scale.y = ch.blinking ? 0.15 : 1;
      ch.mouth.scale.set(talk ? 0.8 + 0.2 * Math.sin(t * 7 + i) : 1, talk ? 1 + 3 * Math.abs(Math.sin(t * 11 + i)) : 1, 1);
      ch.bars.visible = talk;
      if (talk) for (var b = 0; b < 3; b++) ch.bl[b].scale.y = 0.35 + Math.abs(Math.sin(t * (9 + b * 2.3) + b * 1.7 + i));

      /* the monitor turns towards the viewer; the head looks at whoever is talking */
      var sg = seats[i].g.position, rotY = seats[i].g.rotation.y, wantY = 0, wantX = 0;
      if (hasVideo) {
        var dx = camera.position.x - sg.x, dz = camera.position.z - sg.z;
        wantY = Math.atan2(dx, dz) - rotY;
        wantX = -clamp(Math.atan2(camera.position.y - 1.64, Math.hypot(dx, dz)), -0.3, 0.5);
      } else {
        if (spSeat >= 0 && spSeat !== i) {
          var tg = seats[spSeat].g.position, d = Math.atan2(tg.x - sg.x, tg.z - sg.z) - rotY;
          wantY = clamp(Math.atan2(Math.sin(d), Math.cos(d)), -1.1, 1.1);
        }
        wantX = talk ? 0.07 * Math.sin(t * 6.5) : 0;
      }
      var dyaw = Math.atan2(Math.sin(wantY - ch.yaw), Math.cos(wantY - ch.yaw));
      ch.yaw += dyaw * k4; ch.pitch += (wantX - ch.pitch) * k4;
      ch.head.rotation.y = ch.yaw + (hasVideo ? 0 : 0.05 * Math.sin(t * 0.8 + i));
      ch.head.rotation.x = ch.pitch;
      ch.head.position.y = 1.24 + (talk && !hasVideo ? 0.015 * Math.abs(Math.sin(t * 6.5)) : 0);
    }

    try { renderer.render(scene, camera); }
    catch (err) {
      if (!failed) { failed = true; if (callbacks.onError) callbacks.onError(err && err.message ? err.message : String(err)); }
      return;
    }

    fpsN++; fpsT += dt;
    if (fpsT >= 0.6) {
      var info = renderer.info.render;
      if (callbacks.onStats) callbacks.onStats(info.triangles.toLocaleString('en-US') + ' triangles · ' + info.calls + ' draw calls · ' + Math.round(fpsN / fpsT) + ' fps');
      fpsN = 0; fpsT = 0;
    }
  }
  drawEmptyScreen();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
    drawEmptyScreen();
    for (var i = 0; i < MAX; i++) if (chars[i]) drawTag(chars[i]);
  });
  requestAnimationFrame(tick);

  return { setPeople: setPeople, setScreen: setScreen, setView: setView, setSaver: setSaver };
}
