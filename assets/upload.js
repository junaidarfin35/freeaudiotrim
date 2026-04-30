(() => {
  'use strict';

  const DROPZONE_SELECTOR = '[data-upload-dropzone], .upload-dropzone, .upload-box';
  const PROCESSED_FLAG = 'uploadComponentBound';
  const DEFAULT_PRIMARY_TEXT = 'Drop audio file here or click to upload';
  const DEFAULT_FORMAT_TEXT = 'MP3, WAV, M4A, AAC, FLAC, OGG, MP4, MOV, WEBM';
  const DEFAULT_META_TEXT = 'Max file size: 200MB';
  const DEFAULT_PRIVACY_TEXT = 'Files processed locally in your browser';

  const formatFileSizeMB = (bytes) => {
    const mb = Number(bytes || 0) / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatFilesSizeMB = (files) => {
    const totalBytes = Array.from(files || []).reduce((sum, file) => sum + Number(file?.size || 0), 0);
    return formatFileSizeMB(totalBytes);
  };

  const syncSharedFileRow = (input, file) => {
    const scope = input?.form || document;
    const toolRoot =
      scope.querySelector?.('#audio-tool') ||
      document.getElementById('audio-tool') ||
      document;

    const fileNameNodes = toolRoot.querySelectorAll?.('[data-role="fileName"]') || [];
    const fileRowNodes = toolRoot.querySelectorAll?.('[data-role="fileRow"]') || [];

    fileNameNodes.forEach((node) => {
      node.textContent = file ? file.name : '';
    });

    fileRowNodes.forEach((row) => {
      row.classList.toggle('is-hidden', !file);
    });
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
      input.setAttribute('accept', '.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.mp4,.m4v,.mov,.webm,.mpga,audio/*,video/*');
    }
  };

const dispatchToInput = (input, incomingFiles) => {
  const files = Array.isArray(incomingFiles) ? incomingFiles : [incomingFiles];
  const acceptedFiles = files.filter((file) => fileMatchesInputAccept(input, file));
  if (!acceptedFiles.length) {
    return;
  }

  const transfer = new DataTransfer();
  const nextFiles = input.multiple ? acceptedFiles : [acceptedFiles[0]];
  nextFiles.forEach((file) => {
    transfer.items.add(file);
  });
  input.files = transfer.files;

  input.dispatchEvent(new Event('change', { bubbles: true }));
};

  const ensureContentStructure = (dropzone) => {
    let content = dropzone.querySelector('.upload-content, .upload-dropzone__content');
    if (!content) {
      content = document.createElement('div');
      content.className = dropzone.classList.contains('upload-dropzone')
        ? 'upload-dropzone__content'
        : 'upload-content';
      while (dropzone.firstChild) {
        content.appendChild(dropzone.firstChild);
      }
      dropzone.appendChild(content);
    }

    let icon = content.querySelector('.upload-icon');
    if (!icon) {
      icon = document.createElement('div');
      icon.className = 'upload-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V7"/><path d="m8.5 10.5 3.5-3.5 3.5 3.5"/><path d="M20 16.5a4.5 4.5 0 0 0-1.5-8.74A6 6 0 0 0 7 8.5 4 4 0 0 0 4.2 16"/><path d="M8 20h8"/></svg>';
      content.prepend(icon);
    }

    let primary = content.querySelector('.upload-dropzone__primary, h2');
    if (!primary) {
      primary = document.createElement('h2');
      content.appendChild(primary);
    }
    primary.className = 'upload-dropzone__primary';
    primary.textContent = DEFAULT_PRIMARY_TEXT;

    let secondary = content.querySelector('.upload-dropzone__secondary, p');
    if (!secondary) {
      secondary = document.createElement('p');
      content.appendChild(secondary);
    }
    secondary.className = 'upload-dropzone__secondary';
    secondary.textContent = DEFAULT_FORMAT_TEXT;

    let meta = content.querySelector('.upload-dropzone__meta');
    if (!meta) {
      meta = document.createElement('small');
      meta.className = 'upload-dropzone__meta';
      content.appendChild(meta);
    }
    meta.textContent = DEFAULT_META_TEXT;

    let privacy = content.querySelector('.upload-dropzone__privacy');
    if (!privacy) {
      privacy = document.createElement('small');
      privacy.className = 'upload-dropzone__privacy';
      content.appendChild(privacy);
    }
    privacy.textContent = DEFAULT_PRIVACY_TEXT;

    return { content, primary, secondary, meta, privacy };
  };

  const updateDropzoneLabel = (dropzone, labelText) => {
    const primary = dropzone.querySelector('.upload-dropzone__primary, .upload-content h2, h2');
    if (!primary) {
      return;
    }

    if (labelText) {
      primary.textContent = labelText;
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
    secondary.hidden = true;
    content.appendChild(secondary);
    return secondary;
  };

  const ensureActionsContainer = (dropzone) => {
    let actions = dropzone.querySelector('.upload-actions');
    if (actions) {
      return actions;
    }

    const content = dropzone.querySelector('.upload-content, .upload-dropzone__content') || dropzone;
    actions = document.createElement('div');
    actions.className = 'upload-actions';
    content.appendChild(actions);
    return actions;
  };

  const ensureBrowseButton = (dropzone, input) => {
    let button = dropzone.querySelector('.upload-action');
    if (button) {
      return button;
    }

    const actions = ensureActionsContainer(dropzone);
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'upload-action';
    button.textContent = 'Choose file';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      input.click();
    });
    actions.appendChild(button);
    return button;
  };

  const ensureChangeFileButton = (dropzone, input) => {
    let button = dropzone.querySelector('.upload-change-file');
    if (button) {
      return button;
    }

    const actions = ensureActionsContainer(dropzone);
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'upload-change-file';
    button.textContent = 'Change file';
    button.hidden = true;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      input.click();
    });

    actions.appendChild(button);
    return button;
  };

  const updateDropzoneState = (dropzone, file) => {
    const secondary = ensureSecondaryInfoElement(dropzone);
    const browseButton = dropzone.querySelector('.upload-action');
    const changeButton = dropzone.querySelector('.upload-change-file');
    const meta = dropzone.querySelector('.upload-dropzone__meta');
    const privacy = dropzone.querySelector('.upload-dropzone__privacy');
    const input = findTargetInput(dropzone);
    const selectedFiles = Array.from(input?.files || []);

    if (file) {
      if (selectedFiles.length > 1) {
        updateDropzoneLabel(dropzone, `${selectedFiles.length} files selected`);
        secondary.textContent = `Total size: ${formatFilesSizeMB(selectedFiles)}`;
      } else {
        updateDropzoneLabel(dropzone, file.name);
        secondary.textContent = `File size: ${formatFileSizeMB(file.size)}`;
      }
      secondary.hidden = false;
      dropzone.classList.add('has-file', 'is-confirmed');
      if (meta) {
        meta.hidden = true;
      }
      if (privacy) {
        privacy.hidden = true;
      }
      if (browseButton) {
        browseButton.hidden = true;
      }
      if (changeButton) {
        changeButton.hidden = false;
      }
      return;
    }

    updateDropzoneLabel(dropzone, DEFAULT_PRIMARY_TEXT);
    secondary.textContent = '';
    secondary.hidden = true;
    dropzone.classList.remove('has-file', 'is-confirmed');
    if (meta) {
      meta.hidden = false;
      meta.textContent = DEFAULT_META_TEXT;
    }
    if (privacy) {
      privacy.hidden = false;
      privacy.textContent = DEFAULT_PRIVACY_TEXT;
    }
    if (browseButton) {
      browseButton.hidden = false;
      browseButton.textContent = 'Choose file';
    }
    if (changeButton) {
      changeButton.hidden = true;
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
    ensureContentStructure(dropzone);
    ensureBrowseButton(dropzone, input);
    ensureChangeFileButton(dropzone, input);

    updateDropzoneState(dropzone, Array.from(input.files || [])[0] || null);

    dropzone.dataset[PROCESSED_FLAG] = 'true';
    dropzone.setAttribute('role', dropzone.getAttribute('role') || 'button');
    dropzone.setAttribute('tabindex', dropzone.getAttribute('tabindex') || '0');
    dropzone.setAttribute('aria-label', DEFAULT_PRIMARY_TEXT);

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

      const droppedFiles = Array.from(event.dataTransfer?.files || []);
      if (!droppedFiles.length) {
        return;
      }

      dispatchToInput(input, droppedFiles);
    });

      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        const [file] = files;
        updateDropzoneState(dropzone, file || null);
        syncSharedFileRow(input, file || null);
        if (file) {
          document.dispatchEvent(new CustomEvent('file:selected', {
            detail: { file, files, input }
          }));
        }
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
