// Injected Content Script for Smart Form Autofiller

let activePickerColumn = null;
let hoverOverlay = null;
let widgetContainer = null;
let isMinimized = false;

// Cached state
let dataRows = [];
let mappings = [];
let config = {
  mode: 'manual',
  delay: 3,
  activeRowId: null,
  isAutomating: false,
  submitSelector: '',
  autoTrackSubmit: false,
  showPageWidget: true
};

// Filtered rows for widget search
let filteredRows = [];
let widgetSearchQuery = '';

console.log('Smart Form Autofiller content script loaded.');
notifyBackgroundReady();
initializeWidgetSync();

// Notify background on script ready
function notifyBackgroundReady() {
  chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY' }).catch(() => {});
}

// Load storage and attach state listeners to sync with sidebar/dashboard
function initializeWidgetSync() {
  chrome.storage.local.get(['dataRows', 'mappings', 'config'], (result) => {
    dataRows = result.dataRows || [];
    mappings = result.mappings || [];
    if (result.config) {
      config = { ...config, ...result.config };
    }

    if (dataRows.length > 0) {
      initFloatingWidget();
      applyWidgetFilter();
      updateWidgetVisibility();
    }
  });

  // Watch for changes in storage
  chrome.storage.onChanged.addListener((changes) => {
    chrome.storage.local.get(['dataRows', 'mappings', 'config'], (result) => {
      dataRows = result.dataRows || [];
      mappings = result.mappings || [];
      if (result.config) {
        config = { ...config, ...result.config };
      }

      if (dataRows.length > 0) {
        if (!widgetContainer) {
          initFloatingWidget();
        }
        applyWidgetFilter();
        updateWidgetVisibility();
      } else if (widgetContainer) {
        // Destroy widget if database cleared
        widgetContainer.parentNode.removeChild(widgetContainer);
        widgetContainer = null;
      }
    });
  });
}

// Hide or show widget based on configuration state
function updateWidgetVisibility() {
  if (!widgetContainer) return;
  
  if (config.showPageWidget) {
    widgetContainer.style.display = 'block';
  } else {
    widgetContainer.style.display = 'none';
  }
}

// Receive triggers
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'FILL_FORM') {
    fillFormFields(message.row, message.mappings, message.config);
    sendResponse({ status: 'form_filled' });
    return true;
  }
  
  if (message.action === 'START_SELECTOR_PICKER') {
    startElementPicker(message.column);
    sendResponse({ status: 'picker_started' });
    return true;
  }
  
  if (message.action === 'CHECK_ALIVE') {
    sendResponse({ status: 'ALIVE' });
    return true;
  }

  if (message.action === 'UPDATE_WIDGET_ROW') {
    applyWidgetFilter();
    sendResponse({ status: 'widget_updated' });
    return true;
  }

  if (message.action === 'AUTOMATION_FINISHED') {
    showAutomationToast('🎉 Automation finished! All unchecklisted rows completed.');
    sendResponse({ status: 'toast_shown' });
    return true;
  }
});

// Element Picker
function startElementPicker(column) {
  activePickerColumn = column;
  showAutomationToast(`🎯 Selector Picker: Click on the target input field for "${column}"`);
  document.body.classList.add('autofiller-picking-cursor');

  document.addEventListener('mouseover', handlePickerMouseOver, true);
  document.addEventListener('mouseout', handlePickerMouseOut, true);
  document.addEventListener('click', handlePickerClick, true);
}

function stopElementPicker() {
  document.body.classList.remove('autofiller-picking-cursor');
  document.removeEventListener('mouseover', handlePickerMouseOver, true);
  document.removeEventListener('mouseout', handlePickerMouseOut, true);
  document.removeEventListener('click', handlePickerClick, true);
  
  if (hoverOverlay && hoverOverlay.parentNode) {
    hoverOverlay.parentNode.removeChild(hoverOverlay);
    hoverOverlay = null;
  }
  
  activePickerColumn = null;
}

function handlePickerMouseOver(e) {
  e.stopPropagation();
  e.preventDefault();
  
  const el = e.target;
  if (el.closest('#autofiller-floating-widget') || el.closest('.autofiller-toast')) return;

  if (!hoverOverlay) {
    hoverOverlay = document.createElement('div');
    hoverOverlay.id = 'autofiller-picker-overlay';
    document.body.appendChild(hoverOverlay);
  }

  const rect = el.getBoundingClientRect();
  hoverOverlay.style.top = `${rect.top + window.scrollY}px`;
  hoverOverlay.style.left = `${rect.left + window.scrollX}px`;
  hoverOverlay.style.width = `${rect.width}px`;
  hoverOverlay.style.height = `${rect.height}px`;
}

function handlePickerMouseOut(e) {
  e.stopPropagation();
  if (hoverOverlay) {
    hoverOverlay.style.width = '0px';
    hoverOverlay.style.height = '0px';
  }
}

function handlePickerClick(e) {
  e.stopPropagation();
  e.preventDefault();
  
  const el = e.target;
  if (el.closest('#autofiller-floating-widget') || el.closest('.autofiller-toast')) return;

  const selector = getUniqueSelector(el);
  
  chrome.runtime.sendMessage({
    action: 'SELECTOR_PICKED',
    column: activePickerColumn,
    selector: selector
  }).catch(() => {});

  stopElementPicker();
}

function getUniqueSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.name) {
    const tagName = el.tagName.toLowerCase();
    return `${tagName}[name="${CSS.escape(el.name)}"]`;
  }
  
  let path = [];
  while (el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    const classes = Array.from(el.classList).filter(c => !c.startsWith('autofiller-')).join('.');
    if (classes) selector += '.' + classes;
    
    let sibling = el;
    let sibCount = 0;
    while (sibling) {
      if (sibling.nodeName === el.nodeName) sibCount++;
      sibling = sibling.previousElementSibling;
    }
    sibling = el.nextElementSibling;
    while (sibling) {
      if (sibling.nodeName === el.nodeName) sibCount++;
      sibling = sibling.nextElementSibling;
    }
    
    if (sibCount > 1) {
      let temp = el;
      let index = 1;
      while (temp.previousElementSibling) {
        temp = temp.previousElementSibling;
        if (temp.nodeName === el.nodeName) index++;
      }
      selector += `:nth-of-type(${index})`;
    }
    
    path.unshift(selector);
    el = el.parentNode;
    if (el && el.nodeName.toLowerCase() === 'body') {
      path.unshift('body');
      break;
    }
  }
  return path.join(' > ');
}

// Form Filling logic
function fillFormFields(row, mappings, config) {
  if (!row || !row.data) return;

  console.log(`Autofilling row #${row.id}...`, row.data);
  
  mappings.forEach(mapping => {
    if (!mapping.selector) return;
    
    const value = row.data[mapping.column];
    if (value === undefined) return;

    // Use querySelectorAll to handle group inputs
    const elements = document.querySelectorAll(mapping.selector);
    if (elements.length === 0) return;

    fillElements(elements, value);
  });

  // Auto-submit triggers (Only if automated and submit selector mapped)
  if (config.mode === 'automated' && config.submitSelector) {
    const submitBtn = document.querySelector(config.submitSelector);
    if (submitBtn) {
      showAutomationToast(`⏳ Auto-submitting Row #${row.id} in 700ms...`);
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'FORM_SUBMITTED',
          rowId: row.id
        }).catch(() => {});

        submitBtn.classList.add('autofiller-filled-glow');
        submitBtn.click();
      }, 700);
    } else {
      showAutomationToast(`⚠️ Submit button not found for selector: ${config.submitSelector}`);
    }
  }
}

// Visual highlight effect
function highlightElement(el) {
  el.classList.add('autofiller-filled-glow');
  setTimeout(() => {
    el.classList.remove('autofiller-filled-glow');
  }, 1500);
}

// Helper to parse comma-separated or JSON list values
function parseValues(val) {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val.map(v => String(v).trim().toLowerCase());
  const valStr = String(val).trim();
  if (!valStr) return [];
  
  // Try parsing as JSON array
  if (valStr.startsWith('[') && valStr.endsWith(']')) {
    try {
      const parsed = JSON.parse(valStr);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v).trim().toLowerCase());
      }
    } catch (e) {}
  }
  
  // Split by comma or semicolon
  return valStr.split(/[,;]\s*/).map(v => v.trim().toLowerCase()).filter(v => v !== '');
}

// Format Excel serial date or general date string into YYYY-MM-DD
function formatDateForInput(val) {
  if (val === undefined || val === null || val === '') return '';
  
  // Excel serial number (days since 1900-01-01)
  const num = Number(val);
  if (!isNaN(num) && num > 25569 && num < 100000) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // Extract date part in case of time suffix
  const valStr = String(val).trim().split(/\s+/)[0];
  
  // Regex parsing (fully timezone-independent)
  const matchISO = valStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (matchISO) {
    const [_, y, m, d] = matchISO;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  
  const matchUS = valStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (matchUS) {
    const [_, m, d, y] = matchUS;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  
  // Standard fallback
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}
  
  return valStr;
}

// Format Excel fractional time or string into HH:MM:SS
function formatTimeForInput(val) {
  if (val === undefined || val === null || val === '') return '';
  
  const num = Number(val);
  if (!isNaN(num) && num >= 0 && num < 1) {
    const totalSeconds = Math.round(num * 86400);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return String(val);
}

// Fill checkboxes (supporting single toggle and multiple selection groups)
function fillCheckboxes(elements, val) {
  const targetValues = parseValues(val);
  const valStr = String(val).trim().toLowerCase();
  const isTruthy = (valStr === 'true' || valStr === '1' || valStr === 'yes' || valStr === 'checked' || valStr === 'on');
  const isFalsy = (valStr === 'false' || valStr === '0' || valStr === 'no' || valStr === 'unchecked' || valStr === 'off');

  if (elements.length === 1) {
    const el = elements[0];
    highlightElement(el);
    if (isTruthy) {
      el.checked = true;
    } else if (isFalsy) {
      el.checked = false;
    } else {
      // Checked if value attribute matches or is in target values
      el.checked = (el.value.toLowerCase() === valStr || targetValues.includes(el.value.toLowerCase()));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Checkbox group
    elements.forEach(el => {
      highlightElement(el);
      const elVal = el.value.toLowerCase();
      
      // Get associated label text
      let labelText = '';
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        if (labelEl) labelText = labelEl.textContent.trim().toLowerCase();
      }
      if (!labelText && el.parentElement) {
        labelText = el.parentElement.textContent.trim().toLowerCase();
      }
      
      const matchesValue = targetValues.includes(elVal);
      const matchesLabel = targetValues.some(tv => labelText.includes(tv));
      
      el.checked = matchesValue || matchesLabel;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}

// Fill radio groups
function fillRadios(elements, val) {
  const valStr = String(val).trim().toLowerCase();
  
  if (elements.length === 1) {
    const el = elements[0];
    highlightElement(el);
    const isTruthy = (valStr === 'true' || valStr === '1' || valStr === 'yes' || valStr === 'checked' || valStr === 'on');
    if (isTruthy || el.value.toLowerCase() === valStr) {
      el.checked = true;
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Multiple radios - check matching option
    const name = elements[0].name;
    const allRadios = name ? document.querySelectorAll(`input[type="radio"][name="${name}"]`) : elements;
    
    let matched = false;
    allRadios.forEach(el => {
      highlightElement(el);
      const elVal = el.value.toLowerCase();
      
      let labelText = '';
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        if (labelEl) labelText = labelEl.textContent.trim().toLowerCase();
      }
      if (!labelText && el.parentElement) {
        labelText = el.parentElement.textContent.trim().toLowerCase();
      }
      
      const matchesValue = (elVal === valStr);
      const matchesLabel = (labelText === valStr || labelText.includes(valStr));
      
      if (matchesValue || matchesLabel) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        matched = true;
      }
    });
    
    // Fallback: exact match value
    if (!matched && name) {
      allRadios.forEach(radio => {
        if (radio.value.toLowerCase() === valStr) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
  }
}

// Fill dropdowns (supporting select-multiple and single dropdowns with fallbacks)
function fillSelects(elements, val) {
  const targetValues = parseValues(val);
  const valStr = String(val).trim().toLowerCase();

  elements.forEach(el => {
    highlightElement(el);
    if (el.multiple) {
      // Clear selections
      for (let option of el.options) {
        option.selected = false;
      }
      // Apply multi-select
      for (let option of el.options) {
        const optVal = option.value.trim().toLowerCase();
        const optText = option.text.trim().toLowerCase();
        if (targetValues.includes(optVal) || targetValues.includes(optText)) {
          option.selected = true;
        }
      }
    } else {
      // Single select direct assign
      el.value = val;
      
      // Fallback matching
      if (el.value !== String(val)) {
        let matched = false;
        for (let option of el.options) {
          const optVal = option.value.trim().toLowerCase();
          const optText = option.text.trim().toLowerCase();
          if (optVal === valStr || optText === valStr) {
            el.value = option.value;
            matched = true;
            break;
          }
        }
        
        // Sub-string matching
        if (!matched) {
          for (let option of el.options) {
            const optText = option.text.trim().toLowerCase();
            if (optText.includes(valStr) || valStr.includes(optText)) {
              el.value = option.value;
              break;
            }
          }
        }
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// Main elements router
function fillElements(elements, val) {
  const firstEl = elements[0];
  const tagName = firstEl.tagName.toLowerCase();
  const type = firstEl.type ? firstEl.type.toLowerCase() : '';

  if (tagName === 'input' && type === 'checkbox') {
    fillCheckboxes(elements, val);
  } else if (tagName === 'input' && type === 'radio') {
    fillRadios(elements, val);
  } else if (tagName === 'select') {
    fillSelects(elements, val);
  } else {
    // Text inputs, textareas, range, color, contenteditable
    elements.forEach(el => {
      highlightElement(el);
      const elTagName = el.tagName.toLowerCase();
      const elType = el.type ? el.type.toLowerCase() : '';

      if (elTagName === 'textarea') {
        el.value = val;
      } else if (elTagName === 'input') {
        if (elType === 'date') {
          el.value = formatDateForInput(val);
        } else if (elType === 'time') {
          el.value = formatTimeForInput(val);
        } else if (elType === 'checkbox') {
          fillCheckboxes([el], val);
        } else if (elType === 'radio') {
          fillRadios([el], val);
        } else {
          el.value = val;
        }
      } else if (el.getAttribute('contenteditable') === 'true') {
        el.innerHTML = val;
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}

// Injected Floating Widget DOM creation
function initFloatingWidget() {
  if (document.getElementById('autofiller-floating-widget')) return;

  widgetContainer = document.createElement('div');
  widgetContainer.id = 'autofiller-floating-widget';
  widgetContainer.className = 'autofiller-widget-card';
  
  // Header
  const header = document.createElement('div');
  header.className = 'autofiller-widget-header';
  header.innerHTML = `
    <span class="autofiller-widget-title">⚡ Autofiller</span>
    <div class="autofiller-widget-controls">
      <button id="autofiller-widget-minimize" title="Minimize">➖</button>
      <button id="autofiller-widget-close" title="Close widget" style="margin-left:4px;">❌</button>
    </div>
  `;
  
  // Body Panel
  const body = document.createElement('div');
  body.id = 'autofiller-widget-body';
  body.className = 'autofiller-widget-body';
  
  // Search row
  const searchRow = document.createElement('div');
  searchRow.className = 'autofiller-search-row';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'autofiller-widget-search';
  searchInput.placeholder = 'Search data...';
  searchInput.addEventListener('input', (e) => {
    widgetSearchQuery = e.target.value;
    applyWidgetFilter();
  });
  searchRow.appendChild(searchInput);
  body.appendChild(searchRow);

  // Navigator Row
  const navRow = document.createElement('div');
  navRow.className = 'autofiller-nav-row';
  navRow.innerHTML = `
    <button id="autofiller-widget-prev" class="autofiller-btn-nav">◀</button>
    <span id="autofiller-widget-indicator">0 of 0</span>
    <button id="autofiller-widget-next" class="autofiller-btn-nav">▶</button>
  `;
  body.appendChild(navRow);

  // Data display
  const previewDiv = document.createElement('div');
  previewDiv.id = 'autofiller-row-preview';
  previewDiv.className = 'autofiller-row-preview';
  body.appendChild(previewDiv);

  // Sent Checkbox Row
  const sentRow = document.createElement('div');
  sentRow.className = 'autofiller-sent-row';
  sentRow.innerHTML = `
    <label class="autofiller-checkbox-container">
      <input type="checkbox" id="autofiller-widget-sent">
      <span class="autofiller-checkbox-label">Mark as Sent</span>
    </label>
  `;
  body.appendChild(sentRow);
  
  // Button group
  const actions = document.createElement('div');
  actions.className = 'autofiller-widget-actions';
  
  const fillBtn = document.createElement('button');
  fillBtn.id = 'autofiller-widget-fill';
  fillBtn.className = 'autofiller-widget-btn autofiller-btn-fill';
  fillBtn.textContent = 'Fill Fields ⚡';
  fillBtn.addEventListener('click', () => {
    chrome.storage.local.get(['dataRows', 'mappings', 'config'], (res) => {
      const row = res.dataRows.find(r => r.id === res.config.activeRowId);
      fillFormFields(row, res.mappings, res.config);
    });
  });

  actions.appendChild(fillBtn);
  body.appendChild(actions);
  
  widgetContainer.appendChild(header);
  widgetContainer.appendChild(body);
  document.body.appendChild(widgetContainer);

  // Header button handlers
  const minBtn = header.querySelector('#autofiller-widget-minimize');
  minBtn.addEventListener('click', () => {
    isMinimized = !isMinimized;
    if (isMinimized) {
      body.style.display = 'none';
      minBtn.textContent = '➕';
      widgetContainer.classList.add('minimized');
    } else {
      body.style.display = 'flex';
      minBtn.textContent = '➖';
      widgetContainer.classList.remove('minimized');
    }
  });

  const closeBtn = header.querySelector('#autofiller-widget-close');
  closeBtn.addEventListener('click', () => {
    // Hide widget and update storage config
    config.showPageWidget = false;
    chrome.storage.local.set({ config });
  });

  // Wire up navigation clicks
  navRow.querySelector('#autofiller-widget-prev').addEventListener('click', () => {
    if (filteredRows.length === 0) return;
    const activeIndex = filteredRows.findIndex(r => r.id === config.activeRowId);
    if (activeIndex > 0) {
      config.activeRowId = filteredRows[activeIndex - 1].id;
      chrome.storage.local.set({ config });
    }
  });

  navRow.querySelector('#autofiller-widget-next').addEventListener('click', () => {
    if (filteredRows.length === 0) return;
    const activeIndex = filteredRows.findIndex(r => r.id === config.activeRowId);
    if (activeIndex < filteredRows.length - 1) {
      config.activeRowId = filteredRows[activeIndex + 1].id;
      chrome.storage.local.set({ config });
    }
  });

  // Wire up Sent checkbox change
  body.querySelector('#autofiller-widget-sent').addEventListener('change', (e) => {
    if (config.activeRowId === null) return;
    const isChecked = e.target.checked;
    
    chrome.runtime.sendMessage({
      action: 'MANUAL_SUBMIT_TOGGLE',
      rowId: config.activeRowId,
      checklisted: isChecked
    });
  });

  // Draggability
  makeWidgetDraggable(widgetContainer, header);
}

// Filter and render the previews/nav indicators in floating widget
function applyWidgetFilter() {
  if (!widgetContainer) return;

  const query = widgetSearchQuery.toLowerCase().trim();
  
  if (!query) {
    filteredRows = dataRows;
  } else {
    filteredRows = dataRows.filter(row => {
      const dataStr = Object.values(row.data).join(' ').toLowerCase();
      return dataStr.includes(query) || row.id.toString().includes(query);
    });
  }

  // Handle active row id bounds checking or defaults
  if (filteredRows.length > 0) {
    const activeExists = filteredRows.some(r => r.id === config.activeRowId);
    if (!activeExists && config.activeRowId !== null) {
      const firstPending = filteredRows.find(r => !r.checklisted);
      config.activeRowId = firstPending ? firstPending.id : filteredRows[0].id;
      chrome.storage.local.set({ config });
    }
  }

  renderWidgetPreview();
}

function renderWidgetPreview() {
  const previewDiv = document.getElementById('autofiller-row-preview');
  const indicator = document.getElementById('autofiller-widget-indicator');
  const prevBtn = document.getElementById('autofiller-widget-prev');
  const nextBtn = document.getElementById('autofiller-widget-next');
  const sentCheck = document.getElementById('autofiller-widget-sent');
  
  if (filteredRows.length === 0) {
    previewDiv.innerHTML = '<div class="no-row">No row active.</div>';
    indicator.textContent = '0 of 0';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const activeRow = filteredRows.find(r => r.id === config.activeRowId) || filteredRows[0];
  if (config.activeRowId !== activeRow.id) {
    config.activeRowId = activeRow.id;
    chrome.storage.local.set({ config });
  }

  // Set Nav
  const activeIndex = filteredRows.findIndex(r => r.id === activeRow.id);
  indicator.textContent = `${activeIndex + 1} of ${filteredRows.length}`;
  prevBtn.disabled = activeIndex === 0;
  nextBtn.disabled = activeIndex === filteredRows.length - 1;

  // Set Checkbox
  sentCheck.checked = activeRow.checklisted;

  // Build fields list
  let html = `
    <div class="row-num">Row ID: #${activeRow.id} <span class="row-status ${activeRow.checklisted ? 'completed' : 'pending'}">${activeRow.checklisted ? 'Sent' : 'Pending'}</span></div>
    <div class="preview-scroll">
  `;

  for (let key in activeRow.data) {
    html += `
      <div class="preview-item">
        <span class="preview-key">${key}:</span>
        <span class="preview-val">${activeRow.data[key]}</span>
      </div>
    `;
  }

  html += `</div>`;
  previewDiv.innerHTML = html;
}

// Draggability helper
function makeWidgetDraggable(widget, header) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  header.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    if (e.target.tagName.toLowerCase() === 'button') return;
    
    e = e || window.event;
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    
    widget.style.top = (widget.offsetTop - pos2) + "px";
    widget.style.left = (widget.offsetLeft - pos1) + "px";
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

// Toast Notifications helper
function showAutomationToast(text) {
  let toastContainer = document.querySelector('.autofiller-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'autofiller-toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = 'autofiller-toast';
  toast.innerHTML = `
    <span class="toast-logo">⚡</span>
    <span class="toast-text">${text}</span>
  `;
  
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 400);
  }, 4000);
}

// Global submit listener for page forms
document.addEventListener('submit', (e) => {
  chrome.storage.local.get(['config'], (res) => {
    const config = res.config || {};
    if (config.activeRowId !== null) {
      // Only track submission if in Automated Mode, OR if Manual Mode has Auto Track enabled
      if (config.mode === 'automated' || (config.mode === 'manual' && config.autoTrackSubmit)) {
        chrome.runtime.sendMessage({
          action: 'FORM_SUBMITTED',
          rowId: config.activeRowId
        }).catch(() => {});
      }
    }
  });
}, true);
