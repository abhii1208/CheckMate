import { useNavigate } from 'react-router-dom';

import { useWorkflow } from '../WorkflowContext';

function ExportWorkflowPage() {
  const navigate = useNavigate();
  const {
    importedEntries,
    selectedFileName,
    secondaryFileName,
    statusMessage,
    pageError,
    isExporting,
    exportUpdatedSheet,
  } = useWorkflow();

  const updatedCount = importedEntries.filter((entry) => entry.isEdited || entry.updatedQuantity !== null).length;

  return (
    <div className="page-stack">
      <section className="panel workflow-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Step 4</span>
            <h2>Export Updated Sheet</h2>
            <p>Review what was loaded and changed, then download the updated sheet in the same structure.</p>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-btn" onClick={() => navigate('/update')}>
              Back to Update
            </button>
            <button type="button" className="primary-btn" onClick={exportUpdatedSheet} disabled={isExporting || !importedEntries.length}>
              {isExporting ? 'Preparing...' : 'Download updated sheet'}
            </button>
          </div>
        </div>
        {pageError ? <div className="warning-banner">{pageError}</div> : null}
        {statusMessage ? <div className="success-banner">{statusMessage}</div> : null}
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <p>Primary file</p>
          <h3>{selectedFileName === 'No file selected' ? '-' : '1'}</h3>
          <span>{selectedFileName}</span>
        </div>
        <div className="stat-card">
          <p>Secondary file</p>
          <h3>{secondaryFileName === 'No secondary file selected' ? '0' : '1'}</h3>
          <span>{secondaryFileName}</span>
        </div>
        <div className="stat-card success">
          <p>Total rows</p>
          <h3>{importedEntries.length}</h3>
          <span>Loaded into the workflow</span>
        </div>
        <div className="stat-card warning">
          <p>Updated rows</p>
          <h3>{updatedCount}</h3>
          <span>Ready for export</span>
        </div>
      </section>
    </div>
  );
}

export default ExportWorkflowPage;
