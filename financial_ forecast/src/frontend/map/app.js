import { TerrainTexture } from "./render/terraintexture.js";
import { TerrainRenderer } from "./render/terrainrenderer.js";
import { AreaIndex } from "./areas.js";
import { AreaInteraction } from "./areainteraction.js";
import { MapNavigation } from "./mapnavigation.js";
import { TerrainControls, formatDensity } from "../GUI/terraincontrols.js";
import { CapriCompanion } from "../GUI/capri.js";

const canvas=document.querySelector("#map"), panel=document.querySelector(".map-panel");
const loading=document.querySelector("#loading"), explain=document.querySelector("#explain-area");
let texture,renderer,navigation,interaction,selection,framePending=false;
const controls=new TerrainControls({
  onChange:()=>{interaction?.invalidate();requestDraw();},
  onZoom:factor=>navigation?.zoom(factor),
  onReset:()=>{renderer?.reset();navigation?.resize(true);},
  onMode:mode=>{if(!navigation)return;navigation.setMode(mode);controls.setMode(mode);},
});
const capri=new CapriCompanion(panel);
explain.addEventListener("click",()=>{if(selection)capri.explainArea(selection.feature.properties);});
document.addEventListener("capri:busy",event=>{explain.disabled=!selection || event.detail;});

function requestDraw() {
  if(framePending)return;
  framePending=true;
  requestAnimationFrame(now=>{framePending=false;draw(now);});
}

function draw(now=performance.now()) {
  if(!navigation?.view || !renderer || renderer.gl.isContextLost())return;
  const highlights=interaction?.highlights(now) || [];
  renderer.draw(navigation.view,controls.visible,navigation.mode,highlights,controls.density);
  if(interaction?.animating && !document.hidden)requestDraw();
}

function showArea(area,position) {
  selection=area;
  const {authority_name:name,income_per_head:income,population_density:density,authority_code:code}=area.feature.properties;
  document.querySelector("#area-name").textContent=name;
  document.dispatchEvent(new CustomEvent("terrain:selection",{detail:{authorityCode:code,authorityName:name}}));
  explain.disabled=capri.busy;
  const stats=document.querySelector("#area-stats");
  const densityText=density===null?"No matching value":formatDensity(density);
  const rows=income===null
    ? [["Height","Not available"],["Income per head","No matching value"]]
    : [["Synthetic height",Math.round(texture.elevationAt(...position)).toLocaleString()+" units"],
       ["Income per head","£"+Math.round(income).toLocaleString()]];
  rows.push(["Population density",densityText]);
  stats.replaceChildren(...rows.map(([label,value])=>{
    const row=document.createElement("div"),term=document.createElement("dt"),detail=document.createElement("dd");
    term.textContent=label;detail.textContent=value;row.append(term,detail);return row;
  }));
}

async function initialise() {
  try {
    const response=await fetch("/api/terrain");
    if(!response.ok)throw new Error("Terrain API returned "+response.status);
    const terrain=await response.json(), areas=new AreaIndex(terrain.features);
    texture=new TerrainTexture(terrain,areas);
    renderer=new TerrainRenderer(canvas,terrain.dem,texture,areas,{
      onUnavailable:()=>{loading.textContent="Restoring map graphics…";loading.classList.remove("hidden");},
      onRestore:()=>{loading.classList.add("hidden");requestDraw();},
    });
    navigation=new MapNavigation({
      canvases:[canvas],panel,bounds:terrain.metadata.bounds,
      onChange:()=>{interaction?.invalidate();requestDraw();},
      onZoom:zoom=>controls.setZoom(zoom),onSelect:point=>interaction?.select(point),
      rotate:(dx,dy,reset=false)=>reset?renderer.reset():renderer.rotate(dx,dy),
      pan3D:(view,dx,dy)=>renderer.pan(view,dx,dy),
    });
    interaction=new AreaInteraction({
      canvas,index:areas,renderer,getView:()=>navigation.view,getMode:()=>navigation.mode,
      isTerrainVisible:()=>controls.visible,isDragging:()=>navigation.pointers.size>0,
      onChange:requestDraw,onSelect:showArea,
      describe:({authority_name:name,population_density:density})=>controls.density
        ?name+" · "+(density===null?"No density data":formatDensity(density))
        :name,
    });
    controls.setReady();controls.setLegend(texture.colourRange,texture.peakHeight);
    const density=terrain.metadata.population_density;
    controls.setDensitySource(density?.source_year);
    document.querySelector("#source-note").textContent=terrain.metadata.metric+", "+terrain.metadata.source_year+". "+
      terrain.metadata.matched_authorities+" of "+terrain.features.length+" planning authorities matched; special authorities remain unshaded."+
      (density?" Population density (ONS, mid-"+density.source_year+"): "+density.matched_authorities+" matched.":"");
    draw();loading.classList.add("hidden");
  } catch(error){loading.textContent="Could not load the map: "+error.message;}
}
initialise();
