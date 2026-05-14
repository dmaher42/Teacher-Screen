import { listAvailableWidgets } from '../widgets/widget-registry.js';

function createWidgetPickerButton(widget, { focusWidgetType = null, favorites = [], onAddWidget, onToggleFavorite } = {}) {
    const card = document.createElement('div');
    card.className = 'widget-picker-card';

    const button = document.createElement('button');
    button.className = 'widget-category-btn';
    button.dataset.widget = widget.key;
    if (focusWidgetType && widget.key === focusWidgetType) {
        button.classList.add('is-target');
    }
    button.innerHTML = `
        <span class="category-icon" aria-hidden="true">${widget.icon || '*'}</span>
        <span>${widget.label}</span>
    `;
    button.addEventListener('click', () => {
        if (typeof onAddWidget === 'function') {
            onAddWidget(widget.key);
        }
    });

    const isFavorite = favorites.includes(widget.key);
    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = 'widget-favorite-btn';
    favoriteButton.dataset.favorite = isFavorite ? 'true' : 'false';
    favoriteButton.setAttribute('aria-label', isFavorite ? `Remove ${widget.label} from favorites` : `Add ${widget.label} to favorites`);
    favoriteButton.title = isFavorite ? 'Remove favorite' : 'Add favorite';
    favoriteButton.textContent = '\u2605';
    favoriteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onToggleFavorite === 'function') {
            onToggleFavorite(widget.key);
        }
    });

    card.appendChild(button);
    card.appendChild(favoriteButton);
    return card;
}

function appendWidgetSection(container, title, widgets, options = {}) {
    if (!container || !Array.isArray(widgets) || widgets.length === 0) {
        return;
    }

    const section = document.createElement('section');
    section.className = `widget-category-section${options.accent ? ' widget-category-section--accent' : ''}`;

    const heading = document.createElement('h4');
    heading.className = 'widget-category-title';
    heading.textContent = title;
    section.appendChild(heading);

    widgets.forEach((widget) => {
        section.appendChild(createWidgetPickerButton(widget, options));
    });

    container.appendChild(section);
}

export function renderWidgetPicker({
    container,
    focusWidgetType = null,
    quickAddWidgetKeys = [],
    widgetPickerState,
    onAddWidget,
    onToggleFavorite
} = {}) {
    if (!container) {
        return;
    }

    const availableWidgets = listAvailableWidgets();
    const widgetMap = new Map(availableWidgets.map((widget) => [widget.key, widget]));
    const favorites = Array.isArray(widgetPickerState?.favorites) ? widgetPickerState.favorites : [];
    const recent = Array.isArray(widgetPickerState?.recent) ? widgetPickerState.recent : [];
    const baseOptions = {
        focusWidgetType,
        favorites,
        onAddWidget,
        onToggleFavorite
    };

    const quickAddWidgets = quickAddWidgetKeys
        .map((key) => widgetMap.get(key))
        .filter(Boolean);
    appendWidgetSection(container, 'Quick Add', quickAddWidgets, {
        ...baseOptions,
        accent: true
    });

    const favoriteWidgets = favorites
        .map((key) => widgetMap.get(key))
        .filter(Boolean)
        .filter((widget) => !quickAddWidgetKeys.includes(widget.key));
    appendWidgetSection(container, 'Favorites', favoriteWidgets, baseOptions);

    const recentWidgets = recent
        .map((key) => widgetMap.get(key))
        .filter(Boolean)
        .filter((widget) => !quickAddWidgetKeys.includes(widget.key) && !favorites.includes(widget.key));
    appendWidgetSection(container, 'Recent', recentWidgets, baseOptions);

    const categories = {};
    availableWidgets.forEach((widget) => {
        const categoryName = widget.category || 'Secondary';
        if (!categories[categoryName]) {
            categories[categoryName] = [];
        }
        categories[categoryName].push(widget);
    });

    ['Primary', 'Secondary'].forEach((categoryName) => {
        const widgets = (categories[categoryName] || []).slice().sort((a, b) => a.label.localeCompare(b.label));
        appendWidgetSection(container, categoryName, widgets, baseOptions);
    });
}
