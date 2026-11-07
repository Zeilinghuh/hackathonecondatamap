import test from "node:test";
import assert from "node:assert/strict";
import { AreaIndex } from "../../src/frontend/map/areas.js";

function triangleArea(vertices) {
  let area=0;
  for(let i=0;i<vertices.length;i+=6) {
    const [ax,ay,bx,by,cx,cy]=vertices.slice(i,i+6);
    area+=Math.abs((bx-ax)*(cy-ay)-(by-ay)*(cx-ax))/2;
  }
  return area;
}
const ring=coordinates=>new Float64Array(coordinates.flat());

test("highlight triangles preserve holes and disconnected islands",()=>{
  const index=Object.create(AreaIndex.prototype);
  const area={polygons:[
    [ring([[0,0],[4,0],[4,4],[0,4],[0,0]]),ring([[1,1],[1,3],[3,3],[3,1],[1,1]])],
    [ring([[10,0],[11,0],[11,1],[10,1],[10,0]])],
  ]};
  const vertices=index.triangles(area);
  assert.equal(triangleArea(vertices),13);
  for(let i=0;i<vertices.length;i+=6) {
    const x=(vertices[i]+vertices[i+2]+vertices[i+4])/3;
    const y=(vertices[i+1]+vertices[i+3]+vertices[i+5])/3;
    assert.equal(x>1&&x<3&&y>1&&y<3,false,"A highlight must not fill the hole");
  }
});

test("all highlight geometry is prepared once and reused across selections",()=>{
  const index=Object.create(AreaIndex.prototype);
  index.areas=[{polygons:[[ring([[0,0],[1,0],[1,1],[0,0]])]]},{polygons:[[ring([[2,0],[3,0],[3,1],[2,0]])]]}];
  const vertices=index.fills();
  assert.equal(index.fills(),vertices);
  assert.equal(index.areas[0].fillStart,0);
  assert.equal(index.areas[1].fillStart,index.areas[0].fillCount);
  assert.equal(index.areas.reduce((count,area)=>count+area.fillCount,0),vertices.length/2);
});
