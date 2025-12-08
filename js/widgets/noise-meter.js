class NoiseMeter {
  constructor(canvasElement, onUpdate = null) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.microphone = null;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.onUpdate = onUpdate;

    // Thresholds for visualization colors
    this.quietThreshold = 50;
    this.loudThreshold = 150;
  }
  
  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);
      this.analyser.fftSize = 256;
      this.draw();
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  }
  
  setThresholds(quiet, loud) {
      this.quietThreshold = quiet;
      this.loudThreshold = loud;
  }

  draw() {
    requestAnimationFrame(() => this.draw());
    
    this.analyser.getByteFrequencyData(this.dataArray);

    if (this.dataArray.length === 0) return;

    const average = this.dataArray.reduce((a, b) => a + b) / this.dataArray.length;
    
    if (this.onUpdate) {
        this.onUpdate(average);
    }

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw meter
    const width = (average / 255) * this.canvas.width;
    
    // Color based on noise level vs thresholds
    if (average < this.quietThreshold) {
      this.ctx.fillStyle = '#4CAF50'; // Green
    } else if (average < this.loudThreshold) {
      this.ctx.fillStyle = '#FFC107'; // Yellow
    } else {
      this.ctx.fillStyle = '#F44336'; // Red
    }
    
    this.ctx.fillRect(0, 0, width, this.canvas.height);
  }
}
