'use strict';

import { api } from '../api.js';
import { showToast, setButtonLoading } from '../helpers.js';

let pageElement = null;
let currentSignal = null;
let isSaving = false;
let isChangingPassword = false;

const BANGLADESH_DISTRICTS = {
  Barishal: [
    'Barguna',
    'Barishal',
    'Bhola',
    'Jhalokati',
    'Patuakhali',
    'Pirojpur'
  ],
  Chattogram: [
    'Bandarban',
    'Brahmanbaria',
    'Chandpur',
    'Chattogram',
    "Cox's Bazar",
    'Cumilla',
    'Feni',
    'Khagrachhari',
    'Lakshmipur',
    'Noakhali',
    'Rangamati'
  ],
  Dhaka: [
    'Dhaka',
    'Faridpur',
    'Gazipur',
    'Gopalganj',
    'Kishoreganj',
    'Madaripur',
    'Manikganj',
    'Munshiganj',
    'Narayanganj',
    'Narsingdi',
    'Rajbari',
    'Shariatpur',
    'Tangail'
  ],
  Khulna: [
    'Bagerhat',
    'Chuadanga',
    'Jashore',
    'Jhenaidah',
    'Khulna',
    'Kushtia',
    'Magura',
    'Meherpur',
    'Narail',
    'Satkhira'
  ],
  Mymensingh: [
    'Jamalpur',
    'Mymensingh',
    'Netrokona',
    'Sherpur'
  ],
  Rajshahi: [
    'Bogura',
    'Chapainawabganj',
    'Joypurhat',
    'Naogaon',
    'Natore',
    'Pabna',
    'Rajshahi',
    'Sirajganj'
  ],
  Rangpur: [
    'Dinajpur',
    'Gaibandha',
    'Kurigram',
    'Lalmonirhat',
    'Nilphamari',
    'Panchagarh',
    'Rangpur',
    'Thakurgaon'
  ],
  Sylhet: [
    'Habiganj',
    'Moulvibazar',
    'Sunamganj',
    'Sylhet'
  ]
};

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function showMessage(message, type = '') {
  const element = pageElement?.querySelector('#settings-message');
  if (!element) return;
  element.textContent = String(message || '');
  element.className = `management-message ${type}`.trim();
}

function populateDistrictSelect(select, selectedDistrict = '') {
  const selected = String(selectedDistrict || '').trim();
  const knownDistricts = new Set(
    Object.values(BANGLADESH_DISTRICTS).flat()
  );

  select.replaceChildren();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select District';
  select.appendChild(placeholder);

  if (selected && !knownDistricts.has(selected)) {
    const currentOption = document.createElement('option');
    currentOption.value = selected;
    currentOption.textContent = `${selected} (Current)`;
    select.appendChild(currentOption);
  }

  Object.entries(BANGLADESH_DISTRICTS).forEach(([division, districts]) => {
    const group = document.createElement('optgroup');
    group.label = `${division} Division`;

    districts.forEach(district => {
      const option = document.createElement('option');
      option.value = district;
      option.textContent = district;
      group.appendChild(option);
    });

    select.appendChild(group);
  });

  select.value = selected;
}

function createDistrictRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'settings-dynamic-row settings-district-row';
  row.innerHTML = `
    <label class="management-field">
      <span>District</span>
      <select class="form-control settings-district-name">
        <option value="">Select District</option>
      </select>
    </label>
    <label class="management-field">
      <span>Delivery Charge</span>
      <input class="form-control settings-district-charge" type="number"
        min="0" step="0.01" value="${numberValue(data.charge)}">
    </label>
    <button class="btn btn-secondary settings-row-remove" type="button"
      aria-label="Remove district">Remove</button>
  `;
  populateDistrictSelect(
    row.querySelector('.settings-district-name'),
    data.district
  );
  return row;
}

function createDiscountRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'settings-dynamic-row settings-discount-row';
  row.dataset.ruleId = String(data.id || '');
  row.innerHTML = `
    <label class="management-field">
      <span>Minimum Purchase</span>
      <input class="form-control settings-rule-minimum" type="number"
        min="0" step="0.01" value="${numberValue(data.minimumPurchase)}">
    </label>
    <label class="management-field">
      <span>Discount %</span>
      <input class="form-control settings-rule-percent" type="number"
        min="0.01" max="100" step="0.01"
        value="${numberValue(data.discountPercent)}">
    </label>
    <label class="management-field">
      <span>Maximum Discount</span>
      <input class="form-control settings-rule-maximum" type="number"
        min="0" step="0.01" value="${numberValue(data.maxDiscount)}">
    </label>
    <label class="management-check">
      <input class="settings-rule-active" type="checkbox"
        ${data.active === false ? '' : 'checked'}>
      <span>Active</span>
    </label>
    <button class="btn btn-secondary settings-row-remove" type="button"
      aria-label="Remove discount rule">Remove</button>
  `;
  return row;
}

function renderSettings(settings = {}) {
  const defaultCharge = pageElement?.querySelector('#settings-default-charge');
  const districtList = pageElement?.querySelector('#settings-district-list');
  const discountList = pageElement?.querySelector('#settings-discount-list');

  if (defaultCharge) {
    defaultCharge.value = String(numberValue(settings.delivery?.defaultCharge));
  }

  if (districtList) {
    districtList.replaceChildren();
    const districts = Array.isArray(settings.delivery?.districtCharges)
      ? settings.delivery.districtCharges
      : [];
    districts.forEach(item => districtList.appendChild(createDistrictRow(item)));
  }

  if (discountList) {
    discountList.replaceChildren();
    const rules = Array.isArray(settings.purchaseDiscounts)
      ? settings.purchaseDiscounts
      : [];
    rules.forEach(item => discountList.appendChild(createDiscountRow(item)));
  }
}

async function loadSettings() {
  showMessage('Loading settings...', 'loading');

  try {
    const result = await api.get('settings', {}, { signal: currentSignal });
    if (currentSignal?.aborted) return false;
    renderSettings(result.settings || result.data?.settings || result.data || {});
    showMessage('Settings loaded.', 'success');
    return true;
  } catch (error) {
    if (error.name === 'AbortError' || currentSignal?.aborted) return false;
    console.error('[SETTINGS LOAD]', error);
    showMessage(error.message || 'Unable to load settings.', 'error');
    return false;
  }
}

function collectSettings() {
  const districtRows = Array.from(
    pageElement.querySelectorAll('.settings-district-row')
  );
  const discountRows = Array.from(
    pageElement.querySelectorAll('.settings-discount-row')
  );

  const districtCharges = districtRows.map(row => ({
    district: row.querySelector('.settings-district-name')?.value.trim() || '',
    charge: numberValue(row.querySelector('.settings-district-charge')?.value)
  })).filter(item => item.district);

  for (const row of districtRows) {
    const district = row.querySelector('.settings-district-name')?.value.trim() || '';
    const charge = numberValue(row.querySelector('.settings-district-charge')?.value);
    if (!district && charge > 0) throw new Error('District name is required for each delivery charge.');
  }

  const purchaseDiscounts = discountRows.map((row, index) => {
    const discountPercent = numberValue(
      row.querySelector('.settings-rule-percent')?.value
    );
    if (discountPercent <= 0 || discountPercent > 100) {
      throw new Error(`Discount rule ${index + 1} must be between 0 and 100 percent.`);
    }

    return {
      id: row.dataset.ruleId || `discount-${Date.now()}-${index}`,
      minimumPurchase: numberValue(row.querySelector('.settings-rule-minimum')?.value),
      discountPercent,
      maxDiscount: numberValue(row.querySelector('.settings-rule-maximum')?.value),
      active: row.querySelector('.settings-rule-active')?.checked === true
    };
  });

  return {
    delivery: {
      defaultCharge: numberValue(
        pageElement.querySelector('#settings-default-charge')?.value
      ),
      districtCharges
    },
    purchaseDiscounts
  };
}

async function saveSettings(event) {
  event.preventDefault();
  if (isSaving) return;

  const button = pageElement?.querySelector('#settings-save');

  try {
    const payload = collectSettings();
    isSaving = true;
    setButtonLoading(button, true, 'Saving...');
    const result = await api.put('settings', payload, { signal: currentSignal });
    renderSettings(result.settings || result.data?.settings || payload);
    showMessage('Settings saved successfully.', 'success');
    showToast('Settings saved successfully.', 'success');
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('[SETTINGS SAVE]', error);
    showMessage(error.message || 'Unable to save settings.', 'error');
    showToast(error.message || 'Unable to save settings.', 'error', 5000);
  } finally {
    isSaving = false;
    setButtonLoading(button, false);
  }
}

async function changePassword(event) {
  event.preventDefault();
  if (isChangingPassword) return;

  const password = pageElement?.querySelector('#settings-password')?.value || '';
  const confirmPassword = pageElement?.querySelector('#settings-password-confirm')?.value || '';
  const button = pageElement?.querySelector('#settings-password-save');

  if (password.length < 8) {
    showToast('Password must contain at least 8 characters.', 'warning');
    return;
  }
  if (password !== confirmPassword) {
    showToast('Password confirmation does not match.', 'warning');
    return;
  }

  isChangingPassword = true;
  setButtonLoading(button, true, 'Changing...');

  try {
    await api.post('settings/password', { password, confirmPassword }, { signal: currentSignal });
    event.currentTarget.reset();
    showToast('Password changed successfully.', 'success');
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('[PASSWORD CHANGE]', error);
    showToast(error.message || 'Unable to change password.', 'error', 5000);
  } finally {
    isChangingPassword = false;
    setButtonLoading(button, false);
  }
}

export async function render({ signal } = {}) {
  const page = document.createElement('section');
  page.className = 'page settings-page management-page';
  page.id = 'settings-page';
  page.innerHTML = `
    <div class="page-header management-page-header">
      <div>
        <h2 class="page-title">Settings</h2>
        <p class="page-description">Manage delivery charges, purchase discounts and password.</p>
      </div>
    </div>
    <div id="settings-message" class="management-message" aria-live="polite"></div>
    <form id="settings-form" class="management-stack">
      <section class="management-card">
        <div class="management-card-header">
          <div><h3>Delivery Settings</h3><p>Set default and district-based delivery charges.</p></div>
          <button class="btn btn-secondary" id="settings-add-district" type="button">+ Add District</button>
        </div>
        <label class="management-field management-field-small">
          <span>Default Delivery Charge</span>
          <input class="form-control" id="settings-default-charge" type="number" min="0" step="0.01" value="0">
        </label>
        <div id="settings-district-list" class="settings-row-list"></div>
      </section>
      <section class="management-card">
        <div class="management-card-header">
          <div><h3>Purchase Discount Rules</h3><p>Automatic discounts based on minimum purchase.</p></div>
          <button class="btn btn-secondary" id="settings-add-discount" type="button">+ Add Rule</button>
        </div>
        <div id="settings-discount-list" class="settings-row-list"></div>
      </section>
      <div class="management-actions">
        <button class="btn btn-primary" id="settings-save" type="submit">Save Settings</button>
      </div>
    </form>
    <form id="settings-password-form" class="management-card settings-password-card">
      <div class="management-card-header"><div><h3>Change Password</h3><p>Use at least 8 characters.</p></div></div>
      <div class="management-form-grid">
        <label class="management-field"><span>New Password</span><input class="form-control" id="settings-password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label>
        <label class="management-field"><span>Confirm Password</span><input class="form-control" id="settings-password-confirm" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label>
      </div>
      <div class="management-actions"><button class="btn btn-primary" id="settings-password-save" type="submit">Change Password</button></div>
    </form>
  `;

  pageElement = page;
  currentSignal = signal || null;
  await loadSettings();
  return page;
}

export function bindEvents({ signal } = {}) {
  if (!pageElement) return;

  pageElement.querySelector('#settings-form')?.addEventListener('submit', saveSettings, { signal });
  pageElement.querySelector('#settings-password-form')?.addEventListener('submit', changePassword, { signal });
  pageElement.querySelector('#settings-add-district')?.addEventListener('click', () => {
    pageElement.querySelector('#settings-district-list')?.appendChild(createDistrictRow());
  }, { signal });
  pageElement.querySelector('#settings-add-discount')?.addEventListener('click', () => {
    pageElement.querySelector('#settings-discount-list')?.appendChild(createDiscountRow());
  }, { signal });
  pageElement.addEventListener('click', event => {
    const button = event.target.closest('.settings-row-remove');
    button?.closest('.settings-dynamic-row')?.remove();
  }, { signal });
}

export function cleanup() {
  pageElement = null;
  currentSignal = null;
  isSaving = false;
  isChangingPassword = false;
}

export default { render, bindEvents, cleanup };
