import { sanitizePresentationMarkup } from './reveal-manager.js';

const copy = value => JSON.parse(JSON.stringify(value));
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const recordPageId = 'recovered-lesson-record-v1';

function richHTML(value = '') {
    const root = document.createElement('div');
    root.innerHTML = sanitizePresentationMarkup(value);
    root.querySelectorAll('*').forEach(node => {
        node.removeAttribute('id');
        node.removeAttribute('hidden');
        for (const property of Array.from(node.style)) {
            if (!['color','background-color','font-size','font-family','font-weight','font-style','text-align','text-decoration'].includes(property)) node.style.removeProperty(property);
        }
        if (node.hasAttribute('class')) {
            node.className = node.className.split(/\s+/).filter(name => /^(ql-(align|indent|size|font|direction|line-spacing)-[\w-]+|ql-ui|display-callout)$/.test(name)).join(' ');
            if (!node.className) node.removeAttribute('class');
        }
    });
    return root.innerHTML;
}

// Only the exact plain-text HTML emitted by the removed legacy migration is
// converted back to fields. Anything richer is retained as a Text Board.
function legacyFields(value = {}) {
    if (typeof value.html !== 'string') return { ...value };
    const root = document.createElement('div'); root.innerHTML = value.html;
    const nodes = Array.from(root.childNodes);
    const fields = { today:'', now:'', next:'' };
    if (nodes.length % 2) return null;
    const seen = new Set();
    for (let index=0; index<nodes.length; index+=2) {
        const heading=nodes[index], paragraph=nodes[index+1];
        const key=heading.textContent.toLowerCase();
        if (heading.nodeName!=='H2' || !['today','now','next'].includes(key) || seen.has(key)
            || heading.attributes.length || paragraph.nodeName!=='P' || paragraph.attributes.length
            || Array.from(paragraph.childNodes).some(node=>node.nodeType!==Node.TEXT_NODE && node.nodeName!=='BR')) return null;
        const fragment=paragraph.cloneNode(true);
        fragment.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));
        if (fragment.textContent.length>4000) return null;
        fields[key]=fragment.textContent; seen.add(key);
    }
    return { visible:value.visible===true, width:value.width, fontSize:value.fontSize, ...fields };
}

export function hasSavedLessonRecord(record) {
    return Boolean(record && (record.taught || record.links?.length || ['current','next'].includes(record.stage)));
}

function board(id, html, saved = {}, title = 'Lesson outline') {
    return { id, type:'RichTextWidget', layoutType:'grid',
        x:Number.isFinite(saved.x)?saved.x:40, y:Number.isFinite(saved.y)?saved.y:40,
        width:Number.isFinite(saved.width)?saved.width:520, height:Number.isFinite(saved.height)?saved.height:340,
        minimized:saved.minimized===true,
        visibleOnProjector:saved.visibleOnProjector!==false,
        projectorVisibilityConfigured:true,
        data:{ customTitle:saved.data?.customTitle || title, content:richHTML(html), displayMode:saved.data?.displayMode===true, presentationMode:'normal' }
    };
}

export function recoverRedesignState(value = {}, record = null) {
    const hasRich = typeof value?.instructions?.html === 'string';
    const recoverRecord = hasSavedLessonRecord(record) && (record.rollbackRecovered!==true || hasRich);
    if (!hasRich && !recoverRecord) return value;
    const state=copy(value);
    if (!Array.isArray(state.pages) || !state.pages.length) state.pages=[{id:'page-1',name:'Page 1',snapshot:{theme:state.theme,background:state.background,layout:state.layout || {mode:'dashboard',widgets:[]}}}];
    const active=state.pages.find(page=>page.id===state.activePageId) || state.pages[0];
    const addBoard=(page, widget) => {
        page.snapshot ||= {};
        page.snapshot.layout ||= {mode:'dashboard',widgets:[]};
        page.snapshot.layout.widgets ||= [];
        if (!page.snapshot.layout.widgets.some(item=>item.id===widget.id)) page.snapshot.layout.widgets.push(widget);
    };
    if (hasRich) {
        const instructions=state.instructions;
        const origin=instructions.origin?.widget?.type==='RichTextWidget' ? instructions.origin : null;
        const previous=origin ? origin.previous || {} : instructions;
        const legacy=legacyFields(previous);
        state.instructions=legacy || {visible:false,width:previous.width,fontSize:previous.fontSize,today:'',now:'',next:''};
        if (origin) {
            const page=state.pages.find(item=>item.id===origin.pageId) || active;
            addBoard(page,board('recovered-instruction-outline-v1',instructions.html,origin.widget));
            if (!legacy && previous.html) addBoard(page,board('recovered-previous-instructions-v1',previous.html,{visibleOnProjector:previous.visible===true},'Previous instructions'));
        } else if (!legacy && instructions.html) {
            addBoard(active,board('recovered-instruction-outline-v1',instructions.html,{visibleOnProjector:instructions.visible===true}));
        }
    }
    if (recoverRecord && !state.pages.some(page=>page.id===recordPageId)) {
        const taught=record.taught;
        const linkMarkup=links=>(Array.isArray(links)?links:[]).map(link=>{
            try { const url=new URL(link.url);return ['https:','http:'].includes(url.protocol) ? `<p><a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(link.name)}</a></p>` : ''; } catch { return ''; }
        }).join('');
        const html=`<h2>Saved lesson record</h2>${['current','next'].includes(record.stage)?`<p>${escape(record.stage)} lesson</p>`:''}${linkMarkup(record.links)}${taught?`<h3>${escape(taught.title)}</h3><p>Taught ${escape(taught.date)}</p><p>${escape(taught.className)} · ${escape(taught.pageName)}</p>${richHTML(taught.outline)}${linkMarkup(taught.links)}${(Array.isArray(taught.resources)?taught.resources:[]).map(resource=>`<p>${escape(resource.name)}</p>`).join('')}`:''}`;
        const page={id:recordPageId,name:'Saved lesson record',snapshot:{...copy(active.snapshot),layout:{mode:'dashboard',widgets:[]},timerStates:[],lessonPlan:null}};
        addBoard(page,board('recovered-lesson-record-board-v1',html,{visibleOnProjector:false},'Saved lesson record'));
        page.snapshot.layout.widgets[0].data.teacherOnly = true;
        state.pages.push(page);
    }
    state.activePageId=active.id;
    state.layout=copy(active.snapshot.layout);
    return state;
}

export function recoverRedesignPreset(preset) {
    if (!hasSavedLessonRecord(preset.lessonRecord)) return preset;
    return { ...preset,
        projectState:recoverRedesignState(preset.projectState || {layout:preset.layout},preset.lessonRecord),
        lessonRecord:{...preset.lessonRecord,rollbackRecovered:true}
    };
}
