class Timer {
  constructor(displayElement) {
    this.display = displayElement;
    this.time = 0;
    this.interval = null;
    this.running = false;
  }
  
  start(minutes) {
    if (!this.running) {
      this.time = minutes * 60;
      this.updateDisplay();
      this.interval = setInterval(() => this.tick(), 1000);
      this.running = true;
    }
  }
  
  tick() {
    this.time--;
    this.updateDisplay();
    if (this.time <= 0) {
      this.stop();
      this.notifyComplete();
    }
  }
  
  updateDisplay() {
    const minutes = Math.floor(this.time / 60);
    const seconds = this.time % 60;
    this.display.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  stop() {
    clearInterval(this.interval);
    this.running = false;
  }
  
  notifyComplete() {
    // Visual notification
    this.display.style.color = "red";
    // Audio notification
    const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alarm-digital-clock-beep-989.mp3');
    audio.play();
  }
}
