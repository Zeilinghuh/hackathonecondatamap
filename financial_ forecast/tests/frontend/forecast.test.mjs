import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastSeries} from '../../src/frontend/GUI/forecast.js';
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

test('local commands resolve Barnet 2019 and compose view/layer changes',()=>{
 const actions=new AppActions({areas:{areas:[area('Barnet LPA','1'),area('Barnsley LPA','2')]}});
 const plan=actions.plan('find Barnet in 2019');
 assert.deepEqual(plan,[{type:'select_area',target:'Barnet LPA'},{type:'set_simulation',enabled:false},{type:'set_year',year:2019}]);
 assert.deepEqual(actions.plan('show employment in 3D'),[{type:'set_layer',layer:'employment'},{type:'set_view',mode:'3d'}]);
 assert.equal(actions.plan("don't change the year to 2019"),null);
 assert.equal(actions.plan('why are incomes different?'),null);
 assert.equal(actions.plan('set income growth in Barnet to one standard deviation'),null);
 assert.equal(actions.plan('set the rate stance to 0.5'),null);
 assert.equal(actions.plan('find Atlantis in 2019'),null);
 assert.equal(actions.plan('find Barnet in 2019 and then 2020'),null);
});

test('actions reject unknown code, nonfinite values and ambiguous authority names',async()=>{
 for(const action of [{type:'eval',code:'bad'},{type:'zoom',factor:Infinity},{type:'set_shock',variable:'income',value:4},{type:'set_year',year:2019.5},{type:'set_sound',enabled:'true'}])assert.throws(()=>validateAction(action));
 const actions=new AppActions({areas:{areas:[area('North Somerset LPA','1'),area('Somerset LPA','2')]}});
 assert.equal(actions.find('Somerset').feature.properties.authority_code,'2');
 assert.throws(()=>actions.find('Som'),/Which area/);
 assert.throws(()=>actions.find('Missing'),/couldn’t find/);
 let called=false;actions.select=()=>{called=true;};
 await assert.rejects(actions.execute([{type:'select_area',target:'Somerset'},{type:'eval'}]));
 assert.equal(called,false,'all actions validated before any changes');
});
