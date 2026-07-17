const router = require("express").Router();
const { getInvoiceByToken } = require("../controllers/invoiceController");

// Public — see invoiceController.js's header comment. Mounted at
// /invoices/:token in index.js.
router.get("/:token", getInvoiceByToken);

module.exports = router;
