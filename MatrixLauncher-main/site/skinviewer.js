/* ============================================================
   MatrixL, 3D-просмотр скина (чистый WebGL, без библиотек).
   Рисует игрока по текстуре скина 64×64 / 64×32 (в том числе HD):
   основной и внешний (второй) слой, тонкие и обычные руки, плащ.
   Вращение мышью или пальцем, колесо меняет масштаб, двойной клик сбрасывает вид.
   SkinViewer.create(canvas, view) вернёт null, если WebGL недоступен.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- матрицы 4×4 (по столбцам) ---------- */
  const M = {
    id() { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
      return o;
    },
    persp(fov, asp, n, f) {
      const t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
      return o;
    },
    move(x, y, z) { const o = M.id(); o[12] = x; o[13] = y; o[14] = z; return o; },
    rotX(a) { const o = M.id(), c = Math.cos(a), s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; },
    rotY(a) { const o = M.id(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; },
    apply(m, p) {
      return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
    }
  };

  /* ---------- геометрия: коробка с раскладкой текстуры как в Minecraft ---------- */
  const SHADE = { front: 0.92, back: 0.86, side: 0.74, top: 1.0, bottom: 0.55 };

  /* Добавляет в массив вершины (x, y, z, u, v, свет) коробки.
     b: { size:[w,h,d], center:[x,y,z], expand, uv:[u,v], mirror, tw, th, xf } */
  function addBox(out, b) {
    const [w, h, d] = b.size, e = b.expand || 0;
    const hx = w / 2 + e, hy = h / 2 + e, hz = d / 2 + e;
    const [u, v] = b.uv;
    const rect = {
      front: [u + d, v + d, w, h], back: [u + d + w + d, v + d, w, h],
      right: [u, v + d, d, h], left: [u + d + w, v + d, d, h],
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d]
    };
    if (b.mirror) { const t = rect.right; rect.right = rect.left; rect.left = t; }
    const faces = [
      ['front', SHADE.front, [[-hx, hy, hz], [hx, hy, hz], [hx, -hy, hz], [-hx, -hy, hz]]],
      ['back', SHADE.back, [[hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, -hz], [hx, -hy, -hz]]],
      ['right', SHADE.side, [[-hx, hy, -hz], [-hx, hy, hz], [-hx, -hy, hz], [-hx, -hy, -hz]]],
      ['left', SHADE.side, [[hx, hy, hz], [hx, hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
      ['top', SHADE.top, [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]]],
      ['bottom', SHADE.bottom, [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]]]
    ];
    for (const [name, shade, c] of faces) {
      const [rx, ry, rw, rh] = rect[name];
      // углы текстуры: верх-лево, верх-право, низ-право, низ-лево (у зеркальной части слева направо наоборот)
      let t = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
      if (b.mirror) t = [t[1], t[0], t[3], t[2]];
      const P = c.map(p => {
        let q = [p[0], p[1], p[2]];
        if (b.xf) q = M.apply(b.xf, q);
        return [q[0] + b.center[0], q[1] + b.center[1], q[2] + b.center[2]];
      });
      const P2 = b.post ? P.map(p => M.apply(b.post, p)) : P;
      const vert = i => out.push(P2[i][0], P2[i][1], P2[i][2], t[i][0] / b.tw, t[i][1] / b.th, shade);
      [0, 3, 2, 0, 2, 1].forEach(vert);
    }
  }

  /* Вся фигура: [основа, внешний слой] */
  function buildPlayer(slim, legacy) {
    const base = [], over = [];
    const tw = 64, th = legacy ? 32 : 64;
    const aw = slim ? 3 : 4;
    const P = (target, size, center, uv, expand, mirror) => addBox(target, { size, center, uv, expand, mirror, tw, th });
    P(base, [8, 8, 8], [0, 28, 0], [0, 0]);
    P(over, [8, 8, 8], [0, 28, 0], [32, 0], 0.5);                         // шапка есть и у старых скинов
    P(base, [8, 12, 4], [0, 18, 0], [16, 16]);
    P(base, [aw, 12, 4], [-(4 + aw / 2), 18, 0], [40, 16]);
    P(base, [4, 12, 4], [-2, 6, 0], [0, 16]);
    if (legacy) {
      P(base, [aw, 12, 4], [4 + aw / 2, 18, 0], [40, 16], 0, true);       // левая рука и нога = зеркало правых
      P(base, [4, 12, 4], [2, 6, 0], [0, 16], 0, true);
    } else {
      P(base, [aw, 12, 4], [4 + aw / 2, 18, 0], [32, 48]);
      P(base, [4, 12, 4], [2, 6, 0], [16, 48]);
      P(over, [8, 12, 4], [0, 18, 0], [16, 32], 0.25);
      P(over, [aw, 12, 4], [-(4 + aw / 2), 18, 0], [40, 32], 0.25);
      P(over, [aw, 12, 4], [4 + aw / 2, 18, 0], [48, 48], 0.25);
      P(over, [4, 12, 4], [-2, 6, 0], [0, 32], 0.25);
      P(over, [4, 12, 4], [2, 6, 0], [0, 48], 0.25);
    }
    return { base, over };
  }

  /* Плащ: тонкая пластина на спине, нижний край чуть отведён назад */
  function buildCape() {
    const out = [];
    const flip = M.rotY(Math.PI);
    const post = M.mul(M.move(0, 24, -2), M.mul(M.rotX(0.16), M.move(0, 0, 0)));
    addBox(out, { size: [10, 16, 1], center: [0, -8, -0.5], uv: [0, 0], tw: 64, th: 32, xf: flip, post });
    return out;
  }

  /* ---------- WebGL ---------- */
  const VS = 'attribute vec3 a_p;attribute vec2 a_t;attribute float a_s;uniform mat4 u_m;varying vec2 v_t;varying float v_s;void main(){v_t=a_t;v_s=a_s;gl_Position=u_m*vec4(a_p,1.0);}';
  const FS = 'precision mediump float;varying vec2 v_t;varying float v_s;uniform sampler2D u_x;uniform float u_cut;void main(){vec4 c=texture2D(u_x,v_t);if(c.a<u_cut)discard;gl_FragColor=vec4(c.rgb*v_s,1.0);}';

  function create(canvas, view) {
    let gl = null;
    try { gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false }) || canvas.getContext('experimental-webgl'); } catch (e) { gl = null; }
    if (!gl) return null;

    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader'); return s; };
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    } catch (e) { return null; }
    gl.useProgram(prog);
    const loc = { p: gl.getAttribLocation(prog, 'a_p'), t: gl.getAttribLocation(prog, 'a_t'), s: gl.getAttribLocation(prog, 'a_s'), m: gl.getUniformLocation(prog, 'u_m'), cut: gl.getUniformLocation(prog, 'u_cut'), x: gl.getUniformLocation(prog, 'u_x') };
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    const v = view || {};
    const cam = { yaw: v.yaw != null ? v.yaw : 0.55, pitch: v.pitch != null ? v.pitch : 0.14, dist: v.dist || 74 };
    const DEF = { yaw: 0.55, pitch: 0.14, dist: 74 };
    let skinTex = null, capeTex = null, meshes = [], dead = false, dragging = false, lastX = 0, lastY = 0, idleAt = performance.now();
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    function tex(img) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function mesh(data, texture, cut) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return { buf, n: data.length / 6, texture, cut };
    }
    function free() {
      meshes.forEach(m => gl.deleteBuffer(m.buf)); meshes = [];
      if (skinTex) gl.deleteTexture(skinTex); if (capeTex) gl.deleteTexture(capeTex);
      skinTex = capeTex = null;
    }

    function update({ skin, cape, slim }) {
      if (dead || !skin) return;
      free();
      const legacy = skin.height < skin.width;
      skinTex = tex(skin);
      const pl = buildPlayer(!!slim && !legacy, legacy);
      meshes.push(mesh(pl.base, skinTex, 0.1), mesh(pl.over, skinTex, 0.5));
      if (cape) { capeTex = tex(cape); meshes.push(mesh(buildCape(), capeTex, 0.1)); }
    }

    function frame(now) {
      if (dead) return;
      if (!canvas.isConnected) { destroy(); return; }
      requestAnimationFrame(frame);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (!dragging && !reduce && now - idleAt > 2500) cam.yaw += 0.006;   // медленно крутится, пока с ним не работают
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const proj = M.persp(30 * Math.PI / 180, w / h, 1, 400);
      const mv = M.mul(M.move(0, 0, -cam.dist), M.mul(M.rotX(cam.pitch), M.mul(M.rotY(cam.yaw), M.move(0, -16, 0))));
      gl.uniformMatrix4fv(loc.m, false, M.mul(proj, mv));
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(loc.x, 0);
      for (const m of meshes) {
        gl.bindTexture(gl.TEXTURE_2D, m.texture);
        gl.uniform1f(loc.cut, m.cut);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
        gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(loc.t); gl.vertexAttribPointer(loc.t, 2, gl.FLOAT, false, 24, 12);
        gl.enableVertexAttribArray(loc.s); gl.vertexAttribPointer(loc.s, 1, gl.FLOAT, false, 24, 20);
        gl.drawArrays(gl.TRIANGLES, 0, m.n);
      }
    }

    /* ---------- управление ---------- */
    const touch = () => { idleAt = performance.now(); };
    const down = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; touch(); try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* не критично */ } canvas.classList.add('grab'); };
    const move = e => {
      if (!dragging) return;
      cam.yaw += (e.clientX - lastX) * 0.012;
      cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + (e.clientY - lastY) * 0.01));
      lastX = e.clientX; lastY = e.clientY; touch();
    };
    const up = () => { dragging = false; touch(); canvas.classList.remove('grab'); };
    const wheel = e => { e.preventDefault(); cam.dist = Math.max(42, Math.min(120, cam.dist * Math.exp(e.deltaY * 0.0012))); touch(); };
    const reset = () => { Object.assign(cam, DEF); touch(); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', reset);
    canvas.style.touchAction = 'none';

    function destroy() {
      if (dead) return;
      dead = true; free();
      try { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* не критично */ }
    }
    requestAnimationFrame(frame);
    return { update, destroy, view: () => ({ yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist }), _cam: cam };
  }

  window.SkinViewer = { create };
})();
