import {createProgram,uploadBuffer} from "./gl.js";

// Sparse world-space reference lines behind the land, uploaded once.
export class SeaGrid {
  constructor(gl) {
    this.gl=gl;
    this.program=createProgram(gl,`
      attribute vec2 position; uniform mat4 camera; varying vec2 ground;
      void main(){ground=position;gl_Position=camera*vec4(position.x,0.0,position.y,1.0);gl_Position.z=0.0;}
    `,`
      #extension GL_OES_standard_derivatives : enable
      precision mediump float; varying vec2 ground; uniform vec2 centre;
      void main(){
        vec2 cells=ground/4.0;
        vec2 distance=abs(fract(cells+.5)-.5)/max(fwidth(cells),vec2(.00001));
        float line=1.0-smoothstep(.0,.8,min(distance.x,distance.y));
        float fade=1.0-smoothstep(35.0,90.0,length(ground-centre));
        gl_FragColor=vec4(vec3(11.0,16.0,24.0)/255.0+vec3(.035,.055,.07)*line*fade,1.0);
      }
    `,["position"]);
    this.camera=gl.getUniformLocation(this.program,"camera");this.centre=gl.getUniformLocation(this.program,"centre");
    this.buffer=uploadBuffer(gl,gl.ARRAY_BUFFER,new Float32Array([-512,-512,512,-512,-512,512,-512,512,512,-512,512,512]));
  }
  draw(matrix,centre) {
    const gl=this.gl;gl.disable(gl.DEPTH_TEST);gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(0);gl.disableVertexAttribArray(1);gl.disableVertexAttribArray(2);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);gl.uniformMatrix4fv(this.camera,false,matrix);gl.uniform2f(this.centre,centre[0],centre[2]);
    gl.drawArrays(gl.TRIANGLES,0,6);gl.enable(gl.DEPTH_TEST);
  }
}
