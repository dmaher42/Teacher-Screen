export const THEME_OPTIONS = [
    { name: 'Ocean', id: 'theme-ocean', swatch: '#38bdf8' },
    { name: 'Professional', id: 'theme-professional', swatch: '#6366f1' },
    { name: 'Light', id: 'theme-light', swatch: '#2563eb' }
];

const THEME_IDS = THEME_OPTIONS.map((theme) => theme.id);

const THEME_META_COLORS = {
    'theme-light': '#ffffff',
    'theme-ocean': '#0f172a',
    'theme-professional': '#111827'
};

function syncDocumentThemeColor(themeName) {
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute('content', THEME_META_COLORS[themeName] || THEME_META_COLORS['theme-professional']);
    }
}

export function applyTheme(themeName) {
    const nextTheme = THEME_IDS.includes(themeName) ? themeName : 'theme-ocean';
    THEME_IDS.forEach((theme) => document.body.classList.remove(theme));
    document.body.classList.add(nextTheme);
    document.documentElement.style.colorScheme = nextTheme === 'theme-light' ? 'light' : 'dark';
    syncDocumentThemeColor(nextTheme);
    localStorage.setItem('selectedTheme', nextTheme);
}

export function syncThemeSelectorSelection(themeSelector, themeName) {
    if (!themeSelector) {
        return;
    }

    themeSelector.querySelectorAll('input[name="theme"]').forEach((input) => {
        input.checked = input.value === themeName;
    });
}

export function renderThemeSelector(themeSelector, themes = THEME_OPTIONS, onThemeChange = null) {
    if (!themeSelector) {
        return;
    }

    themeSelector.innerHTML = '';
    themes.forEach((theme) => {
        const label = document.createElement('label');
        label.className = 'theme-option';
        label.innerHTML = `
            <input type="radio" name="theme" value="${theme.id}">
            <span class="theme-swatch" style="background-color: ${theme.swatch};"></span>
            <span>${theme.name}</span>
        `;
        const input = label.querySelector('input');
        input.checked = document.body.classList.contains(theme.id);
        input.addEventListener('change', () => {
            if (typeof onThemeChange === 'function') {
                onThemeChange(theme.id);
            }
        });
        themeSelector.appendChild(label);
    });
}
