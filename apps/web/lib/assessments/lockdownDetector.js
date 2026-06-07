/**
 * @typedef {'tab_switch'|'window_blur'|'right_click'|'dev_tools'|'keyboard_shortcut'} ViolationType
 */

/**
 * @typedef {Object} Violation
 * @property {ViolationType} type
 * @property {Date} timestamp
 */

/**
 * Sets up browser lockdown mode by attaching event listeners that detect
 * suspicious activity (tab switches, dev tools, right clicks, etc.).
 *
 * @param {(violation: Violation) => void} onViolation - Callback invoked on each violation
 * @returns {() => void} Cleanup function that removes all event listeners
 */
export function setupLockdown(onViolation) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // SSR - return no-op cleanup
    return () => {};
  }

  const report = (type) => {
    onViolation({ type, timestamp: new Date() });
  };

  // Tab switch detection via visibility change
  const handleVisibilityChange = () => {
    if (document.hidden) {
      report('tab_switch');
    }
  };

  // Window blur detection
  const handleWindowBlur = () => {
    report('window_blur');
  };

  // Right-click prevention
  const handleContextMenu = (e) => {
    e.preventDefault();
    report('right_click');
  };

  // Keyboard shortcut prevention
  const handleKeyDown = (e) => {
    // F12 - Dev tools
    if (e.key === 'F12') {
      e.preventDefault();
      report('dev_tools');
      return;
    }

    // Ctrl+Shift+I - Dev tools (Elements)
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
      e.preventDefault();
      report('dev_tools');
      return;
    }

    // Ctrl+Shift+J - Dev tools (Console)
    if (e.ctrlKey && e.shiftKey && e.key === 'J') {
      e.preventDefault();
      report('dev_tools');
      return;
    }

    // Ctrl+U - View source
    if (e.ctrlKey && !e.shiftKey && e.key === 'u') {
      e.preventDefault();
      report('keyboard_shortcut');
      return;
    }

    // Ctrl+S - Save page
    if (e.ctrlKey && !e.shiftKey && e.key === 's') {
      e.preventDefault();
      report('keyboard_shortcut');
      return;
    }

    // Ctrl+P - Print
    if (e.ctrlKey && !e.shiftKey && e.key === 'p') {
      e.preventDefault();
      report('keyboard_shortcut');
      return;
    }
  };

  // Attach listeners
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', handleWindowBlur);
  document.addEventListener('contextmenu', handleContextMenu);
  document.addEventListener('keydown', handleKeyDown);

  // Return cleanup function
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    document.removeEventListener('contextmenu', handleContextMenu);
    document.removeEventListener('keydown', handleKeyDown);
  };
}
