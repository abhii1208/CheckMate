import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import Loader from '../components/Loader';
import { useScannerInput } from '../hooks/useScannerInput';
import { useWorkflow } from '../WorkflowContext';
import { playSuccessTone } from '../utils/scannerAudio';

function ScanWorkflowPage() {
  const navigate = useNavigate();
  const {
    pageError,
    setPageError,
    statusMessage,
    importedEntries,
    duplicateOptions,
    selectedEntryId,
    recentScans,
    selectDuplicateEntry,
    lookupValue,
  } = useWorkflow();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [isCameraBusy, setIsCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isImageScanning, setIsImageScanning] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [preferredFacingMode, setPreferredFacingMode] = useState('environment');
  const [externalScannerReady, setExternalScannerReady] = useState(true);

  const scannerReaderRef = useRef(null);
  const mobileDetectorRef = useRef(null);
  const mobileDetectorTimerRef = useRef(null);
  const barcodeInputRef = useRef(null);
  const cameraStartRequestRef = useRef(0);
  const duplicateScansRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const scanHandledRef = useRef(false);
  const autoLookupTimeoutRef = useRef(null);

  useEffect(() => () => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
  }, []);

  useEffect(() => () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
  }, [imagePreviewUrl]);

  useEffect(() => () => {
    if (autoLookupTimeoutRef.current) {
      window.clearTimeout(autoLookupTimeoutRef.current);
    }
  }, []);

  const forceStopCameraStream = useCallback(() => {
    const container = document.getElementById('camera-reader');
    const video = container?.querySelector('video');
    const mediaStream = video?.srcObject;

    if (mediaStream?.getTracks) {
      mediaStream.getTracks().forEach((track) => {
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
      video.removeAttribute('src');
      video.load?.();
    }
  }, []);

  const cleanupCamera = useCallback(async () => {
    if (mobileDetectorTimerRef.current) {
      window.clearInterval(mobileDetectorTimerRef.current);
      mobileDetectorTimerRef.current = null;
    }

    mobileDetectorRef.current = null;

    try {
      await scannerReaderRef.current?.stop?.();
    } catch (error) {}

    try {
      await scannerReaderRef.current?.clear?.();
    } catch (error) {}

    scannerReaderRef.current = null;
    forceStopCameraStream();
  }, [forceStopCameraStream]);

  const stopCamera = useCallback(async () => {
    stopRequestedRef.current = true;
    setIsCameraBusy(true);

    try {
      await cleanupCamera();
    } finally {
      scanHandledRef.current = false;
      setCameraActive(false);
      setIsCameraBusy(false);
    }
  }, [cleanupCamera]);

  const runLookup = useCallback(async (rawValue, source = 'manual') => {
    const query = String(rawValue || '').trim();

    if (!query) {
      return null;
    }

    const lastSeen = duplicateScansRef.current.get(query) || 0;

    if (Date.now() - lastSeen < 900) {
      return null;
    }

    duplicateScansRef.current.set(query, Date.now());
    setBarcodeInput(query);
    setPageError('');
    setIsLoading(true);

    try {
      const result = await lookupValue(query, source);

      if (result) {
        playSuccessTone(audioContextRef);
        toast.success('Exact entry candidate found.');
        navigate('/update');
      } else {
        const notFoundMessage = `Scanned barcode "${query}" was not found in the imported sheet.`;
        setPageError(notFoundMessage);
        if (source !== 'manual entry') {
          toast.error(notFoundMessage);
        }
      }

      return result;
    } finally {
      setIsLoading(false);
    }
  }, [lookupValue, navigate, setPageError]);

  useScannerInput(async (value) => {
    setExternalScannerReady(false);
    await runLookup(value, 'external scanner');
    window.setTimeout(() => setExternalScannerReady(true), 300);
  }, {
    minLength: 3,
    timeout: 60,
    cooldown: 900,
  });

  useEffect(() => {
    const trimmedValue = barcodeInput.trim();

    if (!trimmedValue || isLoading) {
      return undefined;
    }

    if (autoLookupTimeoutRef.current) {
      window.clearTimeout(autoLookupTimeoutRef.current);
    }

    autoLookupTimeoutRef.current = window.setTimeout(() => {
      if (document.activeElement === barcodeInputRef.current) {
        runLookup(trimmedValue, 'manual entry');
      }
    }, 450);

    return () => {
      if (autoLookupTimeoutRef.current) {
        window.clearTimeout(autoLookupTimeoutRef.current);
      }
    };
  }, [barcodeInput, isLoading, runLookup]);

  const handleStartCamera = useCallback(() => {
    stopRequestedRef.current = false;
    scanHandledRef.current = false;
    setCameraError('');
    setPageError('');
    setCameraActive(true);
  }, [setPageError]);

  const handleSwitchCamera = useCallback(() => {
    if (availableCameras.length > 1) {
      const currentIndex = availableCameras.findIndex((camera) => camera.id === selectedCameraId);
      const nextCamera = availableCameras[currentIndex + 1] || availableCameras[0];

      if (nextCamera?.id && nextCamera.id !== selectedCameraId) {
        setSelectedCameraId(nextCamera.id);
        return;
      }
    }

    setPreferredFacingMode((current) => current === 'environment' ? 'user' : 'environment');
    setSelectedCameraId('');
  }, [availableCameras, selectedCameraId]);

  useEffect(() => {
    if (!cameraActive) {
      return undefined;
    }

    let cancelled = false;
    const requestId = cameraStartRequestRef.current + 1;
    cameraStartRequestRef.current = requestId;

    const startCamera = async () => {
      try {
        setIsCameraBusy(true);
        setCameraError('');
        setPageError('');
        await cleanupCamera();

        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        const devices = await Html5Qrcode.getCameras();
        const normalizedDevices = (devices || []).map((device, index) => ({
          id: device.id || device.deviceId || `${index}`,
          label: device.label || `Camera ${index + 1}`,
        }));

        if (!normalizedDevices.length) {
          throw new Error('No camera detected on this device.');
        }

        if (cancelled || stopRequestedRef.current || cameraStartRequestRef.current !== requestId) {
          return;
        }

        setAvailableCameras(normalizedDevices);

        const preferredCamera = selectedCameraId
          || (
            preferredFacingMode === 'user'
              ? normalizedDevices.find((device) => /front|user|facetime/i.test(device.label))?.id
              : normalizedDevices.find((device) => /back|rear|environment/i.test(device.label))?.id
          )
          || normalizedDevices[0].id;

        if (!selectedCameraId) {
          setSelectedCameraId(preferredCamera);
        }

        const reader = new Html5Qrcode('camera-reader');
        scannerReaderRef.current = reader;

        await reader.start(
          preferredCamera || { facingMode: preferredFacingMode },
          {
            fps: 18,
            disableFlip: false,
            rememberLastUsedCamera: true,
            formatsToSupport: [
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.CODE_93,
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
            ],
          },
          async (decodedText) => {
            if (stopRequestedRef.current || scanHandledRef.current) {
              return;
            }

            scanHandledRef.current = true;
            const matched = await runLookup(decodedText, 'camera');

            if (matched) {
              await stopCamera();
            } else {
              scanHandledRef.current = false;
            }
          },
          () => {}
        );

        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
          try {
            mobileDetectorRef.current = new window.BarcodeDetector({
              formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'],
            });

            mobileDetectorTimerRef.current = window.setInterval(async () => {
              if (stopRequestedRef.current || scanHandledRef.current || !mobileDetectorRef.current) {
                return;
              }

              const container = document.getElementById('camera-reader');
              const video = container?.querySelector('video');

              if (!video || video.readyState < 2 || video.videoWidth < 10 || video.videoHeight < 10) {
                return;
              }

              try {
                const detections = await mobileDetectorRef.current.detect(video);
                const firstDetection = detections?.[0];
                const detectedValue = firstDetection?.rawValue;

                if (!detectedValue) {
                  return;
                }

                scanHandledRef.current = true;
                const matched = await runLookup(detectedValue, 'camera');

                if (matched) {
                  await stopCamera();
                } else {
                  scanHandledRef.current = false;
                }
              } catch (error) {}
            }, 250);
          } catch (error) {
            mobileDetectorRef.current = null;
          }
        }

        if (!cancelled && cameraStartRequestRef.current === requestId) {
          setCameraActive(true);
        }
      } catch (error) {
        if (!cancelled) {
          await cleanupCamera();
          setCameraError('Camera failed to start. Allow camera access and then try switching between front and back cameras.');
          setCameraActive(false);
        }
      } finally {
        if (!cancelled) {
          setIsCameraBusy(false);
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopRequestedRef.current = true;
      cleanupCamera();
    };
  }, [cameraActive, cleanupCamera, preferredFacingMode, runLookup, selectedCameraId, setPageError, stopCamera]);

  const handleImageUpload = async (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      setPageError('Please upload a valid barcode image.');
      event.target.value = '';
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    setImagePreviewUrl(URL.createObjectURL(selectedFile));
    await stopCamera();
    setCameraError('');
    setPageError('');

    let imageScanner;

    try {
      setIsImageScanning(true);
      const { Html5Qrcode } = await import('html5-qrcode');
      imageScanner = new Html5Qrcode('image-reader');
      const decodedText = await imageScanner.scanFile(selectedFile, false);
      await runLookup(decodedText, 'image upload');
    } catch (error) {
      setPageError('No readable barcode was found in that image. Try a clearer, closer photo.');
    } finally {
      if (imageScanner) {
        try {
          await imageScanner.clear();
        } catch (clearError) {}
      }

      setIsImageScanning(false);
      event.target.value = '';
    }
  };

  if (!importedEntries.length) {
    return (
      <section className="panel">
        <div className="warning-banner">Import a sheet first, then return here to scan and filter entries.</div>
      </section>
    );
  }

  return (
    <div className="page-stack">
      <section className="panel workflow-panel scan-hero-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Step 2</span>
            <h2>Scan And Filter</h2>
            <p>Use camera, image, manual type, or an external scanner. After each update, you return here to scan the next item or identifier.</p>
          </div>
          <button type="button" className="secondary-btn" onClick={() => navigate('/update')}>
            Go to Update
          </button>
        </div>
        {pageError ? <div className="warning-banner">{pageError}</div> : null}
        {statusMessage ? <div className="success-banner">{statusMessage}</div> : null}
      </section>

      <section className="scanner-grid">
        <div className={`panel scan-panel ${cameraActive || isCameraBusy ? 'scan-panel-active' : ''}`}>
          <div className="scan-primary">
            <div className="section-header scan-section-header">
              <div>
                <h3>Live barcode scan</h3>
                <p>Open the camera and hold the barcode steady. Matching entries load automatically as soon as the code is detected.</p>
              </div>
            </div>

            <div className="button-row scan-control-row">
              <button type="button" className="primary-btn" onClick={handleStartCamera} disabled={cameraActive || isCameraBusy}>
                {isCameraBusy && !cameraActive ? 'Starting...' : 'Start camera'}
              </button>
              <button type="button" className="secondary-btn" onClick={stopCamera} disabled={!cameraActive && !isCameraBusy}>
                {isCameraBusy && cameraActive ? 'Stopping...' : 'Stop camera'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleSwitchCamera}
                disabled={isCameraBusy || (!availableCameras.length && !cameraActive)}
              >
                {preferredFacingMode === 'environment' ? 'Front camera' : 'Back camera'}
              </button>
            </div>

            {availableCameras.length > 1 ? (
              <label className="camera-select">
                <span>Camera source</span>
                <select value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.target.value)}>
                  {availableCameras.map((camera) => (
                    <option key={camera.id} value={camera.id}>
                      {camera.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className={`camera-shell ${cameraActive || isCameraBusy ? '' : 'camera-shell-hidden'}`}>
            <div className="camera-frame">
              <div id="camera-reader" className="camera-reader camera-reader-plain" />
              <div className="camera-guides" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
            <p className="helper-text">Tip: keep the barcode flat and close enough to focus. On phones, use the camera button to switch between rear and front lenses.</p>
          </div>
          <div id="image-reader" className="sr-only" />
          {cameraError ? <p className="error-text">{cameraError}</p> : null}

          <div className="method-list method-list-secondary">
            <div className="method-card">
              <h4>Manual entry</h4>
              <form
                className="barcode-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runLookup(barcodeInput, 'manual entry');
                }}
              >
                <input
                  ref={barcodeInputRef}
                  data-scanner-allow="true"
                  type="text"
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                  placeholder="Enter barcode, batch>stock, SKU, name, or location"
                />
                <button type="submit" className="primary-btn">Search</button>
              </form>
            </div>

            <div className="method-card">
              <h4>Image upload</h4>
              <label className="file-upload-row">
                <span className="secondary-btn">Choose barcode image</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} />
              </label>
              {isImageScanning ? <p className="helper-text">Scanning selected image...</p> : null}
              {imagePreviewUrl ? (
                <div className="image-preview-box">
                  <img src={imagePreviewUrl} alt="Uploaded barcode preview" />
                </div>
              ) : null}
            </div>

            <div className="method-card">
              <h4>External scanner</h4>
              <p>{externalScannerReady ? 'Ready for direct barcode input.' : 'Reading scan and fetching the matching entry...'}</p>
            </div>
          </div>
        </div>

        <section className="panel product-panel scan-result-panel">
          <div className="section-header">
            <div>
              <h3>Current Filter Result</h3>
              <p>Use repeated scans or combined values to reduce the result set before updating.</p>
            </div>
          </div>

          {duplicateOptions.length > 1 ? (
            <label className="editor-field">
              <span>Matched entries</span>
              <select value={selectedEntryId} onChange={(event) => selectDuplicateEntry(event.target.value)}>
                {duplicateOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.rowLabel}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="helper-text">Scan or type a value to load one or more exact entry matches here.</div>
          )}

          {recentScans.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Value</th>
                    <th>Matched by</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {recentScans.map((scan, index) => (
                    <tr key={`${scan.barcode}-${index}`}>
                      <td>{scan.time}</td>
                      <td>{scan.barcode}</td>
                      <td>{scan.matchedBy}</td>
                      <td>{scan.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </section>

      {isLoading ? <Loader label="Finding the exact entry..." /> : null}
    </div>
  );
}

export default ScanWorkflowPage;
