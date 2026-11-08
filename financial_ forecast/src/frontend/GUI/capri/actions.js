// Capri's only application entry point: validated actions reuse existing controls.
import {normaliseArea,VARIABLES} from '../forecast.js';
import {latitudeAt,mercator} from '../../map/terrainmath.js';
import {sfx} from '../terraincontrols.js';

export const ACTION_TYPES=['select_area','locate_user','clear_location','show_map_position','focus_region','set_year','set_layer','set_view','set_overlay','set_simulation','set_shock','optimize_simulation','set_rate','reset_simulation','play_timeline','pause_timeline','zoom','reset_view','set_sidebar','set_sound'];
const layerIds={income:'terrain',density:'density',employment:'vegetation',borders:'borders'};
export function validateAction(action) {
  if(!action || !ACTION_TYPES.includes(action.type))throw new Error('Unknown application action.');
  if(Object.keys(action).some(key=>!['type','target','year','layer','mode','overlay','enabled','variable','value','factor','region','goal','aggregation'].includes(key)))throw new Error('Unknown application argument.');
  const enumValue=(key,allowed)=>{if(!allowed.includes(action[key]))throw new Error('Invalid '+key+'.');};
  const number=(key,min,max)=>{if(!Number.isFinite(action[key])||action[key]<min||action[key]>max)throw new Error('Invalid '+key+'.');};
  const target=()=>{if(typeof action.target!=='string'||!action.target.trim()||action.target.length>120)throw new Error('Choose an area by name.');};
  if(action.type==='select_area')target();
  if(action.type==='set_year'){number('year',1991,2035);if(!Number.isInteger(action.year))throw new Error('Choose a whole year.');}
  if(action.type==='set_layer')enumValue('layer',Object.keys(layerIds));
  if(action.type==='set_view')enumValue('mode',['2d','3d']);
  if(action.type==='set_overlay')enumValue('overlay',['business_failure','weeklypay','fdi','rate']);
  if(['set_overlay','set_simulation','set_sidebar','set_sound'].includes(action.type)&&typeof action.enabled!=='boolean')throw new Error('Use an on/off value.');
  if(action.type==='set_shock'){enumValue('variable',Object.keys(VARIABLES));number('value',-10,10);if(action.target!==undefined)target();}
  if(action.type==='optimize_simulation'){enumValue('variable',['income','density','employment','weeklypay','deaths']);enumValue('goal',['min','max']);number('year',2026,2035);if(!Number.isInteger(action.year)||typeof action.region!=='string'||!action.region.trim()||action.region.length>100)throw new Error('Choose a valid region and simulation year.');}
  if(action.type==='focus_region'&&(typeof action.region!=='string'||!action.region.trim()||action.region.length>100))throw new Error('Choose a model region.');
  if(action.aggregation!==undefined)enumValue('aggregation',['extreme','mean']);
  if(action.type==='set_rate')number('value',-1,1);
  if(action.type==='zoom')number('factor',.25,4);
  return action;
}

export class AppActions {
  constructor({select,...options}){Object.assign(this,options);this.onSelect=select;}
  find(query) {
    const key=normaliseArea(query),areas=this.areas.areas;
    const exact=areas.find(a=>normaliseArea(a.feature.properties.authority_name)===key||a.feature.properties.authority_code===query);
    if(exact)return exact;
    const matches=key.length>=3?areas.filter(a=>normaliseArea(a.feature.properties.authority_name).includes(key)):[];
    if(matches.length===1)return matches[0];
    throw new Error(matches.length?'Which area? '+matches.slice(0,5).map(a=>a.feature.properties.authority_name.replace(/ LPA$/,'')).join(', ')+'.':'I couldn’t find “'+query+'”. Try a local authority such as Barnet.');
  }
  select(query,focus=true) {
    const area=this.find(query),b=area.bounds,points=this.areas.triangles(area);
    let x=(b[0]+b[2])/2,z=(b[1]+b[3])/2;
    if(this.areas.find([x,latitudeAt(z)])!==area&&points.length>=6){x=(points[0]+points[2]+points[4])/3;z=(points[1]+points[3]+points[5])/3;}
    this.focusedRegion=null;this.onSelect(area,[x,latitudeAt(z)]);if(focus)this.focusSelection();return area;
  }
  focusSelection(){const area=this.getSelected();return area?this.navigation.focus(area.bounds,this.getPosition?.(),(point,view)=>this.renderer.project(...point,view,this.navigation.mode,this.controls.surface)):Promise.resolve();}
  async focusRegion(region) {
    let members=this.areas.areas;
    if(!['uk','unitedkingdom','all'].includes(normaliseArea(region))) {
      if(!this.forecast.data)await this.forecast.reload();
      const match=this.forecast.data.regions.find(r=>normaliseArea(r.name)===normaliseArea(region)||r.code===region);
      if(!match)throw new Error('Choose one of the available model regions or UK.');
      members=members.filter(a=>this.forecast.data.areas[this.forecast.byCode.get(a.feature.properties.authority_code)]?.region===match.code);
    }
    if(!members.length)throw new Error('No mapped authorities in that region.');
    const bounds=members.reduce((b,a)=>[Math.min(b[0],a.bounds[0]),Math.min(b[1],a.bounds[1]),Math.max(b[2],a.bounds[2]),Math.max(b[3],a.bounds[3])],[Infinity,Infinity,-Infinity,-Infinity]);
    this.onRegion?.(region);this.focusedRegion=region;
    await this.navigation.focus(bounds,undefined,(point,view)=>this.renderer.project(...point,view,this.navigation.mode,this.controls.surface));
  }
  async locateUser() {
    if(!window.isSecureContext||!navigator.geolocation)throw new Error('Device location needs localhost or HTTPS and a supported browser.');
    const generation=this.locationGeneration=(this.locationGeneration||0)+1;this.lastLocationAction='requesting';
    const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,error=>reject(new Error({1:'Location permission was denied. You can enable it in the browser site settings.',2:'The device could not determine a location.',3:'The location request timed out. Please try again.'}[error.code]||'Device location is unavailable.')),{enableHighAccuracy:true,timeout:15000,maximumAge:30000}));
    if(generation!==this.locationGeneration)throw new Error('Location request cancelled because the user cleared pins. Do not retry.');
    const {longitude,latitude,accuracy}=position.coords;
    this.deviceLocation={longitude,latitude,accuracy_m:Number.isFinite(accuracy)?accuracy:null,observed_at:new Date(position.timestamp).toISOString(),source:'browser geolocation'};
    await this.pinPosition({...this.deviceLocation,kind:'device'});
  }
  async pinPosition(point) {
    const {longitude:lon,latitude:lat}=point;
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)throw new Error('The position coordinates are invalid.');
    const [west,south,east,north]=this.navigation.bounds;
    point.in_coverage=lon>=west&&lon<=east&&lat>=south&&lat<=north;
    const area=point.in_coverage?this.areas.find([lon,lat]):null;
    point.authority_name=area?.feature.properties.authority_name||null;this.positionPin=point;this.lastLocationAction='placed';
    this.locationMarker??=document.createElement('div');
    this.locationMarker.className='map-location';this.locationMarker.dataset.locationPin='true';this.locationMarker.setAttribute('aria-hidden','true');
    this.locationMarker.textContent=point.kind==='device'?'YOU':'MAP POINT';
    if(!this.locationMarker.isConnected)this.navigation.panel.append(this.locationMarker);
    this.locationNote??=document.createElement('div');this.locationNote.className='map-key compact-key location-key';this.locationNote.dataset.locationPin='true';this.locationNote.setAttribute('role','status');
    if(!this.locationNote.isConnected)this.navigation.panel.querySelector('.legend-stack').append(this.locationNote);
    const label=point.kind==='device'?'Device location':'Map centre';
    const detail=document.createElement('span');detail.textContent=label+' · '+(point.authority_name||lat.toFixed(4)+', '+lon.toFixed(4))+(point.accuracy_m!==undefined&&point.accuracy_m!==null?' · approximate ±'+Math.round(point.accuracy_m).toLocaleString()+' m':'')+(point.in_coverage?'':' · outside UK map coverage');
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove pin');remove.title='Remove pin';remove.addEventListener('click',()=>this.clearLocation());this.locationNote.replaceChildren(detail,remove);
    this.drawLocation();
    if(!point.in_coverage)return;
    this.focusedRegion=null;
    if(area)this.onSelect(area,[lon,lat]);else this.onRegion?.(label);
    const radius=Math.max(.035,Math.min(2,(point.accuracy_m||0)/(111320*Math.cos(lat*Math.PI/180))));
    await this.navigation.focus([lon-radius,mercator(lat)-radius,lon+radius,mercator(lat)+radius],[lon,lat],(p,view)=>this.renderer.project(...p,view,this.navigation.mode,this.controls.surface));
  }
  clearLocation() {
    const point=this.positionPin;
    this.locationGeneration=(this.locationGeneration||0)+1;
    this.positionPin=null;this.deviceLocation=null;this.lastLocationAction='cleared';
    this.locationMarker?.remove();this.locationNote?.remove();
    this.navigation.panel.querySelectorAll('[data-location-pin],.map-location').forEach(node=>node.remove());
    this.locationMarker=null;this.locationNote=null;
    if(point?.authority_name&&this.getSelected()?.feature.properties.authority_name===point.authority_name)this.onRegion?.('Explore the map');
    this.navigation.onChange();
  }
  drawLocation() {
    if(!this.locationMarker)return;
    const point=this.positionPin,view=this.navigation.view;
    if(!point?.in_coverage){this.locationMarker.hidden=true;return;}
    const p=this.renderer.project(point.longitude,point.latitude,view,this.navigation.mode,this.controls.surface,true);
    this.locationMarker.hidden=p.x<0||p.x>view.width||p.y<0||p.y>view.height;
    this.locationMarker.style.transform=`translate(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px)`;
  }
  async execute(actions) {
    if(!Array.isArray(actions)||!actions.length||actions.length>12)throw new Error('Ask for up to 12 application changes at once.');
    actions.forEach(validateAction);
    // Resolve named areas before changing the map; ambiguous names have no effects.
    for(const a of actions)if(a.type==='select_area'||a.type==='set_shock'&&a.target&&a.target!=='selected')this.find(a.target);
    await this.timeline.ready;
    const requestedYear=actions.findLast(a=>a.type==='set_year')?.year;
    const requestedLayer=actions.findLast(a=>a.type==='set_layer')?.layer||this.controls.timelineSurface||'income';
    if(requestedYear<2026&&!this.timeline.data[requestedLayer==='borders'?'income':requestedLayer]?.frames.some(f=>Number(f.year)===requestedYear))throw new Error('No recorded '+requestedLayer+' data for '+requestedYear+'. Choose another year or layer.');
    if(actions.some(a=>['select_area','set_year','set_layer','set_simulation','set_shock','set_rate','reset_simulation'].includes(a.type)))this.timeline.pause();
    let focus=false,play=false,regionFocused=false;this.searchResult=null;
    for(const a of actions){
      switch(a.type){
        case 'clear_location':this.clearLocation();break;
        case 'locate_user':await this.locateUser();regionFocused=true;break;
        case 'show_map_position':{const camera=this.state().camera;await this.pinPosition({longitude:camera.longitude,latitude:camera.latitude,kind:'map',source:'current map centre'});regionFocused=true;break;}
        case 'select_area':this.select(a.target,false);focus=true;regionFocused=false;break;
        case 'focus_region':await this.focusRegion(a.region);regionFocused=true;break;
        case 'set_year':if(this.forecast.enabled!==(a.year>=2026))await this.forecast.setEnabled(a.year>=2026);await this.timeline.setYear(a.year);break;
        case 'set_layer':document.querySelector(`[data-layer="${layerIds[a.layer]}"]`).click();break;
        case 'set_view':document.querySelector('#view-'+a.mode).click();break;
        case 'set_overlay':if(a.overlay==='business_failure'){if(this.controls.mistEnabled!==a.enabled)document.querySelector('#mist-toggle').click();}else await this.forecast.setOverlay(a.overlay,a.enabled);break;
        case 'set_simulation':if(a.enabled&&!this.controls.surface)document.querySelector('[data-layer="terrain"]').click();if(this.forecast.enabled!==a.enabled)await this.forecast.setEnabled(a.enabled);break;
        case 'set_shock':{const area=a.target==='selected'?this.getSelected():a.target?this.find(a.target):null;if(a.target&&!area)throw new Error('Select an area first.');if(area){this.select(area.feature.properties.authority_name,false);focus=true;}await this.forecast.edit(a.variable,a.value,area?.feature.properties.authority_code);if(!actions.some(a=>a.type==='set_layer')){if(layerIds[a.variable])document.querySelector(`[data-layer="${layerIds[a.variable]}"]`).click();else if(a.variable==='deaths'){if(!this.controls.mistEnabled)document.querySelector('#mist-toggle').click();}else await this.forecast.setOverlay(a.variable,true);}break;}
        case 'optimize_simulation':{
          const response=await fetch('/api/forecast/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variable:a.variable,goal:a.goal,region:a.region,year:a.year,aggregation:a.aggregation||'extreme',scenario:this.forecast.appliedInputs||this.forecast.inputs}),signal:AbortSignal.timeout(60000)});
          const result=await response.json();if(!response.ok)throw new Error(result.error||'Simulation search unavailable.');
          this.timeline.pause();this.forecast.inputs=result.inputs;this.forecast.scope.value='';this.forecast.syncSliders();
          if(!this.forecast.enabled)await this.forecast.setEnabled(true);else await this.forecast.reload();
          if(layerIds[a.variable])document.querySelector(`[data-layer="${layerIds[a.variable]}"]`).click();
          else if(a.variable==='deaths'){if(!this.controls.mistEnabled)document.querySelector('#mist-toggle').click();}
          else await this.forecast.setOverlay(a.variable,true);
          await this.timeline.setYear(result.year);if(result.aggregation==='mean'){await this.focusRegion(result.region);regionFocused=true;}else{this.select(result.area.name,false);regionFocused=false;}this.forecast.scope.value='';this.forecast.syncSliders();focus=true;this.searchResult=result;break;
        }
        case 'set_rate':this.forecast.inputs.rate_bias=a.value;this.forecast.syncSliders();if(!this.forecast.enabled)await this.forecast.setEnabled(true);await this.forecast.reload();await this.forecast.setOverlay('rate',true);break;
        case 'reset_simulation':await this.forecast.reset();break;
        case 'play_timeline':play=true;break;
        case 'pause_timeline':play=false;this.timeline.pause();break;
        case 'zoom':this.navigation.zoom(a.factor);break;
        case 'reset_view':document.querySelector('#reset-view').click();break;
        case 'set_sidebar':{const button=document.querySelector('#sidebar-toggle');if((button.getAttribute('aria-expanded')==='true')!==a.enabled)button.click();break;}
        case 'set_sound':if(sfx.enabled!==a.enabled)document.querySelector('#sound-toggle').click();break;
      }
    }
    if(!regionFocused&&(focus||actions.some(a=>['set_view','set_year','set_layer','set_simulation','set_shock'].includes(a.type)))&&this.getSelected())await this.focusSelection();
    if(play&&!this.timeline.timer)this.timeline.play.click();
    const summary=(actions.some(a=>a.type==='clear_location')?'Location pins and legends removed; device coordinates cleared. ':'')+this.summary();return this.searchResult?summary+' '+(this.searchResult.goal==='min'?'Lowest':'Highest')+(this.searchResult.aggregation==='mean'?' average':' authority value')+' found across '+this.searchResult.area_count+' authorities in '+this.searchResult.region+' after '+this.searchResult.evaluations+' parameter settings. Sliders show the winning global settings. This bounded search does not prove a global optimum.':summary;
  }
  state(){const v=this.navigation.view,now=new Date();return {location_state:{pin_present:!!this.positionPin,marker_visible:!!this.locationMarker?.isConnected&&!this.locationMarker.hidden,legend_visible:!!this.locationNote?.isConnected,last_operation:this.lastLocationAction||null},browser_context:{time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,utc_offset_minutes:-now.getTimezoneOffset()},device_location:this.deviceLocation||null,position_pin:this.positionPin||null,camera:{zoom:v.zoom,longitude:(v.width/2-v.offsetX)/v.scale+v.west,latitude:latitudeAt(v.north-(v.height/2-v.offsetY)/v.scale),height:v.focusHeight||0},focused_region:this.focusedRegion||null,simulation_inputs:this.forecast.appliedInputs||this.forecast.inputs,layer:this.controls.surface||'borders',view:this.navigation.mode,year:this.timeline.year,simulation:this.forecast.enabled,selected_area:this.getSelected()?.feature.properties.authority_name||null,available_years:this.timeline.series()?.frames.map(f=>Number(f.year))||[],overlays:[...(this.controls.mistEnabled?['business_failure']:[]),...this.forecast.overlays]};}
  summary() {
    const state=this.state(),p=this.getSelected()?.feature.properties;
    let text=(state.simulation?'Simulated ':'Recorded ')+(state.year||'latest')+' · '+(VARIABLES[state.layer]||'Area boundaries')+' · '+state.view.toUpperCase()+'.';
    if(p){text+=' '+p.authority_name.replace(/ LPA$/,'')+': ';const values=[['Income per head',p.income_per_head,'£',''],['Population density',p.population_density,'',' / km²'],['Employment rate',p.employment_rate,'','%']];text+=values.map(([label,value,prefix,suffix])=>label+' '+(Number.isFinite(value)?prefix+value.toLocaleString(undefined,{maximumFractionDigits:suffix==='%'?1:0})+suffix:'unavailable')).join('; ')+'.';}
    if(this.positionPin)text+=' '+(this.positionPin.kind==='device'?'Device location':'Map point')+': '+this.positionPin.latitude.toFixed(4)+', '+this.positionPin.longitude.toFixed(4)+(this.positionPin.authority_name?' · '+this.positionPin.authority_name:'')+(this.positionPin.in_coverage?'.':' · outside UK map coverage.');
    if(state.simulation){const model=p&&this.forecast.data?.areas[this.forecast.byCode?.get(p.authority_code)];if(model?.estimated_inputs?.length)text+=' Estimated starting growth/input: '+model.estimated_inputs.map(v=>VARIABLES[v]).join(', ')+'.';text+=' Exploratory scenario, not a prediction.';}return text;
  }
}
