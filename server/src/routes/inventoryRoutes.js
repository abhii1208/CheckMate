const express = require('express');
const multer = require('multer');

const productController = require('../controllers/productController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const isAllowedFile = /\.(xlsx|csv)$/i.test(file.originalname || '');

    if (isAllowedFile) {
      callback(null, true);
      return;
    }

    callback(new Error('Only .xlsx and .csv files are allowed.'));
  },
});

router.get('/dashboard', productController.getDashboard);
router.get('/products', productController.listProducts);
router.post('/upload', upload.single('file'), productController.uploadInventory);
router.get('/product/:barcode', productController.getProduct);
router.post('/update-stock', productController.updateStock);
router.get('/logs', productController.getLogs);

module.exports = router;
