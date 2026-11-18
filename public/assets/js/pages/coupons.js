'use strict';

import { api } from '../api.js';
import { showToast, setButtonLoading } from '../helpers.js';

let pageElement = null;
let currentSignal = null;
let coupons = [];
let editingCouponId = '';
let isSaving = false;
const updatingCouponIds = new Set();

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function toDate(value) {
  if (!value) return null;
  const seconds = value?.seconds ?? value?._seconds;
  const date = seconds !== undefined
    ? new Date(Number(seconds) * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateTimeInput(value) {
  const date = toDate(value);
  if (!date) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return 'No expiry';
  return new Intl.DateTimeFormat('en-BD', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatMoney(value) {
  return `৳${toNumber(value).toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function showMessage(message, type = '') {
  const element = pageElement?.querySelector('#coupons-message');
  if (!element) return;
  element.textContent = String(message || '');
  element.className = `management-message ${type}`.trim();
}

function normalizeCoupon(coupon = {}) {
  return {
    ...coupon,
    id: String(coupon.id || coupon.couponId || ''),
    code: String(coupon.code || ''),
    type: String(coupon.type || 'website').toLowerCase(),
    title: String(coupon.title || ''),
    phone: String(coupon.phone || ''),
    discountPercent: toNumber(coupon.discountPercent),
    minimumPurchase: toNumber(coupon.minimumPurchase),
    maxDiscount: toNumber(coupon.maxDiscount),
    quantity: Math.max(0, Number(coupon.quantity || 0)),
    collectedCount: Math.max(0, Number(coupon.collectedCount || 0)),
    active: coupon.active !== false,
    note: String(coupon.note || '')
  };
}

function getCouponStatus(coupon) {
  const now = Date.now();
  const start = toDate(coupon.startAt)?.getTime() || 0;
  const expiry = toDate(coupon.expiresAt)?.getTime() || 0;

  if (!coupon.active) return { key: 'inactive', label: 'Inactive' };
  if (start > now) return { key: 'scheduled', label: 'Scheduled' };
  if (expiry && expiry <= now) return { key: 'expired', label: 'Expired' };
  if (coupon.quantity > 0 && coupon.collectedCount >= coupon.quantity) {
    return { key: 'exhausted', label: 'Exhausted' };
  }
  return { key: 'active', label: 'Active' };
}

function getFilteredCoupons() {
  const search = pageElement?.querySelector('#coupons-search')?.value
    .trim().toLowerCase() || '';
  const filter = pageElement?.querySelector('#coupons-status-filter')?.value || 'all';

  return coupons.filter(coupon => {
    const status = getCouponStatus(coupon).key;
    const matchesStatus = filter === 'all' || status === filter || coupon.type === filter;
    const matchesSearch = !search || [
      coupon.code,
      coupon.title,
      coupon.phone,
      coupon.type
    ].some(value => String(value || '').toLowerCase().includes(search));
    return matchesStatus && matchesSearch;
  });
}

function renderSummary() {
  const container = pageElement?.querySelector('#coupons-summary');
  if (!container) return;

  const active = coupons.filter(item => getCouponStatus(item).key === 'active').length;
  const website = coupons.filter(item => item.type === 'website').length;
  const offline = coupons.filter(item => item.type === 'offline').length;
  const collected = coupons.reduce((total, item) => total + item.collectedCount, 0);
  const cards = [
    ['Total Coupons', coupons.length],
    ['Active', active],
    ['Website / Offline', `${website} / ${offline}`],
    ['Collected', collected]
  ];

  container.innerHTML = cards.map(([label, value]) => `
    <div class="management-summary-card">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `).join('');
}

function renderCoupons() {
  const body = pageElement?.querySelector('#coupons-table-body');
  if (!body) return;
  const filtered = getFilteredCoupons();

  if (!filtered.length) {
    body.innerHTML = '<tr><td class="empty-state" colspan="9">No Coupons found.</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(coupon => {
    const status = getCouponStatus(coupon);
    const usage = coupon.quantity > 0
      ? `${coupon.collectedCount} / ${coupon.quantity}`
      : `${coupon.collectedCount} / Unlimited`;
    const remaining = coupon.quantity > 0
      ? `${Math.max(0, coupon.quantity - coupon.collectedCount)} remaining`
      : 'No collection limit';

    return `
      <tr>
        <td><strong>${escapeHTML(coupon.code)}</strong><small>${escapeHTML(coupon.title || 'Untitled Coupon')}</small></td>
        <td><span class="coupon-type ${escapeHTML(coupon.type)}">${escapeHTML(coupon.type)}</span></td>
        <td><strong>${escapeHTML(`${coupon.discountPercent}%`)}</strong><small>Max ${escapeHTML(formatMoney(coupon.maxDiscount))}</small></td>
        <td>${escapeHTML(formatMoney(coupon.minimumPurchase))}</td>
        <td><strong>${escapeHTML(usage)}</strong><small>${escapeHTML(remaining)}</small></td>
        <td>${escapeHTML(coupon.phone || '—')}</td>
        <td>${escapeHTML(formatDate(coupon.expiresAt))}</td>
        <td><span class="coupon-status ${escapeHTML(status.key)}">${escapeHTML(status.label)}</span></td>
        <td>
          <div class="management-table-actions">
            <button class="btn btn-sm btn-secondary" type="button" data-coupon-action="edit" data-coupon-id="${escapeHTML(coupon.id)}">Edit</button>
            <button class="btn btn-sm ${coupon.active ? 'coupon-disable-button' : 'btn-primary'}" type="button" data-coupon-action="toggle" data-coupon-id="${escapeHTML(coupon.id)}">${coupon.active ? 'Disable' : 'Enable'}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadCoupons({ announce = false } = {}) {
  showMessage('Loading Coupons...', 'loading');

  try {
    const result = await api.get('coupons', {}, { signal: currentSignal });
    if (currentSignal?.aborted) return false;
    const source = Array.isArray(result.coupons)
      ? result.coupons
      : Array.isArray(result.data?.coupons)
        ? result.data.coupons
        : [];
    coupons = source.map(normalizeCoupon).filter(item => item.id);
    renderSummary();
    renderCoupons();
    showMessage(
      announce ? 'Coupons refreshed.' : `${coupons.length} Coupon(s) loaded.`,
      'success'
    );
    return true;
  } catch (error) {
    if (error.name === 'AbortError' || currentSignal?.aborted) return false;
    console.error('[COUPONS LOAD]', error);
    coupons = [];
    renderSummary();
    renderCoupons();
    showMessage(error.message || 'Unable to load Coupons.', 'error');
    return false;
  }
}

function updatePhoneVisibility() {
  const type = pageElement?.querySelector('#coupon-type')?.value || 'website';
  const group = pageElement?.querySelector('#coupon-phone-group');
  const input = pageElement?.querySelector('#coupon-phone');
  if (group) group.hidden = type !== 'offline';
  if (input) input.required = type === 'offline';
}

function openCouponModal(coupon = null) {
  const modal = pageElement?.querySelector('#coupon-modal');
  const form = pageElement?.querySelector('#coupon-form');
  if (!modal || !form) return;

  editingCouponId = coupon?.id || '';
  form.reset();
  pageElement.querySelector('#coupon-modal-title').textContent = coupon
    ? 'Edit Coupon'
    : 'Create Coupon';

  const values = {
    type: coupon?.type || 'website',
    code: coupon?.code || '',
    title: coupon?.title || '',
    phone: coupon?.phone || '',
    discountPercent: coupon?.discountPercent || '',
    minimumPurchase: coupon?.minimumPurchase || 0,
    maxDiscount: coupon?.maxDiscount || 0,
    quantity: coupon?.quantity || 0,
    collectedCount: coupon?.collectedCount || 0,
    startAt: toDateTimeInput(coupon?.startAt) || toDateTimeInput(new Date()),
    expiresAt: toDateTimeInput(coupon?.expiresAt),
    note: coupon?.note || ''
  };

  Object.entries(values).forEach(([name, value]) => {
    const input = form.elements.namedItem(name);
    if (input) input.value = String(value);
  });

  const codeInput = form.elements.namedItem('code');
  if (codeInput) codeInput.readOnly = Boolean(coupon);
  const activeInput = form.elements.namedItem('active');
  if (activeInput) activeInput.checked = coupon?.active !== false;

  updatePhoneVisibility();
  modal.hidden = false;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => form.elements.namedItem(coupon ? 'title' : 'code')?.focus(), 0);
}

function closeCouponModal() {
  const modal = pageElement?.querySelector('#coupon-modal');
  if (!modal || isSaving) return;
  modal.classList.remove('is-open');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  editingCouponId = '';
}

function getCouponPayload(form) {
  const data = new FormData(form);
  const type = String(data.get('type') || 'website');
  const code = String(data.get('code') || '').trim().toUpperCase();
  const phone = String(data.get('phone') || '').trim();
  const discountPercent = Number(data.get('discountPercent'));

  if (code && code.length < 4) throw new Error('Coupon Code must contain at least 4 characters.');
  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
    throw new Error('Discount must be between 0 and 100 percent.');
  }
  if (type === 'offline' && !phone) throw new Error('Mobile number is required for an offline Coupon.');

  const startAt = String(data.get('startAt') || '');
  const expiresAt = String(data.get('expiresAt') || '');
  const quantity = Math.max(0, Math.trunc(Number(data.get('quantity') || 0)));
  const collectedCount = Math.max(
    0,
    Math.trunc(Number(data.get('collectedCount') || 0))
  );

  if (quantity > 0 && collectedCount > quantity) {
    throw new Error('Collected Count cannot be greater than Coupon Quantity.');
  }

  return {
    type,
    ...(code ? { code } : {}),
    title: String(data.get('title') || '').trim(),
    phone: type === 'offline' ? phone : '',
    discountPercent,
    minimumPurchase: toNumber(data.get('minimumPurchase')),
    maxDiscount: toNumber(data.get('maxDiscount')),
    quantity,
    collectedCount,
    ...(startAt ? { startAt: new Date(startAt).toISOString() } : {}),
    ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    active: data.get('active') === 'on',
    note: String(data.get('note') || '').trim()
  };
}

async function saveCoupon(event) {
  event.preventDefault();
  if (isSaving) return;

  const form = event.currentTarget;
  const button = pageElement?.querySelector('#coupon-save');

  try {
    const payload = getCouponPayload(form);
    isSaving = true;
    setButtonLoading(button, true, 'Saving...');

    if (editingCouponId) {
      await api.patch(`coupons/${encodeURIComponent(editingCouponId)}`, payload, { signal: currentSignal });
      showToast('Coupon updated successfully.', 'success');
    } else {
      await api.post('coupons', payload, { signal: currentSignal });
      showToast('Coupon created successfully.', 'success');
    }

    isSaving = false;
    setButtonLoading(button, false);
    closeCouponModal();
    await loadCoupons();
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('[COUPON SAVE]', error);
    showToast(error.message || 'Unable to save Coupon.', 'error', 5000);
  } finally {
    isSaving = false;
    setButtonLoading(button, false);
  }
}

async function toggleCoupon(couponId) {
  if (!couponId || updatingCouponIds.has(couponId)) return;
  const coupon = coupons.find(item => item.id === couponId);
  if (!coupon) return;

  updatingCouponIds.add(couponId);
  renderCoupons();

  try {
    const result = await api.patch(
      `coupons/${encodeURIComponent(couponId)}`,
      { active: !coupon.active },
      { signal: currentSignal }
    );
    const updated = normalizeCoupon(result.coupon || result.data?.coupon || {
      ...coupon,
      active: !coupon.active
    });
    coupons = coupons.map(item => item.id === couponId ? updated : item);
    renderSummary();
    showToast(updated.active ? 'Coupon enabled.' : 'Coupon disabled.', 'success');
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('[COUPON TOGGLE]', error);
    showToast(error.message || 'Unable to update Coupon.', 'error', 5000);
  } finally {
    updatingCouponIds.delete(couponId);
    renderCoupons();
  }
}

export async function render({ signal } = {}) {
  const page = document.createElement('section');
  page.className = 'page coupons-page management-page';
  page.id = 'coupons-page';
  page.innerHTML = `
    <div class="page-header management-page-header">
      <div><h2 class="page-title">Coupons</h2><p class="page-description">Create and manage website or offline Coupons.</p></div>
      <div class="management-header-actions">
        <button class="btn btn-secondary" id="coupons-refresh" type="button">Refresh</button>
        <button class="btn btn-primary" id="coupon-create" type="button">+ New Coupon</button>
      </div>
    </div>
    <div class="management-toolbar">
      <input class="form-control" id="coupons-search" type="search" placeholder="Search Code, title or phone..." autocomplete="off">
      <select class="form-control" id="coupons-status-filter">
        <option value="all">All Coupons</option><option value="active">Active</option>
        <option value="scheduled">Scheduled</option><option value="expired">Expired</option>
        <option value="inactive">Inactive</option><option value="exhausted">Exhausted</option>
        <option value="website">Website</option><option value="offline">Offline</option>
      </select>
    </div>
    <div id="coupons-summary" class="management-summary"></div>
    <div id="coupons-message" class="management-message" aria-live="polite"></div>
    <div class="management-table-wrap">
      <table class="management-table coupons-table">
        <thead><tr><th>Coupon</th><th>Type</th><th>Discount</th><th>Minimum</th><th>Collected</th><th>Phone</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody id="coupons-table-body"></tbody>
      </table>
    </div>
    <div class="management-modal-overlay" id="coupon-modal" hidden aria-hidden="true">
      <div class="management-modal" role="dialog" aria-modal="true" aria-labelledby="coupon-modal-title">
        <div class="management-modal-header">
          <div><h3 id="coupon-modal-title">Create Coupon</h3><p>Set discount, validity and usage limit.</p></div>
          <button class="management-modal-close" type="button" data-coupon-action="close" aria-label="Close">×</button>
        </div>
        <form id="coupon-form" class="management-modal-body">
          <div class="management-form-grid">
            <label class="management-field"><span>Coupon Type</span><select class="form-control" id="coupon-type" name="type"><option value="website">Website</option><option value="offline">Offline</option></select></label>
            <label class="management-field"><span>Coupon Code</span><input class="form-control" name="code" maxlength="40" placeholder="Leave blank to auto-generate"></label>
            <label class="management-field management-field-wide"><span>Title</span><input class="form-control" name="title" maxlength="120" placeholder="Example: Eid Discount"></label>
            <label class="management-field" id="coupon-phone-group" hidden><span>Customer Mobile</span><input class="form-control" id="coupon-phone" name="phone" maxlength="30" placeholder="01XXXXXXXXX"></label>
            <label class="management-field"><span>Discount %</span><input class="form-control" name="discountPercent" type="number" min="0.01" max="100" step="0.01" required></label>
            <label class="management-field"><span>Minimum Purchase</span><input class="form-control" name="minimumPurchase" type="number" min="0" step="0.01" value="0"></label>
            <label class="management-field"><span>Maximum Discount</span><input class="form-control" name="maxDiscount" type="number" min="0" step="0.01" value="0"></label>
            <label class="management-field"><span>Quantity (0 = Unlimited)</span><input class="form-control" name="quantity" type="number" min="0" step="1" value="0"></label>
            <label class="management-field"><span>Collected Count</span><input class="form-control" name="collectedCount" type="number" min="0" step="1" value="0"><small class="management-field-hint">Each unique user collection increases this by 1.</small></label>
            <label class="management-field"><span>Start Date</span><input class="form-control" name="startAt" type="datetime-local"></label>
            <label class="management-field"><span>Expiry Date</span><input class="form-control" name="expiresAt" type="datetime-local"></label>
            <label class="management-field management-field-wide"><span>Note</span><textarea class="form-control" name="note" rows="3" maxlength="500"></textarea></label>
            <label class="management-check management-field-wide"><input name="active" type="checkbox" checked><span>Coupon Active</span></label>
          </div>
          <div class="management-actions">
            <button class="btn btn-secondary" type="button" data-coupon-action="close">Cancel</button>
            <button class="btn btn-primary" id="coupon-save" type="submit">Save Coupon</button>
          </div>
        </form>
      </div>
    </div>
  `;

  pageElement = page;
  currentSignal = signal || null;
  coupons = [];
  editingCouponId = '';
  await loadCoupons();
  return page;
}

export function bindEvents({ signal } = {}) {
  if (!pageElement) return;

  pageElement.querySelector('#coupon-create')?.addEventListener('click', () => openCouponModal(), { signal });
  pageElement.querySelector('#coupons-refresh')?.addEventListener('click', () => loadCoupons({ announce: true }), { signal });
  pageElement.querySelector('#coupons-search')?.addEventListener('input', renderCoupons, { signal });
  pageElement.querySelector('#coupons-status-filter')?.addEventListener('change', renderCoupons, { signal });
  pageElement.querySelector('#coupon-type')?.addEventListener('change', updatePhoneVisibility, { signal });
  pageElement.querySelector('#coupon-form')?.addEventListener('submit', saveCoupon, { signal });

  pageElement.addEventListener('click', event => {
    const action = event.target.closest('[data-coupon-action]')?.dataset.couponAction;
    const couponId = event.target.closest('[data-coupon-id]')?.dataset.couponId;

    if (action === 'close') closeCouponModal();
    if (action === 'edit') {
      const coupon = coupons.find(item => item.id === couponId);
      if (coupon) openCouponModal(coupon);
    }
    if (action === 'toggle') void toggleCoupon(couponId);
    if (event.target.id === 'coupon-modal') closeCouponModal();
  }, { signal });

  pageElement.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeCouponModal();
  }, { signal });
}

export function cleanup() {
  pageElement = null;
  currentSignal = null;
  coupons = [];
  editingCouponId = '';
  isSaving = false;
  updatingCouponIds.clear();
}

export default { render, bindEvents, cleanup };
