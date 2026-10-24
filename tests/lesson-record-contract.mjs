import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { normalizeLessonRecord, updateLessonRecord, mountClassDashboard } from '../js/utils/lesson-dashboard.js';
const dom = new JSDOM('<div id="root"><div id="class-lesson-dashboard"></div></div>');
Object.assign(globalThis,{document:dom.window.document,DOMParser:dom.window.DOMParser,Node:dom.window.Node});
const makePreset=(id,classId='a')=>({id,name:id,className:classId.toUpperCase(),classId,lessonRecord:normalizeLessonRecord(),projectState:{activePageId:'p',instructions:{html:'<p><strong>Original</strong></p>',origin:{private:'SECRET'}},pages:[{id:'p',name:'Page 1',snapshot:{layout:{widgets:[]}}}]}});
function makeApp(){return {
 presets:[makePreset('one'),makePreset('two'),makePreset('three','b')],
 dashboardRoot:document.getElementById('root'),saveStateImmediately(){},savePresets(){},renderDashboard(){},
 normalizePresetRecord(preset){return preset;},getPresetClassNames(){return [...new Set(this.presets.map(p=>p.className))].map(name=>({name}));}
};}
test('planning is explicit, exclusive within a class, and independent of taught history',()=>{
 const app=makeApp();
 assert(app.presets.every(p=>p.lessonRecord.stage==='planned'&&!p.lessonRecord.taught));
 updateLessonRecord(app,'one','current');updateLessonRecord(app,'three','current');updateLessonRecord(app,'two','current');
 assert.equal(app.presets[0].lessonRecord.stage,'planned');assert.equal(app.presets[1].lessonRecord.stage,'current');assert.equal(app.presets[2].lessonRecord.stage,'current');
 updateLessonRecord(app,'one','next');assert.equal(app.presets[0].lessonRecord.stage,'next');
 assert(app.presets.every(p=>!p.lessonRecord.taught));
});
test('a taught record freezes public content, rejects duplicate marking and permits correction/undo',()=>{
 const app=makeApp();updateLessonRecord(app,'one','link',{name:'Originals',url:'https://example.org/original'});
 assert(updateLessonRecord(app,'one','taught'));const frozen=JSON.stringify(app.presets[0].lessonRecord.taught);
 app.presets[0].projectState.instructions.html='<p>New planning</p>';
 assert.equal(updateLessonRecord(app,'one','taught'),false);assert.equal(JSON.stringify(app.presets[0].lessonRecord.taught),frozen);assert(!frozen.includes('SECRET'));
 assert.equal(updateLessonRecord(app,'one','date','2026-02-30'),false);
 assert(updateLessonRecord(app,'one','date','2026-10-20'));
 assert.equal(app.presets[0].lessonRecord.taught.date,'2026-10-20');
 updateLessonRecord(app,'one','undo-taught');assert.equal(app.presets[0].lessonRecord.taught,null);assert.equal(app.presets[0].lessonRecord.links.length,1);
});
test('original links are safe and deduplicated, and moving a deck retains its original class history',()=>{
 const app=makeApp();assert.equal(updateLessonRecord(app,'one','link',{name:'Unsafe',url:'javascript:alert(1)'}),false);
 updateLessonRecord(app,'one','link',{name:'Original',url:'https://example.org/'});updateLessonRecord(app,'one','link',{name:'Original again',url:'https://example.org/'});
 assert.equal(app.presets[0].lessonRecord.links.length,1);updateLessonRecord(app,'one','taught');
 Object.assign(app.presets[0],{className:'B',classId:'b'});
 mountClassDashboard(app,app.dashboardRoot,'A');assert.equal(app.dashboardRoot.querySelectorAll('.class-taught-history__entry').length,1);
 mountClassDashboard(app,app.dashboardRoot,'B');assert.equal(app.dashboardRoot.querySelectorAll('.class-taught-history__entry').length,0);
});
