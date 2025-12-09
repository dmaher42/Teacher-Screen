const toggleWidget = (widgetId) => {
    const widget = document.getElementById(widgetId);
    if (!widget) return;

    const isHidden = getComputedStyle(widget).display === 'none';
    widget.style.display = isHidden ? 'block' : 'none';
};

const setupWidgetToolbar = () => {
    const toolbar = document.getElementById('widget-toolbar-wrapper');
    if (!toolbar) return;

    const controls = toolbar.querySelectorAll('[data-widget-id]');
    controls.forEach((control) => {
        const widgetId = control.getAttribute('data-widget-id');
        if (!widgetId) return;

        control.addEventListener('click', () => toggleWidget(widgetId));
    });
};

const setupDrawingBoard = () => {
    const canvas = document.getElementById('drawing-canvas');
    const colorButtons = document.querySelectorAll('.color-btn');
    const sizeButtons = document.querySelectorAll('.size-btn');
    const clearButton = document.getElementById('clear-drawing-btn');
    const saveButton = document.getElementById('save-drawing-btn');

    if (!canvas || !colorButtons.length || !sizeButtons.length || !clearButton || !saveButton) return;

    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let currentColor = 'black';
    let currentLineWidth = 5;

    const updateSelection = (buttons, target) => {
        buttons.forEach((button) => {
            button.classList.toggle('selected', button === target);
        });
    };

    const setCanvasSize = () => {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = Math.max(rect.height, 320);
    };

    setCanvasSize();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentLineWidth;

    const getPosition = (event) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    };

    canvas.addEventListener('mousedown', (event) => {
        isDrawing = true;
        const { x, y } = getPosition(event);
        ctx.beginPath();
        ctx.moveTo(x, y);
    });

    canvas.addEventListener('mousemove', (event) => {
        if (!isDrawing) return;
        const { x, y } = getPosition(event);
        ctx.lineTo(x, y);
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentLineWidth;
        ctx.stroke();
    });

    const stopDrawing = () => {
        isDrawing = false;
        ctx.beginPath();
    };

    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    colorButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const selectedColor = button.id === 'color-red'
                ? 'red'
                : button.id === 'color-green'
                    ? 'green'
                    : 'black';
            currentColor = selectedColor;
            ctx.strokeStyle = currentColor;
            updateSelection(colorButtons, button);
        });
    });

    sizeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            let size = 5;
            if (button.id === 'size-small') size = 2;
            if (button.id === 'size-large') size = 8;

            currentLineWidth = size;
            ctx.lineWidth = currentLineWidth;
            updateSelection(sizeButtons, button);
        });
    });

    clearButton.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    saveButton.addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'classroom-drawing.png';
        link.click();
        link.remove();
    });
};

const init = () => {
    setupWidgetToolbar();
    setupDrawingBoard();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
