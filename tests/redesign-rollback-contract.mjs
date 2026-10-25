import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {recoverRedesignState,recoverRedesignPreset} from '../js/utils/redesign-rollback.js';
const dom=new JSDOM();Object.assign(globalThis,{document:dom.window.document,DOMParser:dom.window.DOMParser,Node:dom.window.Node});
const state=()=>({currentDeckId:'deck-a',projectName:'Synthetic',activePageId:'p',pages:[{id:'p',name:'Page 1',snapshot:{theme:'theme-professional',background:{},layout:{mode:'dashboard',widgets:[]}}}],instructions:{visible:true,width:35,fontSize:32,html:'<h2>Outline</h2><p><strong>Keep formatting</strong></p>'}});
const previous={visible:true,width:30,fontSize:28,html:'<h2>Today</h2><p>Literal &lt;tag&gt;<br>New line</p><h2>Next</h2><p>Compare</p>'};
test('pinned source and old plain fields recover losslessly and idempotently',()=>{
 const original=state();original.instructions.origin={pageId:'deleted',widget:{type:'RichTextWidget',x:80,y:100,width:400,height:300,visibleOnProjector:false,data:{customTitle:'My outline'}},previous};
 const migrated=recoverRedesignState(original);
 assert.equal(migrated.instructions.today,'Literal <tag>\nNew line');assert.equal(migrated.instructions.next,'Compare');
 const board=migrated.pages[0].snapshot.layout.widgets[0];assert(board.data.content.includes('<strong>Keep formatting</strong>'));assert.equal(board.visibleOnProjector,false);assert.equal(board.data.customTitle,'My outline');
 assert.deepEqual(recoverRedesignState(migrated),migrated);assert.equal(original.pages[0].snapshot.layout.widgets.length,0);
});
test('rich standalone and previous content remain boards; hidden instructions remain private',()=>{
 const original=state();original.instructions.visible=false;
 const migrated=recoverRedesignState(original);assert.equal(migrated.instructions.visible,false);assert.equal(migrated.layout.widgets[0].visibleOnProjector,false);
 original.instructions.origin={pageId:'p',widget:{type:'RichTextWidget'},previous:{visible:false,html:'<p><em>Earlier rich outline</em></p>'}};
 const both=recoverRedesignState(original);assert.equal(both.layout.widgets.length,2);assert(both.layout.widgets[1].data.content.includes('<em>Earlier rich outline</em>'));
});
test('legacy template restores only exact plain text; richer or long content is never truncated',()=>{
 assert.equal(recoverRedesignState({...state(),instructions:previous}).layout.widgets.length,0);
 const original=state();original.instructions.html='<h2>Today</h2><p>'+ 'x'.repeat(5000)+'</p>';
 assert(recoverRedesignState(original).layout.widgets[0].data.content.includes('x'.repeat(5000)));
});
test('taught data and original links remain intact plus an editable teacher-only record page',()=>{
 const record={stage:'next',links:[{name:'Original',url:'https://example.org/'}],taught:{date:'2026-10-20',title:'Recorded title',className:'Synthetic A',pageName:'Page 1',outline:'<p><b>Frozen outline</b></p>',links:[],resources:[{name:'Original.pdf'}]}};
 const preset={id:'deck-a',name:'Synthetic',projectState:state(),lessonRecord:record};
 const migrated=recoverRedesignPreset(preset);assert.deepEqual({...migrated.lessonRecord,rollbackRecovered:undefined},{...record,rollbackRecovered:undefined});
 const page=migrated.projectState.pages.find(page=>page.id==='recovered-lesson-record-v1');assert(page);assert.equal(page.snapshot.layout.widgets[0].visibleOnProjector,false);assert(page.snapshot.layout.widgets[0].data.content.includes('2026-10-20'));assert(page.snapshot.layout.widgets[0].data.content.includes('Original.pdf'));
 assert.deepEqual(recoverRedesignPreset(migrated),migrated);
 migrated.projectState.pages=migrated.projectState.pages.filter(page=>page.id!=='recovered-lesson-record-v1');assert.equal(recoverRedesignPreset(migrated).projectState.pages.length,1,'Intentional deletion does not recreate a recovery page');
});
