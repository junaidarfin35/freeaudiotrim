(() => {
  'use strict';

  const DROPZONE_SELECTOR = '[data-upload-dropzone], .upload-dropzone, .upload-box';
  const PROCESSED_FLAG = 'uploadComponentBound';

  const formatFileSizeMB = (bytes) => {
    const mb = Number(bytes || 0) / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const matchesAcceptToken = (file, token) => {
    const trimmedToken = token.trim().toLowerCase();
    if (!trimmedToken) {
      return false;
    }

    if (trimmedToken.startsWith('.')) {
      return (file.name || '').toLowerCase().endsWith(trimmedToken);
    }

    if (trimmedToken.endsWith('/*')) {
      const majorType = trimmedToken.slice(0, -1);
      return (file.type || '').toLowerCase().startsWith(majorType);
    }

    return (file.type || '').toLowerCase() === trimmedToken;
  };

  const fileMatchesInputAccept = (input, file) => {
    if (!file) {
      return false;
    }

    const accept = (input.getAttribute('accept') || '').trim();
    if (!accept) {
      return true;
    }

    const acceptTokens = accept.split(',').map((token) => token.trim()).filter(Boolean);
    if (acceptTokens.length === 0) {
      return true;
    }

    return acceptTokens.some((token) => matchesAcceptToken(file, token));
  };

  const findTargetInput = (dropzone) => {
    const inputId = dropzone.getAttribute('data-upload-input');
    if (inputId) {
      const byId = document.getElementById(inputId);
      if (byId && byId.matches('input[type="file"]')) {
        return byId;
      }
    }

    const parent = dropzone.parentElement;
    const scopedInput = parent?.querySelector('input[type="file"]');
    if (scopedInput) {
      return scopedInput;
    }

    return document.querySelector('input[type="file"]');
  };

  const ensureAudioAccept = (input) => {
    const currentAccept = (input.getAttribute('accept') || '').trim();
    if (!currentAccept) {
      input.setAttribute('accept', 'audio/*');
    }
  };

  const dispatchToInput = (input, file) => {
    if (!fileMatchesInputAccept(input, file)) {
      return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;

    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const updateDropzoneLabel = (dropzone, fileName) => {
    const primary = dropzone.querySelector('.upload-dropzone__primary, .upload-content h2, h2');
    if (!primary) {
      return;
    }

    if (fileName) {
      primary.textContent = fileName;
      dropzone.classList.add('has-file');
      return;
    }

    dropzone.classList.remove('has-file');
  };

  const ensureSecondaryInfoElement = (dropzone) => {
    let secondary = dropzone.querySelector('.upload-file-meta');
    if (secondary) {
      return secondary;
    }

    const content = dropzone.querySelector('.upload-content, .upload-dropzone__content') || dropzone;
    secondary = document.createElement('small');
    secondary.className = 'upload-file-meta';
    content.appendChild(secondary);
    return secondary;
  };

  const ensureChangeFileButton = (dropzone, input) => {
    let button = dropzone.querySelector('.upload-change-file');
    if (button) {
      return button;
    }

    const content = dropzone.querySelector('.upload-content, .upload-dropzone__content') || dropzone;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'upload-change-file';
    button.textContent = 'Change file';
    button.style.display = 'none';
    button.style.marginTop = '0.5rem';
    button.style.padding = '0.35rem 0.7rem';
    button.style.border = '1px solid currentColor';
    button.style.borderRadius = '999px';
    button.style.background = 'transparent';
    button.style.cursor = 'pointer';

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      input.click();
    });

    content.appendChild(button);
    return button;
  };

  const updateDropzoneState = (dropzone, file) => {
    const secondary = ensureSecondaryInfoElement(dropzone);
    const changeButton = dropzone.querySelector('.upload-change-file');

    if (file) {
      updateDropzoneLabel(dropzone, file.name);
      secondary.textContent = `Size: ${formatFileSizeMB(file.size)}`;
      dropzone.classList.add('has-file', 'is-confirmed');
      if (changeButton) {
        changeButton.style.display = 'inline-block';
      }
      return;
    }

    const defaultMeta = dropzone.dataset.uploadDefaultMeta || 'Max file size: 200MB';
    secondary.textContent = defaultMeta;
    dropzone.classList.remove('has-file', 'is-confirmed');
    if (changeButton) {
      changeButton.style.display = 'none';
    }
  };

  const bindDropzone = (dropzone) => {
    if (!(dropzone instanceof HTMLElement) || dropzone.dataset[PROCESSED_FLAG] === 'true') {
      return;
    }

    const input = findTargetInput(dropzone);
    if (!input) {
      return;
    }

    ensureAudioAccept(input);
    ensureChangeFileButton(dropzone, input);

    const initialMetaElement = dropzone.querySelector('.upload-content small, .upload-dropzone__secondary');
    dropzone.dataset.uploadDefaultMeta = (initialMetaElement?.textContent || 'Max file size: 200MB').trim();
    updateDropzoneState(dropzone, Array.from(input.files || [])[0] || null);

    dropzone.dataset[PROCESSED_FLAG] = 'true';
    dropzone.setAttribute('role', dropzone.getAttribute('role') || 'button');
    dropzone.setAttribute('tabindex', dropzone.getAttribute('tabindex') || '0');

    dropzone.addEventListener('click', () => {
      input.click();
    });

    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });

    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('is-dragover');
    });

    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');

      const [file] = Array.from(event.dataTransfer?.files || []);
      if (!file) {
        return;
      }

      dispatchToInput(input, file);
    });

    input.addEventListener('change', () => {
      const [file] = Array.from(input.files || []);
      updateDropzoneState(dropzone, file || null);
    });
  };

  const bindAllDropzones = () => {
    const dropzones = document.querySelectorAll(DROPZONE_SELECTOR);
    dropzones.forEach(bindDropzone);
  };

  const observeNewDropzones = () => {
    const observer = new MutationObserver(() => {
      bindAllDropzones();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindAllDropzones();
      observeNewDropzones();
    }, { once: true });
  } else {
    bindAllDropzones();
    observeNewDropzones();
  }
})();

