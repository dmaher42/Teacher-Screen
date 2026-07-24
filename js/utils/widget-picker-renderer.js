import { listAvailableWidgets } from '../widgets/widget-registry.js';

const CATEGORY_FILTERS = [
    { key: 'all', label: 'All tools' },
    { key: 'Primary', label: 'Classroom' },
    { key: 'Secondary', label: 'Content & display' }
];

const CATEGORY_TITLES = {
    Primary: 'Classroom tools',
    Secondary: 'Content & display'
};

function createWidgetPickerButton(widget, {
    focusWidgetType = null,
    favorites = [],
    onAddWidget,
    onToggleFavorite
} = {}) {
    const card = document.createElement('div');
    card.className = 'widget-picker-card';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'widget-category-btn';
    button.dataset.widget = widget.key;
    button.setAttribute('aria-label', `Add ${widget.label}`);
    if (focusWidgetType && widget.key === focusWidgetType) {
        button.classList.add('is-target');
    }

    const icon = document.createElement('span');
    icon.className = 'category-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = widget.icon || '•';

    const copy = document.createElement('span');
    copy.className = 'widget-picker-card__copy';

    const name = document.createElement('span');
    name.className = 'widget-picker-card__name';
    name.textContent = widget.label;

    const description = document.createElement('span');
    description.className = 'widget-picker-card__description';
    description.textContent = widget.description || 'Add to this screen';

    copy.appendChild(name);
    copy.appendChild(description);
    button.appendChild(icon);
    button.appendChild(copy);
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
    favoriteButton.dataset.favoriteWidget = widget.key;
    favoriteButton.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
    favoriteButton.setAttribute('aria-label', isFavorite ? `Unpin ${widget.label}` : `Pin ${widget.label}`);
    favoriteButton.title = isFavorite ? 'Unpin widget' : 'Pin widget';
    favoriteButton.innerHTML = '<span aria-hidden="true">★</span>';
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

function sortByRecentThenName(widgets, recent = []) {
    const recentOrder = new Map(recent.map((key, index) => [key, index]));
    return widgets.slice().sort((a, b) => {
        const aRecent = recentOrder.has(a.key) ? recentOrder.get(a.key) : Number.MAX_SAFE_INTEGER;
        const bRecent = recentOrder.has(b.key) ? recentOrder.get(b.key) : Number.MAX_SAFE_INTEGER;
        return aRecent - bRecent || a.label.localeCompare(b.label);
    });
}

function matchesSearch(widget, query) {
    if (!query) return true;
    const searchableText = [widget.label, widget.description, widget.category, widget.key]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
    return searchableText.includes(query.toLocaleLowerCase());
}

export function renderWidgetPicker({
    container,
    focusWidgetType = null,
    widgetPickerState,
    onAddWidget,
    onToggleFavorite
} = {}) {
    if (!container) {
        return;
    }

    const availableWidgets = listAvailableWidgets();
    let favorites = Array.isArray(widgetPickerState?.favorites) ? widgetPickerState.favorites : [];
    const recent = Array.isArray(widgetPickerState?.recent) ? widgetPickerState.recent : [];
    let activeFilter = 'all';
    let searchQuery = '';

    container.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'widget-picker-toolbar';

    const search = document.createElement('div');
    search.className = 'widget-picker-search';
    search.setAttribute('role', 'search');

    const searchIcon = document.createElement('i');
    searchIcon.className = 'fas fa-search';
    searchIcon.setAttribute('aria-hidden', 'true');

    const searchInput = document.createElement('input');
    searchInput.id = 'widget-picker-search';
    searchInput.type = 'search';
    searchInput.placeholder = 'Find a widget…';
    searchInput.setAttribute('aria-label', 'Search widgets');
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.spellcheck = false;
    if (!focusWidgetType) {
        searchInput.autofocus = true;
    }

    const clearSearchButton = document.createElement('button');
    clearSearchButton.type = 'button';
    clearSearchButton.className = 'widget-picker-search__clear';
    clearSearchButton.setAttribute('aria-label', 'Clear widget search');
    clearSearchButton.hidden = true;
    clearSearchButton.textContent = '×';

    search.appendChild(searchIcon);
    search.appendChild(searchInput);
    search.appendChild(clearSearchButton);

    const filters = document.createElement('div');
    filters.className = 'widget-picker-filters';
    filters.setAttribute('aria-label', 'Filter widgets');

    const results = document.createElement('div');
    results.className = 'widget-picker-results';

    const resultStatus = document.createElement('p');
    resultStatus.className = 'visually-hidden';
    resultStatus.setAttribute('aria-live', 'polite');

    const renderResults = () => {
        results.innerHTML = '';
        const filteredWidgets = availableWidgets.filter((widget) => {
            const matchesFilter = activeFilter === 'all' || widget.category === activeFilter;
            return matchesFilter && matchesSearch(widget, searchQuery.trim());
        });

        resultStatus.textContent = `${filteredWidgets.length} widget${filteredWidgets.length === 1 ? '' : 's'} available`;

        const baseOptions = {
            focusWidgetType,
            favorites,
            onAddWidget,
            onToggleFavorite: (widgetKey) => {
                const nextFavorites = favorites.includes(widgetKey)
                    ? favorites.filter((key) => key !== widgetKey)
                    : [...favorites, widgetKey];
                const savedState = typeof onToggleFavorite === 'function'
                    ? onToggleFavorite(widgetKey)
                    : null;
                favorites = Array.isArray(savedState?.favorites) ? savedState.favorites : nextFavorites;
                renderResults();
                window.requestAnimationFrame(() => {
                    results.querySelector(`[data-favorite-widget="${widgetKey}"]`)?.focus({ preventScroll: true });
                });
            }
        };

        if (filteredWidgets.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'widget-picker-empty';
            emptyState.innerHTML = `
                <span aria-hidden="true">⌕</span>
                <strong>No widgets found</strong>
                <p>Try a different name or choose another category.</p>
            `;
            results.appendChild(emptyState);
            return;
        }

        const isBrowsingAll = activeFilter === 'all' && !searchQuery.trim();
        if (!isBrowsingAll) {
            const title = searchQuery.trim()
                ? 'Search results'
                : CATEGORY_TITLES[activeFilter] || 'Widgets';
            appendWidgetSection(results, title, sortByRecentThenName(filteredWidgets, recent), baseOptions);
            return;
        }

        const widgetMap = new Map(availableWidgets.map((widget) => [widget.key, widget]));
        const pinnedWidgets = favorites
            .map((key) => widgetMap.get(key))
            .filter(Boolean);
        appendWidgetSection(results, 'Pinned', pinnedWidgets, { ...baseOptions, accent: true });

        ['Primary', 'Secondary'].forEach((categoryName) => {
            const widgets = availableWidgets.filter((widget) => (
                widget.category === categoryName && !favorites.includes(widget.key)
            ));
            appendWidgetSection(
                results,
                CATEGORY_TITLES[categoryName],
                sortByRecentThenName(widgets, recent),
                baseOptions
            );
        });
    };

    CATEGORY_FILTERS.forEach((filter) => {
        const filterButton = document.createElement('button');
        filterButton.type = 'button';
        filterButton.className = 'widget-picker-filter';
        filterButton.dataset.filter = filter.key;
        filterButton.setAttribute('aria-pressed', filter.key === activeFilter ? 'true' : 'false');
        filterButton.textContent = filter.label;
        filterButton.addEventListener('click', () => {
            activeFilter = filter.key;
            filters.querySelectorAll('.widget-picker-filter').forEach((button) => {
                button.setAttribute('aria-pressed', button === filterButton ? 'true' : 'false');
            });
            renderResults();
        });
        filters.appendChild(filterButton);
    });

    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        clearSearchButton.hidden = searchQuery.length === 0;
        renderResults();
    });

    clearSearchButton.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        clearSearchButton.hidden = true;
        renderResults();
        searchInput.focus();
    });

    toolbar.appendChild(search);
    toolbar.appendChild(filters);
    container.appendChild(toolbar);
    container.appendChild(results);
    container.appendChild(resultStatus);
    renderResults();
}
