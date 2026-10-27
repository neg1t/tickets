import { describe, expect, it, vi } from 'vitest';
import { WebGLResourceManager } from './resourceManager.js';

describe('WebGL resource manager', () => {
  it('replaces named buffers, updates ranges, and disposes every resource once', () => {
    const firstBuffer = {} as WebGLBuffer;
    const secondBuffer = {} as WebGLBuffer;
    const shader = {} as WebGLShader;
    const program = {} as WebGLProgram;
    const gl = {
      ARRAY_BUFFER: 34962,
      STATIC_DRAW: 35044,
      createBuffer: vi
        .fn()
        .mockReturnValueOnce(firstBuffer)
        .mockReturnValueOnce(secondBuffer),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      bufferSubData: vi.fn(),
      deleteBuffer: vi.fn(),
      deleteShader: vi.fn(),
      deleteProgram: vi.fn(),
    } as unknown as WebGL2RenderingContext;
    const resources = new WebGLResourceManager();

    resources.uploadBuffer(gl, 'positions', new Float32Array([1, 2]));
    resources.updateBuffer(gl, 'positions', 4, new Float32Array([2]));
    resources.uploadBuffer(gl, 'positions', new Float32Array([3, 4]));
    resources.trackShader(shader);
    resources.trackProgram(program);
    resources.dispose(gl);
    resources.dispose(gl);

    expect(gl.bufferSubData).toHaveBeenCalledWith(
      gl.ARRAY_BUFFER,
      4,
      new Float32Array([2]),
    );
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledWith(firstBuffer);
    expect(gl.deleteBuffer).toHaveBeenCalledWith(secondBuffer);
    expect(gl.deleteShader).toHaveBeenCalledWith(shader);
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
  });
});
