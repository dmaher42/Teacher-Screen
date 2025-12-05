/**
 * Timer Widget Class
 * Creates a countdown timer widget with start/stop functionality.
 */
class TimerWidget {
    /**
     * Constructor for the TimerWidget.
     */
    constructor() {
        // Create the main widget element
        this.element = document.createElement('div');
        this.element.className = 'widget';
        this.element.dataset.widgetType = 'timer';

        // Create the widget header
        this.header = document.createElement('div');
        this.header.className = 'widget-header';

        this.title = document.createElement('div');
        this.title.className = 'widget-title';
        this.title.textContent = 'Timer';

        this.helpButton = document.createElement('button');
        this.helpButton.className = 'widget-help';
        this.helpButton.textContent = '?';

        this.closeButton = document.createElement('button');
        this.closeButton.className = 'widget-close';
        this.closeButton.innerHTML = '&times;';
        this.closeButton.addEventListener('click', () => this.remove());

        this.headerControls = document.createElement('div');
        this.headerControls.className = 'widget-controls';
        this.headerControls.appendChild(this.helpButton);
        this.headerControls.appendChild(this.closeButton);

        this.header.appendChild(this.title);
        this.header.appendChild(this.headerControls);

        // Create the widget content area
        this.content = document.createElement('div');
        this.content.className = 'widget-content';

        this.helpText = document.createElement('div');
        this.helpText.className = 'widget-help-text';
        this.helpText.textContent = 'Press Start for a 5-minute countdown and Stop to pause early. When time ends, the display highlights and a beep plays.';
        this.helpButton.addEventListener('click', () => {
            const isVisible = this.helpText.style.display === 'block';
            this.helpText.style.display = isVisible ? 'none' : 'block';
        });

        // Create the timer display
        this.display = document.createElement('div');
        this.display.className = 'timer-display';
        this.display.textContent = '00:00';

        // Create the timer controls
        this.controls = document.createElement('div');
        this.controls.className = 'timer-controls';

        this.startButton = document.createElement('button');
        this.startButton.textContent = 'Start';
        this.startButton.addEventListener('click', () => this.start());

        this.stopButton = document.createElement('button');
        this.stopButton.textContent = 'Stop';
        this.stopButton.addEventListener('click', () => this.stop());

        this.controls.appendChild(this.startButton);
        this.controls.appendChild(this.stopButton);

        // Assemble the widget
        this.content.appendChild(this.helpText);
        this.content.appendChild(this.display);
        this.content.appendChild(this.controls);
        this.element.appendChild(this.header);
        this.element.appendChild(this.content);

        // Timer state
        this.time = 0;
        this.interval = null;
        this.running = false;
    }

    /**
     * Start the timer with a default of 5 minutes.
     * @param {number} minutes - The number of minutes to count down from.
     */
    start(minutes = 5) {
        if (!this.running) {
            this.time = minutes * 60;
            this.updateDisplay();
            this.interval = setInterval(() => this.tick(), 1000);
            this.running = true;
            this.display.style.color = ''; // Reset color in case it was red
        }
    }

    /**
     * Called every second to update the timer.
     */
    tick() {
        this.time--;
        this.updateDisplay();
        if (this.time <= 0) {
            this.stop();
            this.notifyComplete();
        }
    }

    /**
     * Update the timer display.
     */
    updateDisplay() {
        const minutes = Math.floor(this.time / 60);
        const seconds = this.time % 60;
        this.display.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Stop the timer.
     */
    stop() {
        clearInterval(this.interval);
        this.running = false;
    }

    /**
     * Called when the timer reaches zero.
     */
    notifyComplete() {
        // Visual notification
        this.display.style.color = "red";
        // Audio notification
        const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alarm-digital-clock-beep-989.mp3');
        audio.play().catch(e => console.error("Audio playback failed:", e));
    }

    /**
     * Remove the widget from the DOM.
     */
    remove() {
        if (this.interval) {
            this.stop();
        }
        this.element.remove();
        // Notify the app to update its widget list
        const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
        document.dispatchEvent(event);
    }

    /**
     * Serialize the widget's state for saving to localStorage.
     * @returns {object} The serialized state.
     */
    serialize() {
        return {
            type: 'TimerWidget',
            time: this.time,
            running: this.running
        };
    }

    /**
     * Deserialize the widget's state from localStorage.
     * @param {object} data - The serialized state.
     */
    deserialize(data) {
        this.time = data.time || 0;
        this.running = data.running || false;
        this.updateDisplay();
        if (this.running) {
            // Note: Restarting the interval after page load is complex,
            // for simplicity, we'll just restore the display time.
            this.running = false;
        }
    }
}
