
'use strict';

// ========================================
// PRODUCT IMAGES
// Cloudinary Upload & Image Management
// ========================================

import {
  getProductElement,
  showProductMessage,
  productApiRequest
} from './product-utils.js';


// ========================================
// STATE
// ========================================

let productImages = [];
let cloudinaryImages = [];
let selectedCloudinaryIds = new Set();
let initialized = false;
let isCloudinaryLoading = false;

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp'
];


// ========================================
// SELECTORS
// ========================================

const SELECTORS = {
  input: '#product-image-input',
  container: '#product-image-container',
  uploadButton: '#product-image-upload',
  cloudinaryButton: '#product-image-cloudinary',
  cloudinaryModal: '#cloudinary-image-modal',
  cloudinaryClose: '#cloudinary-image-close',
  cloudinaryCancel: '#cloudinary-image-cancel',
  cloudinaryAdd: '#cloudinary-image-add',
  cloudinaryStatus: '#cloudinary-image-status',
  cloudinaryGrid: '#cloudinary-image-grid',
  mainImage: '#product-main-image',
  hoverImage: '#product-hover-image'
};


// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    input: getProductElement(SELECTORS.input),
    container: getProductElement(SELECTORS.container),
    uploadButton: getProductElement(SELECTORS.uploadButton),
    cloudinaryButton: getProductElement(SELECTORS.cloudinaryButton),
    cloudinaryModal: getProductElement(SELECTORS.cloudinaryModal),
    cloudinaryClose: getProductElement(SELECTORS.cloudinaryClose),
    cloudinaryCancel: getProductElement(SELECTORS.cloudinaryCancel),
    cloudinaryAdd: getProductElement(SELECTORS.cloudinaryAdd),
    cloudinaryStatus: getProductElement(SELECTORS.cloudinaryStatus),
    cloudinaryGrid: getProductElement(SELECTORS.cloudinaryGrid),
    mainImage: getProductElement(SELECTORS.mainImage),
    hoverImage: getProductElement(SELECTORS.hoverImage)
  };
}


// ========================================
// ESCAPE HTML
// ========================================

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}


// ========================================
// VALIDATE IMAGE FILE
// ========================================

function validateImageFile(file) {
  if (!file) return false;

  if (!ALLOWED_TYPES.includes(file.type)) {
    showProductMessage(
      'শুধুমাত্র JPG, PNG ও WebP ছবি Upload করা যাবে।',
      'warning'
    );

    return false;
  }

  if (file.size > MAX_FILE_SIZE) {
    showProductMessage(
      'প্রতিটি ছবির Size সর্বোচ্চ 5 MB হতে পারবে।',
      'warning'
    );

    return false;
  }

  return true;
}


// ========================================
// CLOUDINARY CONFIG
// ========================================

function getCloudinaryConfig() {
  const config = window.APP_CONFIG?.cloudinary;

  if (!config?.cloudName || !config?.uploadPreset) {
    return null;
  }

  return config;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => {
      resolve(String(reader.result));
    });

    reader.addEventListener('error', () => {
      reject(reader.error || new Error('Image file পড়া যায়নি।'));
    });

    reader.readAsDataURL(file);
  });
}


// ========================================
// UPLOAD TO CLOUDINARY
// ========================================

async function uploadToCloudinary(file) {
  const config = getCloudinaryConfig();

  if (!config) {
    return {
      url: await readFileAsDataURL(file),
      publicId: '',
      width: 0,
      height: 0,
      format: file.type.split('/')[1] || '',
      bytes: file.size,
      fileName: file.name,
      localOnly: true
    };
  }

  const formData = new FormData();

  formData.append('file', file);
  formData.append('upload_preset', config.uploadPreset);

  if (config.folder) {
    formData.append('folder', config.folder);
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
    {
      method: 'POST',
      body: formData
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error?.message || 'Cloudinary upload failed'
    );
  }

  if (!result.secure_url || !result.public_id) {
    throw new Error('Cloudinary image response invalid');
  }

  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width || 0,
    height: result.height || 0,
    format: result.format || '',
    bytes: result.bytes || 0
  };
}


// ========================================
// UPLOAD IMAGE
// ========================================

async function uploadProductImage(file) {
  if (!validateImageFile(file)) return null;

  if (productImages.length >= MAX_IMAGES) {
    showProductMessage(
      `সর্বোচ্চ ${MAX_IMAGES} টি ছবি রাখা যাবে।`,
      'warning'
    );

    return null;
  }

  try {
    const uploaded = await uploadToCloudinary(file);

    const image = {
      url: uploaded.url,
      publicId: uploaded.publicId,
      alt: '',
      color: '',
      order: productImages.length + 1,
      width: uploaded.width,
      height: uploaded.height,
      format: uploaded.format,
      fileName: uploaded.fileName || file.name,
      localOnly: uploaded.localOnly === true,
      isMain: productImages.length === 0,
      isHover: false
    };

    productImages.push(image);

    renderProductImages();

    showProductMessage(
      uploaded.localOnly
        ? 'ছবি preview-তে যোগ হয়েছে। Cloudinary config না থাকায় এখন local data হিসেবে রাখা হয়েছে।'
        : 'ছবি সফলভাবে Upload হয়েছে।',
      uploaded.localOnly ? 'info' : 'success',
      uploaded.localOnly ? 6000 : 3500
    );

    return image;

  } catch (error) {
    console.error('[PRODUCT IMAGES]', error);

    showProductMessage(
      error.message || 'ছবি Upload করা যায়নি।',
      'error'
    );

    return null;
  }
}


// ========================================
// CLOUDINARY LIBRARY
// ========================================

function getCloudinaryLibraryUrl() {
  const cloudName = String(
    window.APP_CONFIG?.cloudinary?.cloudName || ''
  ).trim();

  if (!cloudName) {
    return '/api/cloudinary/images';
  }

  return `/api/cloudinary/images?cloudName=${encodeURIComponent(cloudName)}`;
}

function setCloudinaryStatus(message = '', type = '') {
  const { cloudinaryStatus } = getElements();

  if (!cloudinaryStatus) return;

  cloudinaryStatus.textContent = message;
  cloudinaryStatus.hidden = !message;
  cloudinaryStatus.className = [
    'cloudinary-library-status',
    type ? `is-${type}` : ''
  ].filter(Boolean).join(' ');
}

function updateCloudinaryAddButton() {
  const { cloudinaryAdd } = getElements();
  if (!cloudinaryAdd) return;

  const count = selectedCloudinaryIds.size;

  cloudinaryAdd.disabled = count === 0;
  cloudinaryAdd.textContent = count > 0
    ? `Add Selected (${count})`
    : 'Add Selected';
}

function isCloudinaryImageAdded(image) {
  return productImages.some(item => (
    (image.publicId && item.publicId === image.publicId) ||
    item.url === image.url
  ));
}

function getCloudinaryFileName(image) {
  const name = String(image.publicId || 'cloudinary-image')
    .split('/')
    .pop();

  return image.format
    ? `${name}.${image.format}`
    : name;
}

function renderCloudinaryImages() {
  const { cloudinaryGrid } = getElements();
  if (!cloudinaryGrid) return;

  cloudinaryGrid.replaceChildren();

  if (!cloudinaryImages.length) {
    setCloudinaryStatus('No Cloudinary images found.', 'empty');
    return;
  }

  setCloudinaryStatus('');

  cloudinaryImages.forEach(image => {
    const added = isCloudinaryImageAdded(image);
    const selected = selectedCloudinaryIds.has(image.publicId);
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'cloudinary-library-item';
    button.dataset.cloudinaryId = image.publicId;
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = added;

    if (selected) button.classList.add('is-selected');
    if (added) button.classList.add('is-added');

    const preview = document.createElement('img');
    preview.src = image.url;
    preview.alt = image.publicId;
    preview.loading = 'lazy';

    const info = document.createElement('span');
    info.className = 'cloudinary-library-item-info';

    const name = document.createElement('strong');
    name.textContent = image.publicId;

    const details = document.createElement('small');
    details.textContent = image.width && image.height
      ? `${image.width} × ${image.height}`
      : (image.format || 'Image');

    info.append(name, details);
    button.append(preview, info);

    if (added) {
      const badge = document.createElement('span');
      badge.className = 'cloudinary-library-badge';
      badge.textContent = 'Added';
      button.appendChild(badge);
    }

    cloudinaryGrid.appendChild(button);
  });
}

async function loadCloudinaryImages() {
  if (isCloudinaryLoading) return;

  const { cloudinaryButton } = getElements();

  isCloudinaryLoading = true;
  setCloudinaryStatus('Loading Cloudinary images...');

  if (cloudinaryButton) {
    cloudinaryButton.disabled = true;
    cloudinaryButton.textContent = 'Loading Cloudinary...';
  }

  try {
    const result = await productApiRequest(
      getCloudinaryLibraryUrl(),
      { method: 'GET' }
    );

    cloudinaryImages = Array.isArray(result.images)
      ? result.images.filter(image => image?.publicId && image?.url)
      : [];

    renderCloudinaryImages();

  } catch (error) {
    console.error('[CLOUDINARY LIBRARY]', error);
    cloudinaryImages = [];
    setCloudinaryStatus(
      error.message || 'Cloudinary images could not be loaded.',
      'error'
    );

  } finally {
    isCloudinaryLoading = false;

    if (cloudinaryButton) {
      cloudinaryButton.disabled = false;
      cloudinaryButton.textContent = 'Choose from Cloudinary';
    }
  }
}

async function openCloudinaryLibrary() {
  const { cloudinaryModal } = getElements();

  if (!cloudinaryModal) return;

  selectedCloudinaryIds = new Set();
  updateCloudinaryAddButton();

  cloudinaryModal.hidden = false;
  cloudinaryModal.classList.add('is-open');
  cloudinaryModal.setAttribute('aria-hidden', 'false');

  await loadCloudinaryImages();
}

function closeCloudinaryLibrary() {
  const { cloudinaryModal } = getElements();
  if (!cloudinaryModal) return;

  cloudinaryModal.classList.remove('is-open');
  cloudinaryModal.hidden = true;
  cloudinaryModal.setAttribute('aria-hidden', 'true');
}

function toggleCloudinaryImage(button) {
  const publicId = button.dataset.cloudinaryId;
  if (!publicId || button.disabled) return;

  if (selectedCloudinaryIds.has(publicId)) {
    selectedCloudinaryIds.delete(publicId);
  } else {
    selectedCloudinaryIds.add(publicId);
  }

  const selected = selectedCloudinaryIds.has(publicId);
  button.classList.toggle('is-selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  updateCloudinaryAddButton();
}

function addSelectedCloudinaryImages() {
  const availableSlots = Math.max(0, MAX_IMAGES - productImages.length);
  const selected = cloudinaryImages.filter(image => (
    selectedCloudinaryIds.has(image.publicId) &&
    !isCloudinaryImageAdded(image)
  ));

  if (!availableSlots) {
    showProductMessage(
      `সর্বোচ্চ ${MAX_IMAGES} টি ছবি রাখা যাবে।`,
      'warning'
    );
    return;
  }

  const imagesToAdd = selected.slice(0, availableSlots);

  imagesToAdd.forEach(image => {
    const isFirstImage = productImages.length === 0;

    productImages.push({
      url: image.url,
      publicId: image.publicId,
      alt: '',
      color: '',
      order: productImages.length + 1,
      width: Number(image.width || 0),
      height: Number(image.height || 0),
      format: image.format || '',
      fileName: getCloudinaryFileName(image),
      localOnly: false,
      isMain: isFirstImage,
      isHover: false
    });
  });

  renderProductImages();
  closeCloudinaryLibrary();

  if (selected.length > imagesToAdd.length) {
    showProductMessage(
      `${imagesToAdd.length} টি ছবি যোগ হয়েছে। সর্বোচ্চ ${MAX_IMAGES} টি রাখা যাবে।`,
      'warning'
    );
  } else if (imagesToAdd.length) {
    showProductMessage(
      `${imagesToAdd.length} টি Cloudinary ছবি যোগ হয়েছে।`,
      'success'
    );
  }
}


// ========================================
// RENDER IMAGE LIST
// ========================================

function renderProductImages() {
  const { container } = getElements();

  if (!container) return;

  container.replaceChildren();

  productImages.forEach((image, index) => {
    const card = document.createElement('div');

    card.className = 'product-image-item';
    card.dataset.index = String(index);

    const img = document.createElement('img');

    img.src = image.url;
    img.alt = image.alt || `Product image ${index + 1}`;
    img.loading = 'lazy';

    const info = document.createElement('div');
    info.className = 'product-image-info';

    const mainButton = document.createElement('button');

    mainButton.type = 'button';
    mainButton.dataset.action = 'main';
    mainButton.textContent = image.isMain
      ? 'Main Image'
      : 'Set Main';

    const hoverButton = document.createElement('button');

    hoverButton.type = 'button';
    hoverButton.dataset.action = 'hover';
    hoverButton.textContent = image.isHover
      ? 'Hover Image'
      : 'Set Hover';

    const deleteButton = document.createElement('button');

    deleteButton.type = 'button';
    deleteButton.dataset.action = 'delete';
    deleteButton.textContent = 'Delete';

    const altInput = document.createElement('input');

    altInput.type = 'text';
    altInput.dataset.action = 'alt';
    altInput.placeholder = 'Image alt text';
    altInput.value = image.alt || '';

    const colorInput = document.createElement('input');

    colorInput.type = 'text';
    colorInput.dataset.action = 'color';
    colorInput.placeholder = 'Color (optional)';
    colorInput.value = image.color || '';

    info.append(
      mainButton,
      hoverButton,
      deleteButton,
      altInput,
      colorInput
    );

    card.append(img, info);

    container.appendChild(card);
  });
}


// ========================================
// SET MAIN IMAGE
// ========================================

function setMainImage(index) {
  if (!productImages[index]) return;

  productImages = productImages.map((image, i) => ({
    ...image,
    isMain: i === index
  }));

  renderProductImages();
}


// ========================================
// SET HOVER IMAGE
// ========================================

function setHoverImage(index) {
  if (!productImages[index]) return;

  productImages = productImages.map((image, i) => ({
    ...image,
    isHover: i === index
  }));

  renderProductImages();
}


// ========================================
// DELETE IMAGE
// ========================================

function deleteProductImage(index) {
  if (!productImages[index]) return;

  productImages.splice(index, 1);

  productImages = productImages.map((image, i) => ({
    ...image,
    order: i + 1
  }));

  if (productImages.length) {
    if (!productImages.some(image => image.isMain)) {
      productImages[0].isMain = true;
    }

    if (!productImages.some(image => image.isHover)) {
      productImages.forEach(image => {
        image.isHover = false;
      });
    }
  }

  renderProductImages();
}


// ========================================
// IMAGE EVENTS
// ========================================

function bindImageEvents() {
  const {
    input,
    uploadButton,
    cloudinaryButton,
    cloudinaryModal,
    cloudinaryClose,
    cloudinaryCancel,
    cloudinaryAdd,
    cloudinaryGrid,
    container
  } = getElements();

  if (!input || !uploadButton || !container) return;
  if (container.dataset.imageEventsBound === 'true') return;

  uploadButton?.addEventListener('click', () => {
    input?.click();
  });

  cloudinaryButton?.addEventListener(
    'click',
    openCloudinaryLibrary
  );

  cloudinaryClose?.addEventListener(
    'click',
    closeCloudinaryLibrary
  );

  cloudinaryCancel?.addEventListener(
    'click',
    closeCloudinaryLibrary
  );

  cloudinaryAdd?.addEventListener(
    'click',
    addSelectedCloudinaryImages
  );

  cloudinaryGrid?.addEventListener('click', event => {
    const button = event.target.closest('[data-cloudinary-id]');
    if (button) toggleCloudinaryImage(button);
  });

  cloudinaryModal?.addEventListener('click', event => {
    if (event.target === cloudinaryModal) {
      closeCloudinaryLibrary();
    }
  });

  input?.addEventListener('change', async () => {
    const files = Array.from(input.files || []);

    for (const file of files) {
      if (productImages.length >= MAX_IMAGES) break;

      await uploadProductImage(file);
    }

    input.value = '';
  });

  container?.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');

    if (!button) return;

    const card = button.closest('.product-image-item');

    if (!card) return;

    const index = Number(card.dataset.index);

    switch (button.dataset.action) {
      case 'main':
        setMainImage(index);
        break;

      case 'hover':
        setHoverImage(index);
        break;

      case 'delete':
        deleteProductImage(index);
        break;
    }
  });

  container?.addEventListener('input', event => {
    const inputElement = event.target;

    const card = inputElement.closest('.product-image-item');

    if (!card) return;

    const index = Number(card.dataset.index);

    if (!productImages[index]) return;

    if (inputElement.dataset.action === 'alt') {
      productImages[index].alt = inputElement.value;
    }

    if (inputElement.dataset.action === 'color') {
      productImages[index].color = inputElement.value;
    }
  });

  container.dataset.imageEventsBound = 'true';
}


// ========================================
// GET IMAGE DATA
// ========================================

export function getProductImagesData() {
  return productImages.map((image, index) => ({
    url: image.url,
    publicId: image.publicId,
    alt: image.alt || '',
    color: image.color || '',
    order: index + 1,
    width: image.width || 0,
    height: image.height || 0,
    isMain: image.isMain === true,
    isHover: image.isHover === true,
    fileName: image.fileName || '',
    localOnly: image.localOnly === true
  }));
}


// ========================================
// SET IMAGE DATA (EDIT PRODUCT)
// ========================================

export function setProductImagesData(images = []) {
  if (!Array.isArray(images)) return;

  productImages = images.slice(0, MAX_IMAGES).map(
    (image, index) => ({
      url: image.url || '',
      publicId: image.publicId || '',
      alt: image.alt || '',
      color: image.color || '',
      order: index + 1,
      width: image.width || 0,
      height: image.height || 0,
      isMain: image.isMain === true || index === 0,
      isHover: image.isHover === true,
      fileName: image.fileName || '',
      localOnly: image.localOnly === true
    })
  );

  renderProductImages();
}


// ========================================
// VALIDATE IMAGES
// ========================================

export function validateProductImages() {
  if (productImages.length < 3) {
    showProductMessage(
      'Active Product-এর জন্য কমপক্ষে 3 টি ছবি প্রয়োজন।',
      'warning'
    );

    return false;
  }

  if (!productImages.some(image => image.isMain)) {
    showProductMessage(
      'একটি Main Image নির্বাচন করুন।',
      'warning'
    );

    return false;
  }

  return true;
}


// ========================================
// RESET IMAGES
// ========================================

export function resetProductImages() {
  productImages = [];
  cloudinaryImages = [];
  selectedCloudinaryIds = new Set();

  const { input } = getElements();

  if (input) input.value = '';

  closeCloudinaryLibrary();
  updateCloudinaryAddButton();
  renderProductImages();
}


// ========================================
// INITIALIZE
// ========================================

export function initProductImages({ force = false } = {}) {
  if (initialized && !force) return;

  const {
    container,
    input,
    uploadButton,
    cloudinaryButton
  } = getElements();

  if (!container || !input || !uploadButton || !cloudinaryButton) {
    console.warn(
      '[PRODUCT IMAGES] Required HTML elements not found.'
    );

    return;
  }

  input.type = 'file';
  input.accept = ALLOWED_TYPES.join(',');
  input.multiple = true;

  bindImageEvents();

  initialized = true;

  renderProductImages();
}


// ========================================
// DEFAULT EXPORT
// ========================================

export default initProductImages;
