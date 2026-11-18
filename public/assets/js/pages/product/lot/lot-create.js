'use strict';

import {
  getProductElement,
  showProductMessage,
  productApiRequest,
  setProductButtonLoading
} from '../product-utils.js';
import {
  getLotVariantsData,
  getLotTotalQuantity,
  validateLotVariants,
  resetLotVariants
} from './lot-variants.js';
import {
  getLotCostData,
  validateLotCost,
  resetLotCost
} from './lot-history.js';
import { refreshProductLots } from './product-lots.js';
import { setProductVariantsData } from '../product-variants.js';
import { setProductInventoryData } from '../product-inventory.js';

const CONFIG = {
  apiUrl: '/api/products',
  modal: '#lot-create-modal',
  form: '#lot-create-form',
  existingLot: '#lot-existing-lot',
  lotName: '#lot-name',
  submitButton: '#lot-create-submit',
  cancelButton: '#lot-create-cancel',
  openButton: '#product-lot-create'
};

let initialized = false;
let currentProductId = null;
let isSubmitting = false;
let ensureProductSaved = null;
let availableLots = [];
let isLoadingExistingLots = false;
let newLotNameDraft = '';

function getElements() {
  return {
    modal: getProductElement(CONFIG.modal),
    form: getProductElement(CONFIG.form),
    existingLot: getProductElement(CONFIG.existingLot),
    lotName: getProductElement(CONFIG.lotName),
    submitButton: getProductElement(CONFIG.submitButton),
    cancelButton: getProductElement(CONFIG.cancelButton),
    openButton: getProductElement(CONFIG.openButton)
  };
}

export function setLotCreateProductId(productId) {
  currentProductId = productId || null;
}

export function getLotCreateProductId() {
  return currentProductId;
}

export function openLotCreate(productId = currentProductId) {
  const elements = getElements();

  if (!elements.modal) {
    showProductMessage('Lot form was not found.', 'error');
    return false;
  }

  currentProductId = productId || currentProductId || null;
  resetLotCreate();
  elements.modal.querySelector('#product-global-message')?.remove();
  elements.modal.hidden = false;
  elements.modal.classList.add('is-open');
  elements.modal.setAttribute('aria-hidden', 'false');

  void loadExistingLots();

  window.setTimeout(() => elements.lotName?.focus(), 0);
  return true;
}

export function closeLotCreate() {
  const { modal } = getElements();
  if (!modal) return;

  modal.classList.remove('is-open');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  modal.querySelector('#product-global-message')?.remove();
}

export function getLotCreateData() {
  const elements = getElements();

  return {
    existingLotId: elements.existingLot?.value.trim() || '',
    lotName: elements.lotName?.value.trim() || ''
  };
}

export function validateLotCreate() {
  const elements = getElements();
  const { existingLotId, lotName } = getLotCreateData();

  if (!existingLotId && (!lotName || lotName.length > 100)) {
    showProductMessage('Enter a Lot Name within 100 characters.', 'warning');
    elements.lotName?.focus();
    return false;
  }

  return true;
}

function normalizeExistingLot(lot = {}) {
  return {
    id: String(lot.id || lot.lotId || ''),
    lotName: String(lot.lotName || lot.lotNumber || ''),
    lotNumber: String(lot.lotNumber || lot.id || ''),
    productName: String(lot.productName || ''),
    status: String(lot.status || '').toLowerCase(),
    legacy: lot.legacy === true
  };
}

function renderExistingLots() {
  const { existingLot } = getElements();
  if (!existingLot) return;

  const previousValue = existingLot.value;
  existingLot.replaceChildren();

  const createOption = document.createElement('option');
  createOption.value = '';
  createOption.textContent = 'Create a new Lot';
  existingLot.appendChild(createOption);

  availableLots.forEach(lot => {
    const option = document.createElement('option');
    const unavailable = lot.status === 'closed' || lot.status === 'cancelled';
    const legacyLabel = lot.legacy ? ' · old' : '';
    const productLabel = lot.productName ? ` · ${lot.productName}` : '';

    option.value = lot.id;
    option.textContent = `${lot.lotName || lot.lotNumber}${productLabel}${legacyLabel}`;
    option.disabled = unavailable;
    existingLot.appendChild(option);
  });

  existingLot.disabled = false;
  existingLot.value = availableLots.some(lot => lot.id === previousValue)
    ? previousValue
    : '';
  updateLotMode();
}

async function loadExistingLots() {
  if (isLoadingExistingLots) return;

  const { existingLot } = getElements();
  if (!existingLot) return;

  isLoadingExistingLots = true;
  existingLot.disabled = true;
  existingLot.innerHTML = '<option value="">Loading existing Lots...</option>';

  try {
    const result = await productApiRequest('/api/lots', {
      method: 'GET'
    });
    const source = Array.isArray(result?.lots)
      ? result.lots
      : Array.isArray(result?.data?.lots)
        ? result.data.lots
        : [];

    availableLots = source
      .map(normalizeExistingLot)
      .filter(lot => lot.id);

    renderExistingLots();

  } catch (error) {
    console.error('[LOT OPTIONS]', error);
    availableLots = [];
    existingLot.replaceChildren();

    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Create a new Lot';
    existingLot.appendChild(option);
    existingLot.disabled = false;

  } finally {
    isLoadingExistingLots = false;
  }
}

function updateLotMode() {
  const elements = getElements();
  const selectedId = elements.existingLot?.value || '';
  const selectedLot = availableLots.find(lot => lot.id === selectedId);

  if (selectedLot) {
    if (!elements.lotName?.readOnly) {
      newLotNameDraft = elements.lotName?.value || '';
    }

    if (elements.lotName) {
      elements.lotName.value = selectedLot.lotName || selectedLot.lotNumber;
      elements.lotName.readOnly = true;
    }

    if (elements.submitButton && !isSubmitting) {
      elements.submitButton.textContent = 'Add Product to Lot';
    }
    return;
  }

  if (elements.lotName) {
    const wasReadOnly = elements.lotName.readOnly;

    elements.lotName.readOnly = false;

    if (wasReadOnly) {
      elements.lotName.value = newLotNameDraft;
    }
  }

  if (elements.submitButton && !isSubmitting) {
    elements.submitButton.textContent = 'Create Lot';
  }
}

export async function createProductLot() {
  if (isSubmitting) return false;
  if (!validateLotCreate()) return false;
  if (!validateLotVariants()) return false;
  if (!validateLotCost()) return false;

  const elements = getElements();
  const lotData = getLotCreateData();
  const isExistingLot = Boolean(lotData.existingLotId);
  const costs = getLotCostData();
  const variants = getLotVariantsData();

  isSubmitting = true;

  try {
    if (!currentProductId) {
      if (typeof ensureProductSaved !== 'function') {
        throw new Error('Product save করা যায়নি।');
      }

      setProductButtonLoading(
        elements.submitButton,
        true,
        'Saving Product...'
      );

      const savedProduct = await ensureProductSaved();
      const savedProductId = String(
        savedProduct?.id ||
        savedProduct?.productId ||
        currentProductId ||
        ''
      );

      if (!savedProductId) {
        return false;
      }

      currentProductId = savedProductId;
    }

    setProductButtonLoading(
      elements.submitButton,
      true,
      isExistingLot ? 'Adding Product...' : 'Creating Lot...'
    );

    const result = isExistingLot
      ? await productApiRequest(
          `/api/lots/${encodeURIComponent(lotData.existingLotId)}/items`,
          {
            method: 'POST',
            body: JSON.stringify({
              productId: currentProductId,
              variants,
              purchaseCost: costs.purchaseCost,
              note: ''
            })
          }
        )
      : await productApiRequest(
          `${CONFIG.apiUrl}/${encodeURIComponent(currentProductId)}/lots`,
          {
            method: 'POST',
            body: JSON.stringify({
              lotName: lotData.lotName,
              variants,
              totalQuantity: getLotTotalQuantity(),
              purchaseCost: costs.purchaseCost,
              transportCost: costs.transportCost,
              otherCost: costs.otherCost,
              landedCost: costs.totalCost
            })
          }
        );

    const createdLot = isExistingLot
      ? result.data?.stockBatch || result.stockBatch
      : result.lot || result.data?.lot || result.data;
    const updatedProduct = isExistingLot
      ? result.data?.product || result.product || null
      : result.product || result.data?.product || null;

    if (!createdLot?.id && !createdLot?.lotId) {
      throw new Error('The backend did not return a Lot ID.');
    }

    if (Array.isArray(updatedProduct?.variants)) {
      setProductVariantsData(updatedProduct.variants);
      setProductInventoryData({
        totalStock: updatedProduct.totalStock,
        variants: updatedProduct.variants
      });
    }

    closeLotCreate();
    resetLotCreate();
    showProductMessage(
      isExistingLot
        ? 'Product stock added to the selected Purchase Lot.'
        : 'Purchase Lot created and stock added.',
      'success'
    );
    await refreshProductLots(currentProductId);

    document.dispatchEvent(new CustomEvent('product:lot-created', {
      detail: {
        productId: currentProductId,
        lot: createdLot,
        product: updatedProduct
      }
    }));

    return createdLot;
  } catch (error) {
    console.error('[LOT CREATE]', error);
    showProductMessage(error.message || 'Unable to create the Purchase Lot.', 'error');
    return false;
  } finally {
    isSubmitting = false;
    setProductButtonLoading(elements.submitButton, false);
    updateLotMode();
  }
}

export function resetLotCreate() {
  const elements = getElements();

  newLotNameDraft = '';

  if (elements.lotName) {
    elements.lotName.readOnly = false;
  }

  elements.form?.querySelectorAll('input, textarea, select').forEach(input => {
    if (!input.readOnly) input.value = '';
  });

  if (elements.existingLot) {
    elements.existingLot.value = '';
  }

  resetLotCost();
  resetLotVariants();
  isSubmitting = false;
  updateLotMode();
}

function bindEvents() {
  const elements = getElements();

  elements.openButton?.addEventListener('click', () => openLotCreate());
  elements.cancelButton?.addEventListener('click', closeLotCreate);
  elements.submitButton?.addEventListener('click', createProductLot);
  elements.existingLot?.addEventListener('change', updateLotMode);
  elements.modal?.addEventListener('click', event => {
    if (event.target === elements.modal) closeLotCreate();
  });
}

export function initLotCreate({
  force = false,
  ensureProductSaved: saveProduct = null
} = {}) {
  if (typeof saveProduct === 'function') {
    ensureProductSaved = saveProduct;
  }

  if (initialized && !force) return;

  const elements = getElements();
  if (!elements.modal || !elements.form) return;

  if (elements.form.dataset.lotCreateBound !== 'true') {
    bindEvents();
    elements.form.dataset.lotCreateBound = 'true';
  }

  initialized = true;
}

export default initLotCreate;
