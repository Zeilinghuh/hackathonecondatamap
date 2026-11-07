import { mercator } from "./terrainmath.js";
import earcut from "./render/vendor/earcut.js";

// One geometry index for cached fills, GPU borders, hover and selection.
export class AreaIndex {
  constructor(features) {
    this.hitContext = document.createElement("canvas").getContext("2d");
    let count = 0;
    this.areas = features.map((feature,index) => {
      const path = new Path2D(), bounds = [Infinity,Infinity,-Infinity,-Infinity];
      const polygons = (feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates).map(polygon => polygon.map(ring => {
        const points = new Float64Array(ring.length*2);
        ring.forEach(([lon,lat],i) => {
          const y = mercator(lat); points[i*2]=lon; points[i*2+1]=y;
          bounds[0]=Math.min(bounds[0],lon); bounds[1]=Math.min(bounds[1],y);
          bounds[2]=Math.max(bounds[2],lon); bounds[3]=Math.max(bounds[3],y);
          if (i) path.lineTo(lon,-y); else path.moveTo(lon,-y);
        });
        path.closePath(); count += ring.length-1;
        return points;
      }));
      return {index,feature,path,bounds,polygons};
    });
    this.segments = new Float32Array(count*4);
    let offset = 0;
    for (const area of this.areas) {
      area.lineStart = offset/4;
      for (const polygon of area.polygons) for (const ring of polygon) for (let i=0;i<ring.length-2;i+=2) {
        this.segments.set(ring.subarray(i,i+4),offset); offset+=4;
      }
      area.lineCount = offset/4-area.lineStart;
    }
  }

  find([lon,lat]) {
    const y = mercator(lat);
    return this.areas.findLast(area => lon>=area.bounds[0] && lon<=area.bounds[2] && y>=area.bounds[1] && y<=area.bounds[3]
      && this.hitContext.isPointInPath(area.path,lon,-y,"evenodd"));
  }

  triangles(area) {
    const output = [];
    for (const polygon of area.polygons) {
      const coordinates = [], holes = [];
      polygon.forEach((ring,index) => {
        if (index) holes.push(coordinates.length/2);
        // GeoJSON closes rings; earcut expects each vertex only once.
        for (let i=0;i<ring.length-2;i++) coordinates.push(ring[i]);
      });
      for (const index of earcut(coordinates,holes,2)) output.push(coordinates[index*2],coordinates[index*2+1]);
    }
    return new Float32Array(output);
  }

  fills() {
    if(this.fillVertices)return this.fillVertices;
    let count=0;
    const chunks=this.areas.map(area=>{
      const vertices=this.triangles(area);
      area.fillStart=count/2; area.fillCount=vertices.length/2; count+=vertices.length;
      return vertices;
    });
    this.fillVertices=new Float32Array(count);
    let offset=0;
    for(const chunk of chunks){this.fillVertices.set(chunk,offset);offset+=chunk.length;}
    return this.fillVertices;
  }
}
