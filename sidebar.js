// Sidebar Logic for Smart Form Autofiller

// State variables
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

// Filtered rows for sidebar search
let filteredRows = [];
let isMappingsOpen = false;

// DOM Elements
const dbStatusEl = document.getElementById('db-status');
const searchInput = document.getElementById('sidebar-search');
const prevRowBtn = document.getElementById('prev-row');
const nextRowBtn = document.getElementById('next-row');
const rowIndicator = document.getElementById('row-indicator');
const detailsContainer = document.getElementById('active-row-details');
const sentContainer = document.getElementById('manual-sent-container');
const sentCheckbox = document.getElementById('sidebar-sent-checkbox');

const modeManualBtn = document.getElementById('mode-manual');
const modeAutoBtn = document.getElementById('mode-auto');
const delayContainer = document.getElementById('delay-container');
const delayInput = document.getElementById('sidebar-delay');
const autoTrackContainer = document.getElementById('autotrack-container');
const autoTrackCheckbox = document.getElementById('sidebar-autotrack-checkbox');

const toggleMappingsBtn = document.getElementById('toggle-mappings');
const mappingsContainer = document.getElementById('sidebar-mappings-container');
const mappingChevron = document.getElementById('mapping-chevron');
const mappingList = document.getElementById('sidebar-mapping-list');

const fillBtn = document.getElementById('fill-now');
const toggleWidgetBtn = document.getElementById('toggle-page-widget');
const openDashboardBtn = document.getElementById('open-dashboard');

// Initialize Sidebar
document.addEventListener('DOMContentLoaded', () => {
  loadStateFromStorage();
  setupEventListeners();
});

// Load state from chrome storage
function loadStateFromStorage() {
  chrome.storage.local.get(['dataRows', 'mappings', 'config'], (result) => {
    dataRows = result.dataRows || [];
    mappings = result.mappings || [];
    if (result.config) {
      config = { ...config, ...result.config };
    }
    
    updateHeaderStatus();
    applyFilter();
    updateSettingsUI();
    renderMappings();
  });
}

// Sync helper
function saveConfig() {
  chrome.storage.local.set({ config });
}

// Update database loaded status in header
function updateHeaderStatus() {
  if (dataRows.length > 0) {
    const checklistedCount = dataRows.filter(r => r.checklisted).length;
    dbStatusEl.textContent = `Loaded (${checklistedCount}/${dataRows.length} sent)`;
    dbStatusEl.style.color = '#34d399';
    sentContainer.style.display = 'block';
  } else {
    dbStatusEl.textContent = 'No database loaded';
    dbStatusEl.style.color = '#9ca3af';
    sentContainer.style.display = 'none';
  }
}

// Update configuration UI controls
function updateSettingsUI() {
  delayInput.value = config.delay;
  autoTrackCheckbox.checked = config.autoTrackSubmit;
  
  if (config.mode === 'automated') {
    modeAutoBtn.classList.add('active');
    modeManualBtn.classList.remove('active');
    delayContainer.style.display = 'flex';
    autoTrackContainer.style.display = 'none';
    fillBtn.textContent = config.isAutomating ? '⏸ Pause Automation' : '⚡ Start Automation';
  } else {
    modeManualBtn.classList.add('active');
    modeAutoBtn.classList.remove('active');
    delayContainer.style.display = 'none';
    autoTrackContainer.style.display = 'flex';
    fillBtn.textContent = '⚡ Fill Selected Row';
  }

  // Update floating widget toggle button text
  toggleWidgetBtn.textContent = config.showPageWidget ? '🖥️ Hide Page Widget' : '🖥️ Show Page Widget';
  
  // Enable start button only if data exists
  fillBtn.disabled = dataRows.length === 0;
}

// Filter rows based on search input
function applyFilter() {
  const query = searchInput.value.toLowerCase().trim();
  
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
      // Find first unchecklisted or first available in filter
      const firstPending = filteredRows.find(r => !r.checklisted);
      config.activeRowId = firstPending ? firstPending.id : filteredRows[0].id;
      saveConfig();
    }
  }

  renderActiveRowCard();
}

// Render the details of the selected row
function renderActiveRowCard() {
  if (filteredRows.length === 0) {
    if (dataRows.length === 0) {
      detailsContainer.innerHTML = `<p class="placeholder-text">Please upload Excel or CSV data in the Dashboard to start.</p>`;
    } else {
      detailsContainer.innerHTML = `<p class="placeholder-text">No rows match your search filter.</p>`;
    }
    rowIndicator.textContent = '0 of 0';
    prevRowBtn.disabled = true;
    nextRowBtn.disabled = true;
    sentContainer.style.display = 'none';
    return;
  }

  sentContainer.style.display = 'block';
  
  const activeRow = filteredRows.find(r => r.id === config.activeRowId) || filteredRows[0];
  if (config.activeRowId !== activeRow.id) {
    config.activeRowId = activeRow.id;
    saveConfig();
  }

  // Update row navigation display
  const activeIndex = filteredRows.findIndex(r => r.id === activeRow.id);
  rowIndicator.textContent = `${activeIndex + 1} of ${filteredRows.length}`;
  prevRowBtn.disabled = activeIndex === 0;
  nextRowBtn.disabled = activeIndex === filteredRows.length - 1;

  // Set checkbox state
  sentCheckbox.checked = activeRow.checklisted;

  // Build key values preview box
  let html = `
    <div class="row-meta">
      <span>Row #${activeRow.id}</span>
      <span class="status-badge ${activeRow.checklisted ? 'sent' : 'pending'}">
        ${activeRow.checklisted ? 'Sent' : 'Pending'}
      </span>
    </div>
    <div class="data-preview-box">
  `;
  
  for (let col in activeRow.data) {
    html += `
      <div class="preview-row">
        <span class="preview-col">${col}:</span>
        <span class="preview-val" title="${activeRow.data[col]}">${activeRow.data[col]}</span>
      </div>
    `;
  }
  
  html += `</div>`;
  detailsContainer.innerHTML = html;
}

// Navigation helpers
function navigateToRowIndex(index) {
  if (index >= 0 && index < filteredRows.length) {
    config.activeRowId = filteredRows[index].id;
    saveConfig();
    renderActiveRowCard();
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', () => {
    applyFilter();
  });

  // Prev/Next Nav buttons
  prevRowBtn.addEventListener('click', () => {
    if (filteredRows.length === 0) return;
    const activeIndex = filteredRows.findIndex(r => r.id === config.activeRowId);
    if (activeIndex > 0) {
      navigateToRowIndex(activeIndex - 1);
    }
  });

  nextRowBtn.addEventListener('click', () => {
    if (filteredRows.length === 0) return;
    const activeIndex = filteredRows.findIndex(r => r.id === config.activeRowId);
    if (activeIndex < filteredRows.length - 1) {
      navigateToRowIndex(activeIndex + 1);
    }
  });

  // Sent checkbox
  sentCheckbox.addEventListener('change', (e) => {
    if (config.activeRowId === null) return;
    const isChecked = e.target.checked;
    
    chrome.runtime.sendMessage({
      action: 'MANUAL_SUBMIT_TOGGLE',
      rowId: config.activeRowId,
      checklisted: isChecked
    });
  });

  // Modes
  modeManualBtn.addEventListener('click', () => {
    config.mode = 'manual';
    config.isAutomating = false;
    saveConfig();
    updateSettingsUI();
  });

  modeAutoBtn.addEventListener('click', () => {
    config.mode = 'automated';
    saveConfig();
    updateSettingsUI();
  });

  // Delay Settings (change event to prevent lag)
  delayInput.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0) {
      config.delay = val;
      saveConfig();
    }
  });

  // Auto-Track Submit Toggle
  autoTrackCheckbox.addEventListener('change', (e) => {
    config.autoTrackSubmit = e.target.checked;
    saveConfig();
  });

  // Collapsible mappings drawer
  toggleMappingsBtn.addEventListener('click', () => {
    isMappingsOpen = !isMappingsOpen;
    if (isMappingsOpen) {
      mappingsContainer.style.display = 'block';
      mappingChevron.classList.add('open');
    } else {
      mappingsContainer.style.display = 'none';
      mappingChevron.classList.remove('open');
    }
  });

  // Trigger Fill Button
  fillBtn.addEventListener('click', () => {
    if (dataRows.length === 0 || config.activeRowId === null) return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://')) {
        alert('Please open your target web page first before clicking fill!');
        return;
      }

      if (config.mode === 'automated') {
        config.isAutomating = !config.isAutomating;
        
        // Select starting row if current one is finished
        const activeRow = dataRows.find(r => r.id === config.activeRowId);
        if (config.isAutomating && (!activeRow || activeRow.checklisted)) {
          const firstPending = dataRows.find(r => !r.checklisted);
          config.activeRowId = firstPending ? firstPending.id : dataRows[0].id;
        }

        chrome.storage.local.set({ config }, () => {
          updateSettingsUI();
          if (config.isAutomating) {
            chrome.runtime.sendMessage({
              action: 'START_AUTOMATION',
              tabId: activeTab.id
            });
          } else {
            chrome.runtime.sendMessage({ action: 'PAUSE_AUTOMATION' });
          }
        });
      } else {
        // Manual fill (direct content script message)
        const activeRow = dataRows.find(r => r.id === config.activeRowId);
        chrome.tabs.sendMessage(activeTab.id, {
          action: 'FILL_FORM',
          row: activeRow,
          mappings: mappings,
          config: config
        }).catch((err) => {
          console.error(err);
          alert('Make sure you are on the form page. Refresh it if you just loaded the extension.');
        });
      }
    });
  });

  // Toggle Page Floating Widget Visibility
  toggleWidgetBtn.addEventListener('click', () => {
    config.showPageWidget = !config.showPageWidget;
    saveConfig();
    updateSettingsUI();
  });

  // Open Dashboard option
  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });



  // Watch for storage updates to keep sidebar in sync with dashboard
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.dataRows || changes.config || changes.mappings) {
      loadStateFromStorage();
    }
  });
}

// Render dynamic column mappings in sidebar configuration drawer
function renderMappings() {
  mappingList.innerHTML = '';
  
  if (mappings.length === 0) {
    mappingList.innerHTML = '<div class="empty-mapping">Upload a file first to configure mappings.</div>';
    return;
  }

  mappings.forEach(m => {
    const row = document.createElement('div');
    row.className = 'mapping-row';
    
    const label = document.createElement('div');
    label.className = 'mapping-label';
    label.textContent = m.column;
    const typeSpan = document.createElement('span');
    typeSpan.className = 'col-type';
    typeSpan.textContent = 'TEXT';
    label.appendChild(typeSpan);
    
    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-with-action';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = m.selector;
    input.placeholder = `Selector for ${m.column}`;
    
    // Save on change to prevent lag
    input.addEventListener('change', (e) => {
      m.selector = e.target.value;
      chrome.storage.local.set({ mappings });
    });
    
    const pickBtn = document.createElement('button');
    pickBtn.className = 'btn-pick';
    pickBtn.dataset.col = m.column;
    pickBtn.title = 'Pick input field on the page';
    pickBtn.textContent = '🎯 Pick';
    
    pickBtn.addEventListener('click', () => {
      triggerSidebarSelectorPicker(m.column, pickBtn);
    });
    
    inputGroup.appendChild(input);
    inputGroup.appendChild(pickBtn);
    
    row.appendChild(label);
    row.appendChild(inputGroup);
    
    mappingList.appendChild(row);
  });
}

// Sidebar Picker targets the CURRENT active tab directly
function triggerSidebarSelectorPicker(columnName, btn) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://')) {
      alert('Please select a webpage tab first before picking fields!');
      return;
    }

    btn.classList.add('active-picking');
    btn.textContent = 'Picking...';

    // Start picker immediately in current tab
    chrome.tabs.sendMessage(activeTab.id, {
      action: 'START_SELECTOR_PICKER',
      column: columnName
    }).catch(() => {
      alert('Could not start picker. Try refreshing the target web page first.');
      btn.classList.remove('active-picking');
      btn.textContent = '🎯 Pick';
    });
  });
}


