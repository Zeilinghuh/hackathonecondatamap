import { TerrainTexture } from "./render/terraintexture.js?v=density-blue-pink-3";
import { TerrainRenderer } from "./render/terrainrenderer.js?v=density-blue-pink-3";
import { AreaIndex } from "./areas.js";
import { AreaInteraction } from "./areainteraction.js";
import { MapNavigation } from "./mapnavigation.js";
import { TerrainControls, formatDensity, sfx } from "../GUI/terraincontrols.js";
import { CapriCompanion, AreaMenu } from "../GUI/capri/capri.js";
>>>>>>> 57a313714be24670c8309fa60a8ff4f1b72ac03a
import { Timeline } from "../GUI/timeline.js";
import { VegetationLayer, vegetationState } from "./vegetation.js";

const canvas=document.querySelector("#map"), panel=document.querySelector(".map-panel");
const loading=document.querySelector("#loading"), explain=document.querySelector("#explain-area");
let texture,renderer,navigation,interaction,selection,selectedPosition,timeline,terrainData,areaMenu,vegetation,employmentYear,framePending=false;
const controls=new TerrainControls({
  onChange:()=>{areaMenu?.reset();timeline?.useSurface();interaction?.invalidate();if(selection)showArea(selection,selectedPosition);requestDraw();},
  onOverlayChange:()=>{interaction?.invalidate();requestDraw();},
  onZoom:factor=>navigation?.zoom(factor),
  onReset:()=>{renderer?.reset();navigation?.resize(true);},
  onMode:mode=>{if(!navigation)return;navigation.setMode(mode);controls.setMode(mode);},
});
const capri=new CapriCompanion(panel);

function requestDraw() {
  if(framePending)return;
  framePending=true;
  requestAnimationFrame(now=>{framePending=false;draw(now);});
}

function draw(now=performance.now()) {
  if(!navigation?.view || !renderer || renderer.gl.isContextLost())return;
  const highlights=interaction?.highlights(now) || [];
  renderer.draw(navigation.view,controls.surface,navigation.mode,highlights,controls.mistEnabled,controls.vegetation);
  vegetation?.draw(navigation.view,renderer.camera(navigation.view,navigation.mode).matrix,controls.vegetation);
  if(interaction?.animating && !document.hidden)requestDraw();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)requestDraw();});

function showArea(area,position) {
  selection=area;selectedPosition=position;
  areaMenu?.selected(area);
  const {authority_name:name,income_per_head:income,population_density:density,authority_code:code,business_death_rate_percent:deathRate}=area.feature.properties;
  document.querySelector("#area-name").textContent=name;
  document.dispatchEvent(new CustomEvent("terrain:selection",{detail:{authorityCode:code,authorityName:name,year:timeline?.year}}));
  const stats=document.querySelector("#area-stats");
  // Height of the surface being shown: density terrain on DENSITY, income terrain otherwise.
  const onDensity=controls.density, measured=onDensity?density:income;
  const height=measured===null?null:texture.elevationAt(...position,onDensity?texture.densityDem:texture.dem);
  const rows=[
    [onDensity?"Density height":"Synthetic height",height===null?"Not available":Math.round(height).toLocaleString()+" units"],
    ["Income per head",income===null?"No matching value":"Â£"+Math.round(income).toLocaleString()],
    ["Population density",density===null?"No matching value":formatDensity(density)],
    ["Business death rate (2024)",Number.isFinite(deathRate)?deathRate.toFixed(1)+"%":"No matching value"],
  ];
  if(controls.vegetation) {
    const {employment_rate:rate,employment_change_pp:change}=area.feature.properties;
    rows.splice(0,rows.length,["Employment Â· "+employmentYear,Number.isFinite(rate)?rate.toFixed(1)+"%":"No data for this year"],
      ["Annual change",Number.isFinite(change)?(change>0?"+":"")+change.toFixed(1)+" percentage points":"Previous year unavailable"]);
  }
  stats.replaceChildren(...rows.map(([label,value])=>{
    const row=document.createElement("div"),term=document.createElement("dt"),detail=document.createElement("dd");
    term.textContent=label;detail.textContent=value;row.append(term,detail);return row;
  }));
}

function applyEmploymentFrame(frame,series) {
  employmentYear=frame.year;
  const previous=series.frames.find(item=>Number(item.year)===Number(frame.year)-1);
  for(const feature of terrainData.features) {
    const code=feature.properties.authority_code,rate=frame.observations[code];
    const state=vegetationState(rate,previous?.observations[code]);
    feature.properties.employment_rate=state.available?rate:null;
    feature.properties.employment_change_pp=state.change;
  }
  vegetation.setFrame(frame,previous);
  renderer.setVegetation(frame.observations,vegetation.palette,vegetation.missingColour);
  controls.setEmploymentSource(frame.year);
  capri.selectedYear=frame.year;
  document.querySelector("#source-note").textContent="Employment rate, ages 16â€“64, "+frame.year+
    ". ONS (Great Britain) / NISRA (Northern Ireland). Missing or suppressed values stay unavailable. Vegetation is a visual metaphor.";
}

function applyFrame(name,frame,series) {
  areaMenu?.reset();
  if(name==="employment") {
    applyEmploymentFrame(frame,series);
    if(selection)showArea(selection,selectedPosition);
    interaction.invalidate();requestDraw();return;
  }
  const year=frame.year;
  const observationsBySurface=Object.fromEntries(Object.entries(timeline.data).map(([key,value])=>[key,value.frames.find(item=>item.year===year)?.observations]));
  for(const feature of terrainData.features) {
    for(const [surface,field] of [["income","income_per_head"],["density","population_density"]]) {
      const observations=observationsBySurface[surface];
      feature.properties[field]=observations?.[feature.properties.authority_code]??null;
    }
  }
  const dem=texture.updateFrame(name,frame,series.range,terrainData.features,series.frames.at(-1));
  renderer.updateFrame(name,dem);
  controls.setLegend(texture.colourRange,texture.peakHeight);
  if(name==="density")controls.setDensitySource({...terrainData.metadata.population_density,source_year:year,log10_range:series.range});
  capri.selectedYear=year;
  document.querySelector("#source-note").textContent=(name==="income"?"Income per head":"Population density")+", "+year+" Â· "+Object.keys(frame.observations).length+" authorities matched. Current boundaries; missing data stays unshaded.";
  if(selection)showArea(selection,selectedPosition);
  interaction.invalidate();requestDraw();
}

async function initialise() {
  try {
    const [response,deathsResponse]=await Promise.all([fetch("/api/terrain"),fetch("/api/business-deaths")]);
    if(!response.ok)throw new Error("Terrain API returned "+response.status);
    if(!deathsResponse.ok) {
      const failure=await deathsResponse.json().catch(()=>({}));
      throw new Error(failure.error || "Business deaths API returned "+deathsResponse.status);
    }
    const [terrain,deaths]=await Promise.all([response.json(),deathsResponse.json()]);
    terrainData=terrain;
    const normalise=name=>name.toLowerCase().replace(/lpa|cityof/g,"").replace(/[^a-z0-9]/g,"");
    const rates=new Map(deaths.areas.map(area=>[normalise(area.area_name),area.rate_percent]));
    let matchedDeathRates=0;
    for(const feature of terrain.features) {
      feature.properties.business_death_rate_percent=rates.get(normalise(feature.properties.authority_name)) ?? null;
      if(Number.isFinite(feature.properties.business_death_rate_percent))matchedDeathRates++;
    }
    const areas=new AreaIndex(terrain.features);
    texture=new TerrainTexture(terrain,areas);
    vegetation=new VegetationLayer(document.querySelector("#vegetation-overlay"),areas);
    employmentYear=terrain.metadata.employment?.source_year;
    const employment=terrain.employment;
    if(employment?.frames.length) {
      const latest=employment.frames.at(-1);
      vegetation.setFrame(latest,employment.frames.find(item=>Number(item.year)===Number(latest.year)-1));
      controls.setEmploymentSource(latest.year);
    }
    renderer=new TerrainRenderer(canvas,{income:terrain.dem,density:terrain.density_dem},texture,areas,{
      onUnavailable:()=>{loading.textContent="Restoring map graphicsâ€¦";loading.classList.remove("hidden");},
      onRestore:()=>{loading.classList.add("hidden");requestDraw();},
    });
    if(employment?.frames.length)renderer.setVegetation(employment.frames.at(-1).observations,vegetation.palette,vegetation.missingColour);
    navigation=new MapNavigation({
      canvases:[canvas],panel,bounds:terrain.metadata.bounds,
      onChange:()=>{areaMenu?.close();interaction?.invalidate();requestDraw();},
      onZoom:zoom=>controls.setZoom(zoom),onSelect:point=>interaction?.select(point),
      rotate:(dx,dy,reset=false)=>reset?renderer.reset():renderer.rotate(dx,dy),
      pan3D:(view,dx,dy)=>renderer.pan(view,dx,dy),
    });
    interaction=new AreaInteraction({
      canvas,index:areas,renderer,getView:()=>navigation.view,getMode:()=>navigation.mode,
      getSurface:()=>controls.surface,isDragging:()=>navigation.pointers.size>0,
      onChange:requestDraw,onSelect:(area,position)=>{sfx.play("click",{gain:.25});showArea(area,position);},
      describe:({authority_name:name,population_density:density,employment_rate:employment,business_death_rate_percent:deathRate})=>
        name+(controls.vegetation
          ?" Â· "+(Number.isFinite(employment)?employment.toFixed(1)+"% employed":"No employment data")
          :(density===null?"":" Â· "+formatDensity(density))+(Number.isFinite(deathRate)?" Â· "+deathRate.toFixed(1)+"% deaths":"")),
    });
    areaMenu=new AreaMenu({canvas,panel,capri,getYear:()=>timeline?.year,pause:()=>timeline?.pause(),
      pick:point=>{const position=interaction.position(point,controls.surface),area=position&&areas.find(position);return area?{area,position}:null;},
      select:(area,position)=>{interaction.selected=area;showArea(area,position);requestDraw();},
    });
    controls.setReady();controls.setLegend(texture.colourRange,texture.peakHeight);
    const density=terrain.metadata.population_density;
    controls.setDensitySource(density);
    document.querySelector("#source-note").textContent=terrain.metadata.metric+", "+terrain.metadata.source_year+". "+
      terrain.metadata.matched_authorities+" of "+terrain.features.length+" planning authorities matched; special authorities remain unshaded."+
      (density?" Population density (ONS, mid-"+density.source_year+"): "+density.matched_authorities+" matched.":"")
      +" Business deaths (ONS, "+deaths.source_year+"): "+matchedDeathRates+" authorities matched.";
    draw();loading.classList.add("hidden");
    timeline=new Timeline(()=>controls.timelineSurface,applyFrame,employment?{employment}:{});
  } catch(error){loading.textContent="Could not load the map: "+error.message;}
}
initialise();
