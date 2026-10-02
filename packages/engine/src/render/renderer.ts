import type { Garment } from '../garment.ts';

const VS = `#version 300 es
in vec2 a_pos;   // camera pixels
in vec2 a_uv;
uniform vec2 u_size;
uniform float u_mirror;
out vec2 v_uv;
out vec2 v_cam;
void main() {
  v_uv = a_uv;
  v_cam = a_pos / u_size;
  vec2 clip = v_cam * 2.0 - 1.0;
  clip.x *= u_mirror;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const VIDEO_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_video;
out vec4 o;
void main() { o = vec4(texture(u_video, v_uv).rgb, 1.0); }`;

/**
 * Garment shading:
 *  - exposure: match the garment to the overall scene brightness (dim room → darker garment)
 *  - tint: pick up a little of the room's light colour (warm tube light etc.)
 *  - shade: transfer broad local light/shadow from the camera image onto the garment
 */
const GARMENT_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec2 v_cam;
uniform sampler2D u_tex;     // premultiplied alpha
uniform sampler2D u_video;   // mipmapped camera frame
uniform float u_opacity;
uniform float u_shade;
uniform float u_ambient;
out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 g = texture(u_tex, v_uv);
  if (g.a < 0.004) discard;
  vec3 scene = textureLod(u_video, vec2(0.5), 12.0).rgb;
  float S = max(luma(scene), 0.04);
  float near = luma(textureLod(u_video, v_cam, 4.0).rgb);
  float wide = max(luma(textureLod(u_video, v_cam, 7.0).rgb), 0.03);
  float shade = mix(1.0, clamp(near / wide, 0.75, 1.25), u_shade);
  float exposure = mix(1.0, clamp(S / 0.42, 0.5, 1.2), u_ambient);
  vec3 tint = mix(vec3(1.0), clamp(scene / S, vec3(0.8), vec3(1.25)), 0.3 * u_ambient);
  o = vec4(g.rgb * shade * exposure * tint, g.a) * u_opacity;
}`;

interface LayerGpu {
  vao: WebGLVertexArrayObject;
  pos: WebGLBuffer;
  tex: WebGLTexture;
  count: number;
}

export interface RenderOptions {
  mirror: boolean;
  /** Strength of local light transfer, 0..1. */
  shade: number;
  /** Strength of scene exposure/tint matching, 0..1. */
  ambient: number;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
    gl.attachShader(prog, sh);
  }
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.bindAttribLocation(prog, 1, 'a_uv');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  return prog;
}

/** WebGL2 renderer: camera frame + deformable garment meshes. */
export class Renderer {
  private gl: WebGL2RenderingContext;
  private videoProg!: WebGLProgram;
  private garmentProg!: WebGLProgram;
  private videoTex!: WebGLTexture;
  private quad!: { vao: WebGLVertexArrayObject; pos: WebGLBuffer };
  private layers = new Map<Garment, LayerGpu>();
  private width = 0;
  private height = 0;
  lost = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available on this device');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.layers.clear();
      this.setup();
      this.lost = false;
    });
    this.setup();
  }

  private setup(): void {
    const gl = this.gl;
    this.videoProg = compile(gl, VS, VIDEO_FS);
    this.garmentProg = compile(gl, VS, GARMENT_FS);
    this.videoTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pos = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, 8 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uv = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quad = { vao, pos };
    this.width = 0;
  }

  private upload(g: Garment): LayerGpu {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pos = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, g.positions.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uv = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.bufferData(gl.ARRAY_BUFFER, g.mesh.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    const idx = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, g.image);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const layer = { vao, pos, tex, count: g.mesh.indices.length };
    this.layers.set(g, layer);
    return layer;
  }

  /** Free GPU resources of garments no longer in use. */
  retain(active: readonly Garment[]): void {
    const gl = this.gl;
    for (const [g, l] of this.layers) {
      if (active.includes(g)) continue;
      gl.deleteVertexArray(l.vao);
      gl.deleteBuffer(l.pos);
      gl.deleteTexture(l.tex);
      this.layers.delete(g);
    }
  }

  /** Draw one frame. `garments` must be in draw order, already updated. */
  render(video: HTMLVideoElement, garments: readonly Garment[], opts: RenderOptions): void {
    if (this.lost) return;
    const gl = this.gl;
    const W = video.videoWidth;
    const H = video.videoHeight;
    if (!W || !H) return;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    if (this.width !== W || this.height !== H) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      this.width = W;
      this.height = H;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.pos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([0, 0, W, 0, 0, H, W, H]));
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    }
    gl.generateMipmap(gl.TEXTURE_2D);

    const mirror = opts.mirror ? -1 : 1;
    gl.disable(gl.BLEND);
    gl.useProgram(this.videoProg);
    gl.uniform2f(gl.getUniformLocation(this.videoProg, 'u_size'), W, H);
    gl.uniform1f(gl.getUniformLocation(this.videoProg, 'u_mirror'), mirror);
    gl.uniform1i(gl.getUniformLocation(this.videoProg, 'u_video'), 1);
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (garments.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const p = this.garmentProg;
      gl.useProgram(p);
      gl.uniform2f(gl.getUniformLocation(p, 'u_size'), W, H);
      gl.uniform1f(gl.getUniformLocation(p, 'u_mirror'), mirror);
      gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
      gl.uniform1i(gl.getUniformLocation(p, 'u_video'), 1);
      gl.uniform1f(gl.getUniformLocation(p, 'u_shade'), opts.shade);
      gl.uniform1f(gl.getUniformLocation(p, 'u_ambient'), opts.ambient);
      const uOpacity = gl.getUniformLocation(p, 'u_opacity');
      gl.activeTexture(gl.TEXTURE0);
      for (const g of garments) {
        const layer = this.layers.get(g) ?? this.upload(g);
        gl.uniform1f(uOpacity, g.spec.opacity ?? 1);
        gl.bindTexture(gl.TEXTURE_2D, layer.tex);
        gl.bindVertexArray(layer.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.pos);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.positions);
        gl.drawElements(gl.TRIANGLES, layer.count, gl.UNSIGNED_SHORT, 0);
      }
    }
    gl.bindVertexArray(null);
  }
}
