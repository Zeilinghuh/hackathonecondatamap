import { cameraBasis, terrainMesh, pickTerrain, latitudeAt, HEIGHT_SCALE, DENSITY_HEIGHT_SCALE } from "../terrainmath.js";
import { createProgram, uploadBuffer } from "./gl.js";
import { AreaLayer } from "./arealayer.js?v=vegetation-contours-1";
import { SeaGrid } from "./seagrid.js";

const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec3 previousPosition;
attribute vec3 previousNormal;
uniform mediump float frameBlend;
uniform mat4 camera;
uniform mediump float raised;
uniform float heightScale;
uniform mediump float mistPass;
varying vec2 textureUV;
varying float light;
varying float heightValue;
void main() {
  vec3 point=mix(previousPosition,position,frameBlend);
  vec3 direction=normalize(mix(previousNormal,normal,frameBlend));
  gl_Position = camera * vec4(point.x, point.y * raised + mistPass * raised * .32, point.z, 1.0);
  textureUV = uv;
  heightValue = point.y / heightScale;
  light = mix(1.0, .76 + .24 * max(0.0, dot(direction, normalize(vec3(-.5,1.0,.7)))), raised);
}`;
const fragmentSource = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
uniform sampler2D surface;
uniform sampler2D matched;
uniform sampler2D previousSurface;
uniform sampler2D previousMatched;
uniform mediump float frameBlend;
uniform float contoursOn;
uniform float contourInterval;
uniform float pixelRatio;
uniform float densitySurface;
uniform sampler2D mistTexture;
uniform sampler2D selectionTexture;
uniform float selectionOn;
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
  vec4 colour = mix(texture2D(previousSurface,textureUV),texture2D(surface, textureUV),frameBlend);
  if (colour.a < .5) discard;
  vec3 shaded = colour.rgb * light;
  // Bold white density contours stand out against the blue, purple and pink.
  float minor = contour(contourInterval,.45)*mix(.62,.5,densitySurface);
  float major = contour(contourInterval*5.0,.75)*mix(.86,1.0,densitySurface);
  float coverage=mix(texture2D(previousMatched,textureUV).a,texture2D(matched,textureUV).a,frameBlend);
  float lines = max(minor,major)*contoursOn*coverage;
  float luminance = dot(shaded,vec3(.2126,.7152,.0722));
  // Income: pale blue ink on dark-blue lows. Density: white contours.
  float lightInk = (colour.b > colour.r && luminance < .12) ? 1.0 : 0.0;
  vec3 ink = mix(mix(vec3(.01,.025,.04),vec3(.5,.65,.8),lightInk),vec3(1.0),densitySurface);
  vec3 result=mix(shaded,ink,lines);
  if(selectionOn>.5) {
    float selected=texture2D(selectionTexture,textureUV).a;
    vec2 stepUV=max(fwidth(textureUV)*1.5,vec2(.0006));
    float inside=min(min(texture2D(selectionTexture,textureUV+vec2(stepUV.x,0.0)).a,texture2D(selectionTexture,textureUV-vec2(stepUV.x,0.0)).a),min(texture2D(selectionTexture,textureUV+vec2(0.0,stepUV.y)).a,texture2D(selectionTexture,textureUV-vec2(0.0,stepUV.y)).a));
    result=mix(result,vec3(.25,1.0,.96),selected*max(.18,1.0-inside));
  }
  gl_FragColor = vec4(result,1.0);
}`;

// Income, population density and employment share one renderer; null shows boundaries.
export class TerrainRenderer {
  constructor(canvas, dems, textureSource, areas, {onUnavailable, onRestore}) {
    this.canvas = canvas;
    this.dem = dems.income;
    this.textureSource = textureSource;
    this.areas = areas;
    this.meshes = {income: terrainMesh(dems.income)};
    this.meshes.employment=terrainMesh({...dems.income,values:new Float64Array(dems.income.values.length)},DENSITY_HEIGHT_SCALE);
    if (dems.density) {
      if (dems.density.width !== this.dem.width || dems.density.height !== this.dem.height)
        throw new Error("Density and income grids must share one size.");
      this.meshes.density = terrainMesh(dems.density, DENSITY_HEIGHT_SCALE);
    }
    this.reset();
    this.gl = canvas.getContext("webgl", {alpha: false, antialias: true, powerPreference: "low-power"});
    if (!this.gl) throw new Error("Map graphics are unavailable in this browser.");
    canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); this.endTransition(); this.spareTextures=null; onUnavailable(); });
    canvas.addEventListener("webglcontextrestored", () => { this.initialise(); onRestore(); });
    this.initialise();
  }

  reset() { this.yaw = -.16; this.tilt = .85; }
  rotate(dx, dy) {
    this.yaw = (this.yaw - dx * .007) % (Math.PI * 2);
    this.tilt = Math.max(.18, Math.min(1.2, this.tilt + dy * .006));
  }

  createTexture() {
    const gl=this.gl,texture=gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return texture;
  }

  uploadTexture(texture,source) {
    const gl=this.gl,maxSize=this.maxTextureSize,heightLimit=Math.min(3072,maxSize);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    let image=source;
    if(source.width>maxSize || source.height>heightLimit) {
      image=this.frameUploadCanvas??=document.createElement("canvas");
      const ratio=Math.min(maxSize/source.width,heightLimit/source.height);
      const width=Math.floor(source.width*ratio),height=Math.floor(source.height*ratio);
      if(image.width!==width)image.width=width;
      if(image.height!==height)image.height=height;
      const context=image.getContext("2d");context.clearRect(0,0,width,height);context.drawImage(source,0,0,width,height);
    }
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  }

  initialise() {
    const gl = this.gl;
    if (!gl.getExtension("OES_standard_derivatives")) throw new Error("This browser cannot draw the map contours.");
    this.program = createProgram(gl,vertexSource,fragmentSource,["position","normal","uv","previousPosition","previousNormal"]);
    gl.useProgram(this.program);
    // Same grid, so the index buffer is shared; each surface has its own heights.
    this.vertexBuffers = Object.fromEntries(Object.entries(this.meshes)
      .map(([name,mesh]) => [name, uploadBuffer(gl,gl.ARRAY_BUFFER,mesh.vertices)]));
    this.indexBuffer = uploadBuffer(gl,gl.ELEMENT_ARRAY_BUFFER,this.meshes.income.indices);
    this.cameraLocation = gl.getUniformLocation(this.program, "camera");
    this.blendLocation=gl.getUniformLocation(this.program,"frameBlend");
    this.raisedLocation = gl.getUniformLocation(this.program, "raised");
    this.contoursLocation = gl.getUniformLocation(this.program,"contoursOn");
    this.ratioLocation = gl.getUniformLocation(this.program, "pixelRatio");
    this.mistPassLocation = gl.getUniformLocation(this.program, "mistPass");
    this.densityLocation = gl.getUniformLocation(this.program, "densitySurface");
    this.heightScaleLocation = gl.getUniformLocation(this.program, "heightScale");
    gl.uniform1f(gl.getUniformLocation(this.program,"contourInterval"),this.dem.contour_interval || 5);
    gl.uniform1i(gl.getUniformLocation(this.program, "surface"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "matched"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "mistTexture"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program,"previousSurface"),3);
    gl.uniform1i(gl.getUniformLocation(this.program,"previousMatched"),4);
    gl.uniform1i(gl.getUniformLocation(this.program,"selectionTexture"),5);
    this.selectionLocation=gl.getUniformLocation(this.program,'selectionOn');
    // Upload only at creation/restoration, never when moving the camera.
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.maxTextureSize=maxSize;
    this.textures = [this.textureSource.base, this.textureSource.terrain, this.textureSource.matched,
      this.textureSource.densityTerrain, this.textureSource.mist,this.textureSource.employmentTerrain || this.textureSource.base,this.textureSource.employmentMatched || this.textureSource.matched].map(source => {
      const texture=this.createTexture();
      this.uploadTexture(texture,source);
      return texture;
    });
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,this.textures[2]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,this.textures[4]);
    gl.activeTexture(gl.TEXTURE0);
    this.selectionTexture=this.createTexture();this.uploadTexture(this.selectionTexture,this.textureSource.selectionMask);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0,0,0,1);
    this.areaLayer = new AreaLayer(gl,this.areas);
    this.seaGrid = new SeaGrid(gl);

  }

  setVegetation(observations,palette,missing) {
    this.updateFrame("employment",this.textureSource.updateEmployment(observations,palette,missing));
    this.canvas.dataset.vegetationColouredAreas=String(this.areas.areas.filter(area=>
      Number.isFinite(observations[area.feature.properties.authority_code])).length);
  }

  setSelection(area) {
    if(this.selectedArea===area)return;
    this.selectedArea=area;
    this.textureSource.select(area);
    if(!this.gl.isContextLost())this.uploadTexture(this.selectionTexture,this.textureSource.selectionMask);
    this.canvas.dataset.selectedArea=area?.feature.properties.authority_code || "";
  }

  updateMist() {
    this.textureSource.mist=this.textureSource.buildMist(this.areas);
    if(!this.gl.isContextLost())this.uploadTexture(this.textures[4],this.textureSource.mist);
  }

  camera(view,mode="3d") {
    const centre = [(view.width/2 - view.offsetX)/view.scale + view.west, mode==='3d'?(view.focusHeight||0):0,
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

  project(lon,lat,view,mode,surface) {
    const matrix=this.camera(view,mode).matrix,dem={income:this.textureSource.dem,density:this.textureSource.densityDem,employment:this.textureSource.employmentDem}[surface];
    const x=lon,z=Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*180/Math.PI;
    const y=mode==='3d'&&dem?(this.textureSource.elevationAt(lon,lat,dem)??0)*(surface==='income'?HEIGHT_SCALE:DENSITY_HEIGHT_SCALE):0;
    const a=matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],b=matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13];
    return {x:(a+1)*view.width/2,y:(1-b)*view.height/2,height:y};
  }

  beginTransition(name) {
    const gl=this.gl;if(gl.isContextLost() || !this.meshes[name])return;
    const previous=this.transition,continuing=previous?.name===name;
    let vertices=this.meshes[name].vertices,dem={income:this.textureSource.dem,density:this.textureSource.densityDem,employment:this.textureSource.employmentDem}[name];
    const canvases=[name==='employment'?this.textureSource.employmentTerrain:name==='density'?this.textureSource.densityTerrain:this.textureSource.terrain,name==='employment'?this.textureSource.employmentMatched:this.textureSource.matched];
    const sources=this.transitionSources??=canvases.map(()=>document.createElement('canvas'));
    const t=continuing?Math.min(1,(performance.now()-previous.start)/550):1,blend=t*t*(3-2*t);
    if(continuing){
      vertices=vertices.slice();
      for(let i=0;i<vertices.length;i+=8)for(let j=0;j<6;j++)vertices[i+j]=previous.vertices[i+j]+(vertices[i+j]-previous.vertices[i+j])*blend;
      dem={...dem,values:Float64Array.from(dem.values,(value,i)=>previous.dem.values[i]+(value-previous.dem.values[i])*blend)};
    }
    sources.forEach((canvas,i)=>{
      const source=canvases[i],context=canvas.getContext('2d');
      if(!continuing){canvas.width=source.width;canvas.height=source.height;context.drawImage(source,0,0);}
      else if(i===0){context.globalAlpha=blend;context.drawImage(source,0,0);context.globalAlpha=1;}
      else{context.globalCompositeOperation='destination-in';context.globalAlpha=1-blend;context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.globalCompositeOperation='lighter';context.globalAlpha=blend;context.drawImage(source,0,0);context.globalAlpha=1;context.globalCompositeOperation='source-over';}
    });
    this.endTransition();
    const indices=[{income:1,density:3,employment:5}[name],name==="employment"?6:2];
    const old=indices.map(index=>this.textures[index]);
    if(continuing)old.forEach((texture,i)=>this.uploadTexture(texture,sources[i]));
    this.transition={name,start:performance.now(),buffer:uploadBuffer(gl,gl.ARRAY_BUFFER,vertices),textures:old,vertices,dem,blend:0};
    indices.forEach((index,i)=>{this.textures[index]=this.spareTextures?.[i] || this.createTexture();});
    this.spareTextures=null;
  }

  endTransition() {
    if(!this.transition)return;
    this.gl.deleteBuffer(this.transition.buffer);
    this.spareTextures=this.transition.textures;this.transition=null;
  }

  updateFrame(name,dem) {
    const gl=this.gl;
    this.meshes[name]=terrainMesh(dem,name==="income"?HEIGHT_SCALE:DENSITY_HEIGHT_SCALE);
    if(gl.isContextLost())return;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffers[name]);
    gl.bufferSubData(gl.ARRAY_BUFFER,0,this.meshes[name].vertices);
    for(const [index,source] of [[name==="employment"?5:name==="density"?3:1,name==="employment"?this.textureSource.employmentTerrain:name==="density"?this.textureSource.densityTerrain:this.textureSource.terrain],[name==="employment"?6:2,name==="employment"?this.textureSource.employmentMatched:this.textureSource.matched]]) {
      this.uploadTexture(this.textures[index],source);
    }
  }

  bindMesh(surface="income") {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffers[surface]);
    for (const [index,size,offset] of [[0,3,0],[1,3,12],[2,2,24]]) {
      gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index,size,gl.FLOAT,false,32,offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.transition?.name===surface?this.transition.buffer:this.vertexBuffers[surface]);
    for(const [index,offset] of [[3,0],[4,12]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,3,gl.FLOAT,false,32,offset);}
  }

  draw(view, surface, mode="2d", highlights=[], mistEnabled=false, vegetation=false) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    surface = this.surfaceOf(surface);
    let blend=1;
    if(this.transition) {
      const t=Math.min(1,(performance.now()-this.transition.start)/550);
      blend=t*t*(3-2*t);this.transition.blend=blend;
      if(t===1)this.endTransition();
    }
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(11/255,16/255,24/255,1);
    gl.disable(gl.BLEND);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const camera=this.camera(view,mode),matrix=camera.matrix;
    gl.disableVertexAttribArray(3);gl.disableVertexAttribArray(4);
    this.seaGrid.draw(matrix,camera.centre);
    gl.useProgram(this.program);
    gl.uniform1f(this.blendLocation,this.transition?.name===surface?blend:1);
    this.bindMesh(surface || "income");
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniformMatrix4fv(this.cameraLocation, false, matrix);
    gl.uniform1f(this.raisedLocation, surface && mode === "3d" ? 1 : 0);
    gl.uniform1f(this.contoursLocation,surface ? 1 : 0);
    gl.uniform1f(this.selectionLocation,this.selectedArea&&surface?1:0);
    gl.uniform1f(this.densityLocation,surface === "density" ? 1 : 0);
    gl.uniform1f(this.heightScaleLocation,surface === "income" ? HEIGHT_SCALE : DENSITY_HEIGHT_SCALE);
    gl.uniform1f(this.ratioLocation,this.canvas.width/view.width);
    gl.uniform1f(this.mistPassLocation, 0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[surface==="employment"?6:2]);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D, this.textures[{income: 1, density: 3,employment:5}[surface] ?? 0]);
    const previous=this.transition?.name===surface?this.transition.textures:null;
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,previous?.[0] || this.textures[{income:1,density:3,employment:5}[surface] ?? 0]);
    gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,previous?.[1] || this.textures[surface==="employment"?6:2]);
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,this.selectionTexture);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawElements(gl.TRIANGLES, this.meshes.income.indices.length, gl.UNSIGNED_SHORT, 0);
    if (!surface) {gl.disableVertexAttribArray(3);gl.disableVertexAttribArray(4);this.areaLayer.draw(matrix,view,highlights);}
    if (mistEnabled) {
      gl.useProgram(this.program);
      this.bindMesh(surface || "income");
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

  vegetationHeight(x,z) {
    const height=this.textureSource.elevationAt(x,latitudeAt(z),this.textureSource.employmentDem);
    const previous=this.transition?.name==="employment"?this.transition:null;
    const old=previous?.dem?this.textureSource.elevationAt(x,latitudeAt(z),previous.dem):height;
    return (old+(height-old)*(previous?.blend??1))*DENSITY_HEIGHT_SCALE;
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
    let mesh=this.meshes[surface];
    if(this.transition?.name===surface) {
      const vertices=mesh.vertices.slice(),old=this.transition.vertices,blend=this.transition.blend;
      for(let i=1;i<vertices.length;i+=8)vertices[i]=old[i]+(vertices[i]-old[i])*blend;
      mesh={vertices,indices:mesh.indices};
    }
    const hit = pickTerrain(mesh, {origin, direction,
      accept: p => accepts([p[0], latitudeAt(p[2])])});
    return hit ? [hit[0], latitudeAt(hit[2])] : null;
  }
}
