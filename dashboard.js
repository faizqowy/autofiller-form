// State variables
let dataRows = [];
let mappings = [];
let config = {
  mode: 'manual',
  delay: 3,
  activeRowId: null,
  isAutomating: false,
  submitSelector: '',
  firstRowHeader: true
};
let currentFileBuffer = null;

// Pagination state
let currentPage = 1;
const rowsPerPage = 15;
let filteredRows = [];

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileNameSpan = document.getElementById('file-name');
const removeFileBtn = document.getElementById('remove-file');
const mappingList = document.getElementById('mapping-list');
const submitSelectorInput = document.getElementById('submit-selector');
const pickSubmitBtn = document.getElementById('pick-submit-selector');
const modeManualBtn = document.getElementById('mode-manual');
const modeAutoBtn = document.getElementById('mode-auto');
const delayContainer = document.getElementById('delay-container');
const autoDelayInput = document.getElementById('auto-delay');
const startAutomationBtn = document.getElementById('start-automation');
const resetChecklistBtn = document.getElementById('reset-checklist');
const openTestFormBtn = document.getElementById('open-test-form');
const resetDbBtn = document.getElementById('reset-database');

const searchInput = document.getElementById('search-input');
const statusFilter = document.getElementById('status-filter');
const dataTable = document.getElementById('data-table');
const tableHeaders = document.getElementById('table-headers');
const tableBody = document.getElementById('table-body');
const recordCountDiv = document.getElementById('record-count');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageNumSpan = document.getElementById('page-num');

// Modal Elements
const historyModal = document.getElementById('history-modal');
const modalSentCount = document.getElementById('modal-sent-count');
const modalLastSent = document.getElementById('modal-last-sent');
const historyList = document.getElementById('history-list');
const closeModalBtn = document.getElementById('close-modal');

const tabSelectorModal = document.getElementById('tab-selector-modal');
const tabList = document.getElementById('tab-list');
const closeTabModalBtn = document.getElementById('close-tab-modal');

// Initialize Dashboard
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
    
    updateSettingsUI();
    renderMappings();
    filterAndRenderTable();
    updateFileUploaderUI();
  });
}

// Save state helper
function saveConfig() {
  chrome.storage.local.set({ config });
}

// Update settings UI controls from loaded config
function updateSettingsUI() {
  submitSelectorInput.value = config.submitSelector || '';
  autoDelayInput.value = config.delay;
  
  const firstRowHeaderCheckbox = document.getElementById('first-row-header');
  if (firstRowHeaderCheckbox) {
    firstRowHeaderCheckbox.checked = config.firstRowHeader !== false;
  }
  
  if (config.mode === 'automated') {
    modeAutoBtn.classList.add('active');
    modeManualBtn.classList.remove('active');
    delayContainer.style.opacity = '1';
    delayContainer.style.pointerEvents = 'auto';
    startAutomationBtn.textContent = config.isAutomating ? '⏸ Pause Automation' : '⚡ Start Automation';
  } else {
    modeManualBtn.classList.add('active');
    modeAutoBtn.classList.remove('active');
    delayContainer.style.opacity = '0.5';
    delayContainer.style.pointerEvents = 'none';
    startAutomationBtn.textContent = '⚡ Fill Selected Row';
  }
  
  // Enable start automation only if we have data loaded
  startAutomationBtn.disabled = dataRows.length === 0;
}

// Render the uploader depending on whether file is loaded
function updateFileUploaderUI() {
  if (dataRows.length > 0) {
    dropZone.style.display = 'none';
    fileInfo.style.display = 'flex';
    fileNameSpan.textContent = `Spreadsheet Database (${dataRows.length} rows loaded)`;
  } else {
    dropZone.style.display = 'flex';
    fileInfo.style.display = 'none';
  }
}

// Event Listeners setup
function setupEventListeners() {
  // Drag and drop handlers
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });
  
  removeFileBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all imported spreadsheet data?')) {
      clearDatabase();
    }
  });

  // Settings inputs
  submitSelectorInput.addEventListener('change', (e) => {
    config.submitSelector = e.target.value;
    saveConfig();
  });

  const firstRowHeaderCheckbox = document.getElementById('first-row-header');
  if (firstRowHeaderCheckbox) {
    firstRowHeaderCheckbox.addEventListener('change', (e) => {
      config.firstRowHeader = e.target.checked;
      saveConfig();
      if (currentFileBuffer) {
        processFileBuffer();
      }
    });
  }

  autoDelayInput.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0) {
      config.delay = val;
      saveConfig();
    }
  });

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

  // Pickers
  pickSubmitBtn.addEventListener('click', () => {
    triggerSelectorPicker('SUBMIT_BUTTON');
  });

  // Execution buttons
  startAutomationBtn.addEventListener('click', () => {
    if (dataRows.length === 0) return;
    
    if (config.mode === 'automated') {
      config.isAutomating = !config.isAutomating;
      
      // If we are starting automation, select first unchecklisted row if none selected
      if (config.isAutomating) {
        const activeRow = dataRows.find(r => r.id === config.activeRowId);
        if (!activeRow || activeRow.checklisted) {
          const firstPending = dataRows.find(r => !r.checklisted);
          config.activeRowId = firstPending ? firstPending.id : dataRows[0].id;
        }
      }
      
      saveConfig();
      updateSettingsUI();
      renderTableData(); // Refresh active row style
      
      if (config.isAutomating) {
        // Find non-extension active tab to trigger automation start
        chrome.tabs.query({ currentWindow: true }, (tabs) => {
          const targetTab = tabs.find(t => !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
          if (targetTab) {
            chrome.runtime.sendMessage({
              action: 'START_AUTOMATION',
              tabId: targetTab.id
            });
          }
        });
      } else {
        chrome.runtime.sendMessage({ action: 'PAUSE_AUTOMATION' });
      }
    } else {
      // Manual fill click: trigger filling active row on target webpage
      if (config.activeRowId === null) {
        // Pick first pending or first row
        const pending = dataRows.find(r => !r.checklisted);
        config.activeRowId = pending ? pending.id : dataRows[0].id;
        saveConfig();
        renderTableData();
      }
      
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const targetTab = tabs.find(t => !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
        if (!targetTab) {
          alert('Please open the target form webpage in another tab first!');
          return;
        }
        
        // Switch tab and send fill command
        chrome.tabs.update(targetTab.id, { active: true }, () => {
          // Tell background to fill current row in that tab
          chrome.runtime.sendMessage({ action: 'PING' }, () => {
            // Need a tiny delay for tab activation to stabilize
            setTimeout(() => {
              chrome.storage.local.get(['dataRows', 'mappings', 'config'], (res) => {
                const row = res.dataRows.find(r => r.id === res.config.activeRowId);
                chrome.tabs.sendMessage(targetTab.id, {
                  action: 'FILL_FORM',
                  row: row,
                  mappings: res.mappings,
                  config: res.config
                }).catch((err) => {
                  console.error("Failed to send FILL_FORM message:", err);
                });
              });
            }, 250);
          });
        });
      });
    }
  });

  resetChecklistBtn.addEventListener('click', () => {
    if (confirm('Reset checklist status, sent counters, and history for all rows?')) {
      dataRows = dataRows.map(row => ({
        ...row,
        checklisted: false,
        sentCount: 0,
        history: []
      }));
      if (dataRows.length > 0) {
        config.activeRowId = dataRows[0].id;
      }
      config.isAutomating = false;
      chrome.storage.local.set({ dataRows, config }, () => {
        updateSettingsUI();
        filterAndRenderTable();
      });
    }
  });

  resetDbBtn.addEventListener('click', () => {
    if (confirm('Delete all data and mappings? This cannot be undone.')) {
      clearDatabase();
    }
  });

  openTestFormBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('test-form.html') });
  });

  // Table filtering and search
  searchInput.addEventListener('input', () => {
    currentPage = 1;
    filterAndRenderTable();
  });
  
  statusFilter.addEventListener('change', () => {
    currentPage = 1;
    filterAndRenderTable();
  });

  // Pagination buttons
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTableData();
    }
  });

  nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(filteredRows.length / rowsPerPage);
    if (currentPage < totalPages) {
      currentPage++;
      renderTableData();
    }
  });

    // Modal close
    closeModalBtn.addEventListener('click', () => {
      historyModal.style.display = 'none';
    });
    
    closeTabModalBtn.addEventListener('click', () => {
      tabSelectorModal.style.display = 'none';
    });
    
    window.addEventListener('click', (e) => {
      if (e.target === historyModal) {
        historyModal.style.display = 'none';
      }
      if (e.target === tabSelectorModal) {
        tabSelectorModal.style.display = 'none';
      }
    });

  // Listen to background updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'STATE_UPDATED') {
      loadStateFromStorage();
    } else if (message.action === 'SELECTOR_PICKED') {
      handleSelectorPicked(message.column, message.selector);
    }
  });
}

// Handle Element Picker initiation
function triggerSelectorPicker(columnName) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const webpageTabs = tabs.filter(t => !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
    
    if (webpageTabs.length === 0) {
      alert('Please open your target form webpage in another tab first!');
      return;
    }

    const pickBtn = columnName === 'SUBMIT_BUTTON' 
      ? pickSubmitBtn 
      : document.querySelector(`.btn-pick[data-col="${columnName}"]`);

    if (webpageTabs.length === 1) {
      selectTabForPicker(webpageTabs[0], columnName, pickBtn);
    } else {
      showTabSelectorModal(webpageTabs, columnName, pickBtn);
    }
  });
}

function showTabSelectorModal(tabs, columnName, pickBtn) {
  tabList.innerHTML = '';
  
  tabs.forEach(tab => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'tab-item-btn';
    
    const fav = document.createElement('div');
    fav.className = 'tab-favicon';
    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.src = tab.favIconUrl;
      img.style.width = '16px';
      img.style.height = '16px';
      fav.appendChild(img);
    } else {
      fav.textContent = '🌐';
    }
    
    const info = document.createElement('div');
    info.className = 'tab-info-text';
    
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'Untitled';
    
    const url = document.createElement('span');
    url.className = 'tab-url';
    url.textContent = tab.url || '';
    
    info.appendChild(title);
    info.appendChild(url);
    
    btn.appendChild(fav);
    btn.appendChild(info);
    
    btn.addEventListener('click', () => {
      tabSelectorModal.style.display = 'none';
      selectTabForPicker(tab, columnName, pickBtn);
    });
    
    li.appendChild(btn);
    tabList.appendChild(li);
  });
  
  tabSelectorModal.style.display = 'flex';
}

function selectTabForPicker(tab, columnName, pickBtn) {
  if (pickBtn) {
    pickBtn.classList.add('active-picking');
    pickBtn.textContent = 'Picking...';
  }

  chrome.tabs.update(tab.id, { active: true }, () => {
    chrome.tabs.sendMessage(tab.id, {
      action: 'START_SELECTOR_PICKER',
      column: columnName
    }).catch(() => {
      alert('Could not start picker. Try refreshing the target web page first.');
      if (pickBtn) {
        pickBtn.classList.remove('active-picking');
        pickBtn.textContent = '🎯 Pick';
      }
    });
  });
}

// Receive picked selector from target page
function handleSelectorPicked(column, selector) {
  // Re-enable picker UI button
  let pickBtn = null;
  if (column === 'SUBMIT_BUTTON') {
    pickBtn = pickSubmitBtn;
    config.submitSelector = selector;
    submitSelectorInput.value = selector;
    saveConfig();
  } else {
    pickBtn = document.querySelector(`.btn-pick[data-col="${column}"]`);
    mappings = mappings.map(m => m.column === column ? { ...m, selector } : m);
    chrome.storage.local.set({ mappings }, () => {
      renderMappings();
    });
  }

  if (pickBtn) {
    pickBtn.classList.remove('active-picking');
    pickBtn.textContent = '🎯 Pick';
  }
}

// Clear database helper
function clearDatabase() {
  dataRows = [];
  mappings = [];
  currentFileBuffer = null;
  config.activeRowId = null;
  config.isAutomating = false;
  
  chrome.storage.local.set({
    dataRows: [],
    mappings: [],
    config: config
  }, () => {
    updateSettingsUI();
    renderMappings();
    filterAndRenderTable();
    updateFileUploaderUI();
  });
}

// Parsing spreadsheet files (Excel / CSV)
function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    currentFileBuffer = e.target.result;
    processFileBuffer();
  };
  reader.readAsArrayBuffer(file);
}

function getColumnLetter(colIndex) {
  let letter = '';
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function processFileBuffer() {
  if (!currentFileBuffer) return;
  try {
    const data = new Uint8Array(currentFileBuffer);
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Read sheet as an array of arrays
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (rawRows.length === 0) {
      alert('The uploaded spreadsheet contains no records.');
      return;
    }

    const firstRowHeaderCheckbox = document.getElementById('first-row-header');
    const firstRowHeader = firstRowHeaderCheckbox ? firstRowHeaderCheckbox.checked : true;

    let headers = [];
    let dataArray = [];

    if (firstRowHeader) {
      // First row is headers
      headers = rawRows[0].map((h, i) => {
        let str = String(h).trim();
        return str || `Column_${i + 1}`;
      });
      dataArray = rawRows.slice(1);
    } else {
      // First row is data
      const maxCols = Math.max(...rawRows.map(r => r.length));
      headers = Array.from({ length: maxCols }, (_, i) => `Column ${getColumnLetter(i)}`);
      dataArray = rawRows;
    }

    // Deduplicate headers to avoid mapping conflicts
    const seen = {};
    headers = headers.map((h, i) => {
      let uniqueName = h;
      let count = 1;
      while (seen[uniqueName]) {
        uniqueName = `${h}_${count}`;
        count++;
      }
      seen[uniqueName] = true;
      return uniqueName;
    });

    // Build dataRows, filtering out empty rows
    dataRows = dataArray
      .filter(row => row.some(val => val !== undefined && val !== null && String(val).trim() !== ''))
      .map((row, index) => {
        const rowData = {};
        headers.forEach((header, i) => {
          rowData[header] = row[i] !== undefined ? row[i] : '';
        });
        return {
          id: index + 1,
          data: rowData,
          checklisted: false,
          sentCount: 0,
          history: []
        };
      });

    // Generate default mappings
    mappings = headers.map(header => {
      // Try simple auto-matching
      let selector = '';
      const normHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normHeader.includes('email')) {
        selector = 'input[type="email"], [name*="email"], #email';
      } else if (normHeader.includes('name')) {
        selector = 'input[name*="name"], #name, #fullname';
      } else if (normHeader.includes('phone') || normHeader.includes('tel') || normHeader.includes('mobile')) {
        selector = 'input[type="tel"], [name*="phone"], #phone, #tel';
      } else if (normHeader.includes('address')) {
        selector = 'textarea[name*="address"], input[name*="address"], #address';
      } else if (normHeader.includes('subject')) {
        selector = 'input[name*="subject"], #subject';
      } else if (normHeader.includes('message') || normHeader.includes('body') || normHeader.includes('notes')) {
        selector = 'textarea, [name*="message"], #message';
      }
      
      return {
        column: header,
        selector: selector
      };
    });

    config.activeRowId = dataRows.length > 0 ? dataRows[0].id : null;
    config.isAutomating = false;

    // Save to chrome storage
    chrome.storage.local.set({
      dataRows: dataRows,
      mappings: mappings,
      config: config
    }, () => {
      currentPage = 1;
      updateSettingsUI();
      renderMappings();
      filterAndRenderTable();
      updateFileUploaderUI();
    });
    
  } catch (err) {
    console.error(err);
    alert('Error parsing file: ' + err.message);
  }
}

// Render dynamic column mappings in configuration panel
function renderMappings() {
  mappingList.innerHTML = '';
  
  if (mappings.length === 0) {
    mappingList.innerHTML = '<div class="empty-mapping">Upload a file first to configure mappings.</div>';
    return;
  }

  mappings.forEach(m => {
    const row = document.createElement('div');
    row.className = 'mapping-row';
    
    // Label
    const label = document.createElement('div');
    label.className = 'mapping-label';
    label.textContent = m.column;
    const typeSpan = document.createElement('span');
    typeSpan.className = 'col-type';
    typeSpan.textContent = 'TEXT';
    label.appendChild(typeSpan);
    
    // Selector Input Group
    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-with-action';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = m.selector;
    input.placeholder = `Selector for ${m.column}`;
    input.addEventListener('change', (e) => {
      m.selector = e.target.value;
      // Save mappings array back to storage
      chrome.storage.local.set({ mappings });
    });
    
    const pickBtn = document.createElement('button');
    pickBtn.className = 'btn-pick';
    pickBtn.dataset.col = m.column;
    pickBtn.title = 'Pick input field on the page';
    pickBtn.textContent = '🎯 Pick';
    pickBtn.addEventListener('click', () => {
      triggerSelectorPicker(m.column);
    });
    
    inputGroup.appendChild(input);
    inputGroup.appendChild(pickBtn);
    
    row.appendChild(label);
    row.appendChild(inputGroup);
    
    mappingList.appendChild(row);
  });
}

// Filter and render records table
function filterAndRenderTable() {
  const searchTerm = searchInput.value.toLowerCase();
  const filterVal = statusFilter.value;
  
  filteredRows = dataRows.filter(row => {
    // 1. Filter by search
    let matchesSearch = false;
    if (!searchTerm) {
      matchesSearch = true;
    } else {
      // Check values in row data object
      const dataValuesString = Object.values(row.data).join(' ').toLowerCase();
      matchesSearch = dataValuesString.includes(searchTerm) || row.id.toString().includes(searchTerm);
    }
    
    // 2. Filter by status
    let matchesStatus = true;
    if (filterVal === 'completed') {
      matchesStatus = row.checklisted === true;
    } else if (filterVal === 'pending') {
      matchesStatus = row.checklisted === false;
    }
    
    return matchesSearch && matchesStatus;
  });

  renderTableData();
}

// Render dynamic rows in records table based on pagination
function renderTableData() {
  // Clear headers & body
  tableHeaders.innerHTML = '';
  tableBody.innerHTML = '';

  if (dataRows.length === 0) {
    tableHeaders.innerHTML = `
      <th>Status</th>
      <th>Actions</th>
      <th>Row ID</th>
      <th>spreadsheet columns</th>
    `;
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" class="no-data">No records loaded. Please import a file.</td>
      </tr>
    `;
    recordCountDiv.textContent = '0 records loaded';
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    pageNumSpan.textContent = 'Page 1 of 1';
    return;
  }

  // Set Dynamic Table Headers based on first row's columns
  const headerRow = document.createElement('tr');
  
  const statusTh = document.createElement('th');
  statusTh.textContent = 'Status';
  tableHeaders.appendChild(statusTh);
  
  const actionTh = document.createElement('th');
  actionTh.textContent = 'Actions';
  tableHeaders.appendChild(actionTh);
  
  const idTh = document.createElement('th');
  idTh.textContent = 'Row';
  tableHeaders.appendChild(idTh);
  
  // Find all distinct spreadsheet columns across rows
  const spreadsheetCols = Object.keys(dataRows[0].data);
  spreadsheetCols.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col;
    tableHeaders.appendChild(th);
  });

  // Calculate pagination window
  const totalPages = Math.ceil(filteredRows.length / rowsPerPage) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, filteredRows.length);
  const pageRows = filteredRows.slice(startIndex, endIndex);

  if (pageRows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3 + spreadsheetCols.length;
    td.className = 'no-data';
    td.textContent = 'No records match your filters.';
    tr.appendChild(td);
    tableBody.appendChild(tr);
  } else {
    pageRows.forEach(row => {
      const tr = document.createElement('tr');
      if (row.id === config.activeRowId) {
        tr.classList.add('active-row');
      }

      // 1. Status Column
      const statusTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = row.checklisted ? 'badge badge-success' : 'badge badge-pending';
      badge.textContent = row.checklisted ? 'Sent' : 'Pending';
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);

      // 2. Actions Column
      const actionsTd = document.createElement('td');
      actionsTd.className = 'row-actions';
      
      const fillBtn = document.createElement('button');
      fillBtn.className = 'btn-row-action btn-fill-row';
      fillBtn.textContent = 'Fill';
      fillBtn.title = 'Select and fill this row';
      fillBtn.addEventListener('click', () => {
        selectAndFillRow(row.id);
      });
      
      const histBtn = document.createElement('button');
      histBtn.className = 'btn-row-action';
      histBtn.textContent = `🕒 ${row.sentCount || 0}`;
      histBtn.title = 'View submission history';
      histBtn.addEventListener('click', () => {
        openHistoryModal(row);
      });
      
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-row-action';
      delBtn.textContent = '🗑️';
      delBtn.title = 'Delete row';
      delBtn.addEventListener('click', () => {
        if (confirm(`Delete Row #${row.id}?`)) {
          deleteRow(row.id);
        }
      });

      actionsTd.appendChild(fillBtn);
      actionsTd.appendChild(histBtn);
      actionsTd.appendChild(delBtn);
      tr.appendChild(actionsTd);

      // 3. ID Column
      const idTd = document.createElement('td');
      idTd.textContent = `#${row.id}`;
      idTd.style.fontWeight = '600';
      tr.appendChild(idTd);

      // 4. Spreadsheet Data columns
      spreadsheetCols.forEach(col => {
        const td = document.createElement('td');
        const val = row.data[col];
        td.textContent = val !== undefined ? val : '';
        td.title = val !== undefined ? val : '';
        tr.appendChild(td);
      });

      tableBody.appendChild(tr);
    });
  }

  // Footer UI
  recordCountDiv.textContent = `${filteredRows.length} of ${dataRows.length} records shown`;
  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage === totalPages;
  pageNumSpan.textContent = `Page ${currentPage} of ${totalPages}`;
}

// Delete single row from database
function deleteRow(rowId) {
  dataRows = dataRows.filter(r => r.id !== rowId);
  if (config.activeRowId === rowId) {
    config.activeRowId = dataRows.length > 0 ? dataRows[0].id : null;
  }
  chrome.storage.local.set({ dataRows, config }, () => {
    updateSettingsUI();
    filterAndRenderTable();
    updateFileUploaderUI();
  });
}

// Select active row and perform manual fill
function selectAndFillRow(rowId) {
  config.activeRowId = rowId;
  chrome.storage.local.set({ config }, () => {
    renderTableData(); // Re-render table to show active row visual styling
    // Trigger fill
    startAutomationBtn.click();
  });
}

// Open and render History Audit Modal
function openHistoryModal(row) {
  modalSentCount.textContent = row.sentCount || 0;
  modalLastSent.textContent = row.history && row.history.length > 0 
    ? new Date(row.history[row.history.length - 1]).toLocaleString() 
    : 'Never';
  
  historyList.innerHTML = '';
  if (!row.history || row.history.length === 0) {
    historyList.innerHTML = '<li class="no-data" style="padding: 12px 0;">No submission history entries.</li>';
  } else {
    // Show newest first
    const reversedHistory = [...row.history].reverse();
    reversedHistory.forEach((ts, idx) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      
      const numSpan = document.createElement('span');
      numSpan.textContent = `Submission #${reversedHistory.length - idx}`;
      
      const dateSpan = document.createElement('span');
      dateSpan.className = 'date';
      dateSpan.textContent = new Date(ts).toLocaleString();
      
      li.appendChild(numSpan);
      li.appendChild(dateSpan);
      historyList.appendChild(li);
    });
  }
  
  historyModal.style.display = 'flex';
}
