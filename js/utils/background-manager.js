class BackgroundManager {
  constructor(containerElement) {
    this.container = containerElement;
    this.currentTheme = 'theme-professional';
    this.themeDefaults = {
      'theme-light': { type: 'solid', value: '#ffffff', source: 'theme-default' },
      'theme-ocean': { type: 'solid', value: '#0f172a', source: 'theme-default' },
      'theme-professional': { type: 'solid', value: '#111827', source: 'theme-default' }
    };
    this.defaultBackground = this.getThemeDefaultBackground(this.currentTheme);
    this.backgrounds = {
      solid: ['#ffffff', '#f0f0f0', '#e6f3f7'],
      gradient: [
        'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)',
        'linear-gradient(to top, #a8edea 0%, #fed6e3 100%)'
      ],
      image: [
        'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600',
        'https://images.unsplash.com/photo-1493514789931-586cb221d7a7?w=1600',
        'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1600',
        'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1600',
        'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1600',
        'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=1600',
        'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1600',
        'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1600'
      ]
    };
    this.currentBackground = { ...this.defaultBackground };
  }

  getThemeDefaultBackground(themeName = 'theme-professional') {
    const defaultBackground = this.themeDefaults[themeName] || this.themeDefaults['theme-professional'];
    return {
      ...defaultBackground,
      theme: themeName
    };
  }

  isLegacyDefaultBackground(data) {
    if (!data || typeof data !== 'object') return false;
    const type = data.type || '';
    const value = String(data.value || '').trim().toLowerCase();
    return (type === 'color' || type === 'solid') && value === '#1f2937' && !data.source;
  }

  safeParseLocalStorage(key) {
    try {
      const value = localStorage.getItem(key);
      if (!value) return null;
      return JSON.parse(value);
    } catch (error) {
      console.warn('Invalid localStorage data detected for:', key);
      localStorage.removeItem(key);
      return null;
    }
  }

  isValidBackground(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.value !== 'string') return false;
    return ['color', 'solid', 'gradient', 'image'].includes(data.type);
  }
  
  init(themeName = this.currentTheme) {
    this.currentTheme = themeName;
    this.defaultBackground = this.getThemeDefaultBackground(themeName);

    // Load saved background if available
    const savedBackground = this.safeParseLocalStorage('background');
    if (!savedBackground || !this.isValidBackground(savedBackground)) {
      this.currentBackground = { ...this.defaultBackground };
      localStorage.removeItem('background');
      this.saveBackground();
      this.applyBackground();
      return;
    }

    if (savedBackground.source === 'theme-default' || this.isLegacyDefaultBackground(savedBackground)) {
      this.currentBackground = { ...this.defaultBackground };
      this.saveBackground();
      this.applyBackground();
      return;
    }

    this.currentBackground = {
      ...savedBackground,
      source: savedBackground.source || 'custom'
    };
    this.applyBackground();
  }
  
  setBackground(type, value, options = {}) {
    this.currentBackground = {
      type,
      value,
      source: options.source || 'custom'
    };
    this.applyBackground();
    this.saveBackground();
  }

  setCustomImage(value) {
    this.setBackground('image', value, { source: 'custom-upload' });
  }
  
  applyBackground() {
    const { type, value } = this.currentBackground;
    
    switch(type) {
      case 'color':
      case 'solid':
        this.container.style.backgroundColor = value;
        this.container.style.backgroundImage = 'none';
        break;
      case 'gradient':
        this.container.style.backgroundImage = value;
        break;
      case 'image':
        this.container.style.backgroundImage = `url(${value})`;
        this.container.style.backgroundSize = 'cover';
        this.container.style.backgroundPosition = 'center';
        break;
    }
  }
  
  saveBackground() {
    localStorage.setItem('background', JSON.stringify(this.currentBackground));
  }

  syncTheme(themeName) {
    this.currentTheme = themeName || this.currentTheme;
    this.defaultBackground = this.getThemeDefaultBackground(this.currentTheme);

    if (this.currentBackground?.source === 'theme-default' || this.isLegacyDefaultBackground(this.currentBackground)) {
      this.currentBackground = { ...this.defaultBackground };
      this.applyBackground();
      this.saveBackground();
    }
  }
  
  serialize() {
    return this.currentBackground;
  }

  deserialize(data) {
    if (!data) return;

    // Support older shape: { type, settings: { ... } }
    if (data.settings) {
      if (data.type === 'solid') {
        this.currentBackground = { type: 'solid', value: data.settings.color || '#ffffff', source: 'custom' };
      } else if (data.type === 'gradient') {
        const { start, end } = data.settings;
        this.currentBackground = {
          type: 'gradient',
          value: `linear-gradient(120deg, ${start} 0%, ${end} 100%)`,
          source: 'custom'
        };
      } else {
        this.currentBackground = { type: data.type, value: data.settings.url || '', source: 'custom' };
      }
    } else if (this.isValidBackground(data)) {
      this.currentBackground = {
        ...data,
        source: data.source || 'custom'
      };
    } else {
      this.currentBackground = { ...this.defaultBackground };
      localStorage.removeItem('background');
    }

    this.applyBackground();
    this.saveBackground();
  }

  getAvailableBackgrounds() {
    const backgrounds = {
      solid: [...this.backgrounds.solid],
      gradient: [...this.backgrounds.gradient],
      image: [...this.backgrounds.image]
    };

    if (this.currentBackground?.type === 'image'
      && this.currentBackground?.source === 'custom-upload'
      && typeof this.currentBackground.value === 'string'
      && this.currentBackground.value
      && !backgrounds.image.includes(this.currentBackground.value)) {
      backgrounds.image.unshift(this.currentBackground.value);
    }

    return backgrounds;
  }

  reset(themeName = this.currentTheme) {
    this.currentTheme = themeName;
    this.defaultBackground = this.getThemeDefaultBackground(themeName);
    this.currentBackground = { ...this.defaultBackground };
    this.applyBackground();
    this.saveBackground();
  }
}
