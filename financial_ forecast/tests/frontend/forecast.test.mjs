import test from 'node:test';
import assert from 'node:assert/strict';
import {Forecast,forecastSeries,investmentArrowCount} from '../../src/frontend/GUI/forecast.js';
import {AppActions,validateAction} from '../../src/frontend/GUI/capri/actions.js';

const feature=(name,code)=>({properties:{authority_name:name,authority_code:code}});
const area=(name,code)=>({feature:feature(name,code)});

test('forecast frames join LADs to current planning areas by name, keeping gaps unavailable',()=>{
 const input={years:[2025,2026,2027],projected_from:2026,areas:[{name:'Barnet',code:'E09000003'}],values:{income:[[10,12,14]],density:[[100,110,120]],employment:[[70,null,75]]}};
 const result=forecastSeries(input,[feature('Barnet LPA','E60000003'),feature('Unmatched','other')],{income:[0,100],density:[0,4],employment:[50,95]});
 assert.deepEqual(result.income.frames.map(f=>f.year),['2026','2027']);
 assert.deepEqual(result.income.frames[0].observations,{E60000003:12});
 assert.deepEqual(result.employment.frames[0].observations,{});
 assert.deepEqual(result.employment.frames[1].observations,{E60000003:75});
 assert.equal(input.values.income[0][0],10);
});

test('actions reject unknown code, nonfinite values and ambiguous authority names',async()=>{
 for(const action of [{type:'eval',code:'bad'},{type:'zoom',factor:Infinity},{type:'set_shock',variable:'income',value:11},{type:'set_year',year:2019.5},{type:'set_sound',enabled:'true'}])assert.throws(()=>validateAction(action));
 const actions=new AppActions({areas:{areas:[area('North Somerset LPA','1'),area('Somerset LPA','2')]}});
 assert.equal(actions.find('Somerset').feature.properties.authority_code,'2');
 assert.throws(()=>actions.find('Som'),/Which area/);
 assert.throws(()=>actions.find('Missing'),/couldn’t find/);
 let called=false;actions.select=()=>{called=true;};
 await assert.rejects(actions.execute([{type:'select_area',target:'Somerset'},{type:'eval'}]));
 assert.equal(called,false,'all actions validated before any changes');
});

// Weather uses recorded source years until simulation is explicitly enabled.
test('weather overlays retain observed years and investment changes arrow concentration',()=>{
 const forecast=Object.create(Forecast.prototype);
 forecast.enabled=false;forecast.year=2025;
 forecast.data={years:[2023,2024,2025,2026],projected_from:2026,values:{weeklypay:[[650,null,null,680]]},regions:[{code:'region',fdi:[100,120,null,140]}],areas:[{region:'region'}]};
 forecast.byCode=new Map([['local',0]]);
 assert.equal(forecast.sourceYear('weeklypay'),2023);
 assert.equal(forecast.value('weeklypay','local'),650);
 assert.equal(forecast.sourceYear('fdi'),2024);
 assert.equal(forecast.value('fdi','local'),120);
 forecast.year=2026;assert.equal(forecast.value('weeklypay','local'),680);
 assert.equal(investmentArrowCount(null,[0,100]),0);
 assert.equal(investmentArrowCount(0,[0,100]),0);
 assert.ok(investmentArrowCount(90,[0,100])>investmentArrowCount(10,[0,100]));
 assert.equal(investmentArrowCount(1000,[0,100]),28);
});
