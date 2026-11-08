import test from 'node:test';
import assert from 'node:assert/strict';
import {AppActions} from '../../src/frontend/GUI/capri/actions.js';
const actions=new AppActions({areas:{areas:[{feature:{properties:{authority_name:'Kensington and Chelsea LPA',authority_code:'chelsea'}}},{feature:{properties:{authority_name:'Barnet LPA',authority_code:'barnet'}}}]}});
test('conversational Capri request resolves Chelsea and the future income view',()=>{
 const plan=actions.plan('Capri simulate what the income per head will look like in 2030 in Chelsea');
 assert.ok(plan);assert.ok(plan.some(a=>a.type==='select_area'&&a.target==='Kensington and Chelsea LPA'));assert.ok(plan.some(a=>a.type==='set_year'&&a.year===2030));assert.ok(plan.some(a=>a.type==='set_simulation'&&a.enabled));assert.ok(plan.some(a=>a.type==='set_layer'&&a.layer==='income'));
});
test('place abbreviations work without silently inventing an authority',()=>{
 assert.equal(actions.find('Chelsea').feature.properties.authority_code,'chelsea');
 assert.equal(actions.plan('Capri simulate income in 2030 in Atlantis'),null);
 assert.equal(actions.plan('Capri increase income growth in Chelsea by one standard deviation'),null);
});
