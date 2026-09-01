const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const syncToken = 'projector-reconnect-smoke-token';
const useRealReveal = process.argv.includes('--real-reveal');
const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8'
};

function createStaticServer() {
    return http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://127.0.0.1');
        const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
        const filePath = path.resolve(root, `.${decodeURIComponent(requestedPath)}`);

        if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            response.writeHead(404);
            response.end('Not found');
            return;
        }

        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(response);
    });
}

async function launchBrowser() {
    const candidates = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
    for (const candidate of candidates) {
        try {
            return await chromium.launch({ ...candidate, headless: true });
        } catch (_error) {
            // Try the next locally available browser.
        }
    }
    throw new Error('Unable to launch Edge, Chrome, or bundled Chromium.');
}

async function dragElementBy(page, selector, deltaX, deltaY) {
    const element = page.locator(selector);
    const box = await element.boundingBox();
    if (!box) {
        throw new Error(`Unable to drag hidden element: ${selector}`);
    }

    const startX = box.x + (box.width / 2);
    const startY = box.y + (box.height / 2);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
    await page.mouse.up();
}

async function selectWidgetForEditing(page, selector) {
    const element = page.locator(selector).first();
    const box = await element.boundingBox();
    if (!box) {
        throw new Error(`Unable to select hidden widget: ${selector}`);
    }

    await page.mouse.click(box.x + 3, box.y + Math.min(Math.max(box.height / 2, 3), box.height - 3));
    await page.waitForFunction((widgetSelector) => (
        document.querySelector(widgetSelector)?.classList.contains('is-editing-selected') === true
    ), selector, { timeout: 10000 });
}

async function run() {
    const server = createStaticServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const browser = await launchBrowser();
    const context = await browser.newContext();

    try {
        await context.route(/^https:\/\//, (route) => {
            const hostname = new URL(route.request().url()).hostname;
            if (useRealReveal && hostname === 'cdn.jsdelivr.net') {
                return route.continue();
            }
            return route.abort('blockedbyclient');
        });
        await context.addInitScript(({ token, fakeReveal }) => {
            sessionStorage.setItem('teacher-screen-projector-sync-token', token);
            if (!fakeReveal) {
                return;
            }
            window.Reveal = class FakeRevealDeck {
                constructor() {
                    this.indices = { h: 0, v: 0 };
                    this.listeners = new Map();
                    this.ready = false;
                }

                on(type, listener) {
                    const listeners = this.listeners.get(type) || new Set();
                    listeners.add(listener);
                    this.listeners.set(type, listeners);
                }

                off(type, listener) {
                    this.listeners.get(type)?.delete(listener);
                }

                emit(type) {
                    const event = { indexh: this.indices.h, indexv: this.indices.v };
                    this.listeners.get(type)?.forEach((listener) => listener(event));
                }

                async initialize() {
                    this.ready = true;
                    return this;
                }

                isReady() {
                    return this.ready;
                }

                getIndices() {
                    return { ...this.indices };
                }

                slide(h = 0, v = 0) {
                    this.indices = { h, v };
                    this.emit('slidechanged');
                }

                next() {
                    this.slide(this.indices.h + 1, this.indices.v);
                }

                prev() {
                    this.slide(Math.max(0, this.indices.h - 1), this.indices.v);
                }

                up() {
                    this.slide(this.indices.h, Math.max(0, this.indices.v - 1));
                }

                down() {
                    this.slide(this.indices.h, this.indices.v + 1);
                }

                layout() {}

                destroy() {
                    this.ready = false;
                    this.listeners.clear();
                }
            };
        }, { token: syncToken, fakeReveal: !useRealReveal });

        const projectorPage = await context.newPage();
        await projectorPage.goto(`${baseUrl}/projector.html?syncToken=${syncToken}`, { waitUntil: 'domcontentloaded' });
        await projectorPage.waitForFunction(() => Boolean(window.__TeacherScreenProjectorApp));

        const teacherPage = await context.newPage();
        await teacherPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await teacherPage.waitForFunction(() => Boolean(window.__TeacherScreenApp));
        await projectorPage.waitForFunction(() => window.__TeacherScreenProjectorApp?.hasTeacherSync === true);
        console.log('PASS: A projector opened first automatically connects when the teacher screen becomes ready');

        await projectorPage.evaluate(() => {
            window.__TeacherScreenProjectorApp.hasTeacherSync = false;
        });
        await teacherPage.reload({ waitUntil: 'domcontentloaded' });
        await teacherPage.waitForFunction(() => Boolean(window.__TeacherScreenApp));
        await projectorPage.waitForFunction(() => window.__TeacherScreenProjectorApp?.hasTeacherSync === true);
        console.log('PASS: An open projector automatically reconnects after the teacher screen refreshes');

        const projectorLaunch = await teacherPage.evaluate(() => {
            const originalOpen = window.open;
            let call = null;
            window.open = (...args) => {
                call = args;
                return null;
            };
            window.__TeacherScreenApp.openProjectorView();
            window.open = originalOpen;
            return call;
        });
        const projectorLaunchUrl = new URL(projectorLaunch?.[0] || baseUrl);
        if (projectorLaunchUrl.searchParams.get('syncToken') !== syncToken) {
            throw new Error('Projector action did not preserve the teacher pairing token');
        }
        console.log('PASS: Projector action opens a paired projector that can receive teacher updates');

        const testWidgets = await teacherPage.evaluate(async () => {
            const app = window.__TeacherScreenApp;
            app.handleNavClick('classroom');
            const textBoardWidget = app.addWidget('rich-text', {
                notification: 'Resize sync test board added',
                initialData: {
                    content: '<p>Projector sync content marker</p>',
                    displayMode: false,
                    presentationMode: 'normal'
                }
            });
            const noiseMeterWidget = app.addWidget('noise-meter', { notification: 'Layer sync test meter added' });
            const info = app.layoutManager.widgets.find((candidate) => candidate.widget === textBoardWidget);
            const noiseInfo = app.layoutManager.widgets.find((candidate) => candidate.widget === noiseMeterWidget);
            return {
                textBoard: {
                    id: info.id,
                    width: info.width,
                    height: info.height
                },
                noiseMeter: {
                    id: noiseInfo.id,
                    width: noiseInfo.width,
                    height: noiseInfo.height
                }
            };
        });
        const textBoard = testWidgets.textBoard;
        const noiseMeter = testWidgets.noiseMeter;
        const noiseMeterAreaRatio = (noiseMeter.width * noiseMeter.height) / (textBoard.width * textBoard.height);
        if (noiseMeterAreaRatio > 0.3) {
            throw new Error(`Noise Meter should use no more than 30% of a Text Board (${JSON.stringify({ noiseMeter, textBoard, noiseMeterAreaRatio })})`);
        }
        const minimalNoiseMeter = await teacherPage.evaluate((noiseMeterId) => {
            const app = window.__TeacherScreenApp;
            const info = app?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            const widget = info?.widget;
            if (!widget) return null;
            const canvas = app.layoutManager.getCanvasMetrics();
            const minimum = app.layoutManager.getConstrainedSize(widget, 1, 1);
            const previousMinimumArea = (3 * canvas.width / app.layoutManager.gridColumns)
                * (2.25 * canvas.height / app.layoutManager.gridRows);
            return {
                minimumAreaRatio: (minimum.width * minimum.height) / previousMinimumArea,
                visibleCounterText: widget.warningCounter?.textContent?.trim(),
                counterLabel: widget.warningCounter?.getAttribute('aria-label'),
                statusTextHidden: widget.classroomStatusText?.classList.contains('visually-hidden') === true,
                scaleRemoved: !widget.element.querySelector('.noise-meter-scale')
            };
        }, noiseMeter.id);
        if (!minimalNoiseMeter
            || minimalNoiseMeter.minimumAreaRatio > 0.5
            || minimalNoiseMeter.visibleCounterText !== '0'
            || minimalNoiseMeter.counterLabel !== '0 noise warnings'
            || !minimalNoiseMeter.statusTextHidden
            || !minimalNoiseMeter.scaleRemoved) {
            throw new Error(`Noise Meter should be at least 50% smaller at minimum and show only its meter and counter (${JSON.stringify(minimalNoiseMeter)})`);
        }
        console.log('PASS: Noise Meter opens compactly, resizes over 50% smaller, and removes classroom text');
        const thresholdPlacement = await teacherPage.evaluate((noiseMeterId) => {
            const app = window.__TeacherScreenApp;
            const info = app?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            const widget = info?.widget;
            if (!widget) return null;
            app.openWidgetSettings(widget);
            const placement = {
                visibleOnWidget: widget.element.contains(widget.thresholdControl),
                thresholdInSettings: document.getElementById('widget-settings-modal')?.contains(widget.thresholdControl) === true,
                displayInSettings: document.getElementById('widget-settings-modal')?.contains(widget.displayModeControl) === true,
                displayChoices: Array.from(widget.displayModeInputs?.keys?.() || []),
                startInSettings: document.getElementById('widget-settings-modal')?.contains(widget.startButton) === true,
                resetInSettings: document.getElementById('widget-settings-modal')?.contains(widget.resetCountButton) === true,
                statusInSettings: document.getElementById('widget-settings-modal')?.contains(widget.status) === true
            };
            app.closeWidgetSettings({ restoreFocus: false });
            return placement;
        }, noiseMeter.id);
        if (thresholdPlacement?.visibleOnWidget
            || !thresholdPlacement?.thresholdInSettings
            || !thresholdPlacement?.displayInSettings
            || thresholdPlacement?.displayChoices?.join(',') !== 'compact,gauge,timeline'
            || !thresholdPlacement?.startInSettings
            || !thresholdPlacement?.resetInSettings
            || !thresholdPlacement?.statusInSettings) {
            throw new Error(`Noise Meter setup controls should live in Settings (${JSON.stringify(thresholdPlacement)})`);
        }
        console.log('PASS: Noise Meter setup and three display choices stay in Settings instead of taking student-view space');
        const microphoneStartGuard = await teacherPage.evaluate(async (noiseMeterId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            const widget = info?.widget;
            if (!widget) return null;

            const originalStart = widget.meter.start;
            let resolveStart;
            let startCalls = 0;
            widget.meter.start = () => {
                startCalls += 1;
                return new Promise((resolve) => {
                    resolveStart = resolve;
                });
            };

            widget.start();
            widget.start();
            const whilePending = {
                startCalls,
                isStarting: widget.isStarting,
                buttonDisabled: widget.startButton.disabled,
                buttonText: widget.startButton.textContent
            };
            resolveStart();
            await new Promise((resolve) => setTimeout(resolve, 0));
            const afterSuccess = {
                isStarting: widget.isStarting,
                isListening: widget.isListening,
                buttonText: widget.startButton.textContent
            };

            widget.meter.start = originalStart;
            widget.stop();
            return { whilePending, afterSuccess };
        }, noiseMeter.id);
        if (microphoneStartGuard?.whilePending?.startCalls !== 1
            || microphoneStartGuard.whilePending.isStarting !== true
            || microphoneStartGuard.whilePending.buttonDisabled !== true
            || microphoneStartGuard.whilePending.buttonText !== 'Starting…'
            || microphoneStartGuard.afterSuccess.isStarting !== false
            || microphoneStartGuard.afterSuccess.isListening !== true
            || microphoneStartGuard.afterSuccess.buttonText !== 'Listening…') {
            throw new Error(`Noise Meter should allow only one microphone request at a time (${JSON.stringify(microphoneStartGuard)})`);
        }
        console.log('PASS: Noise Meter prevents overlapping microphone permission requests');

        const microphoneErrorMessages = await teacherPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            const widget = info?.widget;
            if (!widget) return null;
            return {
                permission: widget.getMicrophoneErrorMessage({ name: 'NotAllowedError', message: 'Permission denied' }),
                system: widget.getMicrophoneErrorMessage({ name: 'NotAllowedError', message: 'Permission denied by system' }),
                missing: widget.getMicrophoneErrorMessage({ name: 'NotFoundError' }),
                busy: widget.getMicrophoneErrorMessage({ name: 'NotReadableError' })
            };
        }, noiseMeter.id);
        if (!microphoneErrorMessages?.permission?.includes('site controls')
            || !microphoneErrorMessages?.system?.includes('Windows')
            || !microphoneErrorMessages?.missing?.includes('No microphone')
            || !microphoneErrorMessages?.busy?.includes('busy')) {
            throw new Error(`Noise Meter should explain microphone failures clearly (${JSON.stringify(microphoneErrorMessages)})`);
        }
        console.log('PASS: Noise Meter explains blocked, missing, and busy microphone states');
        await projectorPage.waitForFunction(({ textBoardId, noiseMeterId }) => {
            const widgets = window.__TeacherScreenProjectorApp?.layoutManager.widgets || [];
            return widgets.some((widget) => widget.id === textBoardId)
                && widgets.some((widget) => widget.id === noiseMeterId);
        }, { textBoardId: textBoard.id, noiseMeterId: noiseMeter.id });

        const presentation = await teacherPage.evaluate(async () => {
            const app = window.__TeacherScreenApp;
            const widget = app.addWidget('reveal-manager', { notification: 'Presentation sync test added' });
            await widget.loadExternalSource({
                type: 'google-slides',
                sourceUrl: 'https://docs.google.com/presentation/d/projector-sync-test-deck/edit',
                name: 'Projector Sync Test Slides'
            });
            const info = app.layoutManager.widgets.find((candidate) => candidate.widget === widget);
            return {
                id: info.id,
                sourceUrl: widget.activeDeck?.sourceUrl || ''
            };
        });
        await projectorPage.waitForFunction(({ widgetId, sourceUrl }) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.widget?.activeDeck?.sourceUrl === sourceUrl
                && info.widget.getExternalPresentationRuntime?.(info.widget.activeDeck)?.canMirrorInApp === true;
        }, { widgetId: presentation.id, sourceUrl: presentation.sourceUrl });
        const externalSyncGuidance = await teacherPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.widget?.statusLabel?.textContent || '';
        }, presentation.id);
        if (!externalSyncGuidance.includes('do not sync slides') || !externalSyncGuidance.includes('PowerPoint or PDF')) {
            throw new Error(`Web presentations should direct the teacher to the synced file route (${externalSyncGuidance})`);
        }
        console.log('PASS: A web-link presentation is clearly identified as a separate, non-synced source');

        const presentationReconnectPage = await context.newPage();
        try {
            await presentationReconnectPage.goto(`${baseUrl}/projector.html?syncToken=${syncToken}`, { waitUntil: 'domcontentloaded' });
            await presentationReconnectPage.waitForFunction(({ widgetId, sourceUrl }) => {
                const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
                return info?.widget?.activeDeck?.sourceUrl === sourceUrl;
            }, { widgetId: presentation.id, sourceUrl: presentation.sourceUrl });
            console.log('PASS: A reconnecting projector restores the web-link preview without claiming slide sync');
        } finally {
            await presentationReconnectPage.close();
        }

        await teacherPage.evaluate((widgetId) => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find((widget) => widget.id === widgetId);
            if (info?.widget) {
                app.layoutManager.removeWidget(info.widget);
                app.widgets = app.widgets.filter((widget) => widget !== info.widget);
                app.broadcastProjectorState();
            }
        }, presentation.id);
        await projectorPage.waitForFunction((widgetId) => (
            !window.__TeacherScreenProjectorApp?.layoutManager.widgets.some((widget) => widget.id === widgetId)
        ), presentation.id);
        await projectorPage.waitForFunction((textBoardId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === textBoardId);
            return info?.widget?.element?.textContent?.includes('Projector sync content marker');
        }, textBoard.id);
        console.log('PASS: Projector receives the Text Board content during initial pairing');

        const localPresentation = await teacherPage.evaluate(async () => {
            const app = window.__TeacherScreenApp;
            const widget = app.addWidget('reveal-manager', { notification: 'Local presentation slide sync test added' });
            await widget.launchDeck({
                id: Date.now(),
                name: 'Local Projector Sync Test',
                type: 'html',
                content: '<section><h2>Slide one</h2></section><section><h2>Slide two</h2></section>'
            });
            const info = app.layoutManager.widgets.find((candidate) => candidate.widget === widget);
            app.broadcastProjectorState();
            return { id: info.id };
        });
        await projectorPage.waitForFunction((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.widget?.activeDeck?.type === 'html'
                && info.widget.revealDeck?.isReady?.() === true;
        }, localPresentation.id);
        await teacherPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenApp.layoutManager.widgets.find((widget) => widget.id === widgetId);
            info.widget.navigate('next');
        }, localPresentation.id);
        await teacherPage.waitForFunction((widgetId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.widget?.currentIndices?.h === 1;
        }, localPresentation.id);
        await projectorPage.waitForTimeout(350);
        const syncedLocalSlide = await projectorPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return {
                stored: info?.widget?.currentIndices?.h,
                rendered: info?.widget?.revealDeck?.getIndices?.().h
            };
        }, localPresentation.id);
        if (syncedLocalSlide.stored !== 1 || syncedLocalSlide.rendered !== 1) {
            throw new Error(`Projector did not follow the teacher to slide two (${JSON.stringify(syncedLocalSlide)})`);
        }
        console.log('PASS: Local PowerPoint/PDF presentation slide changes sync live to the projector');

        await teacherPage.evaluate((widgetId) => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find((widget) => widget.id === widgetId);
            if (info?.widget) {
                app.layoutManager.removeWidget(info.widget);
                app.widgets = app.widgets.filter((widget) => widget !== info.widget);
                app.broadcastProjectorState();
            }
        }, localPresentation.id);
        await projectorPage.waitForFunction((widgetId) => (
            !window.__TeacherScreenProjectorApp?.layoutManager.widgets.some((widget) => widget.id === widgetId)
        ), localPresentation.id);

        const localWebPresentation = await teacherPage.evaluate(() => {
            const app = window.__TeacherScreenApp;
            const widget = app.addWidget('url-viewer', { notification: 'Local web presentation sync test added' });
            widget.loadUrl('presentations/year7-rhetoric-marine-turtles/slides.html');
            widget.setChromeless(true);
            const info = app.layoutManager.widgets.find((candidate) => candidate.widget === widget);
            app.broadcastProjectorState();
            return { id: info.id };
        });
        await Promise.all([
            teacherPage.waitForFunction((widgetId) => {
                const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
                return info?.widget?.contentArea?.querySelector('iframe')?.contentDocument
                    ?.querySelector('#slide-counter')?.textContent === '1 / 6';
            }, localWebPresentation.id),
            projectorPage.waitForFunction((widgetId) => {
                const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
                return info?.widget?.contentArea?.querySelector('iframe')?.contentDocument
                    ?.querySelector('#slide-counter')?.textContent === '1 / 6';
            }, localWebPresentation.id)
        ]);
        await teacherPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenApp.layoutManager.widgets.find((widget) => widget.id === widgetId);
            info.widget.contentArea.querySelector('iframe').contentDocument.querySelector('#next-slide').click();
        }, localWebPresentation.id);
        await Promise.all([
            teacherPage.waitForFunction((widgetId) => {
                const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
                return info?.widget?.contentArea?.querySelector('iframe')?.contentDocument
                    ?.querySelector('#slide-counter')?.textContent === '2 / 6';
            }, localWebPresentation.id),
            projectorPage.waitForFunction((widgetId) => {
                const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
                return info?.widget?.contentArea?.querySelector('iframe')?.contentDocument
                    ?.querySelector('#slide-counter')?.textContent === '2 / 6';
            }, localWebPresentation.id)
        ]);
        console.log('PASS: The saved Rhetoric web presentation advances on teacher and projector together');

        await teacherPage.evaluate((widgetId) => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find((widget) => widget.id === widgetId);
            if (info?.widget) {
                app.layoutManager.removeWidget(info.widget);
                app.widgets = app.widgets.filter((widget) => widget !== info.widget);
                app.broadcastProjectorState();
            }
        }, localWebPresentation.id);
        await projectorPage.waitForFunction((widgetId) => (
            !window.__TeacherScreenProjectorApp?.layoutManager.widgets.some((widget) => widget.id === widgetId)
        ), localWebPresentation.id);

        const projectorNoiseStatusHidden = await projectorPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            if (!info?.widget?.status) return false;
            return !info.widget.element?.contains(info.widget.status)
                || window.getComputedStyle(info.widget.status).display === 'none';
        }, noiseMeter.id);
        if (!projectorNoiseStatusHidden) {
            throw new Error('Projector should hide the Noise Meter microphone status sentence');
        }
        console.log('PASS: Projector hides the misleading Noise Meter microphone status sentence');

        await teacherPage.evaluate((noiseMeterId) => {
            window.TeacherScreenEventBus.eventBus.emit('noise-meter:level', {
                widgetId: noiseMeterId,
                level: 170,
                listening: true
            });
        }, noiseMeter.id);
        await projectorPage.waitForFunction((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            return info?.widget?.meter?.lastLevel === 170
                && info.widget.meter.lastRenderedWidth > (info.widget.canvas.width * 0.6)
                && info.widget.meterDisplay?.dataset.noiseState === 'loud'
                && info.widget.classroomStatusText?.textContent === 'Too Loud';
        }, noiseMeter.id);
        console.log('PASS: High live readings render the red Too Loud projector state');

        for (const expected of [
            { level: 80, state: 'warning', label: 'Getting Loud' },
            { level: 25, state: 'ready', label: 'Ready to Learn' }
        ]) {
            await teacherPage.evaluate(({ noiseMeterId, level }) => {
                window.TeacherScreenEventBus.eventBus.emit('noise-meter:level', {
                    widgetId: noiseMeterId,
                    level,
                    listening: true
                });
            }, { noiseMeterId: noiseMeter.id, level: expected.level });
            await projectorPage.waitForFunction(({ noiseMeterId, state, label }) => {
                const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
                return info?.widget?.meterDisplay?.dataset.noiseState === state
                    && info.widget.classroomStatusText?.textContent === label;
            }, { noiseMeterId: noiseMeter.id, state: expected.state, label: expected.label });
        }
        console.log('PASS: Projector Noise Meter shows Ready to Learn, Getting Loud, and Too Loud states');

        const displayModeState = await teacherPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            const widget = info?.widget;
            if (!widget) return null;

            widget.setDisplayMode('gauge');
            const gauge = {
                mode: widget.displayMode,
                canvasMode: widget.meter?.displayMode,
                savedMode: widget.serialize().displayMode,
                selected: widget.displayModeInputs?.get('gauge')?.checked === true
            };

            widget.setDisplayMode('timeline');
            [35, 72, 130, 175, 95].forEach((level, index) => {
                widget.meter.lastHistorySampleAt = Date.now() - 300;
                widget.meter.renderLevel(level);
                widget.lastLevel = level;
            });
            widget.broadcastLevel(widget.lastLevel, true);
            const timeline = {
                mode: widget.displayMode,
                canvasMode: widget.meter?.displayMode,
                savedMode: widget.serialize().displayMode,
                historySamples: widget.meter?.levelHistory?.length || 0,
                selected: widget.displayModeInputs?.get('timeline')?.checked === true
            };
            return { gauge, timeline };
        }, noiseMeter.id);
        if (displayModeState?.gauge?.mode !== 'gauge'
            || displayModeState.gauge.canvasMode !== 'gauge'
            || displayModeState.gauge.savedMode !== 'gauge'
            || !displayModeState.gauge.selected
            || displayModeState.timeline?.mode !== 'timeline'
            || displayModeState.timeline.canvasMode !== 'timeline'
            || displayModeState.timeline.savedMode !== 'timeline'
            || displayModeState.timeline.historySamples < 5
            || !displayModeState.timeline.selected) {
            throw new Error(`Noise Meter display choices should render and save correctly (${JSON.stringify(displayModeState)})`);
        }
        await projectorPage.waitForFunction((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            return info?.widget?.displayMode === 'timeline'
                && info.widget.meter?.displayMode === 'timeline'
                && info.widget.meterDisplay?.dataset.displayMode === 'timeline'
                && info.widget.serialize().displayMode === 'timeline';
        }, noiseMeter.id);
        console.log('PASS: Gauge and rolling Timeline modes save and synchronise to the projector');

        await teacherPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            info?.widget?.setDisplayMode?.('compact');
        }, noiseMeter.id);
        await projectorPage.waitForFunction((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            return info?.widget?.displayMode === 'compact';
        }, noiseMeter.id);

        const warningCounterState = await teacherPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            const widget = info?.widget;
            if (!widget) return null;

            let warningToneCount = 0;
            widget.meter.playWarningTone = () => {
                warningToneCount += 1;
                return true;
            };
            widget.isListening = true;
            const sampledAt = performance.now();
            widget.handleMeterLevel(25, sampledAt);
            widget.handleMeterLevel(155, sampledAt);
            widget.handleMeterLevel(180, sampledAt + 500);
            widget.handleMeterLevel(110, sampledAt + 1000);
            widget.handleMeterLevel(155, sampledAt + 1500);
            widget.handleMeterLevel(110, sampledAt + 11000);
            widget.handleMeterLevel(155, sampledAt + 11000);
            widget.broadcastLevel(widget.lastLevel, true);

            return {
                warningCount: widget.warningCount,
                warningToneCount,
                displayedCount: widget.warningCounterValue?.textContent,
                savedCount: widget.serialize().warningCount
            };
        }, noiseMeter.id);
        if (warningCounterState?.warningCount !== 3
            || warningCounterState.warningToneCount !== 2
            || warningCounterState.displayedCount !== '3'
            || warningCounterState.savedCount !== 3) {
            throw new Error(`Noise warnings should count every Too Loud crossing and limit chimes to once per 10 seconds (${JSON.stringify(warningCounterState)})`);
        }
        await projectorPage.waitForFunction((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            return info?.widget?.warningCount === 3
                && info.widget.warningCounterValue?.textContent === '3';
        }, noiseMeter.id);
        console.log('PASS: Every Too Loud crossing is counted while the chime is limited to once per 10 seconds');

        await teacherPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            info?.widget?.resetWarningCount?.();
        }, noiseMeter.id);
        await projectorPage.waitForFunction((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            return info?.widget?.warningCount === 0
                && info.widget.warningCounterValue?.textContent === '0';
        }, noiseMeter.id);
        console.log('PASS: Reset count clears the teacher and projector warning totals together');

        const adjustableLimitState = await teacherPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            const widget = info?.widget;
            if (!widget) return null;

            let warningToneCount = 0;
            widget.meter.playWarningTone = () => {
                warningToneCount += 1;
                return true;
            };
            widget.isListening = true;
            widget.lastWarningToneAt = Number.NEGATIVE_INFINITY;
            widget.setNoiseThreshold(100);
            const sampledAt = performance.now();
            widget.handleMeterLevel(60, sampledAt);
            widget.handleMeterLevel(95, sampledAt + 100);
            widget.handleMeterLevel(105, sampledAt + 200);
            widget.handleMeterLevel(115, sampledAt + 300);
            widget.handleMeterLevel(65, sampledAt + 11000);
            widget.handleMeterLevel(105, sampledAt + 11200);
            widget.broadcastLevel(widget.lastLevel, true);

            return {
                threshold: widget.tooLoudThreshold,
                thresholdLabel: widget.thresholdOutput?.textContent,
                thresholdAriaText: widget.thresholdInput?.getAttribute('aria-valuetext'),
                warningCount: widget.warningCount,
                warningToneCount,
                state: widget.meterDisplay?.dataset.noiseState,
                savedThreshold: widget.serialize().noiseThreshold
            };
        }, noiseMeter.id);
        if (adjustableLimitState?.threshold !== 100
            || adjustableLimitState.thresholdLabel !== 'Quiet'
            || adjustableLimitState.thresholdAriaText !== 'Quiet'
            || adjustableLimitState.warningCount !== 2
            || adjustableLimitState.warningToneCount !== 2
            || adjustableLimitState.state !== 'loud'
            || adjustableLimitState.savedThreshold !== 100) {
            throw new Error(`Adjusted Noise Meter limit should control warnings, sound, and saved state (${JSON.stringify(adjustableLimitState)})`);
        }
        await projectorPage.waitForFunction((noiseMeterId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            return info?.widget?.tooLoudThreshold === 100
                && info.widget.warningCount === 2
                && info.widget.meterDisplay?.dataset.noiseState === 'loud';
        }, noiseMeter.id);
        console.log('PASS: Teacher Noise limit changes the warning point and synchronises it to the projector');

        const backgroundMeterState = await teacherPage.evaluate((noiseMeterId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === noiseMeterId);
            const widget = info?.widget;
            const meter = widget?.meter;
            if (!widget || !meter) return null;

            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                value: 'hidden'
            });
            meter.analyser = {
                getByteFrequencyData(data) {
                    data.fill(80);
                }
            };
            meter.dataArray = new Uint8Array(8);
            meter.running = true;
            widget.isListening = true;
            widget.started = true;
            document.dispatchEvent(new Event('visibilitychange'));

            const state = {
                widgetStillListening: widget.isListening,
                meterStillRunning: meter.running,
                backgroundTimerScheduled: meter.backgroundSampleTimerId !== null,
                animationFramePaused: meter.animationFrameId === null
            };

            meter.stop();
            widget.isListening = false;
            widget.started = false;
            delete document.visibilityState;
            return state;
        }, noiseMeter.id);
        if (!backgroundMeterState?.widgetStillListening
            || !backgroundMeterState.meterStillRunning
            || !backgroundMeterState.backgroundTimerScheduled
            || !backgroundMeterState.animationFramePaused) {
            throw new Error(`Noise Meter should keep sampling while the teacher screen is hidden (${JSON.stringify(backgroundMeterState)})`);
        }
        console.log('PASS: Noise Meter keeps sampling when the teacher screen is minimised or inactive');

        const projectorNodeWasPreserved = await projectorPage.evaluate((widgetId) => {
            const app = window.__TeacherScreenProjectorApp;
            const info = app.layoutManager.widgets.find((widget) => widget.id === widgetId);
            window.__projectorResizeSyncNode = info?.element || null;
            return Boolean(window.__projectorResizeSyncNode);
        }, textBoard.id);
        if (!projectorNodeWasPreserved) {
            throw new Error('Projector Text Board was not available for resize sync testing');
        }

        const compactTextBoardHeight = 360;
        await teacherPage.evaluate(({ widgetId, height }) => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find((widget) => widget.id === widgetId);
            app.applyProjectorLayoutDelta({
                type: 'widget-update',
                id: widgetId,
                x: info.x,
                y: info.y,
                w: info.width,
                h: height
            });
        }, { widgetId: textBoard.id, height: compactTextBoardHeight });
        await projectorPage.waitForFunction(({ widgetId, height }) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.height === height;
        }, { widgetId: textBoard.id, height: compactTextBoardHeight });
        textBoard.height = compactTextBoardHeight;

        await teacherPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenApp.layoutManager.widgets.find((widget) => widget.id === widgetId);
            const html = [
                '<p><strong>Week 5 - Friday - 21/08/26</strong></p>',
                '<p><strong>Learning goal:</strong> Turn our BTN notes into a clear TEEL paragraph</p>',
                '<ol><li>Wordle</li><li>BTN Segment 1 - Teacher model</li><li>BTN Segment 2 - Write together</li></ol>',
                '<p><strong>Brain Break</strong></p>',
                '<ol><li>BTN Segment 3 - Independent TEEL paragraph</li><li>Check and submit</li></ol>',
                '<p>Projector sync content marker</p>'
            ].join('');
            info.widget.deserialize({ content: html, displayMode: false, presentationMode: 'normal' });
            window.TeacherScreenWidgetState.notifyChanged(info.widget, 'content-updated');
        }, textBoard.id);
        await projectorPage.waitForFunction((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.widget?.element?.textContent?.includes('Check and submit');
        }, textBoard.id);
        await projectorPage.waitForFunction((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            const editor = info?.widget?.quill?.root || info?.widget?.editorSurface;
            const scale = Number.parseFloat(info?.widget?.element?.style.getPropertyValue('--rich-text-projector-fit') || '1');
            return info?.element === window.__projectorResizeSyncNode
                && scale < 1
                && editor?.scrollHeight <= editor?.clientHeight + 2;
        }, textBoard.id);
        await projectorPage.waitForTimeout(450);
        const liveTextBoardState = await projectorPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            const editor = info?.widget?.quill?.root || info?.widget?.editorSurface;
            return {
                preservedNode: info?.element === window.__projectorResizeSyncNode,
                scale: Number.parseFloat(info?.widget?.element?.style.getPropertyValue('--rich-text-projector-fit') || '1'),
                scrollHeight: editor?.scrollHeight || 0,
                clientHeight: editor?.clientHeight || 0
            };
        }, textBoard.id);
        if (!liveTextBoardState.preservedNode
            || liveTextBoardState.scale >= 1
            || liveTextBoardState.scrollHeight > liveTextBoardState.clientHeight + 2) {
            throw new Error(`Text Board live fit failed: ${JSON.stringify(liveTextBoardState)}`);
        }
        console.log('PASS: Text Board content updates in place and automatically fits the projector frame');

        await teacherPage.evaluate(({ widgetId, syncToken }) => {
            window.__TeacherScreenApp.projectorChannel.postMessage({
                type: 'widget-state-update',
                source: 'teacher',
                id: widgetId,
                widgetType: 'RichTextWidget',
                data: {
                    content: '<p>Stale content must not replace the current board</p>',
                    displayMode: false,
                    presentationMode: 'normal'
                },
                revision: 1,
                syncToken
            });
        }, { widgetId: textBoard.id, syncToken });
        await projectorPage.waitForTimeout(150);
        const ignoredStaleTextState = await projectorPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.widget?.element?.textContent?.includes('Check and submit')
                && !info?.widget?.element?.textContent?.includes('Stale content');
        }, textBoard.id);
        if (!ignoredStaleTextState) {
            throw new Error('An older Text Board state replaced the current projector content');
        }
        console.log('PASS: Projector ignores stale Text Board content updates');

        await selectWidgetForEditing(teacherPage, '.widget.rich-text-widget');
        await dragElementBy(teacherPage, '.widget.rich-text-widget .resize-handle.bottom-right', 80, 40);
        await teacherPage.waitForFunction(({ widgetId, initialWidth, initialHeight }) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.width !== initialWidth || info?.height !== initialHeight;
        }, { widgetId: textBoard.id, initialWidth: textBoard.width, initialHeight: textBoard.height });
        const resizedTextBoard = await teacherPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return { width: info.width, height: info.height };
        }, textBoard.id);

        await projectorPage.waitForFunction(({ widgetId, width, height }) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.width === width && info?.height === height;
        }, { widgetId: textBoard.id, ...resizedTextBoard });
        const projectorKeptTextBoard = await projectorPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.element === window.__projectorResizeSyncNode;
        }, textBoard.id);
        if (!projectorKeptTextBoard) {
            throw new Error('Projector rebuilt the Text Board instead of applying its resize');
        }
        console.log('PASS: Text Board resizing syncs live to the projector without rebuilding its content');

        await teacherPage.evaluate((widgetId) => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find((widget) => widget.id === widgetId);
            app.layoutManager.setWidgetMinimized(info, true);
            app.broadcastProjectorState();
        }, textBoard.id);
        await teacherPage.waitForSelector('.widget-minimize-dock > .widget.rich-text-widget.is-minimized', { timeout: 10000 });
        await projectorPage.waitForFunction(({ widgetId, width, height }) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.width === width
                && info?.height === height
                && !info.element.classList.contains('is-minimized')
                && info.widget?.element?.textContent?.includes('Projector sync content marker');
        }, { widgetId: textBoard.id, ...resizedTextBoard });
        const projectorKeptExpandedNode = await projectorPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.element === window.__projectorResizeSyncNode;
        }, textBoard.id);
        if (!projectorKeptExpandedNode) {
            throw new Error('Minimising the teacher widget rebuilt the projector widget');
        }
        console.log('PASS: Teacher minimisation stays local while the projector keeps full content and geometry');

        await teacherPage.evaluate(({ widgetId, syncToken }) => {
            window.__TeacherScreenApp.projectorChannel.postMessage({
                type: 'layout-delta',
                source: 'teacher',
                syncToken,
                delta: {
                    type: 'widget-update',
                    id: widgetId,
                    h: 40,
                    minimized: true
                }
            });
        }, { widgetId: textBoard.id, syncToken });
        await projectorPage.waitForTimeout(250);
        const projectorIgnoredCompactDelta = await projectorPage.evaluate(({ widgetId, width, height }) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.width === width
                && info?.height === height
                && !info.element.classList.contains('is-minimized')
                && info.widget?.element?.textContent?.includes('Projector sync content marker');
        }, { widgetId: textBoard.id, ...resizedTextBoard });
        if (!projectorIgnoredCompactDelta) {
            throw new Error('A compact minimised-height update collapsed the projector widget');
        }
        console.log('PASS: Projector ignores compact minimised-height updates from an older teacher tab');

        const reconnectWhileMinimizedPage = await context.newPage();
        try {
            await reconnectWhileMinimizedPage.goto(`${baseUrl}/projector.html?syncToken=${syncToken}`, { waitUntil: 'domcontentloaded' });
            await reconnectWhileMinimizedPage.waitForFunction(() => window.__TeacherScreenProjectorApp?.hasTeacherSync === true);
            await reconnectWhileMinimizedPage.waitForFunction(({ widgetId, width, height }) => {
                const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
                return info?.width === width
                    && info?.height === height
                    && !info.element.classList.contains('is-minimized')
                    && info.widget?.element?.textContent?.includes('Projector sync content marker');
            }, { widgetId: textBoard.id, ...resizedTextBoard });
            console.log('PASS: A reconnecting projector receives the full widget while the teacher copy is minimised');
        } finally {
            await reconnectWhileMinimizedPage.close();
        }

        await teacherPage.evaluate((widgetId) => {
            const app = window.__TeacherScreenApp;
            const info = app.layoutManager.widgets.find((widget) => widget.id === widgetId);
            app.layoutManager.setWidgetMinimized(info, false);
            app.broadcastProjectorState();
        }, textBoard.id);
        await teacherPage.waitForSelector('.widget-minimize-dock > .widget.rich-text-widget', { state: 'detached', timeout: 10000 });

        const syncedStackOrder = await Promise.all([
            teacherPage.evaluate(() => {
                const app = window.__TeacherScreenApp;
                return {
                    ids: app.layoutManager.widgets.map((widget) => widget.id)
                };
            }),
            projectorPage.evaluate(() => {
                const app = window.__TeacherScreenProjectorApp;
                const visualOrder = [...app.layoutManager.widgets].sort((left, right) => {
                    const leftLayer = Number.parseInt(getComputedStyle(left.element).zIndex, 10) || 0;
                    const rightLayer = Number.parseInt(getComputedStyle(right.element).zIndex, 10) || 0;
                    return leftLayer - rightLayer;
                });
                return {
                    ids: app.layoutManager.widgets.map((widget) => widget.id),
                    topId: visualOrder.at(-1)?.id || ''
                };
            })
        ]);
        const teacherStackIds = syncedStackOrder[0].ids;
        const projectorStackIds = syncedStackOrder[1].ids;
        if (teacherStackIds.at(-1) !== textBoard.id
            || projectorStackIds.at(-1) !== textBoard.id
            || syncedStackOrder[1].topId !== textBoard.id) {
            throw new Error('Projector did not preserve the teacher widget front-to-back order');
        }
        console.log('PASS: Projector preserves the teacher widget visual front-to-back order after resizing');

        await projectorPage.evaluate((widgetId) => {
            window.__TeacherScreenProjectorApp.layoutManager.applyLayoutDelta({
                type: 'widget-update',
                id: widgetId,
                w: 999,
                h: 777
            });
        }, textBoard.id);
        await teacherPage.evaluate(() => window.__TeacherScreenApp.broadcastProjectorState());
        await projectorPage.waitForFunction(({ widgetId, width, height }) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.width === width && info?.height === height;
        }, { widgetId: textBoard.id, ...resizedTextBoard });
        const projectorRecoveredWithoutRebuild = await projectorPage.evaluate((widgetId) => {
            const info = window.__TeacherScreenProjectorApp?.layoutManager.widgets.find((widget) => widget.id === widgetId);
            return info?.element === window.__projectorResizeSyncNode;
        }, textBoard.id);
        if (!projectorRecoveredWithoutRebuild) {
            throw new Error('Projector rebuilt the Text Board while recovering missed geometry');
        }
        console.log('PASS: Full teacher sync repairs missed Text Board resizing without rebuilding content');
    } finally {
        await context.close();
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
