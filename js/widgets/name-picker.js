class NamePicker {
  constructor(namesList, displayElement) {
    this.names = namesList;
    this.display = displayElement;
    this.picking = false;
  }
  
  pickRandom() {
    if (this.picking || this.names.length === 0) return;
    
    this.picking = true;
    let iterations = 0;
    const maxIterations = 20;
    
    const interval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * this.names.length);
      this.display.textContent = this.names[randomIndex];
      iterations++;
      
      if (iterations >= maxIterations) {
        clearInterval(interval);
        this.picking = false;
        
        // Remove selected name temporarily
        const selectedName = this.names.splice(randomIndex, 1)[0];
        
        // Add button to reset list
        if (this.names.length === 0) {
          this.showResetButton();
        }
      }
    }, 100);
  }
  
  reset() {
    // Restore original names list
    this.names = [...this.originalNames];
    this.display.textContent = "Click to pick a name";
  }
}
