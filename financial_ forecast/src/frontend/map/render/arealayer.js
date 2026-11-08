import { createProgram, uploadBuffer } from "./gl.js";
import { vegetationColourTable } from "../vegetation.js";

const lineVertex = `
attribute vec2 start;
attribute vec2 end;
attribute vec2 corner;
uniform mat4 camera;
uniform vec2 viewport;
uniform float width;
varying float side;
void main() {
  vec4 a = camera*vec4(start.x,0.0,start.y,1.0);
  vec4 b = camera*vec4(end.x,0.0,end.y,1.0);
  vec2 delta = (b.xy/b.w-a.xy/a.w)*viewport;
  vec2 normal = vec2(-delta.y,delta.x)/max(length(delta),.000001);
  gl_Position = mix(a,b,corner.x);
  gl_Position.xy += normal*corner.y*width*2.0/viewport*gl_Position.w;
  side = corner.y;
}`;
const lineFragment = `
precision mediump float;
uniform vec4 colour;
uniform bool glow;
varying float side;
void main() {
  float alpha = glow ? pow(max(0.0,1.0-abs(side)),2.0) : 1.0-smoothstep(.45,1.0,abs(side));
  gl_FragColor = vec4(colour.rgb,colour.a*alpha);
}`;
const fillVertex = `
attribute vec2 position;
uniform mat4 camera;
void main() { gl_Position = camera*vec4(position.x,0.0,position.y,1.0); }
`;
const fillFragment = `
precision mediump float;
uniform vec4 colour;
void main() { gl_FragColor = colour; }
`;
const corners = new Float32Array([0,-1,1,-1,0,1,0,1,1,-1,1,1]);
const vegetationVertex = `
attribute vec2 position;
attribute float authority;
uniform mat4 camera;
varying float colourU;
void main() {
  gl_Position = camera * vec4(position.x,0.0,position.y,1.0);
  colourU = authority;
}
`;
const vegetationFragment = `
precision mediump float;
uniform sampler2D areaColours;
varying float colourU;
void main() { gl_FragColor = texture2D(areaColours,vec2(colourU,.5)); }
`;

// Border instances and hover meshes are uploaded once, never rebuilt on a pan.
export class AreaLayer {
  constructor(gl,index) { this.gl=gl; this.index=index; this.initialise(); }

  initialise() {
    const gl=this.gl;
    this.instancing=gl.getExtension("ANGLE_instanced_arrays");
    this.lines=createProgram(gl,lineVertex,lineFragment,["start","end","corner"]);
    this.fill=createProgram(gl,fillVertex,fillFragment,["position"]);
    this.lineUniforms=Object.fromEntries(["camera","viewport","width","colour","glow"].map(name=>[name,gl.getUniformLocation(this.lines,name)]));
    this.fillUniforms=Object.fromEntries(["camera","colour"].map(name=>[name,gl.getUniformLocation(this.fill,name)]));
    this.fillBuffer=uploadBuffer(gl,gl.ARRAY_BUFFER,this.index.fills());
    if (this.instancing) {
      this.segmentBuffer=uploadBuffer(gl,gl.ARRAY_BUFFER,this.index.segments);
      this.cornerBuffer=uploadBuffer(gl,gl.ARRAY_BUFFER,corners);
    } else {
      // Compatibility path: expand the same cached instances once at startup.
      const segments=this.index.segments, expanded=new Float32Array(segments.length/4*36);
      for(let i=0;i<segments.length/4;i++) for(let j=0;j<6;j++) {
        const at=i*36+j*6;
        expanded.set(segments.subarray(i*4,i*4+4),at); expanded.set(corners.subarray(j*2,j*2+2),at+4);
      }
      this.expandedBuffer=uploadBuffer(gl,gl.ARRAY_BUFFER,expanded);
    }
  }

  setVegetation(observations,palette,missing) {
    const gl=this.gl,{width,colours}=vegetationColourTable(this.index,observations,palette,missing);
    gl.activeTexture(gl.TEXTURE0);
    if(!this.vegetationTexture) {
      this.vegetationProgram=createProgram(gl,vegetationVertex,vegetationFragment,["position","authority"]);
      this.vegetationCamera=gl.getUniformLocation(this.vegetationProgram,"camera");
      gl.useProgram(this.vegetationProgram);
      gl.uniform1i(gl.getUniformLocation(this.vegetationProgram,"areaColours"),0);
      const ids=new Float32Array(this.index.fills().length/2);
      this.index.areas.forEach((area,i)=>ids.fill((i+.5)/width,area.fillStart,area.fillStart+area.fillCount));
      this.authorityBuffer=uploadBuffer(gl,gl.ARRAY_BUFFER,ids);
      this.vegetationTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.vegetationTexture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,1,0,gl.RGBA,gl.UNSIGNED_BYTE,colours);
    }else {
      gl.bindTexture(gl.TEXTURE_2D,this.vegetationTexture);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,1,gl.RGBA,gl.UNSIGNED_BYTE,colours);
    }
  }

  drawVegetation(matrix) {
    const gl=this.gl;
    gl.useProgram(this.vegetationProgram);
    gl.enableVertexAttribArray(0);gl.enableVertexAttribArray(1);gl.disableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.fillBuffer);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.authorityBuffer);gl.vertexAttribPointer(1,1,gl.FLOAT,false,4,0);
    gl.uniformMatrix4fv(this.vegetationCamera,false,matrix);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.vegetationTexture);
    gl.drawArrays(gl.TRIANGLES,0,this.index.fills().length/2);
  }

  stroke(matrix,view,start,count,width,colour,glow=false) {
    const gl=this.gl,u=this.lineUniforms;
    gl.useProgram(this.lines);
    gl.uniformMatrix4fv(u.camera,false,matrix); gl.uniform2f(u.viewport,view.width,view.height);
    gl.uniform1f(u.width,width); gl.uniform4fv(u.colour,colour); gl.uniform1i(u.glow,glow?1:0);
    for(let i=0;i<3;i++) gl.enableVertexAttribArray(i);
    if(this.instancing) {
      gl.bindBuffer(gl.ARRAY_BUFFER,this.segmentBuffer);
      gl.vertexAttribPointer(0,2,gl.FLOAT,false,16,start*16); gl.vertexAttribPointer(1,2,gl.FLOAT,false,16,start*16+8);
      this.instancing.vertexAttribDivisorANGLE(0,1); this.instancing.vertexAttribDivisorANGLE(1,1);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.cornerBuffer); gl.vertexAttribPointer(2,2,gl.FLOAT,false,8,0);
      this.instancing.drawArraysInstancedANGLE(gl.TRIANGLES,0,6,count);
      this.instancing.vertexAttribDivisorANGLE(0,0); this.instancing.vertexAttribDivisorANGLE(1,0);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER,this.expandedBuffer);
      gl.vertexAttribPointer(0,2,gl.FLOAT,false,24,0); gl.vertexAttribPointer(1,2,gl.FLOAT,false,24,8); gl.vertexAttribPointer(2,2,gl.FLOAT,false,24,16);
      gl.drawArrays(gl.TRIANGLES,start*6,count*6);
    }
  }

  highlight(matrix,area,opacity) {
    const gl=this.gl;
    gl.useProgram(this.fill); gl.bindBuffer(gl.ARRAY_BUFFER,this.fillBuffer);
    gl.enableVertexAttribArray(0); gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);
    gl.uniformMatrix4fv(this.fillUniforms.camera,false,matrix);
    gl.uniform4f(this.fillUniforms.colour,.22,.95,.94,.18*opacity);
    gl.drawArrays(gl.TRIANGLES,area.fillStart,area.fillCount);
  }

  draw(matrix,view,highlights,light=false) {
    const gl=this.gl;
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    if(light && this.vegetationTexture)this.drawVegetation(matrix);
    this.stroke(matrix,view,0,this.index.segments.length/4,.9,light?[.3,.49,.59,.65]:[.55,.67,.79,.8]);
    for(const {area,opacity} of highlights) {
      this.highlight(matrix,area,opacity);
      this.stroke(matrix,view,area.lineStart,area.lineCount,6,[.25,1,1,.45*opacity],true);
      this.stroke(matrix,view,area.lineStart,area.lineCount,1.5,[.4,1,.98,.95*opacity]);
    }
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
  }
}
