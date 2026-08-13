// Central State Hub for Smart Form Autofiller

// Enable opening the side panel when the toolbar icon is clicked
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
}

// Initialize state in storage if not present
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['dataRows', 'mappings', 'config'], (result) => {
    const updates = {};
    if (!result.dataRows) updates.dataRows = [];
    if (!result.mappings) updates.mappings = [];
    if (!result.config) {
      updates.config = {
        mode: 'manual', // 'manual' or 'automated'
        delay: 3,       // delay in seconds
        activeRowId: null,
        isAutomating: false,
        submitSelector: '',
        autoTrackSubmit: false,
        showPageWidget: true
      };
    } else {
      let changed = false;
      const configObj = result.config;
      if (configObj.autoTrackSubmit === undefined) { configObj.autoTrackSubmit = false; changed = true; }
      if (configObj.showPageWidget === undefined) { configObj.showPageWidget = true; changed = true; }
      if (changed) updates.config = configObj;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});

// Cache tab ready states
const tabStates = {};

// Handle incoming messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  if (message.action === 'CONTENT_SCRIPT_READY') {
    if (tabId) {
      if (!tabStates[tabId]) tabStates[tabId] = {};
      tabStates[tabId].ready = true;
      
      const wasAwaitingReload = tabStates[tabId].awaitingReload;
      tabStates[tabId].awaitingReload = false; // Reset reload wait flag
      
      // If we were waiting for reload and automation is active, trigger fill after delay
      chrome.storage.local.get(['config', 'dataRows'], (result) => {
        const config = result.config || {};
        const dataRows = result.dataRows || [];
        if (config.isAutomating && dataRows.length > 0 && wasAwaitingReload) {
          setTimeout(() => {
            triggerFill(tabId);
          }, config.delay * 1000);
        }
      });
    }
    sendResponse({ status: 'acknowledged' });
    return true;
  }

  if (message.action === 'FORM_SUBMITTED') {
    const submittedRowId = message.rowId;
    if (tabId) {
      // Temporarily mark tab as not ready (since form submission might trigger reload)
      if (tabStates[tabId]) tabStates[tabId].ready = false;
    }
    
    handleFormSubmission(submittedRowId, tabId);
    sendResponse({ status: 'processing_submission' });
    return true;
  }

  if (message.action === 'MANUAL_SUBMIT_TOGGLE') {
    const rowId = message.rowId;
    const isChecked = message.checklisted;
    
    chrome.storage.local.get(['dataRows', 'config'], (result) => {
      let dataRows = result.dataRows || [];
      const config = result.config || {};
      
      dataRows = dataRows.map(row => {
        if (row.id === rowId) {
          const sentCount = isChecked ? (row.sentCount || 0) + 1 : (row.sentCount || 0);
          const history = row.history || [];
          if (isChecked) {
            history.push(new Date().toISOString());
          }
          return {
            ...row,
            checklisted: isChecked,
            sentCount: sentCount,
            history: history
          };
        }
        return row;
      });
      
      if (isChecked) {
        // If checked, advance activeRowId to the next unchecklisted row
        const currentIndex = dataRows.findIndex(r => r.id === rowId);
        let nextRow = null;
        for (let i = currentIndex + 1; i < dataRows.length; i++) {
          if (!dataRows[i].checklisted) {
            nextRow = dataRows[i];
            break;
          }
        }
        if (nextRow) {
          config.activeRowId = nextRow.id;
        } else {
          config.activeRowId = null;
        }
      }
      
      chrome.storage.local.set({ dataRows, config }, () => {
        chrome.runtime.sendMessage({ action: 'STATE_UPDATED' }).catch(() => {});
        sendResponse({ status: 'manual_submit_toggle_processed' });
      });
    });
    return true;
  }
  
  if (message.action === 'START_AUTOMATION') {
    const targetTabId = message.tabId;
    chrome.storage.local.get(['config'], (result) => {
      const config = result.config || {};
      config.isAutomating = true;
      chrome.storage.local.set({ config }, () => {
        triggerFill(targetTabId);
        sendResponse({ status: 'automation_started' });
      });
    });
    return true;
  }

  if (message.action === 'PAUSE_AUTOMATION') {
    chrome.storage.local.get(['config'], (result) => {
      const config = result.config || {};
      config.isAutomating = false;
      chrome.storage.local.set({ config }, () => {
        sendResponse({ status: 'automation_paused' });
      });
    });
    return true;
  }

  if (message.action === 'PING') {
    sendResponse({ status: 'PONG' });
    return true;
  }
});

// Helper to trigger filling on a specific tab
function triggerFill(tabId) {
  chrome.storage.local.get(['config', 'dataRows', 'mappings'], (result) => {
    const config = result.config || {};
    const dataRows = result.dataRows || [];
    const mappings = result.mappings || [];
    
    if (dataRows.length === 0 || config.activeRowId === null) return;
    
    const activeRow = dataRows.find(r => r.id === config.activeRowId);
    if (!activeRow) return;

    // Send message to content script to fill the form
    chrome.tabs.sendMessage(tabId, {
      action: 'FILL_FORM',
      row: activeRow,
      mappings: mappings,
      config: config
    }, (response) => {
      // Check for error (e.g. extension context invalidated or tab closed)
      if (chrome.runtime.lastError) {
        console.log('Error sending FILL_FORM:', chrome.runtime.lastError.message);
      }
    });
  });
}

// Handle what happens when a row is submitted (manual or automated)
function handleFormSubmission(rowId, tabId) {
  chrome.storage.local.get(['dataRows', 'config'], (result) => {
    let dataRows = result.dataRows || [];
    const config = result.config || {};
    
    // Update the submitted row's statistics
    dataRows = dataRows.map(row => {
      if (row.id === rowId) {
        const sentCount = (row.sentCount || 0) + 1;
        const history = row.history || [];
        history.push(new Date().toISOString());
        return {
          ...row,
          checklisted: true,
          sentCount: sentCount,
          history: history
        };
      }
      return row;
    });

    chrome.storage.local.set({ dataRows }, () => {
      // Broadcast update to anyone listening (e.g., Dashboard UI)
      chrome.runtime.sendMessage({ action: 'STATE_UPDATED' }).catch(() => {
        // Suppress error if dashboard is closed
      });

      // If automating, find next row
      if (config.isAutomating) {
        const currentIndex = dataRows.findIndex(r => r.id === rowId);
        let nextRow = null;

        // Try to find the next unchecklisted row
        for (let i = currentIndex + 1; i < dataRows.length; i++) {
          if (!dataRows[i].checklisted) {
            nextRow = dataRows[i];
            break;
          }
        }

        // If no next unchecklisted row found, wrap around or stop
        if (!nextRow) {
          config.isAutomating = false;
          config.activeRowId = null;
          chrome.storage.local.set({ config }, () => {
            chrome.runtime.sendMessage({ action: 'STATE_UPDATED' }).catch(() => {});
            if (tabId) {
              chrome.tabs.sendMessage(tabId, { action: 'AUTOMATION_FINISHED' }).catch(() => {});
            }
          });
          return;
        }

        // Move to the next row
        config.activeRowId = nextRow.id;
        chrome.storage.local.set({ config }, () => {
          chrome.runtime.sendMessage({ action: 'STATE_UPDATED' }).catch(() => {});

          if (tabId) {
            if (!tabStates[tabId]) tabStates[tabId] = {};
            tabStates[tabId].awaitingReload = true;

            // Wait 1.5s to see if page reloads (if so, CONTENT_SCRIPT_READY will clear the flag and trigger fill)
            setTimeout(() => {
              if (tabStates[tabId] && tabStates[tabId].awaitingReload) {
                // No reload occurred (SPA page). Trigger fill after the config delay
                tabStates[tabId].awaitingReload = false;
                
                // Calculate remaining delay (config.delay - 1.5s, min 0)
                const remainingDelay = Math.max(0, (config.delay - 1.5) * 1000);
                setTimeout(() => {
                  triggerFill(tabId);
                }, remainingDelay);
              }
            }, 1500);
          }
        });
      } else {
        // In manual mode, we also want to advance to the next row automatically for ease of use
        const currentIndex = dataRows.findIndex(r => r.id === rowId);
        let nextRow = null;
        for (let i = currentIndex + 1; i < dataRows.length; i++) {
          if (!dataRows[i].checklisted) {
            nextRow = dataRows[i];
            break;
          }
        }
        if (nextRow) {
          config.activeRowId = nextRow.id;
          chrome.storage.local.set({ config }, () => {
            chrome.runtime.sendMessage({ action: 'STATE_UPDATED' }).catch(() => {});
            if (tabId) {
              // Notify content script floating widget to update the row preview
              chrome.tabs.sendMessage(tabId, { action: 'UPDATE_WIDGET_ROW', row: nextRow }).catch(() => {});
            }
          });
        } else {
          config.activeRowId = null;
          chrome.storage.local.set({ config }, () => {
            chrome.runtime.sendMessage({ action: 'STATE_UPDATED' }).catch(() => {});
            if (tabId) {
              chrome.tabs.sendMessage(tabId, { action: 'UPDATE_WIDGET_ROW', row: null }).catch(() => {});
            }
          });
        }
      }
    });
  });
}
