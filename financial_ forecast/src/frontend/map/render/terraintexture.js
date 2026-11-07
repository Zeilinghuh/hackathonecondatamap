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

// Population density classes (residents per km²). One-hue sequential ramp with
// monotone OKLCH lightness: dark recedes into the night sea, bright = crowded.
export const DENSITY_BREAKS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
export const DENSITY_COLOURS = [
  "#670242", "#841259", "#9c2e70", "#b34688", "#cc5da1",
  "#e474ba", "#fd8cd4", "#feb6e3", "#feddf2",
];
export const NO_DATA_COLOUR = "#26374a";
export function densityClass(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return -1;
  const index = DENSITY_BREAKS.findIndex(limit => value < limit);
  return index < 0 ? DENSITY_BREAKS.length : index;
}

// Prepare the colour raster and land mask once; the GPU draws all contours.
export class TerrainTexture {
  constructor(data,areas) {
    this.dem = data.dem;
    this.land = data.features.filter(feature => feature.properties.income_per_head !== null);
    const sorted = [...this.dem.values].sort((a, b) => a - b);
    this.colourRange = [sorted[Math.floor(sorted.length * .02)], sorted[Math.floor(sorted.length * .98)]];
    if (this.colourRange[1] <= this.colourRange[0]) this.colourRange = [0, 1000];
    this.peakHeight = sorted[sorted.length - 1];
    this.palette = [...CONTOUR_COLOURS, ...PEAK_COLOURS]
      .map(colour => colour.slice(1).match(/../g).map(channel => parseInt(channel, 16)));
    this.image = document.createElement("canvas");
    this.image.width = this.dem.width;
    this.image.height = this.dem.height;
    this.mask = new Path2D();
    const [west, south, east, north] = this.dem.bounds;
    const top = mercator(north), span = top - mercator(south);
    for (const feature of this.land) {
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const polygon of polygons) {
        polygon.forEach((ring, ringIndex) => {
          let points = ring.map(([lon, lat]) => [(lon - west) / (east - west), (top - mercator(lat)) / span]);
          const signedArea = points.reduce((sum, point, i) => {
            const next = points[(i + 1) % points.length];
            return sum + point[0] * next[1] - next[0] * point[1];
          }, 0);
          if ((signedArea > 0) !== (ringIndex === 0)) points = points.reverse();
          points.forEach((point, index) => index ? this.mask.lineTo(...point) : this.mask.moveTo(...point));
          this.mask.closePath();
        });
      }
    }
    this.buildImage();
    this.buildSurfaces(areas);
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

  buildImage() {
    const context = this.image.getContext("2d");
    const image = context.createImageData(this.dem.width, this.dem.height);
    const { values } = this.dem;
    values.forEach((value, index) => {
      // Each fill is constant between the same levels used for native isolines.
      const rgb = this.palette[this.colourBandAt(value)];
      image.data.set([...rgb, 255], index * 4);
    });
    context.putImageData(image, 0, 0);
  }

  buildSurfaces(areas) {
    const [west,south,east,north]=this.dem.bounds;
    const top=mercator(north),span=top-mercator(south),scale=3072/span;
    this.base=document.createElement("canvas");
    this.base.width=Math.round((east-west)*scale);this.base.height=3072;
    const context=this.base.getContext("2d");
    context.setTransform(scale,0,0,scale,-west*scale,top*scale);context.fillStyle=NO_DATA_COLOUR;
    for(const {path} of areas.areas)context.fill(path,"evenodd");
    // Flat authority choropleth; same projection and size as the base fill.
    this.density=document.createElement("canvas");
    this.density.width=this.base.width;this.density.height=this.base.height;
    const density=this.density.getContext("2d");
    density.setTransform(scale,0,0,scale,-west*scale,top*scale);
    for(const {path,feature} of areas.areas) {
      const band=densityClass(feature.properties.population_density);
      density.fillStyle=band<0?NO_DATA_COLOUR:DENSITY_COLOURS[band];
      density.fill(path,"evenodd");
    }
    this.terrain=document.createElement("canvas");
    this.terrain.width=this.base.width;this.terrain.height=this.base.height;
    const fill=this.terrain.getContext("2d");fill.drawImage(this.base,0,0);
    this.drawFill(fill,([lon,lat])=>[(lon-west)*scale,(top-mercator(lat))*scale]);
    this.matched=document.createElement("canvas");
    this.matched.width=Math.round(this.base.width/3);this.matched.height=1024;
    const mask=this.matched.getContext("2d");mask.scale(this.matched.width,this.matched.height);
    mask.fillStyle="white";mask.fill(this.mask,"nonzero");
  }

  drawFill(context, project) {
    context.save();
    const [west, south, east, north] = this.dem.bounds;
    const [left, top] = project([west, north]);
    const [right, bottom] = project([east, south]);
    context.translate(left, top);
    context.scale(right - left, bottom - top);
    context.clip(this.mask, "nonzero");
    context.globalAlpha = 1;
    context.imageSmoothingEnabled = true;
    // Raster values are grid nodes; align pixel centres with contour coordinates.
    const { width, height } = this.dem;
    context.drawImage(this.image, -.5 / (width - 1), -.5 / (height - 1), width / (width - 1), height / (height - 1));
    context.restore();
  }

  elevationAt(longitude, latitude) {
    const [west, south, east, north] = this.dem.bounds;
    if (longitude < west || longitude > east || latitude < south || latitude > north) return null;
    const col = Math.round((longitude - west) / (east - west) * (this.dem.width - 1));
    const row = Math.round((mercator(north) - mercator(latitude)) / (mercator(north) - mercator(south)) * (this.dem.height - 1));
    return this.dem.values[row * this.dem.width + col];
  }
}
