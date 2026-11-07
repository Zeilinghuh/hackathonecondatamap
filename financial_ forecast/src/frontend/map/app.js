import { TerrainTexture } from "./render/terraintexture.js";
import { TerrainRenderer } from "./render/terrainrenderer.js";
import { AreaIndex } from "./areas.js";
import { AreaInteraction } from "./areainteraction.js";
import { MapNavigation } from "./mapnavigation.js";
import { TerrainControls } from "../GUI/terraincontrols.js";
import { CapriCompanion } from "../GUI/capri.js";

const canvas=document.querySelector("#map"), panel=document.querySelector(".map-panel");
const loading=document.querySelector("#loading"), explain=document.querySelector("#explain-area");
const key=document.querySelector(".map-key");
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
  renderer.draw(navigation.view,controls.visible,navigation.mode,highlights);
  if(key.hidden===controls.visible)key.hidden=!controls.visible;
  if(interaction?.animating && !document.hidden)requestDraw();
}

function showArea(area,position) {
  selection=area;
  const {authority_name:name,income_per_head:income,authority_code:code}=area.feature.properties;
  document.querySelector("#area-name").textContent=name;
  document.dispatchEvent(new CustomEvent("terrain:selection",{detail:{authorityCode:code,authorityName:name}}));
  explain.disabled=capri.busy;
  const stats=document.querySelector("#area-stats");
  if(income===null) {
    stats.innerHTML="<div><dt>Height</dt><dd>Not available</dd></div><div><dt>Income per head</dt><dd>No matching value</dd></div>";
  } else {
    const height=Math.round(texture.elevationAt(...position)).toLocaleString();
    stats.innerHTML="<div><dt>Synthetic height</dt><dd>"+height+" units</dd></div><div><dt>Income per head</dt><dd>£"+Math.round(income).toLocaleString()+"</dd></div>";
  }
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
    });
    controls.setReady();controls.setLegend(texture.colourRange,texture.peakHeight);
    document.querySelector("#source-note").textContent=terrain.metadata.metric+", "+terrain.metadata.source_year+". "+
      terrain.metadata.matched_authorities+" of "+terrain.features.length+" planning authorities matched; special authorities remain unshaded.";
    draw();loading.classList.add("hidden");
  } catch(error){loading.textContent="Could not load the map: "+error.message;}
}
initialise();
