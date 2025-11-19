const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const app = express();

app.use(express.json());

// ⭐ Correct CORS configuration
app.use(
  cors({
    origin: ["http://localhost:5173", "https://my-payfort-api.onrender.com"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ⭐ Handle OPTIONS preflight
app.options("*", cors());

// ---------- SIGNATURE HELPERS ----------
function createSignature(params, requestPhrase) {
  const sorted = Object.keys(params).sort();
  const concatenated = sorted.map((key) => `${key}=${params[key]}`).join("");
  const toHash = `${requestPhrase}${concatenated}${requestPhrase}`;
  return crypto.createHash("sha256").update(toHash).digest("hex");
}

function encryptOrderDetails(text, secretKey) {
  const toHash = `${secretKey}${text}${secretKey}`;
  return crypto.createHash("sha256").update(toHash).digest("hex");
}

function generateMerchantReference(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TXN-${result}`;
}

// ---------- MAIN PAYFORT ENDPOINT ----------
app.post("/createFormPayLoad", async (req, res) => {
  try {
    const orderID = generateMerchantReference(12);
    const RqPhrase = "$2y$10$Ta0481EDF";

    let formPayLoad = {
      service_command: "PURCHASE",
      language: "en",
      merchant_identifier: "4ada67b5",
      access_code: "M4sQwfE5v1O5QkjocgPW",
      return_url: "https://httpbin.org/post",
      merchant_reference: orderID,
    };

    const details = `${req.body.amount},${req.body.currency},${req.body.email}`;
    const encryptedDetails = encryptOrderDetails(details, RqPhrase);

    formPayLoad.return_url = `${formPayLoad.return_url}?data=${encodeURIComponent(
      encryptedDetails
    )}`;

    formPayLoad.signature = createSignature(formPayLoad, RqPhrase);

    return res.status(200).json({
      success: true,
      message: "Signature created successfully",
      payload: formPayLoad,
    });
  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
