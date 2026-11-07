import { cameraBasis, terrainMesh, pickTerrain, latitudeAt, HEIGHT_SCALE } from "../terrainmath.js";
import { createProgram, uploadBuffer } from "./gl.js";
import { AreaLayer } from "./arealayer.js";

const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 camera;
uniform mediump float raised;
varying vec2 textureUV;
varying float light;
varying float heightValue;
void main() {
  gl_Position = camera * vec4(position.x, position.y * raised, position.z, 1.0);
  textureUV = uv;
  heightValue = position.y / ${HEIGHT_SCALE};
  light = mix(1.0, .76 + .24 * max(0.0, dot(normal, normalize(vec3(-.5,1.0,.7)))), raised);
}`;
const fragmentSource = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
uniform sampler2D surface;
uniform sampler2D matched;
uniform float contoursOn;
uniform float contourInterval;
uniform float pixelRatio;
varying vec2 textureUV;
varying float light;
varying float heightValue;
float contour(float interval, float width) {
  float level = heightValue / interval;
  float slope = fwidth(level);
  float distance = abs(fract(level + .5) - .5) / max(slope, .00001);
  // Fade lines that are too dense instead of blackening high peaks.
  float spacing = 1.0 / max(slope * pixelRatio, .00001);
  return (1.0 - smoothstep(max(0.0,width-.5)*pixelRatio,(width+.5)*pixelRatio,distance))
    * smoothstep(2.0,4.0,spacing) * step(.00001,slope);
}
void main() {
  vec4 colour = texture2D(surface, textureUV);
  if (colour.a < .5) discard;
  vec3 shaded = colour.rgb * light;
  float minor = contour(contourInterval,.45)*.62;
  float major = contour(contourInterval*5.0,.75)*.86;
  float lines = max(minor,major)*contoursOn*texture2D(matched,textureUV).a;
  float luminance = dot(shaded,vec3(.2126,.7152,.0722));
  float darkBlue = (colour.b > colour.r && luminance < .12) ? 1.0 : 0.0;
  vec3 ink = mix(vec3(.01,.025,.04),vec3(.5,.65,.8),darkBlue);
  gl_FragColor = vec4(mix(shaded,ink,lines),1.0);
}`;

export class TerrainRenderer {
  constructor(canvas, dem, textureSource, areas, {onUnavailable, onRestore}) {
    this.canvas = canvas;
    this.dem = dem;
    this.textureSource = textureSource;
    this.areas = areas;
    this.mesh = terrainMesh(dem);
    this.reset();
    this.gl = canvas.getContext("webgl", {alpha: false, antialias: true, powerPreference: "low-power"});
    if (!this.gl) throw new Error("Map graphics are unavailable in this browser.");
    canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); onUnavailable(); });
    canvas.addEventListener("webglcontextrestored", () => { this.initialise(); onRestore(); });
    this.initialise();
  }

  reset() { this.yaw = -.16; this.tilt = .85; }
  rotate(dx, dy) {
    this.yaw = (this.yaw - dx * .007) % (Math.PI * 2);
    this.tilt = Math.max(.18, Math.min(1.2, this.tilt + dy * .006));
  }

  initialise() {
    const gl = this.gl;
    if (!gl.getExtension("OES_standard_derivatives")) throw new Error("This browser cannot draw the map contours.");
    this.program = createProgram(gl,vertexSource,fragmentSource,["position","normal","uv"]);
    gl.useProgram(this.program);
    this.vertexBuffer = uploadBuffer(gl,gl.ARRAY_BUFFER,this.mesh.vertices);
    this.indexBuffer = uploadBuffer(gl,gl.ELEMENT_ARRAY_BUFFER,this.mesh.indices);
    this.cameraLocation = gl.getUniformLocation(this.program, "camera");
    this.raisedLocation = gl.getUniformLocation(this.program, "raised");
    this.contoursLocation = gl.getUniformLocation(this.program,"contoursOn");
    this.ratioLocation = gl.getUniformLocation(this.program, "pixelRatio");
    gl.uniform1f(gl.getUniformLocation(this.program,"contourInterval"),this.dem.contour_interval || 5);
    gl.uniform1i(gl.getUniformLocation(this.program, "surface"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "matched"), 1);
    // Upload only at creation/restoration, never when moving the camera.
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.textures = [this.textureSource.base, this.textureSource.terrain, this.textureSource.matched].map(source => {
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      let image = source;
      if (source.height > Math.min(3072, maxSize) || source.width > maxSize) {
        image = document.createElement("canvas");
        const ratio = Math.min(maxSize / source.width, Math.min(3072, maxSize) / source.height);
        image.width = Math.floor(source.width * ratio); image.height = Math.floor(source.height * ratio);
        image.getContext("2d").drawImage(source, 0, 0, image.width, image.height);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    });
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,this.textures[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(11/255,16/255,24/255,1);
    this.areaLayer = new AreaLayer(gl,this.areas);
  }

  camera(view,mode="3d") {
    const centre = [(view.width/2 - view.offsetX)/view.scale + view.west, 0,
      view.north - (view.height/2 - view.offsetY)/view.scale];
    const basis = mode === "2d" ? cameraBasis(0,0) : cameraBasis(this.yaw, this.tilt);
    const x = 2*view.scale/view.width, y = 2*view.scale/view.height, z = -.01;
    const {right: r, up: u, depth: d} = basis;
    const dot = axis => axis.reduce((sum, value, i) => sum + value*centre[i], 0);
    const matrix = new Float32Array([
      r[0]*x,u[0]*y,d[0]*z,0, r[1]*x,u[1]*y,d[1]*z,0,
      r[2]*x,u[2]*y,d[2]*z,0, -dot(r)*x,-dot(u)*y,-dot(d)*z,1,
    ]);
    return {centre, basis, matrix};
  }

  draw(view, visible, mode="2d", highlights=[]) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffer);
    for (const [index,size,offset] of [[0,3,0],[1,3,12],[2,2,24]]) {
      gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index,size,gl.FLOAT,false,32,offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const matrix = this.camera(view,mode).matrix;
    gl.uniformMatrix4fv(this.cameraLocation, false, matrix);
    gl.uniform1f(this.raisedLocation, visible && mode === "3d" ? 1 : 0);
    gl.uniform1f(this.contoursLocation,visible ? 1 : 0);
    gl.uniform1f(this.ratioLocation,this.canvas.width/view.width);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[visible ? 1 : 0]);
    gl.drawElements(gl.TRIANGLES, this.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    if (!visible) this.areaLayer.draw(matrix,view,highlights);
  }

  pan(view, dx, dy) {
    const {right: r, up: u} = cameraBasis(this.yaw, this.tilt);
    const x = dx/view.scale, y = -dy/view.scale;
    // Invert the projection onto the sea plane; tilt is bounded away from zero.
    const determinant = r[0]*u[2] - r[2]*u[0];
    const lon = (x*u[2] - r[2]*y)/determinant;
    const lat = (r[0]*y - x*u[0])/determinant;
    view.offsetX += lon*view.scale;
    view.offsetY -= lat*view.scale;
  }

  pick(point, view, visible, accepts, mode="3d") {
    const {centre, basis: {right: r, up: u, depth: d}} = this.camera(view,mode);
    const x = (point.x-view.width/2)/view.scale, y = (view.height/2-point.y)/view.scale;
    const origin = centre.map((value,i) => value + r[i]*x + u[i]*y + d[i]*80);
    const direction = d.map(value => -value);
    if (!visible || mode === "2d") {
      const t = -origin[1]/direction[1];
      const p = origin.map((value,i) => value + t*direction[i]);
      const lonLat = [p[0], latitudeAt(p[2])];
      return accepts(lonLat) ? lonLat : null;
    }
    const hit = pickTerrain(this.mesh, {origin, direction,
      accept: p => accepts([p[0], latitudeAt(p[2])])});
    return hit ? [hit[0], latitudeAt(hit[2])] : null;
  }
}
