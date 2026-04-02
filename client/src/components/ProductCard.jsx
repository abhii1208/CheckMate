import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useScannerInput } from '../hooks/useScannerInput';
import { normalizeText, normalizeToken } from '../utils/inventorySheet';

const SPOKEN_NUMBER_MAP = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
};

function parseSpokenQuantity(text) {
  const directMatch = String(text || '').match(/\d+/);

  if (directMatch) {
    return Number.parseInt(directMatch[0], 10);
  }

  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);

  if (!words.length) {
    return null;
  }

  let total = 0;
  let current = 0;

  words.forEach((word) => {
    const value = SPOKEN_NUMBER_MAP[word];

    if (value === undefined) {
      return;
    }

    if (value === 100 || value === 1000) {
      current = Math.max(current, 1) * value;
      if (value === 1000) {
        total += current;
        current = 0;
      }
      return;
    }

    current += value;
  });

  const resolved = total + current;
  return Number.isInteger(resolved) && resolved >= 0 ? resolved : null;
}

function getDuplicateMatches(entries, rawQuery) {
  const query = normalizeText(rawQuery);
  const token = normalizeToken(query);

  if (!query || !token) {
    return [];
  }

  const exactMatches = [];
  const partialMatches = [];

  entries.forEach((entry) => {
    const values = [entry.rowLabel, ...(entry.rowValues || [])]
      .map((value) => normalizeToken(value))
      .filter(Boolean);

    if (values.some((value) => value === token)) {
      exactMatches.push(entry);
      return;
    }

    if (values.some((value) => value.includes(token))) {
      partialMatches.push(entry);
    }
  });

  return [...exactMatches, ...partialMatches];
}

function ProductCard({
  product,
  rowHeaders = [],
  onRowValueChange,
  onSubmit,
  isSaving,
  duplicateOptions = [],
  selectedEntryId = '',
  onSelectEntry,
}) {
  const recognitionRef = useRef(null);
  const micStreamRef = useRef(null);
  const duplicateFilterRef = useRef(null);
  const duplicateImageInputRef = useRef(null);
  const duplicateCameraVideoRef = useRef(null);
  const duplicateCameraReaderRef = useRef(null);
  const duplicateCameraControlsRef = useRef(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [duplicateFilter, setDuplicateFilter] = useState('');
  const [duplicateFilterMessage, setDuplicateFilterMessage] = useState('');
  const [duplicateCameraActive, setDuplicateCameraActive] = useState(false);
  const [duplicateCameraBusy, setDuplicateCameraBusy] = useState(false);
  const [duplicateCameraError, setDuplicateCameraError] = useState('');
  const [duplicateImageScanning, setDuplicateImageScanning] = useState(false);

  const SpeechRecognitionClass = useMemo(
    () => (
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition || null
        : null
    ),
    []
  );

  useEffect(() => {
    setVoiceSupported(Boolean(SpeechRecognitionClass));

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }

      if (micStreamRef.current?.getTracks) {
        micStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (error) {}
        });
        micStreamRef.current = null;
      }

      duplicateCameraControlsRef.current?.stop?.().catch?.(() => {});
    };
  }, [SpeechRecognitionClass]);

  if (!product) {
    return (
      <div className="empty-state">
        <h3>Step 3 - Review and update entry</h3>
        <p>Import your sheet, scan any matching value, then edit the detected entry before saving it.</p>
      </div>
    );
  }

  const quantityIndex = Number.isInteger(product.quantityColumnIndex) ? product.quantityColumnIndex : -1;
  const currentQuantity = quantityIndex >= 0 ? product.rowValues?.[quantityIndex] ?? '' : '';
  const priorityIndexes = [
    quantityIndex,
    product.barcodeColumnIndex,
    product.nameColumnIndex,
  ].filter((value, index, array) => Number.isInteger(value) && value >= 0 && array.indexOf(value) === index);
  const orderedIndexes = [
    ...priorityIndexes,
    ...rowHeaders.map((_, index) => index).filter((index) => !priorityIndexes.includes(index)),
  ];
  const narrowedDuplicateOptions = useMemo(() => {
    const query = normalizeText(duplicateFilter);
    return query ? getDuplicateMatches(duplicateOptions, query) : duplicateOptions;
  }, [duplicateFilter, duplicateOptions]);

  useEffect(() => {
    setDuplicateFilter('');
    setDuplicateFilterMessage('');
  }, [duplicateOptions, selectedEntryId]);

  const applyDuplicateFilter = useCallback((rawQuery, sourceLabel) => {
    const query = normalizeText(rawQuery);

    if (!query || duplicateOptions.length < 2) {
      return;
    }

    const matches = getDuplicateMatches(duplicateOptions, query);
    setDuplicateFilter(query);

    if (matches.length === 1) {
      onSelectEntry?.(matches[0].id);
      setDuplicateFilterMessage(`Exact entry selected from ${sourceLabel}.`);
      return;
    }

    if (matches.length > 1) {
      setDuplicateFilterMessage(`${matches.length} entries still match. Refine the value to lock the exact one.`);
      return;
    }

    setDuplicateFilterMessage(`No imported entry exists for "${query}".`);
  }, [duplicateOptions, onSelectEntry]);

  const stopDuplicateCamera = useCallback(async () => {
    setDuplicateCameraBusy(true);

    try {
      await duplicateCameraControlsRef.current?.stop?.();
    } catch (error) {}

    duplicateCameraControlsRef.current = null;
    duplicateCameraReaderRef.current = null;

    const video = duplicateCameraVideoRef.current;
    const stream = video?.srcObject;

    if (stream?.getTracks) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {}
      });
    }

    if (video) {
      try {
        video.pause();
      } catch (error) {}
      video.srcObject = null;
    }

    setDuplicateCameraActive(false);
    setDuplicateCameraBusy(false);
  }, []);

  const startDuplicateCamera = useCallback(async () => {
    try {
      setDuplicateCameraBusy(true);
      setDuplicateCameraError('');

      const [{ BrowserCodeReader, BrowserMultiFormatReader }, zxingLibrary] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const {
        BarcodeFormat,
        DecodeHintType,
        NotFoundException,
        ChecksumException,
        FormatException,
      } = zxingLibrary;

      const devices = await BrowserCodeReader.listVideoInputDevices();
      const preferredCamera = devices.find((device) => /back|rear|environment/i.test(device.label))
        || devices.find((device) => /front|webcam|integrated|facetime/i.test(device.label))
        || devices[0];

      if (!preferredCamera?.deviceId) {
        throw new Error('No camera detected.');
      }

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 80,
        delayBetweenScanSuccess: 500,
        tryPlayVideoTimeout: 5000,
      });

      duplicateCameraReaderRef.current = reader;
      setDuplicateCameraActive(true);

      const controls = await reader.decodeFromVideoDevice(
        preferredCamera.deviceId,
        duplicateCameraVideoRef.current,
        async (result, error, activeControls) => {
          duplicateCameraControlsRef.current = activeControls || duplicateCameraControlsRef.current;

          if (result) {
            const nextValue = result.getText();
            setDuplicateFilter(nextValue);
            applyDuplicateFilter(nextValue, 'camera');
            await stopDuplicateCamera();
            return;
          }

          if (
            error
            && !(error instanceof NotFoundException)
            && !(error instanceof ChecksumException)
            && !(error instanceof FormatException)
          ) {
            setDuplicateCameraError('Inline camera is active but the barcode is not clear enough yet.');
          }
        }
      );

      duplicateCameraControlsRef.current = controls;
    } catch (error) {
      setDuplicateCameraError('Could not start the inline camera scanner right now.');
      setDuplicateCameraActive(false);
    } finally {
      setDuplicateCameraBusy(false);
    }
  }, [applyDuplicateFilter, stopDuplicateCamera]);

  const handleDuplicateImageUpload = async (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      setDuplicateFilterMessage('Please upload a valid barcode image.');
      event.target.value = '';
      return;
    }

    try {
      setDuplicateImageScanning(true);
      const { Html5Qrcode } = await import('html5-qrcode');
      const imageScanner = new Html5Qrcode('duplicate-image-reader');
      const decodedText = await imageScanner.scanFile(selectedFile, false);
      setDuplicateFilter(decodedText);
      applyDuplicateFilter(decodedText, 'image upload');
      await imageScanner.clear();
    } catch (error) {
      setDuplicateFilterMessage('No readable barcode was found in that image.');
    } finally {
      setDuplicateImageScanning(false);
      event.target.value = '';
    }
  };

  useScannerInput((value) => {
    if (duplicateOptions.length > 1) {
      applyDuplicateFilter(value, 'external scanner');
    }
  }, {
    minLength: 3,
    timeout: 60,
    cooldown: 900,
  });

  const stopVoiceCapture = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    if (micStreamRef.current?.getTracks) {
      micStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {}
      });
      micStreamRef.current = null;
    }
  };

  const startVoiceCapture = async () => {
    if (!SpeechRecognitionClass || quantityIndex < 0) {
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (error) {
      setVoiceError('Microphone permission is blocked. Allow microphone access, then try voice quantity again.');
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      const parsedQuantity = parseSpokenQuantity(transcript);

      if (Number.isInteger(parsedQuantity)) {
        onRowValueChange?.(quantityIndex, String(parsedQuantity));
        setVoiceError('');
      } else {
        setVoiceError(`Could not understand "${transcript}". Try speaking only the quantity clearly.`);
      }
    };

    recognition.onerror = (event) => {
      const nextError = event?.error === 'not-allowed'
        ? 'Microphone access was denied. Allow microphone access, then try again.'
        : event?.error === 'no-speech'
          ? 'No speech was detected. Try again and say only the quantity.'
          : event?.error === 'network'
            ? 'Voice recognition needs a supported browser connection. Try Chrome on localhost or HTTPS.'
            : 'Voice entry could not start on this browser right now.';
      setVoiceError(nextError);
    };

    recognition.onend = () => {
      if (micStreamRef.current?.getTracks) {
        micStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (error) {}
        });
        micStreamRef.current = null;
      }

      setIsListening(false);
      recognitionRef.current = null;
    };

    setVoiceError('');
    setIsListening(true);
    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <section className="panel product-panel">
      <div className="product-header-row">
        <div>
          <span className="eyebrow">Step 3 - Review and update entry</span>
          <h2>{product.name}</h2>
          <p>Primary code: {product.barcode || 'Not available'}</p>
          {product.rowLabel ? <p className="helper-text row-context">Imported entry: {product.rowLabel}</p> : null}
          {product.matchLabel ? <p className="helper-text row-context">Matched by: {product.matchLabel}</p> : null}
        </div>
        <span className={`badge ${quantityIndex >= 0 ? 'badge-success' : 'badge-warning'}`}>
          {quantityIndex >= 0 ? `Quantity ${currentQuantity || 0}` : 'General entry editor'}
        </span>
      </div>

      {duplicateOptions.length > 1 ? (
        <div className="duplicate-picker">
          <div className="duplicate-picker-head">
            <div>
              <span className="eyebrow">Possible Matches</span>
              <strong>Choose matching imported entry</strong>
            </div>
            <span className="badge badge-warning">{duplicateOptions.length} matches</span>
          </div>
          <label className="duplicate-picker-field">
            <span>Imported entry</span>
            <select value={selectedEntryId} onChange={(event) => onSelectEntry?.(event.target.value)}>
              {narrowedDuplicateOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.rowLabel}
                </option>
              ))}
            </select>
          </label>
          <div className="duplicate-picker-tools">
            <label className="duplicate-picker-search">
              <span>Narrow exact entry</span>
              <div className="field-inline-row">
                <input
                  ref={duplicateFilterRef}
                  data-scanner-allow="true"
                  type="text"
                  value={duplicateFilter}
                  onChange={(event) => setDuplicateFilter(event.target.value)}
                  placeholder="Scan here, type manually, or use external scanner"
                />
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => applyDuplicateFilter(duplicateFilter, 'manual entry')}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={duplicateCameraActive ? stopDuplicateCamera : startDuplicateCamera}
                  disabled={duplicateCameraBusy}
                >
                  {duplicateCameraBusy ? 'Starting...' : duplicateCameraActive ? 'Stop camera' : 'Scan camera'}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => duplicateImageInputRef.current?.click()}
                  disabled={duplicateImageScanning}
                >
                  {duplicateImageScanning ? 'Scanning image...' : 'Upload image'}
                </button>
              </div>
            </label>
            {duplicateCameraActive ? (
              <div className="duplicate-camera-box">
                <video
                  ref={duplicateCameraVideoRef}
                  className="duplicate-camera-video"
                  muted
                  playsInline
                  autoPlay
                />
              </div>
            ) : null}
            <input
              ref={duplicateImageInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleDuplicateImageUpload}
            />
            <div id="duplicate-image-reader" className="sr-only" />
            <p className="helper-text duplicate-tool-note">
              Use this field to scan again with camera, upload an image, type batch or stock no manually, or fetch directly from an external barcode scanner.
            </p>
            {duplicateCameraError ? <p className="error-text duplicate-camera-error">{duplicateCameraError}</p> : null}
            {duplicateFilterMessage ? <p className="helper-text duplicate-filter-message">{duplicateFilterMessage}</p> : null}
          </div>
          <p className="helper-text duplicate-note">
            {narrowedDuplicateOptions.length
              ? 'This value appears in multiple imported entries. Narrow it until one exact entry remains.'
              : 'No exact entry is available for the narrowed value.'}
          </p>
        </div>
      ) : null}

      <form
        className="stock-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="editor-grid quick-editor-grid">
          {orderedIndexes.slice(0, 3).map((index) => (
            <label
              key={`${rowHeaders[index]}-${index}`}
              className={index === quantityIndex ? 'editor-field is-quantity editor-field-priority' : 'editor-field editor-field-priority'}
            >
              <span>{rowHeaders[index]}</span>
              {index === quantityIndex ? (
                <>
                  <div className="field-inline-row">
                    <input
                      type="number"
                      step="1"
                      value={product.rowValues?.[index] ?? ''}
                      onChange={(event) => onRowValueChange?.(index, event.target.value)}
                      placeholder={`Update ${rowHeaders[index]}`}
                    />
                    {voiceSupported ? (
                      <button
                        type="button"
                        className={`secondary-btn voice-btn ${isListening ? 'voice-btn-live' : ''}`}
                        onClick={isListening ? stopVoiceCapture : startVoiceCapture}
                      >
                        {isListening ? 'Stop voice' : 'Voice qty'}
                      </button>
                    ) : null}
                  </div>
                  {voiceSupported ? (
                    <p className="helper-text voice-note">
                      Speak only the quantity and it will fill this field automatically.
                    </p>
                  ) : null}
                  {voiceError ? <p className="error-text voice-note">{voiceError}</p> : null}
                </>
              ) : (
                <input
                  type="text"
                  value={product.rowValues?.[index] ?? ''}
                  onChange={(event) => onRowValueChange?.(index, event.target.value)}
                  placeholder={`Update ${rowHeaders[index]}`}
                />
              )}
            </label>
          ))}
        </div>

        {orderedIndexes.length > 3 ? (
          <details className="editor-details">
            <summary>More columns</summary>
            <div className="editor-grid">
              {orderedIndexes.slice(3).map((index) => (
                <label key={`${rowHeaders[index]}-${index}`} className="editor-field">
                  <span>{rowHeaders[index]}</span>
                  <input
                    type="text"
                    value={product.rowValues?.[index] ?? ''}
                    onChange={(event) => onRowValueChange?.(index, event.target.value)}
                    placeholder={`Update ${rowHeaders[index]}`}
                  />
                </label>
              ))}
            </div>
          </details>
        ) : null}

        {orderedIndexes.length === 0 ? (
          <div className="editor-grid">
            {rowHeaders.map((header, index) => (
              <label key={`${header}-${index}`} className={index === quantityIndex ? 'editor-field is-quantity' : 'editor-field'}>
                <span>{header}</span>
                <input
                  type={index === quantityIndex ? 'number' : 'text'}
                  step={index === quantityIndex ? '1' : undefined}
                  value={product.rowValues?.[index] ?? ''}
                  onChange={(event) => onRowValueChange?.(index, event.target.value)}
                  placeholder={`Update ${header}`}
                />
              </label>
            ))}
          </div>
        ) : null}

        <div className="editor-actions">
          <p className="helper-text adjustment-note">
            Quick fields stay on top for faster entry. Open more columns only when you need to edit extra details.
          </p>
          <button type="submit" className="primary-btn" disabled={isSaving}>
            {isSaving ? 'Saving entry...' : 'Save entry updates'}
          </button>
        </div>
      </form>
    </section>
  );
}

export default ProductCard;
