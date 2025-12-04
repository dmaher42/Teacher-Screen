class NoiseMeter {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.microphone = null;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
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
  
  draw() {
    requestAnimationFrame(() => this.draw());
    
    this.analyser.getByteFrequencyData(this.dataArray);
    const average = this.dataArray.reduce((a, b) => a + b) / this.dataArray.length;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw meter
    const width = (average / 255) * this.canvas.width;
    
    // Color based on noise level
    if (average < 50) {
      this.ctx.fillStyle = '#4CAF50'; // Green
    } else if (average < 150) {
      this.ctx.fillStyle = '#FFC107'; // Yellow
    } else {
      this.ctx.fillStyle = '#F44336'; // Red
    }
    
    this.ctx.fillRect(0, 0, width, this.canvas.height);
  }
}
