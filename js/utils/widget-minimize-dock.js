// js/utils/widget-minimize-dock.js

(() => {
  'use strict';

  const LayoutManager = window.LayoutManager;
  if (!LayoutManager || LayoutManager.prototype.__widgetMinimizeDockInstalled) {
    return;
  }

  const DOCK_CLASS = 'widget-minimize-dock';
  const STYLESHEET_ID = 'widget-minimize-dock-styles';
  const DOCK_MARGIN_PX = 16;
  const DOCK_TOOLBAR_GAP_PX = 12;

  const isTeacherMode = () => (
    window.TeacherScreenAppMode
      ? window.TeacherScreenAppMode.isTeacherMode()
      : true
  );

  const loadStylesheet = () => {
    if (document.getElementById(STYLESHEET_ID)) {
      return;
    }

    const currentScript = document.currentScript;
    const scriptUrl = currentScript?.src
      ? new URL(currentScript.src, window.location.href)
      : null;
    const stylesheetUrl = scriptUrl
      ? new URL('../../css/widget-minimize-dock.css', scriptUrl)
      : new URL('./css/widget-minimize-dock.css', window.location.href);

    if (scriptUrl?.searchParams.has('v')) {
      stylesheetUrl.searchParams.set('v', scriptUrl.searchParams.get('v'));
    }

    const stylesheet = document.createElement('link');
    stylesheet.id = STYLESHEET_ID;
    stylesheet.rel = 'stylesheet';
    stylesheet.href = stylesheetUrl.href;
    document.head.appendChild(stylesheet);
  };

  const getWidgetName = (widgetInfo) => (
    widgetInfo?.element
      ?.querySelector(':scope > .widget-header .widget-header-title span')
      ?.textContent
      ?.trim()
    || 'widget'
  );

  const updateDockOffset = (layoutManager, dock) => {
    if (!layoutManager?.container || !dock?.isConnected) {
      return;
    }

    let bottomOffset = DOCK_MARGIN_PX;
    const toolbar = document.getElementById('lesson-quick-actions');

    if (toolbar) {
      const toolbarStyle = window.getComputedStyle(toolbar);
      const containerRect = layoutManager.container.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const toolbarIsVisible = toolbarStyle.display !== 'none'
        && toolbarStyle.visibility !== 'hidden'
        && toolbarRect.width > 0
        && toolbarRect.height > 0;
      const toolbarIsNearBottom = toolbarRect.top > containerRect.top + (containerRect.height * 0.5);
      const toolbarOverlapsCanvas = toolbarRect.bottom > containerRect.top
        && toolbarRect.top < containerRect.bottom;

      if (toolbarIsVisible && toolbarIsNearBottom && toolbarOverlapsCanvas) {
        bottomOffset = Math.max(
          DOCK_MARGIN_PX,
          Math.round(containerRect.bottom - toolbarRect.top + DOCK_TOOLBAR_GAP_PX)
        );
      }
    }

    dock.style.setProperty('--widget-minimize-dock-bottom', `${bottomOffset}px`);
  };

  const ensureDock = (layoutManager) => {
    if (!isTeacherMode() || !layoutManager?.container) {
      return null;
    }

    let dock = layoutManager.minimizedWidgetDock;
    if (!dock?.isConnected || dock.parentElement !== layoutManager.container) {
      dock = layoutManager.container.querySelector(`:scope > .${DOCK_CLASS}`);
    }

    if (!dock) {
      dock = document.createElement('div');
      dock.className = DOCK_CLASS;
      dock.setAttribute('role', 'region');
      dock.setAttribute('aria-label', 'Minimised widgets');
      layoutManager.container.appendChild(dock);
    }

    layoutManager.minimizedWidgetDock = dock;
    updateDockOffset(layoutManager, dock);

    if (!layoutManager.__widgetMinimizeDockResizeHandler) {
      layoutManager.__widgetMinimizeDockResizeHandler = () => {
        const activeDock = layoutManager.minimizedWidgetDock;
        if (activeDock?.isConnected) {
          updateDockOffset(layoutManager, activeDock);
        }
      };
      window.addEventListener('resize', layoutManager.__widgetMinimizeDockResizeHandler);
    }

    return dock;
  };

  const mountInDock = (layoutManager, widgetInfo) => {
    const dock = ensureDock(layoutManager);
    if (!dock || !widgetInfo?.element) {
      return;
    }

    const element = widgetInfo.element;
    element.classList.add('is-minimized');
    element.style.position = 'relative';
    element.style.left = '';
    element.style.top = '';
    element.style.right = '';
    element.style.bottom = '';
    element.style.width = '';
    element.style.height = '';
    element.style.gridColumn = '';
    element.style.gridRow = '';

    if (element.parentElement !== dock) {
      dock.appendChild(element);
    }

    updateDockOffset(layoutManager, dock);
  };

  const applyMinimizedHeaderState = (layoutManager, widgetInfo) => {
    const header = widgetInfo?.element?.querySelector(':scope > .widget-header');
    if (!header) {
      return;
    }

    const minimized = layoutManager.isWidgetMinimized(widgetInfo);
    if (minimized) {
      header.setAttribute('aria-hidden', 'false');
      header.removeAttribute('inert');

      const title = header.querySelector('.widget-header-title');
      if (title) {
        title.tabIndex = -1;
      }
      return;
    }

    header.setAttribute('aria-hidden', layoutManager.editable ? 'false' : 'true');
    header.toggleAttribute('inert', !layoutManager.editable);

    const title = header.querySelector('.widget-header-title');
    if (title) {
      title.tabIndex = layoutManager.editable ? 0 : -1;
    }
  };

  const prototype = LayoutManager.prototype;
  prototype.__widgetMinimizeDockInstalled = true;

  const originalCreateWidgetHeader = prototype.createWidgetHeader;
  prototype.createWidgetHeader = function createWidgetHeaderWithMinimizeButton(widget, widgetElement, widgetType) {
    const result = originalCreateWidgetHeader.call(this, widget, widgetElement, widgetType);

    if (!isTeacherMode()) {
      return result;
    }

    const header = widgetElement.querySelector(':scope > .widget-header');
    const optionsMenu = header?.querySelector(':scope > .widget-header-menu');
    const minimizeButton = widget?.minimizeButton;

    if (!header || !optionsMenu || !minimizeButton) {
      return result;
    }

    minimizeButton.classList.remove('widget-header-menu__item');
    minimizeButton.classList.add('widget-header-action', 'widget-header-action--minimize');
    minimizeButton.setAttribute('data-widget-header-control', 'minimize');
    header.insertBefore(minimizeButton, optionsMenu);

    return result;
  };

  const originalRefreshWidgetMinimizeControl = prototype.refreshWidgetMinimizeControl;
  prototype.refreshWidgetMinimizeControl = function refreshDockedMinimizeControl(widgetInfo) {
    originalRefreshWidgetMinimizeControl.call(this, widgetInfo);

    const minimizeButton = widgetInfo?.minimizeButton || widgetInfo?.widget?.minimizeButton;
    if (!minimizeButton) {
      return;
    }

    const minimized = this.isWidgetMinimized(widgetInfo);
    const widgetName = getWidgetName(widgetInfo);
    const actionLabel = minimized
      ? `Restore ${widgetName} and show it to students`
      : `Minimise ${widgetName} and hide it from students`;

    minimizeButton.classList.remove('widget-header-menu__item', 'is-expanded');
    minimizeButton.classList.add('widget-header-action', 'widget-header-action--minimize');
    minimizeButton.classList.toggle('is-minimized', minimized);
    minimizeButton.innerHTML = minimized
      ? '<i class="fas fa-window-restore" aria-hidden="true"></i>'
      : '<i class="fas fa-window-minimize" aria-hidden="true"></i>';
    minimizeButton.setAttribute('aria-label', actionLabel);
    minimizeButton.setAttribute('aria-pressed', minimized ? 'true' : 'false');
    minimizeButton.title = actionLabel;

    applyMinimizedHeaderState(this, widgetInfo);
  };

  const originalMountWidgetElement = prototype.mountWidgetElement;
  prototype.mountWidgetElement = function mountWidgetOrDock(widgetInfo, options = {}) {
    if (isTeacherMode() && this.isWidgetMinimized(widgetInfo)) {
      mountInDock(this, widgetInfo);
      return;
    }

    return originalMountWidgetElement.call(this, widgetInfo, options);
  };

  const originalUpdateWidgetChrome = prototype.updateWidgetChrome;
  prototype.updateWidgetChrome = function updateWidgetChromeWithDock(widgetInfo) {
    originalUpdateWidgetChrome.call(this, widgetInfo);
    applyMinimizedHeaderState(this, widgetInfo);
  };

  const originalClampWidgetToContainer = prototype.clampWidgetToContainer;
  prototype.clampWidgetToContainer = function clampExpandedBoundsWhileDocked(widgetInfo) {
    if (!this.isWidgetMinimized(widgetInfo)) {
      return originalClampWidgetToContainer.call(this, widgetInfo);
    }

    const minimizedHeight = widgetInfo.height;
    const expandedHeight = Number.isFinite(widgetInfo.expandedHeight)
      ? widgetInfo.expandedHeight
      : minimizedHeight;

    widgetInfo.height = expandedHeight;
    originalClampWidgetToContainer.call(this, widgetInfo);
    widgetInfo.expandedHeight = widgetInfo.height;
    widgetInfo.height = minimizedHeight;
  };

  const originalEnsureTeacherWidgetSpacing = prototype.ensureTeacherWidgetSpacing;
  prototype.ensureTeacherWidgetSpacing = function ensureExpandedWidgetSpacingOnly() {
    if (!isTeacherMode()) {
      return originalEnsureTeacherWidgetSpacing.call(this);
    }

    const allWidgets = this.widgets;
    this.widgets = allWidgets.filter((widgetInfo) => !this.isWidgetMinimized(widgetInfo));

    try {
      return originalEnsureTeacherWidgetSpacing.call(this);
    } finally {
      this.widgets = allWidgets;
    }
  };

  const originalResolveWidgetPlacementConflict = prototype.resolveWidgetPlacementConflict;
  prototype.resolveWidgetPlacementConflict = function skipDockedWidgetPlacement(widgetInfo) {
    if (this.isWidgetMinimized(widgetInfo)) {
      return false;
    }

    return originalResolveWidgetPlacementConflict.call(this, widgetInfo);
  };

  loadStylesheet();
})();
