import { mercator } from "../terrainmath.js";

// Discrete scientific rainbow scale, low to high, matching the contour reference.
export const CONTOUR_COLOURS = [
  "#000080", "#0000b3", "#0000e6", "#002aff", "#0055ff", "#0080ff",
  "#00aaff", "#00d5ff", "#00ffff", "#00ffcc", "#00ff80", "#00ff33",
  "#33ff00", "#80ff00", "#ccff00", "#ffff00", "#ffcc00", "#ff9900",
  "#ff6600", "#ff3300", "#ff0000",
];
// Extra headroom for the high-income peaks above the main rainbow range.
export const PEAK_COLOURS = ["#df0000", "#bc0000", "#970000", "#720000", "#4d0000"];

// Population density classes (residents per km²). Sequential ramp with OKLCH
// lightness falling monotonically: bright blue = sparse -> black = crowded.
// The lightest step stays mid-bright so white contour lines read on every band.
export const DENSITY_BREAKS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
export const DENSITY_COLOURS = [
  "#389bfe", "#2383e5", "#286dbe", "#275899", "#234576",
  "#1c3255", "#142036", "#0a101b", "#020306",
];
export const NO_DATA_COLOUR = "#26374a";
export function densityClass(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return -1;
  const index = DENSITY_BREAKS.findIndex(limit => value < limit);
  return index < 0 ? DENSITY_BREAKS.length : index;
}

// Height (0-1000) on the log10 density terrain -> residents per km².
export const densityFromHeight = (height, [low, high]) => 10 ** (low + height / 1000 * (high - low));
const toRGB = colour => colour.slice(1).match(/../g).map(channel => parseInt(channel, 16));

// Prepare colour rasters and land masks once; the GPU draws all contours.
// Two surfaces share the grid: income (data.dem) and log10 density (data.density_dem).
export class TerrainTexture {
  constructor(data,areas) {
    this.dem = data.dem;
    this.densityDem = data.density_dem;
    this.densityRange = data.metadata?.population_density?.log10_range;
    const sorted = [...this.dem.values].sort((a, b) => a - b);
    this.colourRange = [sorted[Math.floor(sorted.length * .02)], sorted[Math.floor(sorted.length * .98)]];
    if (this.colourRange[1] <= this.colourRange[0]) this.colourRange = [0, 1000];
    this.peakHeight = sorted[sorted.length - 1];
    this.palette = [...CONTOUR_COLOURS, ...PEAK_COLOURS].map(toRGB);
    this.densityPalette = DENSITY_COLOURS.map(toRGB);
    const has = key => feature => feature.properties[key] !== null && feature.properties[key] !== undefined;
    this.mask = this.landMask(data.features.filter(has("income_per_head")));
    this.densityMask = this.landMask(data.features.filter(has("population_density")));
    this.lineMask = this.landMask(data.features.filter(feature => has("income_per_head")(feature) || has("population_density")(feature)));
    this.image = this.rasterise(this.dem, value => this.palette[this.colourBandAt(value)]);
    this.densityImage = this.densityDem && this.densityRange
      ? this.rasterise(this.densityDem, value => this.densityPalette[this.densityBandAt(value)]) : null;
    this.buildSurfaces(areas);
  }

  landMask(features) {
    const mask = new Path2D();
    const [west, south, east, north] = this.dem.bounds;
    const top = mercator(north), span = top - mercator(south);
    for (const feature of features) {
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const polygon of polygons) {
        polygon.forEach((ring, ringIndex) => {
          let points = ring.map(([lon, lat]) => [(lon - west) / (east - west), (top - mercator(lat)) / span]);
          const signedArea = points.reduce((sum, point, i) => {
            const next = points[(i + 1) % points.length];
            return sum + point[0] * next[1] - next[0] * point[1];
          }, 0);
          if ((signedArea > 0) !== (ringIndex === 0)) points = points.reverse();
          points.forEach((point, index) => index ? mask.lineTo(...point) : mask.moveTo(...point));
          mask.closePath();
        });
      }
    }
    return mask;
  }

  colourBandAt(value) {
    const [low, high] = this.colourRange;
    const interval = this.dem.contour_interval ?? 5;
    const midpoint = (Math.floor(value / interval) + .5) * interval;
    const clamp = value => Math.max(0, Math.min(1, value));
    if (midpoint > high && this.peakHeight > high) {
      const tail = clamp((midpoint - high) / (this.peakHeight - high));
      return CONTOUR_COLOURS.length - 1 + Math.min(PEAK_COLOURS.length, Math.floor(tail * (PEAK_COLOURS.length + 1)));
    }
    const ramp = clamp((midpoint - low) / (high - low));
    return Math.min(CONTOUR_COLOURS.length - 1, Math.floor(ramp * CONTOUR_COLOURS.length));
  }

  // Constant between contour levels; the class of that band's density.
  densityBandAt(value) {
    const interval = this.densityDem.contour_interval ?? 5;
    const midpoint = Math.min(1000, (Math.floor(value / interval) + .5) * interval);
    return Math.max(0, densityClass(densityFromHeight(midpoint, this.densityRange)));
  }

  densityAt(longitude, latitude) {
    const height = this.densityDem && this.densityRange ? this.elevationAt(longitude, latitude, this.densityDem) : null;
    return height === null ? null : densityFromHeight(height, this.densityRange);
  }

  updateFrame(name,frame,range,features,reference) {
    if(name==="income" && !this.historyPalette) {
      const sorted=[...reference.values].sort((a,b)=>a-b);
      this.colourRange=[sorted[Math.floor(sorted.length*.02)],sorted[Math.floor(sorted.length*.98)]];
      if(this.colourRange[1]<=this.colourRange[0])this.colourRange=[0,1000];
      this.peakHeight=reference.values.reduce((max,value)=>Math.max(max,value),0);this.historyPalette=true;
    }
    const density=name==="density",field=density?"population_density":"income_per_head";
    const dem={...(density?this.densityDem:this.dem),values:frame.values};
    if(density){this.densityDem=dem;this.densityRange=range;}else this.dem=dem;
    const mask=this.landMask(features.filter(f=>f.properties[field]!==null));
    const image=this.rasterise(dem,value=>density?this.densityPalette[this.densityBandAt(value)]:this.palette[this.colourBandAt(value)]);
    const canvas=density?this.densityTerrain:this.terrain,context=canvas.getContext("2d");
    context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(this.base,0,0);
    const [west,south,east,north]=dem.bounds,top=mercator(north),span=top-mercator(south);
    this.drawFill(context,([lon,lat])=>[(lon-west)/(east-west)*canvas.width,(top-mercator(lat))/span*canvas.height],image,mask);
    const matched=this.matched.getContext("2d");matched.resetTransform();matched.clearRect(0,0,this.matched.width,this.matched.height);
    matched.scale(this.matched.width,this.matched.height);matched.fillStyle="white";matched.fill(mask,"nonzero");
    return dem;
  }

  rasterise(dem, colourAt) {
    const canvas = document.createElement("canvas");
    canvas.width = dem.width; canvas.height = dem.height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(dem.width, dem.height);
    dem.values.forEach((value, index) => image.data.set([...colourAt(value), 255], index * 4));
    context.putImageData(image, 0, 0);
    return canvas;
  }

  buildSurfaces(areas) {
    const [west,south,east,north]=this.dem.bounds;
    const top=mercator(north),span=top-mercator(south),scale=3072/span;
    const project=([lon,lat])=>[(lon-west)*scale,(top-mercator(lat))*scale];
    this.base=document.createElement("canvas");
    this.base.width=Math.round((east-west)*scale);this.base.height=3072;
    const context=this.base.getContext("2d");
    context.setTransform(scale,0,0,scale,-west*scale,top*scale);context.fillStyle=NO_DATA_COLOUR;
    for(const {path} of areas.areas)context.fill(path,"evenodd");
    const surface=(image,mask)=>{
      const canvas=document.createElement("canvas");
      canvas.width=this.base.width;canvas.height=this.base.height;
      const fill=canvas.getContext("2d");fill.drawImage(this.base,0,0);
      if(image)this.drawFill(fill,project,image,mask);
      return canvas;
    };
    this.terrain=surface(this.image,this.mask);
    this.densityTerrain=surface(this.densityImage,this.densityMask);
    this.matched=document.createElement("canvas");
    this.matched.width=Math.round(this.base.width/3);this.matched.height=1024;
    const mask=this.matched.getContext("2d");mask.scale(this.matched.width,this.matched.height);
    mask.fillStyle="white";mask.fill(this.lineMask,"nonzero");
  }

  drawFill(context, project, image, mask) {
    context.save();
    const [west, south, east, north] = this.dem.bounds;
    const [left, top] = project([west, north]);
    const [right, bottom] = project([east, south]);
    context.translate(left, top);
    context.scale(right - left, bottom - top);
    context.clip(mask, "nonzero");
    context.globalAlpha = 1;
    context.imageSmoothingEnabled = true;
    // Raster values are grid nodes; align pixel centres with contour coordinates.
    const { width, height } = this.dem;
    context.drawImage(image, -.5 / (width - 1), -.5 / (height - 1), width / (width - 1), height / (height - 1));
    context.restore();
  }

  elevationAt(longitude, latitude, dem = this.dem) {
    const [west, south, east, north] = dem.bounds;
    if (longitude < west || longitude > east || latitude < south || latitude > north) return null;
    const col = Math.round((longitude - west) / (east - west) * (dem.width - 1));
    const row = Math.round((mercator(north) - mercator(latitude)) / (mercator(north) - mercator(south)) * (dem.height - 1));
    return dem.values[row * dem.width + col];
  }
}
