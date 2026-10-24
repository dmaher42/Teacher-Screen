import { publicInstructions } from './instruction-rail.js?v=4';

const text = value => typeof value === 'string' ? value : '';
const escape = value => text(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
function safeLink(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
const links = value => (Array.isArray(value) ? value : []).map(link => ({ name: text(link?.name), url: safeLink(link?.url) })).filter(link => link.name && link.url);

export function normalizeLessonRecord(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const taught = source.taught && validDate(source.taught.date) ? {
        date: source.taught.date,
        title: text(source.taught.title),
        className: text(source.taught.className),
        classId: text(source.taught.classId),
        pageName: text(source.taught.pageName),
        outline: publicInstructions({ html: text(source.taught.outline) }).html,
        links: links(source.taught.links),
        resources: (Array.isArray(source.taught.resources) ? source.taught.resources : []).map(item => ({name:text(item?.name),pageId:text(item?.pageId)})).filter(item=>item.name)
    } : null;
    return { stage: ['current','next'].includes(source.stage) ? source.stage : 'planned', links: links(source.links), taught };
}

function lessonResources(preset) {
    return (preset.projectState?.pages || []).flatMap(page => (page.snapshot?.layout?.widgets || [])
        .filter(widget => ['DocumentViewerWidget','RevealManagerWidget','UrlViewerWidget'].includes(widget.type))
        .map(widget => ({name: text(widget.data?.fileName || widget.data?.activeDeck?.name || widget.data?.name || widget.data?.title || page.name),pageId:page.id})));
}

export function updateLessonRecord(app, id, action, value) {
    const focused = document.activeElement;
    const focusAttribute = ['data-lesson-stage','data-lesson-date','data-lesson-undo'].find(name=>focused?.hasAttribute(name));
    app.saveStateImmediately();
    const preset = app.presets.find(item => item.id === id);
    if (!preset) return false;
    const record = normalizeLessonRecord(preset.lessonRecord);
    if (action === 'planned') {
        record.stage = 'planned';
    } else if (action === 'current' || action === 'next') {
        app.presets.forEach(item => {
            if (item.id !== id && item.classId === preset.classId && item.lessonRecord?.stage === action) item.lessonRecord = { ...normalizeLessonRecord(item.lessonRecord), stage:'planned' };
        });
        record.stage = action;
    } else if (action === 'taught') {
        if (record.taught) return false;
        const page = preset.projectState?.pages?.find(item => item.id === preset.projectState.activePageId);
        record.taught = { date: localDate(), title:preset.name, className:preset.className, classId:preset.classId, pageName:page?.name || '', outline:publicInstructions(preset.projectState?.instructions).html, links:record.links.map(link=>({...link})), resources:lessonResources(preset) };
        record.stage = 'planned';
    } else if (action === 'undo-taught') {
        record.taught = null;
    } else if (action === 'date') {
        if (!record.taught || !validDate(value)) return false;
        record.taught.date = value;
    } else if (action === 'link') {
        const url = safeLink(value?.url);
        const name = text(value?.name).trim();
        if (!url || !name) return false;
        if (!record.links.some(link=>link.url===url)) record.links.push({ name, url });
    } else if (action === 'unlink') {
        record.links = record.links.filter(link=>link.url!==value);
    } else return false;
    preset.lessonRecord = record;
    app.savePresets(); app.renderDashboard();
    const target = focusAttribute ? [...app.dashboardRoot.querySelectorAll(`[${focusAttribute}]`)].find(node=>node.getAttribute(focusAttribute)===id) : null;
    (target || [...app.dashboardRoot.querySelectorAll('[data-deck-action="toggle"]')].find(node=>node.dataset.deckId===id))?.focus({preventScroll:true});
    return true;
}

export function mountClassDashboard(app, root, selectedClassName = '') {
    const slot = root.querySelector('#class-lesson-dashboard');
    if (!slot) return;
    const all = app.presets.map(preset => app.normalizePresetRecord(preset)).filter(Boolean);
    const historicalClasses = all.filter(preset=>preset.lessonRecord.taught?.className && !all.some(item=>item.classId===preset.lessonRecord.taught.classId)).map(preset=>preset.lessonRecord.taught.className);
    const classes = selectedClassName ? [selectedClassName] : [...new Set([...app.getPresetClassNames().map(item=>item.name), ...historicalClasses])];
    const button = (preset,label) => `<button type="button" class="control-button" data-lesson-open="${escape(preset.id)}">${escape(label)}</button>`;
    slot.innerHTML = classes.map(className => {
        const lessons = all.filter(preset=>preset.className===className);
        const classId = lessons[0]?.classId || all.find(preset=>preset.lessonRecord.taught?.className===className)?.lessonRecord.taught.classId;
        const current = lessons.find(preset=>preset.lessonRecord.stage==='current');
        const next = lessons.find(preset=>preset.lessonRecord.stage==='next');
        const history = all.filter(preset=>preset.lessonRecord.taught && (preset.lessonRecord.taught.classId ? preset.lessonRecord.taught.classId===classId : preset.lessonRecord.taught.className===className)).sort((a,b)=>b.lessonRecord.taught.date.localeCompare(a.lessonRecord.taught.date));
        const resourceLinks = new Map();
        lessons.forEach(preset=>preset.lessonRecord.links.forEach(link=>resourceLinks.set(link.url,link)));
        return `<section class="class-lesson-summary" aria-label="${escape(className)} dashboard">
            ${selectedClassName ? '' : `<h2>${escape(className)}</h2>`}
            <div class="class-lesson-summary__grid">
                <section><h3>Current lesson</h3>${current ? button(current,current.name) : '<span>—</span>'}${current ? `<p>${escape(current.projectState?.pages?.find(page=>page.id===current.projectState.activePageId)?.name || '')}</p>`:''}</section>
                <section><h3>Next lesson</h3>${next ? button(next,next.name) : '<span>—</span>'}</section>
                <section><h3>Resources</h3><button class="control-button" type="button" aria-label="Files for ${escape(className)}" data-class-resources="${escape(className)}">Files</button>${[...resourceLinks.values()].map(link=>`<a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.name)}</a>`).join('')}</section>
            </div>
            <details class="class-taught-history"${selectedClassName ? ' open' : ''}><summary>Past lessons${history.length ? ` (${history.length})` : ''}</summary>
            ${history.map(preset=>{
                const taught=preset.lessonRecord.taught;
                return `<article class="class-taught-history__entry"><div>${button(preset,taught.title)}<label><span class="visually-hidden">Date taught: ${escape(taught.title)}</span><input type="date" data-lesson-date="${escape(preset.id)}" value="${taught.date}"></label><button class="control-button" type="button" data-lesson-undo="${escape(preset.id)}">Undo taught</button></div><details><summary>Record</summary><p>${escape(taught.pageName)}</p><div class="lesson-history-outline ql-editor">${taught.outline}</div>${taught.links.map(link=>`<a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.name)}</a>`).join('')}${taught.resources.map(resource=>`<p>${escape(resource.name)}</p>`).join('')}</details></article>`;
            }).join('') || '<span>—</span>'}</details>
        </section>`;
    }).join('');
    slot.querySelectorAll('[data-lesson-open]').forEach(button=>button.addEventListener('click',()=>app.loadPresetFromDashboard(button.dataset.lessonOpen)));
    slot.querySelectorAll('[data-lesson-date]').forEach(input=>input.addEventListener('change',()=>{if(!updateLessonRecord(app,input.dataset.lessonDate,'date',input.value)) app.renderDashboard();}));
    slot.querySelectorAll('[data-lesson-undo]').forEach(button=>button.addEventListener('click',()=>updateLessonRecord(app,button.dataset.lessonUndo,'undo-taught')));
}
