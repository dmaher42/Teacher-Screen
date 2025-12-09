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

const displayStudents = () => {
    const listDisplay = document.getElementById('student-list-display');
    if (!listDisplay) return;

    listDisplay.innerHTML = '';
    const studentList = JSON.parse(localStorage.getItem('studentList') || '[]');

    if (studentList.length === 0) {
        listDisplay.innerHTML = '<li>No students loaded</li>';
        return;
    }

    studentList.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        listDisplay.appendChild(li);
    });
};

const setupStudentListControls = () => {
    const exportBtn = document.getElementById('export-students-btn');
    const importBtn = document.getElementById('import-students-btn');
    const fileInput = document.getElementById('file-input');

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const studentList = JSON.parse(localStorage.getItem('studentList') || '[]');
            if (studentList.length === 0) {
                alert('No students to export!');
                return;
            }

            const blob = new Blob([studentList.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'students.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                const names = text.split('\n')
                    .map(name => name.trim())
                    .filter(name => name.length > 0);

                if (names.length > 0) {
                    localStorage.setItem('studentList', JSON.stringify(names));
                    displayStudents();
                    alert(`Successfully imported ${names.length} students.`);
                } else {
                    alert('No valid names found in the file.');
                }
            };
            reader.readAsText(file);
            // Reset input so same file can be selected again
            event.target.value = '';
        });
    }

    // Initial display
    displayStudents();
};

const init = () => {
    setupWidgetToolbar();
    setupDrawingBoard();
    setupStudentListControls();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
