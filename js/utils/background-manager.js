class BackgroundManager {
  constructor(containerElement) {
    this.container = containerElement;
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
    this.currentBackground = { type: 'solid', value: '#ffffff' };
  }
  
  init() {
    // Load saved background if available
    const savedBackground = localStorage.getItem('background');
    if (savedBackground) {
      this.currentBackground = JSON.parse(savedBackground);
      this.applyBackground();
    }
  }
  
  setBackground(type, value) {
    this.currentBackground = { type, value };
    this.applyBackground();
    this.saveBackground();
  }
  
  applyBackground() {
    const { type, value } = this.currentBackground;
    
    switch(type) {
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
    this.currentBackground = data;
    this.applyBackground();
    this.saveBackground();
  }

  getAvailableBackgrounds() {
    return this.backgrounds;
  }

  reset() {
    this.currentBackground = { type: 'solid', value: '#ffffff' };
    this.applyBackground();
    this.saveBackground();
  }
}
