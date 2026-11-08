// Shared resource creation; drawing code keeps buffers/textures on the GPU.
export function createProgram(gl, vertexSource, fragmentSource, attributes) {
  const shaders = [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]].map(([type,source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader,source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {
      const detail = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
      throw new Error("Map graphics could not be prepared: "+detail);
    }
    return shader;
  });
  const program = gl.createProgram();
  shaders.forEach(shader => gl.attachShader(program,shader));
  attributes.forEach((name,index) => gl.bindAttribLocation(program,index,name));
  gl.linkProgram(program); shaders.forEach(shader => gl.deleteShader(shader));
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error("Map graphics could not be linked: "+detail);
  }
  return program;
}

export function uploadBuffer(gl, target, data) {
  const buffer = gl.createBuffer(); gl.bindBuffer(target,buffer); gl.bufferData(target,data,gl.STATIC_DRAW);
  return buffer;
}
