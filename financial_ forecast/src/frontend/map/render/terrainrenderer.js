import { cameraBasis, terrainMesh, pickTerrain, latitudeAt, HEIGHT_SCALE, DENSITY_HEIGHT_SCALE } from "../terrainmath.js";
import { createProgram, uploadBuffer } from "./gl.js";
import { AreaLayer } from "./arealayer.js";
import { SeaGrid } from "./seagrid.js";

const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 camera;
uniform mediump float raised;
uniform float heightScale;
uniform mediump float mistPass;
varying vec2 textureUV;
varying float light;
varying float heightValue;
void main() {
  gl_Position = camera * vec4(position.x, position.y * raised + mistPass * raised * .32, position.z, 1.0);
  textureUV = uv;
  heightValue = position.y / heightScale;
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
uniform float densitySurface;
uniform float vegetationBase;
uniform sampler2D mistTexture;
uniform mediump float mistPass;
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
  if (mistPass > .5) {
    float field = texture2D(mistTexture, textureUV).a;
    float wisp = .62 + .22 * sin(textureUV.x * 115.0 + sin(textureUV.y * 83.0));
    wisp += .16 * sin(textureUV.y * 173.0 + textureUV.x * 43.0);
    float alpha = smoothstep(.07, .62, field * wisp) * .43;
    gl_FragColor = vec4(vec3(.68, .81, .89), alpha);
    return;
  }
  vec4 colour = texture2D(surface, textureUV);
  if (colour.a < .5) discard;
  vec3 shaded = mix(colour.rgb * light,vec3(.91,.95,.92),vegetationBase);
  // White density contours are quieter between bold lines so the blue stays legible.
  float minor = contour(contourInterval,.45)*mix(.62,.3,densitySurface);
  float major = contour(contourInterval*5.0,.75)*.86;
  float lines = max(minor,major)*contoursOn*texture2D(matched,textureUV).a;
  float luminance = dot(shaded,vec3(.2126,.7152,.0722));
  // Income: dark ink, pale blue on dark-blue lows. Density: white contours everywhere.
  float lightInk = (colour.b > colour.r && luminance < .12) ? 1.0 : 0.0;
  vec3 ink = mix(mix(vec3(.01,.025,.04),vec3(.5,.65,.8),lightInk),vec3(1.0),densitySurface);
  gl_FragColor = vec4(mix(shaded,ink,lines),1.0);
}`;

// Surfaces: "income" (data.dem) and "density" (data.density_dem); null = flat borders.
export class TerrainRenderer {
  constructor(canvas, dems, textureSource, areas, {onUnavailable, onRestore}) {
    this.canvas = canvas;
    this.dem = dems.income;
    this.textureSource = textureSource;
    this.areas = areas;
    this.meshes = {income: terrainMesh(dems.income)};
    if (dems.density) {
      if (dems.density.width !== this.dem.width || dems.density.height !== this.dem.height)
        throw new Error("Density and income grids must share one size.");
      this.meshes.density = terrainMesh(dems.density, DENSITY_HEIGHT_SCALE);
    }
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
    // Same grid, so the index buffer is shared; each surface has its own heights.
    this.vertexBuffers = Object.fromEntries(Object.entries(this.meshes)
      .map(([name,mesh]) => [name, uploadBuffer(gl,gl.ARRAY_BUFFER,mesh.vertices)]));
    this.indexBuffer = uploadBuffer(gl,gl.ELEMENT_ARRAY_BUFFER,this.meshes.income.indices);
    this.cameraLocation = gl.getUniformLocation(this.program, "camera");
    this.raisedLocation = gl.getUniformLocation(this.program, "raised");
    this.contoursLocation = gl.getUniformLocation(this.program,"contoursOn");
    this.ratioLocation = gl.getUniformLocation(this.program, "pixelRatio");
    this.mistPassLocation = gl.getUniformLocation(this.program, "mistPass");
    this.densityLocation = gl.getUniformLocation(this.program, "densitySurface");
    this.vegetationLocation = gl.getUniformLocation(this.program, "vegetationBase");
    this.heightScaleLocation = gl.getUniformLocation(this.program, "heightScale");
    gl.uniform1f(gl.getUniformLocation(this.program,"contourInterval"),this.dem.contour_interval || 5);
    gl.uniform1i(gl.getUniformLocation(this.program, "surface"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "matched"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "mistTexture"), 2);
    // Upload only at creation/restoration, never when moving the camera.
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.maxTextureSize=maxSize;
    this.textures = [this.textureSource.base, this.textureSource.terrain, this.textureSource.matched,
      this.textureSource.densityTerrain, this.textureSource.mist].map(source => {
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
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,this.textures[4]);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(11/255,16/255,24/255,1);
    this.areaLayer = new AreaLayer(gl,this.areas);
    this.seaGrid = new SeaGrid(gl);
    if(this.vegetationData) {
      const {observations,palette,missing}=this.vegetationData;
      this.areaLayer.setVegetation(observations,palette,missing);
    }
  }

  setVegetation(observations,palette,missing) {
    this.vegetationData={observations,palette,missing};
    if(!this.gl.isContextLost())this.areaLayer.setVegetation(observations,palette,missing);
    this.canvas.dataset.vegetationColouredAreas=String(this.areas.areas.filter(area=>
      Number.isFinite(observations[area.feature.properties.authority_code])).length);
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

  surfaceOf(surface) { return surface && this.meshes[surface] ? surface : null; }

  updateFrame(name,dem) {
    const gl=this.gl;
    this.meshes[name]=terrainMesh(dem,name==="density"?DENSITY_HEIGHT_SCALE:HEIGHT_SCALE);
    if(gl.isContextLost())return;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffers[name]);
    gl.bufferSubData(gl.ARRAY_BUFFER,0,this.meshes[name].vertices);
    for(const [index,source] of [[name==="density"?3:1,name==="density"?this.textureSource.densityTerrain:this.textureSource.terrain],[2,this.textureSource.matched]]) {
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[index]);
      let image=source;
      if(source.width>this.maxTextureSize || source.height>this.maxTextureSize) {
        image=this.frameUploadCanvas??=document.createElement("canvas");
        const ratio=Math.min(this.maxTextureSize/source.width,this.maxTextureSize/source.height);
        if(image.width!==Math.floor(source.width*ratio))image.width=Math.floor(source.width*ratio);
        if(image.height!==Math.floor(source.height*ratio))image.height=Math.floor(source.height*ratio);
        const context=image.getContext("2d");context.clearRect(0,0,image.width,image.height);context.drawImage(source,0,0,image.width,image.height);
      }
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    }
  }

  draw(view, surface, mode="2d", highlights=[], mistEnabled=false, vegetation=false) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    surface = this.surfaceOf(surface);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    if(vegetation)gl.clearColor(.86,.94,.99,1);
    else gl.clearColor(11/255,16/255,24/255,1);
    gl.disable(gl.BLEND);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const camera=this.camera(view,mode),matrix=camera.matrix;
    if(mode==="3d" && !vegetation)this.seaGrid.draw(matrix,camera.centre);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffers[surface || "income"]);
    for (const [index,size,offset] of [[0,3,0],[1,3,12],[2,2,24]]) {
      gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index,size,gl.FLOAT,false,32,offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniformMatrix4fv(this.cameraLocation, false, matrix);
    gl.uniform1f(this.raisedLocation, surface && mode === "3d" ? 1 : 0);
    gl.uniform1f(this.contoursLocation,surface ? 1 : 0);
    gl.uniform1f(this.densityLocation,surface === "density" ? 1 : 0);
    gl.uniform1f(this.vegetationLocation,vegetation?1:0);
    gl.uniform1f(this.heightScaleLocation,surface === "density" ? DENSITY_HEIGHT_SCALE : HEIGHT_SCALE);
    gl.uniform1f(this.ratioLocation,this.canvas.width/view.width);
    gl.uniform1f(this.mistPassLocation, 0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[2]);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D, this.textures[{income: 1, density: 3}[surface] ?? 0]);
    gl.drawElements(gl.TRIANGLES, this.meshes.income.indices.length, gl.UNSIGNED_SHORT, 0);
    if (!surface) this.areaLayer.draw(matrix,view,highlights,vegetation);
    if (mistEnabled) {
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffers[surface || "income"]);
      for (const [index,size,offset] of [[0,3,0],[1,3,12],[2,2,24]]) {
        gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index,size,gl.FLOAT,false,32,offset);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.uniform1f(this.mistPassLocation, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[4]);
      gl.drawElements(gl.TRIANGLES, this.meshes.income.indices.length, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
    }
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

  pick(point, view, surface, accepts, mode="3d") {
    surface = this.surfaceOf(surface);
    const {centre, basis: {right: r, up: u, depth: d}} = this.camera(view,mode);
    const x = (point.x-view.width/2)/view.scale, y = (view.height/2-point.y)/view.scale;
    const origin = centre.map((value,i) => value + r[i]*x + u[i]*y + d[i]*80);
    const direction = d.map(value => -value);
    if (!surface || mode === "2d") {
      const t = -origin[1]/direction[1];
      const p = origin.map((value,i) => value + t*direction[i]);
      const lonLat = [p[0], latitudeAt(p[2])];
      return accepts(lonLat) ? lonLat : null;
    }
    const hit = pickTerrain(this.meshes[surface], {origin, direction,
      accept: p => accepts([p[0], latitudeAt(p[2])])});
    return hit ? [hit[0], latitudeAt(hit[2])] : null;
  }
}
