// Capri's only application entry point: validated actions reuse existing controls.
import {normaliseArea,VARIABLES} from '../forecast.js';
import {latitudeAt} from '../../map/terrainmath.js';
import {sfx} from '../terraincontrols.js';

export const ACTION_TYPES=['select_area','set_year','set_layer','set_view','set_overlay','set_simulation','set_shock','set_rate','reset_simulation','play_timeline','pause_timeline','zoom','reset_view','set_sidebar','set_sound'];
const layerIds={income:'terrain',density:'density',employment:'vegetation',borders:'borders'};
export function validateAction(action) {
  if(!action || !ACTION_TYPES.includes(action.type))throw new Error('Unknown application action.');
  if(Object.keys(action).some(key=>!['type','target','year','layer','mode','overlay','enabled','variable','value','factor'].includes(key)))throw new Error('Unknown application argument.');
  const enumValue=(key,allowed)=>{if(!allowed.includes(action[key]))throw new Error('Invalid '+key+'.');};
  const number=(key,min,max)=>{if(!Number.isFinite(action[key])||action[key]<min||action[key]>max)throw new Error('Invalid '+key+'.');};
  const target=()=>{if(typeof action.target!=='string'||!action.target.trim()||action.target.length>120)throw new Error('Choose an area by name.');};
  if(action.type==='select_area')target();
  if(action.type==='set_year'){number('year',1991,2035);if(!Number.isInteger(action.year))throw new Error('Choose a whole year.');}
  if(action.type==='set_layer')enumValue('layer',Object.keys(layerIds));
  if(action.type==='set_view')enumValue('mode',['2d','3d']);
  if(action.type==='set_overlay')enumValue('overlay',['business_failure','weeklypay','fdi','rate']);
  if(['set_overlay','set_simulation','set_sidebar','set_sound'].includes(action.type)&&typeof action.enabled!=='boolean')throw new Error('Use an on/off value.');
  if(action.type==='set_shock'){enumValue('variable',Object.keys(VARIABLES));number('value',-3,3);if(action.target!==undefined)target();}
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
  select(query) {
    const area=this.find(query),b=area.bounds,points=this.areas.triangles(area);
    let x=(b[0]+b[2])/2,z=(b[1]+b[3])/2;
    if(this.areas.find([x,latitudeAt(z)])!==area&&points.length>=6){x=(points[0]+points[2]+points[4])/3;z=(points[1]+points[3]+points[5])/3;}
    this.onSelect(area,[x,latitudeAt(z)]);this.navigation.focus(b);return area;
  }
  plan(message) {
    const text=message.toLowerCase().trim().replace(/^(?:hey[\s,]+)?capri[\s,:-]*/,'').replace(/^(?:can|could|would|will)\s+you\s+(?:please\s+)?/,'');if(/\b(?:don'?t|do not|never)\b/.test(text))return null;
    // Parameter edits need the model's structured action; a layer-name match
    // must not consume an instruction such as "set income growth in Barnet".
    if(/\b(?:shock|growth|stance|increase|decrease|boost|raise|lower|standard deviations?)\b/.test(text))return null;
    const result=[];
    const year=text.match(/\b(19\d{2}|20\d{2})\b/);
    if(new Set(text.match(/\b(?:19\d{2}|20\d{2})\b/g)||[]).size>1)return null;
    let area=this.areas.areas.filter(a=>{
      const name=a.feature.properties.authority_name.toLowerCase().replace(/ lpa$/,'').replace(/^city of /,'');
      return name.length>=3&&new RegExp('\\b'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b').test(text);
    }).sort((a,b)=>b.feature.properties.authority_name.length-a.feature.properties.authority_name.length)[0];
    if(!area) {
      const place=text.match(/\b(?:in|for|at|to)\s+([a-z][a-z '&.-]+?)(?=\s+(?:in|for|during|by)\s+(?:the\s+year\s+)?(?:19|20)\d{2}\b|[?.!,]?$)/);
      if(place)try{area=this.find(place[1].trim());}catch{return null;}
    }
    if(!area&&/\b(?:find|focus|take me|go to|select)\b/.test(text)&&! /^(?:please\s+)?(?:go to|select)\s+(?:the\s+)?(?:year\s+)?\d{4}[.!?]?$/.test(text))return null;
    const control=/^(?:please\s+)?(?:simulate|forecast|project|find|show|go to|focus|select|take me|switch|change|set|enable|disable|turn|hide|open|close|play|pause|stop|zoom|reset|mute|unmute|start|return|use)\b/.test(text);
    if(area&&(control||year))result.push({type:'select_area',target:area.feature.properties.authority_name});
    if(!control&&!result.length)return null;
    if(/\b(?:recorded|historical)\b/.test(text))result.push({type:'set_simulation',enabled:false});
    if(/\bsimulation\b/.test(text)&&!/\breset\b/.test(text))result.push({type:'set_simulation',enabled:!(/\b(?:off|disable|stop|leave)\b/.test(text))});
    const layer=/population density|\bdensity\b/.test(text)?'density':/employment/.test(text)?'employment':/income/.test(text)?'income':/boundaries|borders/.test(text)?'borders':null;
    if(layer)result.push({type:'set_layer',layer});
    if(year){result.push({type:'set_simulation',enabled:Number(year[1])>=2026},{type:'set_year',year:Number(year[1])});}
    if(/\b3d\b/.test(text))result.push({type:'set_view',mode:'3d'});else if(/\b2d\b/.test(text))result.push({type:'set_view',mode:'2d'});
    const off=/\b(?:hide|off|disable|remove)\b/.test(text);
    if(/\b(?:panel|sidebar)\b/.test(text))result.push({type:'set_sidebar',enabled:!off&&!/close/.test(text)});
    if(/\b(?:mute|unmute|sound|sfx)\b/.test(text))result.push({type:'set_sound',enabled:/unmute/.test(text)||(!/\bmute\b/.test(text)&&!off)});
    if(/\b(?:play|animate|start playback)\b/.test(text))result.push({type:'play_timeline'});else if(/\b(?:pause|stop playback)\b/.test(text))result.push({type:'pause_timeline'});
    if(/zoom/.test(text))result.push({type:'zoom',factor:/out/.test(text)?1/1.4:1.4});
    if(/reset.*(?:view|map)|\buk view\b/.test(text))result.push({type:'reset_view'});
    if(/reset.*simulation/.test(text))result.push({type:'reset_simulation'});
    const overlay=/business failure|business closures|\bmist\b/.test(text)?'business_failure':/weekly pay|\brain\b/.test(text)?'weeklypay':/foreign investment|\bfdi\b|\bwind\b/.test(text)?'fdi':/rate signal|thermometer/.test(text)?'rate':null;
    if(overlay&&!/growth|shock|increase|decrease/.test(text))result.push({type:'set_overlay',overlay,enabled:!off});
    return result.length?result:null;
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
    for(const a of actions){
      switch(a.type){
        case 'select_area':this.select(a.target);break;
        case 'set_year':if(this.forecast.enabled!==(a.year>=2026))await this.forecast.setEnabled(a.year>=2026);await this.timeline.setYear(a.year);break;
        case 'set_layer':document.querySelector(`[data-layer="${layerIds[a.layer]}"]`).click();break;
        case 'set_view':document.querySelector('#view-'+a.mode).click();break;
        case 'set_overlay':if(a.overlay==='business_failure'){if(this.controls.mistEnabled!==a.enabled)document.querySelector('#mist-toggle').click();}else await this.forecast.setOverlay(a.overlay,a.enabled);break;
        case 'set_simulation':if(this.forecast.enabled!==a.enabled)await this.forecast.setEnabled(a.enabled);break;
        case 'set_shock':{const area=a.target==='selected'?this.getSelected():a.target?this.find(a.target):null;if(a.target&&!area)throw new Error('Select an area first.');await this.forecast.edit(a.variable,a.value,area?.feature.properties.authority_code);break;}
        case 'set_rate':this.forecast.inputs.rate_bias=a.value;this.forecast.syncSliders();if(!this.forecast.enabled)await this.forecast.setEnabled(true);await this.forecast.reload();break;
        case 'reset_simulation':await this.forecast.reset();break;
        case 'play_timeline':if(!this.timeline.timer)this.timeline.play.click();break;
        case 'pause_timeline':this.timeline.pause();break;
        case 'zoom':this.navigation.zoom(a.factor);break;
        case 'reset_view':document.querySelector('#reset-view').click();break;
        case 'set_sidebar':{const button=document.querySelector('#sidebar-toggle');if((button.getAttribute('aria-expanded')==='true')!==a.enabled)button.click();break;}
        case 'set_sound':if(sfx.enabled!==a.enabled)document.querySelector('#sound-toggle').click();break;
      }
    }
    return this.summary();
  }
  state(){return {layer:this.controls.surface||'borders',view:this.navigation.mode,year:this.timeline.year,simulation:this.forecast.enabled,selected_area:this.getSelected()?.feature.properties.authority_name||null,available_years:this.timeline.series()?.frames.map(f=>Number(f.year))||[],overlays:[...(this.controls.mistEnabled?['business_failure']:[]),...this.forecast.overlays]};}
  summary() {
    const state=this.state(),p=this.getSelected()?.feature.properties;
    let text=(state.simulation?'Simulated ':'Recorded ')+(state.year||'latest')+' · '+(VARIABLES[state.layer]||'Area boundaries')+' · '+state.view.toUpperCase()+'.';
    if(p){text+=' '+p.authority_name.replace(/ LPA$/,'')+': ';const values=[['Income per head',p.income_per_head,'£',''],['Population density',p.population_density,'',' / km²'],['Employment rate',p.employment_rate,'','%']];text+=values.map(([label,value,prefix,suffix])=>label+' '+(Number.isFinite(value)?prefix+value.toLocaleString(undefined,{maximumFractionDigits:suffix==='%'?1:0})+suffix:'unavailable')).join('; ')+'.';}
    if(state.simulation){const model=p&&this.forecast.data?.areas[this.forecast.byCode?.get(p.authority_code)];if(model?.estimated_inputs?.length)text+=' Estimated starting growth/input: '+model.estimated_inputs.map(v=>VARIABLES[v]).join(', ')+'.';text+=' Exploratory scenario, not a prediction.';}return text;
  }
}
