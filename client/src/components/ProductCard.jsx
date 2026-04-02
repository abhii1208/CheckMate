function ProductCard({
  product,
  actualStock,
  setActualStock,
  onSubmit,
  isSaving,
  duplicateOptions = [],
  selectedEntryId = '',
  onSelectEntry,
}) {
  if (!product) {
    return (
      <div className="empty-state">
        <h3>Step 3 — Update entry</h3>
        <p>Import your sheet and scan a barcode to load the item and adjust its quantity.</p>
      </div>
    );
  }

  const originalQuantity = Number(product.expected_stock || 0);
  const currentQuantity = Number(product.actual_stock || product.expected_stock || 0);
  const adjustment = Number(actualStock || 0);
  const nextQuantity = currentQuantity + adjustment;
  const changeFromOriginal = nextQuantity - originalQuantity;

  return (
    <section className="panel product-panel">
      <div className="product-header-row">
        <div>
          <span className="eyebrow">Step 3 — Update entry</span>
          <h2>{product.name}</h2>
          <p>Barcode: {product.barcode}</p>
          {product.rowLabel ? <p className="helper-text row-context">Imported row: {product.rowLabel}</p> : null}
        </div>
        <span className={`badge ${changeFromOriginal === 0 ? 'badge-success' : 'badge-danger'}`}>
          Final change {changeFromOriginal >= 0 ? '+' : ''}
          {changeFromOriginal}
        </span>
      </div>

      <div className="product-grid">
        <div className="mini-card">
          <span>Sheet quantity</span>
          <strong>{originalQuantity}</strong>
        </div>
        <div className="mini-card">
          <span>Current quantity</span>
          <strong>{currentQuantity}</strong>
        </div>
        <div className="mini-card">
          <span>New quantity</span>
          <strong>{nextQuantity}</strong>
        </div>
      </div>

      <form
        className="stock-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {duplicateOptions.length > 1 ? (
          <>
            <label>
              Choose matching imported row
              <select value={selectedEntryId} onChange={(event) => onSelectEntry?.(event.target.value)}>
                {duplicateOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.rowLabel}
                  </option>
                ))}
              </select>
            </label>

            <p className="helper-text adjustment-note duplicate-note">
              This barcode appears {duplicateOptions.length} times in the imported file. All rows will stay in the exported sheet.
            </p>
          </>
        ) : null}

        <label>
          Update quantity (+ / -)
          <input
            type="number"
            step="1"
            value={actualStock}
            onChange={(event) => setActualStock(event.target.value)}
            placeholder="Example: -75 or 10"
            required
          />
        </label>

        <p className="helper-text adjustment-note">
          Enter a negative number to reduce stock or a positive number to increase it.
        </p>

        <button type="submit" className="primary-btn" disabled={isSaving}>
          {isSaving ? 'Updating...' : 'Apply update'}
        </button>
      </form>
    </section>
  );
}

export default ProductCard;
