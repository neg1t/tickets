export class WebGLResourceManager {
  private readonly buffers = new Map<string, WebGLBuffer>();
  private readonly shaders = new Set<WebGLShader>();
  private readonly programs = new Set<WebGLProgram>();

  uploadBuffer(
    gl: WebGL2RenderingContext,
    key: string,
    data: Float32Array | Uint8Array,
    usage: number = gl.STATIC_DRAW,
  ): WebGLBuffer {
    const previous = this.buffers.get(key);
    if (previous) gl.deleteBuffer(previous);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error(`Unable to allocate WebGL buffer: ${key}`);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    this.buffers.set(key, buffer);
    return buffer;
  }

  updateBuffer(
    gl: WebGL2RenderingContext,
    key: string,
    byteOffset: number,
    data: Float32Array | Uint8Array,
  ): void {
    const buffer = this.buffers.get(key);
    if (!buffer) throw new Error(`Unknown WebGL buffer: ${key}`);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, data);
  }

  buffer(key: string): WebGLBuffer | null {
    return this.buffers.get(key) ?? null;
  }

  trackShader(shader: WebGLShader): WebGLShader {
    this.shaders.add(shader);
    return shader;
  }

  trackProgram(program: WebGLProgram): WebGLProgram {
    this.programs.add(program);
    return program;
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (const buffer of this.buffers.values()) gl.deleteBuffer(buffer);
    for (const shader of this.shaders) gl.deleteShader(shader);
    for (const program of this.programs) gl.deleteProgram(program);
    this.buffers.clear();
    this.shaders.clear();
    this.programs.clear();
  }
}
