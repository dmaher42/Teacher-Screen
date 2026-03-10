class BackgroundManager {
  constructor(containerElement) {
    this.container = containerElement;
    this.defaultBackground = { type: 'color', value: '#1f2937' };
    this.backgrounds = {
      solid: ['#ffffff', '#f0f0f0', '#e6f3f7'],
      gradient: [
        'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)',
        'linear-gradient(to top, #a8edea 0%, #fed6e3 100%)'
      ],
      image: [
        'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600',
        'https://images.unsplash.com/photo-1493514789931-586cb221d7a7?w=1600'
      ]
    };
    this.currentBackground = { ...this.defaultBackground };
  }

  safeParse(key) {
    try {
      const value = localStorage.getItem(key);
      if (!value) return null;
      return JSON.parse(value);
    } catch (error) {
      console.warn('Invalid localStorage data for', key);
      localStorage.removeItem(key);
      return null;
    }
  }

  isValidBackground(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.value !== 'string') return false;
    return ['color', 'solid', 'gradient', 'image'].includes(data.type);
  }
  
  init() {
    // Load saved background if available
    const savedBackground = this.safeParse('background');
    if (!savedBackground || !this.isValidBackground(savedBackground)) {
      this.currentBackground = { ...this.defaultBackground };
      localStorage.removeItem('background');
      this.saveBackground();
      this.applyBackground();
      return;
    }

    this.currentBackground = savedBackground;
    this.applyBackground();
  }
  
  setBackground(type, value) {
    this.currentBackground = { type, value };
    this.applyBackground();
    this.saveBackground();
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
  
  serialize() {
    return this.currentBackground;
  }

  deserialize(data) {
    if (!data) return;

    // Support older shape: { type, settings: { ... } }
    if (data.settings) {
      if (data.type === 'solid') {
        this.currentBackground = { type: 'solid', value: data.settings.color || '#ffffff' };
      } else if (data.type === 'gradient') {
        const { start, end } = data.settings;
        this.currentBackground = {
          type: 'gradient',
          value: `linear-gradient(120deg, ${start} 0%, ${end} 100%)`
        };
      } else {
        this.currentBackground = { type: data.type, value: data.settings.url || '' };
      }
    } else if (this.isValidBackground(data)) {
      this.currentBackground = data;
    } else {
      this.currentBackground = { ...this.defaultBackground };
    }

    this.applyBackground();
    this.saveBackground();
  }

  getAvailableBackgrounds() {
    return this.backgrounds;
  }

  reset() {
    this.currentBackground = { ...this.defaultBackground };
    this.applyBackground();
    this.saveBackground();
  }
}
