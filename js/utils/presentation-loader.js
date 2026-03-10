import { initReveal } from './reveal-manager.js';

export async function loadPresentation(container, name) {
    try {
        const response = await fetch(`presentations/${name}/slides.html`);

        if (!response.ok) {
            throw new Error('Presentation not found');
        }

        const html = await response.text();
        container.innerHTML = html;

        await initReveal(container);

        console.log('[presentation] loaded:', name);
    } catch (error) {
        console.error('[presentation] failed to load', error);
        container.innerHTML = '<p>Presentation failed to load.</p>';
    }
}
