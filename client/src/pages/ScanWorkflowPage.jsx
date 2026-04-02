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
  const [externalScannerReady, setExternalScannerReady] = useState(true);

  const scannerReaderRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const barcodeInputRef = useRef(null);
  const videoRef = useRef(null);
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
    const video = videoRef.current;
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
    try {
      await scannerControlsRef.current?.stop?.();
    } catch (error) {}

    scannerControlsRef.current = null;
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
    if (!availableCameras.length) {
      return;
    }

    const currentIndex = availableCameras.findIndex((camera) => camera.deviceId === selectedCameraId);
    const nextCamera = availableCameras[currentIndex + 1] || availableCameras[0];

    if (!nextCamera?.deviceId || nextCamera.deviceId === selectedCameraId) {
      return;
    }

    setSelectedCameraId(nextCamera.deviceId);
  }, [availableCameras, selectedCameraId]);

  useEffect(() => {
    if (!cameraActive) {
      return undefined;
    }

    let cancelled = false;

    const startCamera = async () => {
      try {
        setIsCameraBusy(true);
        setCameraError('');
        setPageError('');
        await cleanupCamera();

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

        if (!devices?.length) {
          throw new Error('No camera detected on this device.');
        }

        if (cancelled || stopRequestedRef.current) {
          return;
        }

        setAvailableCameras(devices);

        const preferredCamera = selectedCameraId
          || devices.find((device) => /webcam|front|integrated|facetime/i.test(device.label))?.deviceId
          || devices[0].deviceId;

        if (!selectedCameraId) {
          setSelectedCameraId(preferredCamera);
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
          delayBetweenScanAttempts: 70,
          delayBetweenScanSuccess: 500,
          tryPlayVideoTimeout: 6000,
        });
        scannerReaderRef.current = reader;

        const controls = await reader.decodeFromVideoDevice(
          preferredCamera,
          videoRef.current,
          async (result, error, activeControls) => {
            scannerControlsRef.current = activeControls || scannerControlsRef.current;

            if (stopRequestedRef.current || scanHandledRef.current) {
              return;
            }

            if (result) {
              scanHandledRef.current = true;
              const matched = await runLookup(result.getText(), 'camera');

              if (matched) {
                await stopCamera();
              } else {
                scanHandledRef.current = false;
              }

              return;
            }

            if (
              error
              && !(error instanceof NotFoundException)
              && !(error instanceof ChecksumException)
              && !(error instanceof FormatException)
              && !cancelled
            ) {
              setCameraError('Camera is active, but the barcode is not clear enough yet. Hold the phone steady and reduce glare.');
            }
          }
        );

        scannerControlsRef.current = controls;
      } catch (error) {
        if (!cancelled) {
          await cleanupCamera();
          setCameraError('Camera failed to start. Allow camera access and choose the correct webcam.');
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
  }, [cameraActive, cleanupCamera, runLookup, selectedCameraId, setPageError, stopCamera]);

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
          <div className="method-list">
            <div className="method-card method-card-accent">
              <h4>Camera</h4>
              <p>Barcode camera scan now uses a plain live preview with ZXing so the webcam feed starts cleanly and scans immediately.</p>
              <div className="button-row">
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
                  disabled={isCameraBusy || availableCameras.length < 2}
                >
                  Switch camera
                </button>
              </div>
              {availableCameras.length > 1 ? (
                <label className="camera-select">
                  <span>Choose camera</span>
                  <select value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.target.value)}>
                    {availableCameras.map((camera) => (
                      <option key={camera.deviceId} value={camera.deviceId}>
                        {camera.label || `Camera ${camera.deviceId}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="method-card">
              <h4>Image Upload</h4>
              <p>Upload a barcode image or screenshot and let CheckMate decode it.</p>
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
              <h4>Manual Type</h4>
              <p>Type barcode, batch, stock number, name, or combined values like `batch123&gt;stock789`.</p>
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
              <h4>External Scanner</h4>
              <p>{externalScannerReady ? 'Ready. Scanned values fetch matching entries automatically.' : 'Reading scan and fetching the matching entry...'}</p>
            </div>
          </div>

          <div className={`camera-shell ${cameraActive || isCameraBusy ? '' : 'camera-shell-hidden'}`}>
            <div className="camera-frame">
              <video
                ref={videoRef}
                className="camera-reader camera-reader-plain"
                muted
                playsInline
                autoPlay
              />
            </div>
            <p className="helper-text">Hold the phone barcode steady in front of the webcam. If glare appears, tilt the phone slightly and reduce screen brightness a little.</p>
          </div>
          <div id="image-reader" className="sr-only" />
          {cameraError ? <p className="error-text">{cameraError}</p> : null}
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
