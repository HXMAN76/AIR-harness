/**
 * The voice orb: one sphere drawn by a WebGL fragment shader (ray-marched, simplex-noise surface, fresnel rim,
 * layered halo), with a Canvas 2D fallback. Exposes `window.createOrb`.
 *
 * Inputs: `setState('idle' | 'listening' | 'thinking' | 'speaking')`, `setInput(level, high)` (0..1, called
 * as often as the caller likes; the orb smooths it), `setPaused(bool)`. Colours and shape parameters
 * ease to each state's targets in about 300 ms.
 */
// @ts-check
(() => {
  /** Per-state targets. `*Level` terms scale with the smoothed input level, `highVib` with the high band. */
  const STATES = {
    idle: { color: [0.36, 0.43, 0.6], glow: 0.42, glowLevel: 0, amp: 0.022, ampLevel: 0, vib: 0, vibLevel: 0, highVib: 0, freq: 0.85, rot: 0.04, logo: 0.1 },
    listening: { color: [0.353, 0.706, 1.0], glow: 0.62, glowLevel: 0.4, amp: 0.025, ampLevel: 0.075, vib: 0.002, vibLevel: 0.016, highVib: 0, freq: 0.95, rot: 0.1, logo: 0.08 },
    thinking: { color: [0.545, 0.482, 1.0], glow: 0.68, glowLevel: 0, amp: 0.05, ampLevel: 0, vib: 0.006, vibLevel: 0, highVib: 0, freq: 1.25, rot: 0.85, logo: 0.08 },
    speaking: { color: [0.5, 0.93, 1.0], glow: 0.74, glowLevel: 0.36, amp: 0.03, ampLevel: 0.085, vib: 0.003, vibLevel: 0.022, highVib: 0.04, freq: 1.0, rot: 0.14, logo: 0.07 },
  }
  const NUMERIC = ['glow', 'glowLevel', 'amp', 'ampLevel', 'vib', 'vibLevel', 'highVib', 'freq', 'rot', 'logo']

  const VERTEX = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'

  const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uTime;
uniform float uRot;
uniform float uGlow;
uniform float uAmp;
uniform float uVib;
uniform float uFreq;
uniform float uBreath;
uniform float uLogo;
uniform vec3 uColor;
uniform sampler2D uLogoTex;

const vec3 BG = vec3(11.0, 13.0, 18.0) / 255.0;

vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT).
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Surface displacement along the unit direction d: a slow swirling field plus a faster vibration layer.
float disp(vec3 d) {
  float c = cos(uRot);
  float s = sin(uRot);
  d = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  float t = uTime * 0.22;
  float slow = snoise(d * uFreq + vec3(0.0, t, t * 0.6));
  float fast = snoise(d * (uFreq * 2.7) + vec3(t * 3.0, uTime * 1.7, 0.0));
  return uAmp * slow + uVib * fast;
}

float map(vec3 p) {
  float r = length(p);
  return r - (uBreath + disp(p / r));
}

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.004;
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 xy = (gl_FragCoord.xy - uRes * uCenter) / uRadius;
  float rr = length(xy);
  float edge = uBreath;

  // Layered radial halo: tight rim bloom, wide soft glow, faint ambient wash.
  float outside = max(rr - edge, 0.0);
  float halo = 0.34 * exp(-outside * 4.2) + 0.2 * exp(-outside * 1.6) + 0.06 * exp(-rr * 0.55);
  vec3 col = BG + uColor * halo * uGlow;

  float cover = 0.0;
  if (rr < 1.7) {
    vec3 ro = vec3(xy, -2.0);
    vec3 rd = vec3(0.0, 0.0, 1.0);
    float t = 0.0;
    float dmin = 1e3;
    vec3 pm = ro;
    for (int i = 0; i < 44; i++) {
      vec3 p = ro + rd * t;
      float d = map(p);
      if (d < dmin) { dmin = d; pm = p; }
      if (d < 0.001) break;
      t += max(d * 0.62, 0.006);
      if (t > 4.0) break;
    }
    float aa = 1.4 / uRadius;
    cover = clamp(1.0 - dmin / aa, 0.0, 1.0);
    if (cover > 0.0) {
      vec3 n = normalAt(pm);
      vec3 v = vec3(0.0, 0.0, -1.0);
      float ndv = clamp(dot(n, v), 0.0, 1.0);
      float fres = pow(1.0 - ndv, 2.6);
      vec3 ld = normalize(vec3(-0.45, 0.6, -0.65));
      float diff = clamp(dot(n, ld), 0.0, 1.0);
      float crest = clamp(0.5 + 0.5 * disp(normalize(pm)) / (uAmp + uVib + 0.02), 0.0, 1.0);

      vec3 body = uColor * (0.1 + 0.42 * diff + 0.22 * ndv) * (0.75 + 0.5 * crest);
      vec3 rim = mix(uColor, vec3(1.0), 0.35) * fres * 1.25;
      float spec = pow(clamp(dot(reflect(-ld, n), v), 0.0, 1.0), 38.0) * 0.55;
      vec3 sph = (body + rim) * uGlow + vec3(spec) * (0.6 + 0.4 * uGlow);

      // Faint triskelion decal with a soft emboss, riding the displaced surface.
      vec2 uv = vec2(pm.x, -pm.y) * 0.8 + 0.5;
      float m0 = texture2D(uLogoTex, uv).r;
      float m1 = texture2D(uLogoTex, uv + vec2(0.006, 0.01)).r;
      float face = smoothstep(0.25, 0.7, ndv);
      sph += (uColor * 0.5 + 0.5) * (m0 * uLogo + max(m0 - m1, 0.0) * uLogo * 1.6) * face;

      col = mix(col, sph, cover);
    }
  }

  col = vec3(1.0) - exp(-col * 1.55);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`

  /** Draw the logo outline into a small canvas used as a texture. */
  function logoCanvas() {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx === null) return canvas
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)
    ctx.filter = 'blur(1.2px)'
    ctx.fillStyle = '#fff'
    ctx.scale(size / 512, size / 512)
    for (const d of window.AIR_LOGO ?? []) ctx.fill(new Path2D(d), 'nonzero')
    return canvas
  }

  /** @param {WebGLRenderingContext} gl @param {number} type @param {string} source */
  function compile(gl, type, source) {
    const shader = gl.createShader(type)
    if (shader === null) throw new Error('createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(String(gl.getShaderInfoLog(shader)))
    return shader
  }

  /** WebGL backend; throws when the context or shader is unavailable. */
  function webglBackend(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    if (gl === null) throw new Error('no webgl')
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(String(gl.getProgramInfoLog(program)))
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, logoCanvas())
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const u = (name) => gl.getUniformLocation(program, name)
    const loc1 = { res: u('uRes'), center: u('uCenter'), radius: u('uRadius'), time: u('uTime'), rot: u('uRot'), glow: u('uGlow'), amp: u('uAmp'), vib: u('uVib'), freq: u('uFreq'), breath: u('uBreath'), logo: u('uLogo'), color: u('uColor') }
    gl.uniform1i(u('uLogoTex'), 0)
    let lost = false
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      lost = true
    })
    return {
      kind: 'webgl',
      /** @returns {boolean} false when the context was lost. */
      draw(f) {
        if (lost || gl.isContextLost()) return false
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.uniform2f(loc1.res, canvas.width, canvas.height)
        gl.uniform2f(loc1.center, 0.5, 1 - f.centerY)
        gl.uniform1f(loc1.radius, f.radius)
        gl.uniform1f(loc1.time, f.time)
        gl.uniform1f(loc1.rot, f.rot)
        gl.uniform1f(loc1.glow, f.glow)
        gl.uniform1f(loc1.amp, f.amp)
        gl.uniform1f(loc1.vib, f.vib)
        gl.uniform1f(loc1.freq, f.freq)
        gl.uniform1f(loc1.breath, f.breath)
        gl.uniform1f(loc1.logo, f.logo)
        gl.uniform3f(loc1.color, f.color[0], f.color[1], f.color[2])
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        return true
      },
    }
  }

  /** Canvas 2D fallback: radial gradients and a wobbling outline. */
  function canvas2dBackend(canvas) {
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('no 2d context')
    const rgb = (c, a) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`
    return {
      kind: '2d',
      draw(f) {
        const w = canvas.width
        const h = canvas.height
        const cx = w / 2
        const cy = f.centerY * h
        const r = f.radius * f.breath
        ctx.fillStyle = '#0b0d12'
        ctx.fillRect(0, 0, w, h)
        const halo = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2.6)
        halo.addColorStop(0, rgb(f.color, 0.4 * f.glow))
        halo.addColorStop(1, rgb(f.color, 0))
        ctx.fillStyle = halo
        ctx.fillRect(0, 0, w, h)
        ctx.beginPath()
        const steps = 72
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2
          const wobble = f.amp * Math.sin(a * 3 + f.time * 1.3 + f.rot) + f.vib * Math.sin(a * 9 - f.time * 6)
          const rr = r * (1 + wobble)
          const x = cx + Math.cos(a) * rr
          const y = cy + Math.sin(a) * rr
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.15)
        body.addColorStop(0, rgb(f.color, Math.min(1, 0.9 * f.glow + 0.2)))
        body.addColorStop(0.75, rgb(f.color, 0.35 * f.glow))
        body.addColorStop(1, rgb(f.color, 0.9 * f.glow))
        ctx.fillStyle = body
        ctx.fill()
        return true
      },
    }
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ reducedMotion?: boolean, forceFallback?: boolean }} [options]
   */
  function createOrb(canvas, options = {}) {
    const reduced = options.reducedMotion === true
    let backend
    try {
      if (options.forceFallback === true) throw new Error('fallback forced')
      backend = webglBackend(canvas)
    } catch (error) {
      console.warn('orb: WebGL unavailable, using Canvas 2D:', String(error))
      backend = canvas2dBackend(canvas)
    }

    let stateName = 'idle'
    const cur = { ...STATES.idle, color: [...STATES.idle.color] }
    let targetLevel = 0
    let targetHigh = 0
    let level = 0
    let high = 0
    let time = 0
    let rot = 0
    let last = 0
    let paused = false
    let raf = 0
    let frames = []

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    function frame(now) {
      raf = 0
      if (paused) return
      raf = requestAnimationFrame(frame)
      if (last !== 0) frames.push(now - last)
      const dt = Math.min(last === 0 ? 0.016 : (now - last) / 1000, 0.1)
      last = now
      resize()

      // Ease parameters toward the state's targets (about 300 ms to settle).
      const target = STATES[stateName]
      const k = 1 - Math.exp(-dt / 0.1)
      for (const key of NUMERIC) cur[key] += (target[key] - cur[key]) * k
      for (let i = 0; i < 3; i++) cur.color[i] += (target.color[i] - cur.color[i]) * k

      // Input level: quick attack, slow release.
      const live = stateName === 'idle' || stateName === 'thinking' ? 0 : targetLevel
      const liveHigh = stateName === 'speaking' ? targetHigh : 0
      level += (live - level) * (1 - Math.exp(-dt / (live > level ? 0.04 : 0.16)))
      high += (liveHigh - high) * (1 - Math.exp(-dt / (liveHigh > high ? 0.05 : 0.2)))

      const calm = reduced ? 0.45 : 1
      time += dt * (reduced ? 0.35 : 1)
      rot += dt * cur.rot * (reduced ? 0.3 : 1)
      const width = canvas.width
      const height = canvas.height
      backend.draw({
        centerY: 0.43,
        radius: Math.min(width * 0.3, height * 0.215),
        time,
        rot,
        glow: cur.glow + cur.glowLevel * level,
        amp: (cur.amp + cur.ampLevel * level) * calm,
        vib: (cur.vib + cur.vibLevel * level + cur.highVib * high) * calm,
        freq: cur.freq,
        breath: 1 + 0.03 * Math.sin(time * 1.15) * calm * (stateName === 'idle' ? 1 : 0.5),
        logo: cur.logo,
        color: cur.color,
      })
    }

    function start() {
      if (raf === 0 && !paused) raf = requestAnimationFrame(frame)
    }

    return {
      get kind() {
        return backend.kind
      },
      /** @param {'idle' | 'listening' | 'thinking' | 'speaking'} name */
      setState(name) {
        if (name in STATES) stateName = name
      },
      get state() {
        return stateName
      },
      /** @param {number} newLevel 0..1  @param {number} [newHigh] 0..1 */
      setInput(newLevel, newHigh = 0) {
        targetLevel = Math.min(1, Math.max(0, newLevel))
        targetHigh = Math.min(1, Math.max(0, newHigh))
      },
      setPaused(value) {
        paused = value
        if (paused) {
          if (raf !== 0) cancelAnimationFrame(raf)
          raf = 0
          last = 0
        } else start()
      },
      /** Frame-time statistics since the last call: average fps and the slowest frame. */
      takeStats() {
        const n = frames.length
        const sum = frames.reduce((a, b) => a + b, 0)
        const out = { frames: n, fps: n === 0 ? 0 : Math.round((1000 * n) / sum * 10) / 10, worstMs: n === 0 ? 0 : Math.round(Math.max(...frames) * 10) / 10, backend: backend.kind }
        frames = []
        return out
      },
      start,
    }
  }

  window.createOrb = createOrb
})()
