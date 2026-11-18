
'use strict';

// ========================================
// PRODUCT LOTS
// Display All Stock Lots
// ========================================

import {
  getProductElement,
  showProductMessage,
  productApiRequest,
  escapeProductHTML,
  setProductButtonLoading
} from '../product-utils.js';


// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  apiUrl: '/api/products',
  container: '#product-lots-container',
  search: '#product-lot-search',
  statusFilter: '#product-lot-status-filter',
  refreshButton: '#product-lot-refresh',
  editModal: '#lot-edit-modal',
  editName: '#lot-edit-name',
  editPurchaseCost: '#lot-edit-purchase-cost',
  editTransportCost: '#lot-edit-transport-cost',
  editOtherCost: '#lot-edit-other-cost',
  editNote: '#lot-edit-note',
  editCancel: '#lot-edit-cancel',
  editSubmit: '#lot-edit-submit',
  emptyMessage: 'এই Product-এর কোনো Stock Lot পাওয়া যায়নি।'
};


// ========================================
// MODULE STATE
// ========================================

let initialized = false;
let currentProductId = null;
let lots = [];
let editingLotId = null;
let isSavingLot = false;


// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    container: getProductElement(CONFIG.container),
    search: getProductElement(CONFIG.search),
    statusFilter: getProductElement(CONFIG.statusFilter),
    refreshButton: getProductElement(CONFIG.refreshButton),
    editModal: getProductElement(CONFIG.editModal),
    editName: getProductElement(CONFIG.editName),
    editPurchaseCost: getProductElement(CONFIG.editPurchaseCost),
    editTransportCost: getProductElement(CONFIG.editTransportCost),
    editOtherCost: getProductElement(CONFIG.editOtherCost),
    editNote: getProductElement(CONFIG.editNote),
    editCancel: getProductElement(CONFIG.editCancel),
    editSubmit: getProductElement(CONFIG.editSubmit)
  };
}


// ========================================
// NORMALIZE LOT
// ========================================

function normalizeLot(data = {}) {
  return {
    id: String(data.id || data.lotId || ''),
    parentLotId: String(data.parentLotId || ''),
    lotNumber: String(data.lotNumber || data.lotCode || data.id || ''),
    lotName: String(data.lotName || data.lotNumber || data.id || ''),
    purchaseDate: data.purchaseDate || data.createdAt || null,
    supplier: String(data.supplier || ''),
    totalQuantity: Math.max(
      0,
      Number(data.totalQuantity ?? data.quantity ?? 0)
    ),
    remainingQuantity: Math.max(
      0,
      Number(data.remainingQuantity ?? data.availableQuantity ?? 0)
    ),
    purchaseCost: Math.max(0, Number(data.purchaseCost || 0)),
    transportCost: Math.max(0, Number(data.transportCost || 0)),
    otherCost: Math.max(0, Number(data.otherCost || 0)),
    note: String(data.note || ''),
    status: String(data.status || 'active').toLowerCase(),
    createdAt: data.createdAt || null
  };
}


// ========================================
// FORMAT DATE
// ========================================

function formatLotDate(value) {
  if (!value) return '—';

  let date;

  if (typeof value === 'object' && value.seconds) {
    date = new Date(value.seconds * 1000);
  } else if (typeof value === 'number') {
    date = new Date(value);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-BD', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}


// ========================================
// GET LOT STATUS
// ========================================

function getLotStatus(lot) {
  if (lot.status === 'cancelled') return 'Cancelled';
  if (lot.status === 'closed') return 'Closed';
  if (lot.status === 'draft') return 'Draft';

  if (lot.remainingQuantity <= 0) {
    return 'Depleted';
  }

  return 'Active';
}


// ========================================
// GET STATUS CLASS
// ========================================

function getLotStatusClass(status) {
  const classes = {
    Active: 'active',
    Depleted: 'depleted',
    Closed: 'closed',
    Cancelled: 'cancelled',
    Draft: 'draft'
  };

  return classes[status] || 'unknown';
}


// ========================================
// FILTER LOTS
// ========================================

function getFilteredLots() {
  const elements = getElements();

  const search = elements.search?.value
    .trim()
    .toLowerCase() || '';

  const status = elements.statusFilter?.value || 'all';

  return lots.filter(lot => {
    const matchesSearch = [
      lot.id,
      lot.lotName,
      lot.lotNumber,
      lot.supplier
    ].some(value =>
      value.toLowerCase().includes(search)
    );

    const lotStatus = getLotStatus(lot).toLowerCase();

    const matchesStatus =
      status === 'all' ||
      lotStatus === status.toLowerCase();

    return matchesSearch && matchesStatus;
  });
}


// ========================================
// RENDER LOT ROW
// ========================================

function createLotRow(lot) {
  const status = getLotStatus(lot);
  const statusClass = getLotStatusClass(status);

  const row = document.createElement('tr');

  row.innerHTML = `
    <td>
      <strong>${escapeProductHTML(lot.lotName)}</strong>
      ${lot.lotNumber && lot.lotNumber !== lot.lotName
        ? `<small>${escapeProductHTML(lot.lotNumber)}</small>`
        : ''}
    </td>

    <td>
      ${escapeProductHTML(formatLotDate(lot.purchaseDate))}
    </td>

    <td>
      ${escapeProductHTML(lot.supplier || '—')}
    </td>

    <td>
      ${lot.totalQuantity}
    </td>

    <td>
      <strong>${lot.remainingQuantity}</strong>
    </td>

    <td>
      <span class="lot-status lot-status-${statusClass}">
        ${escapeProductHTML(status)}
      </span>
    </td>

    <td>
      <button
        type="button"
        class="btn btn-sm btn-outline-primary"
        data-lot-action="edit"
        data-lot-id="${escapeProductHTML(lot.id)}"
      >
        Edit
      </button>

      <button
        type="button"
        class="btn btn-sm btn-outline-primary"
        data-lot-action="history"
        data-lot-id="${escapeProductHTML(lot.id)}"
      >
        History
      </button>
    </td>
  `;

  return row;
}


// ========================================
// RENDER LOTS
// ========================================

export function renderProductLots() {
  const elements = getElements();

  if (!elements.container) return;

  const filteredLots = getFilteredLots();

  elements.container.replaceChildren();

  if (!filteredLots.length) {
    const empty = document.createElement('div');

    empty.className = 'product-lots-empty';
    empty.textContent = CONFIG.emptyMessage;

    elements.container.appendChild(empty);

    return;
  }

  const table = document.createElement('table');

  table.className = 'product-lots-table';

  table.innerHTML = `
    <thead>
      <tr>
        <th>Lot Number</th>
        <th>Purchase Date</th>
        <th>Supplier</th>
        <th>Total Qty</th>
        <th>Remaining Qty</th>
        <th>Status</th>
        <th>Action</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  filteredLots.forEach(lot => {
    tbody.appendChild(createLotRow(lot));
  });

  table.appendChild(tbody);
  elements.container.appendChild(table);
}


// ========================================
// SET LOT DATA
// ========================================

export function setProductLots(data = []) {
  if (!Array.isArray(data)) {
    console.error('[PRODUCT LOTS] Invalid lot data.');
    return;
  }

  lots = data.map(normalizeLot);

  renderProductLots();
}


// ========================================
// GET LOT DATA
// ========================================

export function getProductLots() {
  return lots.map(lot => ({ ...lot }));
}


// ========================================
// LOAD PRODUCT LOTS
// ========================================

export async function loadProductLots(productId) {
  if (!productId) {
    throw new Error('Product ID পাওয়া যায়নি।');
  }

  currentProductId = productId;

  const elements = getElements();

  if (elements.container) {
    elements.container.textContent = 'Loading Stock Lots...';
  }

  const result = await productApiRequest(
    `${CONFIG.apiUrl}/${encodeURIComponent(productId)}/lots`,
    {
      method: 'GET'
    }
  );

  const lotList = Array.isArray(result)
    ? result
    : Array.isArray(result?.lots)
      ? result.lots
      : Array.isArray(result?.data?.lots)
        ? result.data.lots
        : Array.isArray(result?.data)
          ? result.data
          : [];

  setProductLots(lotList);

  return lots;
}


// ========================================
// REFRESH LOTS
// ========================================

export async function refreshProductLots(productId = currentProductId) {
  if (!productId) return false;

  try {
    await loadProductLots(productId);
    return true;

  } catch (error) {
    console.error('[PRODUCT LOTS]', error);

    showProductMessage(
      error.message || 'Stock Lots Refresh করা যায়নি।',
      'error'
    );

    return false;
  }
}


// ========================================
// EDIT PURCHASE LOT
// ========================================

function inputMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0
    ? number.toFixed(2)
    : '0.00';
}

function fillLotEditForm(lot = {}) {
  const elements = getElements();

  if (elements.editName) {
    elements.editName.value = lot.lotName || lot.lotNumber || '';
  }
  if (elements.editPurchaseCost) {
    elements.editPurchaseCost.value = inputMoney(lot.purchaseCost);
  }
  if (elements.editTransportCost) {
    elements.editTransportCost.value = inputMoney(lot.transportCost);
  }
  if (elements.editOtherCost) {
    elements.editOtherCost.value = inputMoney(lot.otherCost);
  }
  if (elements.editNote) {
    elements.editNote.value = lot.note || '';
  }
}

function closeLotEdit() {
  const { editModal } = getElements();

  if (!editModal) return;

  editModal.classList.remove('is-open');
  editModal.hidden = true;
  editModal.setAttribute('aria-hidden', 'true');
  editModal.querySelector('#product-global-message')?.remove();
  editingLotId = null;
}

async function openLotEdit(lot) {
  const elements = getElements();

  if (!elements.editModal || !lot?.id) return false;

  editingLotId = lot.parentLotId || lot.id;
  fillLotEditForm(lot);
  elements.editModal.querySelector('#product-global-message')?.remove();
  elements.editModal.hidden = false;
  elements.editModal.classList.add('is-open');
  elements.editModal.setAttribute('aria-hidden', 'false');

  window.setTimeout(() => elements.editName?.focus(), 0);

  if (lot.parentLotId) {
    try {
      const result = await productApiRequest(
        `/api/lots/${encodeURIComponent(editingLotId)}`,
        { method: 'GET' }
      );

      if (editingLotId === (lot.parentLotId || lot.id)) {
        fillLotEditForm(result.lot || result.data?.lot || result.data || lot);
      }
    } catch (error) {
      console.warn('[LOT EDIT DETAILS]', error);
    }
  }

  return true;
}

async function saveLotEdit() {
  if (isSavingLot || !editingLotId) return false;

  const elements = getElements();
  const lotName = elements.editName?.value.trim() || '';
  const transportCost = Number(elements.editTransportCost?.value || 0);
  const otherCost = Number(elements.editOtherCost?.value || 0);

  if (!lotName || lotName.length > 100) {
    showProductMessage('Enter a Lot Name within 100 characters.', 'warning');
    elements.editName?.focus();
    return false;
  }

  if (
    !Number.isFinite(transportCost) || transportCost < 0 ||
    !Number.isFinite(otherCost) || otherCost < 0
  ) {
    showProductMessage('Lot costs must be valid non-negative numbers.', 'warning');
    return false;
  }

  isSavingLot = true;
  setProductButtonLoading(elements.editSubmit, true, 'Saving Lot...');

  try {
    await productApiRequest(
      `/api/lots/${encodeURIComponent(editingLotId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          lotName,
          transportCost,
          otherCost,
          note: elements.editNote?.value.trim() || ''
        })
      }
    );

    closeLotEdit();
    await refreshProductLots(currentProductId);
    showProductMessage('Purchase Lot updated successfully.', 'success');
    return true;
  } catch (error) {
    console.error('[LOT EDIT]', error);
    showProductMessage(error.message || 'Unable to update the Purchase Lot.', 'error');
    return false;
  } finally {
    isSavingLot = false;
    setProductButtonLoading(elements.editSubmit, false);
  }
}


// ========================================
// OPEN LOT HISTORY
// ========================================

function handleLotAction(event) {
  const button = event.target.closest('[data-lot-action]');

  if (!button) return;

  const lotId = button.dataset.lotId;

  if (!lotId || !currentProductId) return;

  if (button.dataset.lotAction === 'edit') {
    const lot = lots.find(item => item.id === lotId);
    if (lot) void openLotEdit(lot);
    return;
  }

  document.dispatchEvent(
    new CustomEvent('product:lot-history', {
      detail: {
        productId: currentProductId,
        lotId
      }
    })
  );
}


// ========================================
// BIND EVENTS
// ========================================

function bindEvents() {
  const elements = getElements();

  elements.search?.addEventListener('input', renderProductLots);

  elements.statusFilter?.addEventListener(
    'change',
    renderProductLots
  );

  elements.refreshButton?.addEventListener('click', () => {
    refreshProductLots();
  });

  elements.container?.addEventListener(
    'click',
    handleLotAction
  );

  elements.editCancel?.addEventListener('click', closeLotEdit);
  elements.editSubmit?.addEventListener('click', saveLotEdit);
  elements.editModal?.addEventListener('click', event => {
    if (event.target === elements.editModal) closeLotEdit();
  });
}


// ========================================
// RESET LOTS
// ========================================

export function resetProductLots() {
  lots = [];
  currentProductId = null;
  editingLotId = null;
  isSavingLot = false;

  const elements = getElements();

  closeLotEdit();

  if (elements.search) elements.search.value = '';

  if (elements.statusFilter) {
    elements.statusFilter.value = 'all';
  }

  if (elements.container) {
    renderProductLots();
  }
}


// ========================================
// INITIALIZE
// ========================================

export function initProductLots({ force = false } = {}) {
  if (initialized && !force) return;

  const elements = getElements();

  if (!elements.container) {
    console.warn('[PRODUCT LOTS] Container not found.');
    return;
  }

  bindEvents();

  initialized = true;
}

export default initProductLots;
